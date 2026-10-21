import base64
import gzip
import importlib.util
import io
import json
from contextlib import redirect_stdout
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('web_api_repair_installer',
    ROOT / 'tools/install-web-api-repair.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
REAL_CAPTURE_UI = m.capture_ui
REAL_CHECK_UI = m.check_ui
REAL_WAIT_READY = m.wait_ready
REAL_PROBE_HISTORIES = m.probe_histories
PRODUCTION_BASE_FILES = dict(m.BASE_FILES)
PRODUCTION_BASE_ALTERNATES = dict(m.BASE_ALTERNATES)
PRODUCTION_UI_APPS = dict(m.UI_APPS)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.releases = self.folder / 'releases'
        self.live = self.releases / 'live'
        self.live.mkdir(parents=True)
        self.backups = self.folder / 'backups'
        self.server = 'scripts/server.mjs'
        self.reader = 'scripts/state-reader.mjs'
        self.old_server = b'export const oldServer = true;\n'
        self.new_server = b'export const newServer = true;\n'
        self.new_reader = b'export const stateReaderVersion = 1;\n'
        self.alternate_server = b'export const reviewedAlternateServer = true;\n'
        self.csp = 'scripts/content-security-policy.mjs'
        self.old_content = {name: self.old_server if name == self.server else
            ('export const old_' + Path(name).stem.replace('-', '_') + ' = true;\n').encode()
            for name, digest in PRODUCTION_BASE_FILES.items() if digest is not None}
        self.new_content = {name: self.new_server if name == self.server else
            self.new_reader if name == self.reader else
            ('export const new_' + Path(name).stem.replace('-', '_') + ' = true;\n').encode()
            for name in PRODUCTION_BASE_FILES}
        for name, data in self.old_content.items():
            self.write(name, data)
        self.ui = {
            'web/index.html': b'<script src="/fti-mainnet-ui-f52f5261b5b036f9/app.js"></script>',
            'web/fti-mainnet-ui-f52f5261b5b036f9/app.js': b'live app f52',
            'landing/dist/index.html': b'<script src="/assets/main-2c013412.js"></script>',
            'landing/dist/assets/main-2c013412.js': b'live landing 2c013',
            'landing/dist/token-site/index.html': b'live public token page',
            'landing/dist/whitepaper/index.html': b'live whitepaper',
            'landing/dist/roadmap/index.html': b'live roadmap',
        }
        for name, data in self.ui.items():
            self.write(name, data)
        self.write('.env', b'private environment sentinel')
        self.write('node_modules/dependency/keep.js', b'preserved dependency')
        self.saved = {'LoadState': 'loaded', 'ActiveState': 'active', 'SubState': 'running',
            'User': 'fti-v3', 'Group': 'fti-v3', 'MainPID': '1234',
            'WorkingDirectory': str(self.live)}
        self.cfg = dict(m.EXPECTED_CONFIG, poolDistributionVersion=1, hourlyCapFlushVersion=1)
        self.restart_calls = 0
        self.ready_calls = 0
        self.failure = None
        self.requests = []
        self.ready_failures = 0
        self.restart_failures = 0
        self.histories = {origin: {kind: {'status': 200, 'available': True}
            for kind in ('market', 'events')} for origin in ('local', 'public')}
        self.release = self.payload(self.new_content)
        for name, value in [('RELEASES', self.releases), ('BACKUPS', self.backups),
                ('BASE_FILES', {name: m.sha(self.old_content[name]) if name in self.old_content else None
                                for name in PRODUCTION_BASE_FILES}),
                ('BASE_ALTERNATES', {self.server: (m.sha(self.alternate_server),),
                                    self.csp: (m.sha(self.new_content[self.csp]),)})]:
            p = patch.object(m, name, value)
            p.start()
            self.addCleanup(p.stop)
        for name, fn in [('properties', lambda: dict(self.saved)),
                ('unit_metadata', lambda *_: {}),
                ('capture_runtime', lambda *_: {'node': '/opt/fti/runtime/node-v22.20.0/bin/node',
                                               'unitMeta': {}}),
                ('capture_ui', self.capture_ui), ('check_ui', self.check_ui),
                ('run_syntax', lambda *_: None), ('run_import', lambda *_: None),
                ('restart_web', self.restart_web),
                ('wait_ready', self.wait_ready), ('fetch', self.fetch),
                ('probe_histories', lambda: self.histories)]:
            p = patch.object(m, name, side_effect=fn)
            p.start()
            self.addCleanup(p.stop)

    def write(self, name, data):
        target = self.live / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def payload(self, content):
        files = {name: m.sha(data) for name, data in content.items()}
        return {'schema': 'FTI_WEB_API_REPAIR_V1', 'files': files,
            'payloads': {name: base64.b64encode(gzip.compress(data, mtime=0)).decode()
                         for name, data in content.items()},
            'releaseId': m.sha(json.dumps(files, sort_keys=True).encode())[:16]}

    def backup(self):
        return next(self.backups.glob('install-*'))

    def assert_original_server(self):
        self.assertEqual((self.live / self.server).read_bytes(), self.old_server)

    def assert_original_existing_files(self):
        for name, data in self.old_content.items():
            self.assertEqual((self.live / name).read_bytes(), data, name)

    def assert_installed(self):
        for name, data in self.new_content.items():
            self.assertEqual((self.live / name).read_bytes(), data, name)

    def assert_unrelated_unchanged(self):
        for name, data in self.ui.items():
            self.assertEqual((self.live / name).read_bytes(), data, name)
        self.assertEqual((self.live / '.env').read_bytes(), b'private environment sentinel')
        self.assertEqual((self.live / 'node_modules/dependency/keep.js').read_bytes(),
            b'preserved dependency')

    def use_reviewed_alternate_baseline(self):
        self.old_server = self.alternate_server
        self.old_content[self.server] = self.alternate_server
        self.old_content[self.csp] = self.new_content[self.csp]
        self.write(self.server, self.alternate_server)
        self.write(self.csp, self.new_content[self.csp])

    def capture_ui(self, root):
        return {'files': {name: m.sha(data) for name, data in self.ui.items()}, 'routes': {}}

    def check_ui(self, root, ui):
        for name, digest in ui['files'].items():
            if m.sha((root / name).read_bytes()) != digest:
                raise RuntimeError('Protected UI changed: ' + name)

    def fetch(self, url, *args, **kwargs):
        self.requests.append(url)
        route = url.split('://', 1)[1].partition('/')[2]
        if route == 'health':
            return json.dumps({'ok': self.failure != 'unhealthy', 'chainId': self.cfg['chainId'],
                               'block': 128837199}).encode()
        if route == 'api/config':
            cfg = dict(self.cfg)
            if (self.live / self.server).read_bytes() == self.new_server:
                cfg['stateReaderVersion'] = 1
                cfg['eventHistoryVersion'] = 1
            return json.dumps(cfg).encode()
        if route.startswith('api/state'):
            numeric = ('price supply reserve bb floor ath clock count epoch epochEnd phase level pointPool '
                       'pending auto jobCursor jobCount cursor monthPhase nextMonth builderMultiplier cycle '
                       'cycleStartPrice calculatedPointValue candidatePoints pointValue totalPaidPoints '
                       'rewardQueue pointRetained builderRetained pointAssigned dirtyMembers').split()
            state = {name: '0' for name in numeric}
            state.update({name: False for name in ('paused', 'tokenPaused', 'emergencyUnwind',
                'binaryRecoveryFrozen', 'tokenRecoveryFrozen')})
            state.update(block=128837199, timestamp=1792538982, rewardModel='hourly-global-pool-v2',
                pricingModel='zero-start-reserve-v3', account1=['0', '0'], account2=['0', '0'],
                blockHash='0x' + '1' * 64, development='0x' + '2' * 40)
            if '?wallet=' in route:
                state['wallet'] = dict(address=m.KNOWN_WALLET, exists=True, units='1', usdBalance='0',
                    ftiBalance='400707000000000000000', unlocked='400707000000000000000', remaining='0',
                    claimable='0', autoPending='0')
            if self.failure == 'incomplete-state':
                del state['price']
            return json.dumps(state).encode()
        page = m.UI_ROUTES.get('/' + route)
        if page:
            return (self.live / page).read_bytes()
        if route.startswith('assets/'):
            return (self.live / 'landing/dist' / route).read_bytes()
        if route.startswith('fti-mainnet-ui-'):
            return (self.live / 'web' / route).read_bytes()
        raise AssertionError('Unexpected HTTP route: ' + route)

    def restart_web(self):
        self.restart_calls += 1
        if self.restart_failures:
            self.restart_failures -= 1
            self.saved.update(ActiveState='failed', SubState='failed', MainPID='0')
            raise RuntimeError('Simulated restart failure')
        self.saved.update(ActiveState='active', SubState='running',
            MainPID=str(1234 + self.restart_calls))

    def wait_ready(self, root, config, ui, *args, **kwargs):
        self.ready_calls += 1
        if self.ready_failures:
            self.ready_failures -= 1
            raise RuntimeError('Simulated postflight failure')
        self.check_ui(self.live, ui)
        return self.histories

    def test_installs_scoped_backend_files_once_without_changing_ui_environment_or_dependencies(self):
        m.apply(self.release)
        self.assert_installed()
        self.assert_unrelated_unchanged()
        self.assertEqual(self.restart_calls, 1)
        self.assertTrue(self.backup().is_dir())
        self.assertTrue((self.backup() / 'installer.py').is_file())

    def test_second_install_is_idempotent_without_another_restart(self):
        m.apply(self.release)
        m.apply(self.release)
        self.assert_installed()
        self.assertEqual(self.restart_calls, 1)
        self.assertEqual(len(list(self.backups.glob('install-*'))), 1)
        self.assert_unrelated_unchanged()

    def test_unknown_server_hash_stops_before_backup_or_restart(self):
        self.write(self.server, b'operator server change')
        with self.assertRaises(RuntimeError):
            m.apply(self.release)
        self.assertEqual((self.live / self.server).read_bytes(), b'operator server change')
        self.assertFalse(self.backups.exists())
        self.assertFalse((self.live / self.reader).exists())
        self.assertEqual(self.restart_calls, 0)

    def test_preexisting_reader_is_preserved_and_blocks_install(self):
        self.write(self.reader, b'operator reader')
        with self.assertRaises(RuntimeError):
            m.apply(self.release)
        self.assert_original_server()
        self.assertEqual((self.live / self.reader).read_bytes(), b'operator reader')
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.restart_calls, 0)

    def test_wrong_chain_contract_or_network_stop_before_writes(self):
        for key, value in [('chainId', 97), ('binary', '0x' + '0' * 40), ('mode', 'bnb-testnet')]:
            before = self.cfg[key]
            self.cfg[key] = value
            with self.assertRaises(RuntimeError):
                m.apply(self.release)
            self.cfg[key] = before
        self.assert_original_server()
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.restart_calls, 0)

    def test_corrupt_payload_cannot_write_or_restart(self):
        broken = json.loads(json.dumps(self.release))
        broken['payloads'][self.reader] = base64.b64encode(gzip.compress(b'corrupt')).decode()
        with self.assertRaises(RuntimeError):
            m.apply(broken)
        self.assert_original_server()
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.restart_calls, 0)

    def test_payload_cannot_add_another_backend_or_secret_path(self):
        for name in ['scripts/other.mjs', '../secret', '.env']:
            broken = self.payload(dict(self.new_content, **{name: b'unauthorized'}))
            with self.assertRaises(RuntimeError):
                m.apply(broken)
        self.assert_original_server()
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.restart_calls, 0)

    def test_restart_failure_restores_original_entrypoint_even_when_service_inactive(self):
        self.restart_failures = 1
        with self.assertRaisesRegex(RuntimeError, 'restart failure'):
            m.apply(self.release)
        self.assert_original_server()
        self.assertEqual(self.restart_calls, 2)
        self.assertEqual(self.saved['ActiveState'], 'active')
        self.assert_unrelated_unchanged()

    def test_postflight_failure_restores_original_entrypoint_and_restarts_it(self):
        self.ready_failures = 1
        with self.assertRaisesRegex(RuntimeError, 'postflight failure'):
            m.apply(self.release)
        self.assert_original_server()
        self.assertEqual(self.restart_calls, 2)
        self.assert_unrelated_unchanged()

    def test_manual_restore_restores_old_server_and_preserves_unrelated_files(self):
        m.apply(self.release)
        m.restore(self.backup())
        self.assert_original_server()
        self.assertEqual(self.restart_calls, 2)
        self.assert_unrelated_unchanged()

    def test_manual_restore_preserves_concurrent_operator_server_and_does_not_restart_it(self):
        m.apply(self.release)
        self.write(self.server, b'operator server after install')
        with self.assertRaises(RuntimeError):
            m.restore(self.backup())
        self.assertEqual((self.live / self.server).read_bytes(), b'operator server after install')
        self.assertEqual(self.restart_calls, 1)

    def test_manual_restore_does_not_touch_or_restart_new_deployment(self):
        m.apply(self.release)
        new = self.releases / 'operator-release'
        new.mkdir()
        self.saved['WorkingDirectory'] = str(new)
        with self.assertRaises(RuntimeError):
            m.restore(self.backup())
        self.assert_installed()
        self.assertEqual(self.restart_calls, 1)

    def test_reader_write_failure_never_switches_entrypoint_or_restarts(self):
        original = m.save_new
        def fail_reader(file, data, *args, **kwargs):
            if file == self.live / self.reader:
                raise OSError('Simulated reader write failure')
            return original(file, data, *args, **kwargs)
        with patch.object(m, 'save_new', side_effect=fail_reader):
            with self.assertRaisesRegex(OSError, 'reader write failure'):
                m.apply(self.release)
        self.assert_original_server()
        self.assertFalse((self.live / self.reader).exists())
        self.assertEqual(self.restart_calls, 0)
        self.assert_unrelated_unchanged()

    def test_partial_reader_write_cannot_activate_backend_and_is_preserved_if_unowned(self):
        original = m.save_new
        def partial_reader(file, data, *args, **kwargs):
            if file == self.live / self.reader:
                original(file, data[:5], *args, **kwargs)
                raise OSError('Simulated partial reader write')
            return original(file, data, *args, **kwargs)
        with patch.object(m, 'save_new', side_effect=partial_reader):
            with self.assertRaisesRegex(OSError, 'partial reader write'):
                m.apply(self.release)
        self.assert_original_server()
        self.assertEqual((self.live / self.reader).read_bytes(), self.new_reader[:5])
        self.assertEqual(self.restart_calls, 0)
        self.assert_unrelated_unchanged()

    def test_server_rename_failure_rolls_back_reader_without_restart(self):
        original = m.replace
        def fail_server(file, data, info):
            if file == self.live / self.server and data == self.new_server:
                raise OSError('Simulated server rename failure')
            return original(file, data, info)
        with patch.object(m, 'replace', side_effect=fail_server):
            with self.assertRaisesRegex(OSError, 'server rename failure'):
                m.apply(self.release)
        self.assert_original_server()
        self.assertFalse((self.live / self.reader).exists())
        self.assertEqual(self.restart_calls, 0)

    def test_fsync_failure_after_server_rename_restores_both_files_without_restart(self):
        original = m.replace
        def fail_after_server(file, data, info):
            original(file, data, info)
            if file == self.live / self.server and data == self.new_server:
                raise OSError('Simulated fsync failure after server rename')
        with patch.object(m, 'replace', side_effect=fail_after_server):
            with self.assertRaisesRegex(OSError, 'fsync failure'):
                m.apply(self.release)
        self.assert_original_server()
        self.assertFalse((self.live / self.reader).exists())
        self.assertEqual(self.restart_calls, 0)

    def test_import_failure_restores_staged_files_without_restart(self):
        with patch.object(m, 'run_import', side_effect=RuntimeError('Simulated import failure')):
            with self.assertRaisesRegex(RuntimeError, 'import failure'):
                m.apply(self.release)
        self.assert_original_server()
        self.assertFalse((self.live / self.reader).exists())
        self.assertEqual(self.restart_calls, 0)

    def test_operator_server_edit_during_import_is_preserved_without_restart(self):
        def operator_edit(*_):
            self.write(self.server, b'operator server during import')
        with patch.object(m, 'run_import', side_effect=operator_edit):
            with self.assertRaises(RuntimeError):
                m.apply(self.release)
        self.assertEqual((self.live / self.server).read_bytes(), b'operator server during import')
        self.assertEqual((self.live / self.reader).read_bytes(), self.new_reader)
        self.assertEqual(self.restart_calls, 0)

    def test_operator_reader_edit_during_import_is_preserved_without_restart(self):
        def operator_edit(*_):
            self.write(self.reader, b'operator reader during import')
        with patch.object(m, 'run_import', side_effect=operator_edit):
            with self.assertRaises(RuntimeError):
                m.apply(self.release)
        self.assert_original_server()
        self.assertEqual((self.live / self.reader).read_bytes(), b'operator reader during import')
        self.assertEqual(self.restart_calls, 0)

    def test_ui_change_during_import_is_preserved_and_prevents_restart(self):
        def operator_edit(*_):
            self.write('web/index.html', b'operator UI update')
        with patch.object(m, 'run_import', side_effect=operator_edit):
            with self.assertRaises(RuntimeError):
                m.apply(self.release)
        self.assert_original_server()
        self.assertEqual((self.live / 'web/index.html').read_bytes(), b'operator UI update')
        self.assertEqual(self.restart_calls, 0)

    def test_new_working_directory_during_import_is_never_restarted_or_rolled_back(self):
        new = self.releases / 'operator-release'
        new.mkdir()
        def concurrent_deployment(*_):
            self.saved['WorkingDirectory'] = str(new)
        with patch.object(m, 'run_import', side_effect=concurrent_deployment):
            with self.assertRaises(RuntimeError):
                m.apply(self.release)
        self.assert_installed()
        self.assertEqual(self.restart_calls, 0)
        self.assertEqual(list(new.iterdir()), [])

    def test_operator_server_edit_after_restart_is_preserved_without_second_restart(self):
        def operator_edit(*_):
            self.write(self.server, b'operator entrypoint after restart')
            raise RuntimeError('Simulated operator postflight edit')
        with patch.object(m, 'wait_ready', side_effect=operator_edit):
            with self.assertRaisesRegex(RuntimeError, 'operator postflight edit'):
                m.apply(self.release)
        self.assertEqual((self.live / self.server).read_bytes(), b'operator entrypoint after restart')
        self.assertEqual((self.live / self.reader).read_bytes(), self.new_reader)
        for name, data in self.new_content.items():
            if name != self.server:
                self.assertEqual((self.live / name).read_bytes(), data, name)
        self.assertEqual(self.restart_calls, 1)

    def test_deleted_reader_during_postflight_still_restores_entrypoint(self):
        def deleted_reader(*_):
            (self.live / self.reader).unlink()
            raise RuntimeError('Simulated reader deletion')
        with patch.object(m, 'wait_ready', side_effect=deleted_reader):
            with self.assertRaisesRegex(RuntimeError, 'reader deletion'):
                m.apply(self.release)
        self.assert_original_server()
        self.assertFalse((self.live / self.reader).exists())
        self.assertEqual(self.restart_calls, 2)
        self.assert_unrelated_unchanged()

    def test_symlinked_reader_during_postflight_still_restores_entrypoint_and_preserves_link(self):
        def linked_reader(*_):
            (self.live / self.reader).unlink()
            (self.live / self.reader).symlink_to(self.live / 'node_modules/dependency/keep.js')
            raise RuntimeError('Simulated reader symlink')
        with patch.object(m, 'wait_ready', side_effect=linked_reader):
            with self.assertRaisesRegex(RuntimeError, 'reader symlink'):
                m.apply(self.release)
        self.assert_original_server()
        self.assertTrue((self.live / self.reader).is_symlink())
        self.assertEqual(self.restart_calls, 2)
        self.assert_unrelated_unchanged()

    def test_new_working_directory_after_restart_preserves_new_deployment(self):
        new = self.releases / 'operator-release'
        new.mkdir()
        def deployment_changed(*_):
            self.saved['WorkingDirectory'] = str(new)
        with patch.object(m, 'wait_ready', side_effect=deployment_changed):
            with self.assertRaises(RuntimeError):
                m.apply(self.release)
        self.assert_installed()
        self.assertEqual(self.restart_calls, 1)
        self.assertEqual(list(new.iterdir()), [])

    def test_marker_check_rejects_legacy_backend_and_accepts_installed_version(self):
        with self.assertRaisesRegex(RuntimeError, 'not active'):
            m.check_web(m.LOCAL, marker=True)
        m.apply(self.release)
        self.assertEqual(m.check_web(m.LOCAL, marker=True)['stateReaderVersion'], 1)

    def test_capture_ui_validates_both_reviewed_workspace_prefixes_and_public_documents(self):
        for prefix in PRODUCTION_UI_APPS:
            app = ('fixture ' + prefix).encode()
            self.write('web/index.html', ('<script src="/' + prefix + '/app.js"></script>').encode())
            self.write('web/' + prefix + '/app.js', app)
            with patch.object(m, 'UI_APPS', {prefix: m.sha(app)}), \
                    patch.object(m, 'check_ui', side_effect=REAL_CHECK_UI):
                captured = REAL_CAPTURE_UI(self.live)
            self.assertIn('web/' + prefix + '/app.js', captured['files'])
            self.assertIn('/' + prefix + '/app.js', captured['routes'])
            for route in m.UI_ROUTES:
                self.assertIn(route, captured['routes'])

    def test_production_baselines_are_exact_and_have_only_the_reviewed_backend_paths(self):
        self.assertEqual(PRODUCTION_BASE_FILES, {
            'scripts/server.mjs': '31b576910e1d7573d7efd34efa16ecbcc84eb236c72a00579d59acc173a34353',
            'scripts/event-reader.mjs': '14fe424f4f1008f7f873b7a5c32fc13f960f73ac033d099eb15bb9199ad7b008',
            'scripts/market-reader.mjs': '0ddf1d9cf6e6dd48d854c1bf51b2e0e7b5884e984401f32b79f30a56b5c43e36',
            'scripts/state-reader.mjs': None, 'scripts/history-cache.mjs': None,
            'scripts/event-history-source.mjs': None, 'scripts/content-security-policy.mjs': None})
        self.assertEqual(PRODUCTION_BASE_ALTERNATES, {
            'scripts/server.mjs': ('24acf84c4b74703c47228184b999dc5007a983e7df13ded5814739a400cc957d',),
            'scripts/content-security-policy.mjs': ('30fefc98d19a95e424433ef9d0b5538b15599c52d02311f3bd2ba42fa49961ad',)})
        self.assertEqual(set(PRODUCTION_UI_APPS), {'fti-mainnet-ui-f52f5261b5b036f9',
            'fti-mainnet-ui-2c0130354c3b16c3'})

    def test_package_embeds_exactly_reviewed_backend_files_and_is_importable(self):
        build = self.folder / 'build'
        for name, data in self.new_content.items():
            target = build / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        output = self.folder / 'release.py'
        m.package(build, output)
        packaged_spec = importlib.util.spec_from_file_location('packaged_api_repair', output)
        packaged = importlib.util.module_from_spec(packaged_spec)
        packaged_spec.loader.exec_module(packaged)
        _, content, _ = packaged.release_files(packaged.RELEASE)
        self.assertEqual(content, self.new_content)
        with self.assertRaises(FileExistsError):
            m.package(build, output)

    def test_partial_existing_module_update_rolls_back_all_owned_files(self):
        original = m.replace
        market = 'scripts/market-reader.mjs'
        def fail_market(file, data, info):
            if file == self.live / market and data == self.new_content[market]:
                raise OSError('Simulated market rename failure')
            return original(file, data, info)
        with patch.object(m, 'replace', side_effect=fail_market):
            with self.assertRaisesRegex(OSError, 'market rename failure'):
                m.apply(self.release)
        self.assert_original_existing_files()
        for name, digest in PRODUCTION_BASE_FILES.items():
            if digest is None:
                self.assertFalse((self.live / name).exists(), name)
        self.assertEqual(self.restart_calls, 0)

    def test_postflight_failure_rolls_back_every_existing_module_and_removes_only_owned_helpers(self):
        self.ready_failures = 1
        with self.assertRaisesRegex(RuntimeError, 'postflight failure'):
            m.apply(self.release)
        self.assert_original_existing_files()
        for name, digest in PRODUCTION_BASE_FILES.items():
            if digest is None:
                self.assertFalse((self.live / name).exists(), name)
        self.assertEqual(self.restart_calls, 2)

    def test_foreign_existing_module_preserves_helpers_and_blocks_rollback_restart(self):
        market = 'scripts/market-reader.mjs'
        operator = b'import "./history-cache.mjs"; // operator change\n'
        def operator_edit(*_):
            self.write(market, operator)
            raise RuntimeError('Simulated foreign dependent module')
        with patch.object(m, 'wait_ready', side_effect=operator_edit):
            with self.assertRaisesRegex(RuntimeError, 'foreign dependent module'):
                m.apply(self.release)
        self.assert_original_server()
        self.assertEqual((self.live / market).read_bytes(), operator)
        for name, digest in PRODUCTION_BASE_FILES.items():
            if digest is None:
                self.assertEqual((self.live / name).read_bytes(), self.new_content[name], name)
        self.assertEqual(self.restart_calls, 1)
        self.assert_unrelated_unchanged()

    def test_deleted_entrypoint_preserves_all_staged_dependencies_and_blocks_rollback_restart(self):
        def delete_entry(*_):
            (self.live / self.server).unlink()
            raise RuntimeError('Simulated deleted entrypoint')
        with patch.object(m, 'wait_ready', side_effect=delete_entry):
            with self.assertRaisesRegex(RuntimeError, 'deleted entrypoint'):
                m.apply(self.release)
        self.assertFalse((self.live / self.server).exists())
        for name, data in self.new_content.items():
            if name != self.server:
                self.assertEqual((self.live / name).read_bytes(), data, name)
        self.assertEqual(self.restart_calls, 1)
        self.assert_unrelated_unchanged()

    def test_symlinked_entrypoint_preserves_all_staged_dependencies_and_blocks_rollback_restart(self):
        def link_entry(*_):
            (self.live / self.server).unlink()
            (self.live / self.server).symlink_to(self.live / 'node_modules/dependency/keep.js')
            raise RuntimeError('Simulated symlinked entrypoint')
        with patch.object(m, 'wait_ready', side_effect=link_entry):
            with self.assertRaisesRegex(RuntimeError, 'symlinked entrypoint'):
                m.apply(self.release)
        self.assertTrue((self.live / self.server).is_symlink())
        for name, data in self.new_content.items():
            if name != self.server:
                self.assertEqual((self.live / name).read_bytes(), data, name)
        self.assertEqual(self.restart_calls, 1)
        self.assert_unrelated_unchanged()

    def test_low_space_stops_before_backup_or_any_backend_change(self):
        tiny = SimpleNamespace(f_bavail=0, f_frsize=4096, f_favail=10000)
        with patch.object(m.os, 'statvfs', return_value=tiny):
            with self.assertRaisesRegex(RuntimeError, 'Insufficient'):
                m.apply(self.release)
        self.assert_original_existing_files()
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.restart_calls, 0)

    def test_corrupted_backup_is_rejected_before_restoring_any_file(self):
        m.apply(self.release)
        (self.backup() / 'before/scripts/server.mjs').write_bytes(b'corrupted backup')
        with self.assertRaisesRegex(RuntimeError, 'backup checksum mismatch'):
            m.restore(self.backup())
        self.assert_installed()
        self.assertEqual(self.restart_calls, 1)

    def test_actual_postflight_checks_general_and_known_wallet_state_at_both_origins(self):
        self.write(self.server, self.new_server)
        self.cfg['genesis'] = [m.KNOWN_WALLET]
        REAL_WAIT_READY(self.live, dict(self.cfg), self.capture_ui(self.live))
        for origin in (m.LOCAL, m.PUBLIC):
            self.assertIn(origin + '/api/state', self.requests)
            self.assertIn(origin + '/api/state?wallet=' + m.KNOWN_WALLET, self.requests)
        self.assertEqual(self.restart_calls, 0)

    def test_actual_postflight_rejects_incomplete_state(self):
        self.write(self.server, self.new_server)
        self.failure = 'incomplete-state'
        with self.assertRaisesRegex(RuntimeError, 'Incomplete state'):
            REAL_WAIT_READY(self.live, dict(self.cfg), self.capture_ui(self.live))

    def test_actual_postflight_rejects_missing_new_marker_with_bounded_wait(self):
        with patch.object(m.time, 'monotonic', side_effect=[0, 181]), \
                patch.object(m.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'did not become healthy'):
                REAL_WAIT_READY(self.live, dict(self.cfg), self.capture_ui(self.live))
        sleep.assert_not_called()

    def test_each_existing_backend_hash_is_checked_before_any_install_writes(self):
        for name, data in self.old_content.items():
            with self.subTest(path=name):
                self.write(name, b'operator existing module')
                with self.assertRaisesRegex(RuntimeError, 'base mismatch'):
                    m.apply(self.release)
                self.assertEqual((self.live / name).read_bytes(), b'operator existing module')
                self.write(name, data)
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.restart_calls, 0)

    def test_each_new_helper_must_be_absent_before_install(self):
        for name, digest in PRODUCTION_BASE_FILES.items():
            if digest is None:
                with self.subTest(path=name):
                    self.write(name, b'operator helper')
                    with self.assertRaisesRegex(RuntimeError, 'base mismatch'):
                        m.apply(self.release)
                    self.assertEqual((self.live / name).read_bytes(), b'operator helper')
                    (self.live / name).unlink()
        self.assert_original_existing_files()
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.restart_calls, 0)

    def test_health_block_must_be_positive_integer_not_boolean(self):
        original = self.fetch
        def boolean_block(url, *args, **kwargs):
            data = original(url, *args, **kwargs)
            if url.endswith('/health'):
                row = json.loads(data)
                row['block'] = True
                return json.dumps(row).encode()
            return data
        with patch.object(m, 'fetch', side_effect=boolean_block):
            with self.assertRaisesRegex(RuntimeError, 'health unavailable'):
                m.check_web(m.LOCAL)

    def test_state_reader_version_must_be_integer_one_not_boolean(self):
        self.write(self.server, self.new_server)
        original = self.fetch
        def boolean_marker(url, *args, **kwargs):
            data = original(url, *args, **kwargs)
            if url.endswith('/api/config'):
                row = json.loads(data)
                row['stateReaderVersion'] = True
                return json.dumps(row).encode()
            return data
        with patch.object(m, 'fetch', side_effect=boolean_marker):
            with self.assertRaisesRegex(RuntimeError, 'not active'):
                m.check_web(m.LOCAL, marker=True)

    def test_both_reader_markers_must_be_integer_one(self):
        self.write(self.server, self.new_server)
        original = self.fetch
        for marker in ('stateReaderVersion', 'eventHistoryVersion'):
            for value in (None, True, '1', 0):
                with self.subTest(marker=marker, value=value):
                    def wrong_marker(url, *args, **kwargs):
                        data = original(url, *args, **kwargs)
                        if url.endswith('/api/config'):
                            row = json.loads(data)
                            if value is None:
                                row.pop(marker)
                            else:
                                row[marker] = value
                            return json.dumps(row).encode()
                        return data
                    with patch.object(m, 'fetch', side_effect=wrong_marker):
                        with self.assertRaisesRegex(RuntimeError, 'not active'):
                            m.check_web(m.LOCAL, marker=True)

    def test_same_config_ignores_only_the_two_added_version_markers(self):
        before = dict(self.cfg)
        after = dict(before, stateReaderVersion=1, eventHistoryVersion=1)
        self.assertTrue(m.same_config(before, after))
        self.assertFalse(m.same_config(before, dict(after, walletConnectProjectId='operator-change')))

    def test_state_requires_nonzero_canonical_block_hash(self):
        state = json.loads(self.fetch(m.LOCAL + '/api/state'))
        m.validate_state(state)
        for value in (None, '', '0x' + '0' * 64, '0x1234', '0x' + 'g' * 64):
            with self.subTest(value=value):
                broken = dict(state)
                if value is None:
                    del broken['blockHash']
                else:
                    broken['blockHash'] = value
                with self.assertRaisesRegex(RuntimeError, 'block hash'):
                    m.validate_state(broken)

    def test_optional_development_address_must_be_valid_and_nonzero_when_present(self):
        state = json.loads(self.fetch(m.LOCAL + '/api/state'))
        del state['development']
        m.validate_state(state)
        for value in ('0x' + '0' * 40, '0x1234', None, '0x' + 'g' * 40):
            with self.subTest(value=value):
                with self.assertRaisesRegex(RuntimeError, 'development address'):
                    m.validate_state(dict(state, development=value))

    def test_history_503_with_retry_after_and_honest_error_is_accepted(self):
        response = {'status': 503, 'headers': {'retry-after': '15'},
            'body': json.dumps({'error': 'Market history unavailable; no fabricated volume.'}).encode()}
        for kind in ('market', 'events'):
            with self.subTest(kind=kind), patch.object(m, 'history_response', return_value=response):
                self.assertEqual(m.check_history(m.LOCAL + '/api/' + kind, kind),
                    {'status': 503, 'available': False, 'retryAfter': 15})

    def test_history_503_rejects_missing_or_wrong_retry_after(self):
        for value in (None, '0', '10', '15 ', 15):
            response = {'status': 503, 'headers': {} if value is None else {'retry-after': value},
                'body': json.dumps({'error': 'History unavailable.'}).encode()}
            with self.subTest(value=value), patch.object(m, 'history_response', return_value=response):
                with self.assertRaisesRegex(RuntimeError, 'retry interval'):
                    m.check_history(m.LOCAL + '/api/market', 'market')

    def test_history_503_rejects_fabricated_arrays_or_missing_error(self):
        for body in ([], {'error': ''}, {}, {'error': 'unavailable', 'trades': []},
                     {'error': 'unavailable', 'events': []}):
            response = {'status': 503, 'headers': {'retry-after': '15'}, 'body': json.dumps(body).encode()}
            with self.subTest(body=body), patch.object(m, 'history_response', return_value=response):
                with self.assertRaisesRegex(RuntimeError, 'honest error'):
                    m.check_history(m.LOCAL + '/api/market', 'market')

    def test_history_200_validates_market_ranges_and_event_list_shapes(self):
        valid = {'market': {'fromBlock': 128837100, 'toBlock': 128837199, 'trades': []}, 'events': []}
        for kind, body in valid.items():
            response = {'status': 200, 'headers': {}, 'body': json.dumps(body).encode()}
            with self.subTest(kind=kind), patch.object(m, 'history_response', return_value=response):
                self.assertEqual(m.check_history(m.LOCAL + '/api/' + kind, kind),
                    {'status': 200, 'available': True})
        invalid = [('market', []), ('market', {'fromBlock': 2, 'toBlock': 1, 'trades': []}),
            ('market', {'fromBlock': True, 'toBlock': 2, 'trades': []}),
            ('market', {'fromBlock': 0, 'toBlock': 2, 'trades': {}}),
            ('market', {'fromBlock': 0, 'toBlock': 2, 'trades': [], 'error': 'unavailable'}),
            ('events', {'events': []})]
        for kind, body in invalid:
            response = {'status': 200, 'headers': {}, 'body': json.dumps(body).encode()}
            with self.subTest(kind=kind, body=body), patch.object(m, 'history_response', return_value=response):
                with self.assertRaises(RuntimeError):
                    m.check_history(m.LOCAL + '/api/' + kind, kind)

    def test_history_unknown_status_or_malformed_json_is_rejected(self):
        for status in (400, 404, 500, 502, 504):
            response = {'status': status, 'headers': {}, 'body': b'{}'}
            with self.subTest(status=status), patch.object(m, 'history_response', return_value=response):
                with self.assertRaisesRegex(RuntimeError, 'HTTP status'):
                    m.check_history(m.LOCAL + '/api/events', 'events')
        with patch.object(m, 'history_response', return_value={'status': 200, 'headers': {}, 'body': b'not JSON'}):
            with self.assertRaises(ValueError):
                m.check_history(m.LOCAL + '/api/events', 'events')

    def test_history_http_error_preserves_503_body_and_uses_bounded_get(self):
        body = b'{"error":"history unavailable"}'
        error = HTTPError(m.LOCAL + '/api/events', 503, 'Unavailable', {'Retry-After': '15'}, io.BytesIO(body))
        opener = MagicMock()
        opener.open.side_effect = error
        with patch.object(m.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(m.history_response(m.LOCAL + '/api/events'),
                {'status': 503, 'headers': {'retry-after': '15'}, 'body': body})
        self.assertEqual(opener.open.call_args.kwargs['timeout'], 25)
        self.assertEqual(opener.open.call_args.args[0].get_method(), 'GET')

    def test_probe_histories_runs_four_bounded_origin_and_kind_probes(self):
        barrier = threading.Barrier(4, timeout=2)
        calls = []
        def checked(url, kind):
            calls.append((url, kind))
            barrier.wait()
            return {'status': 200, 'available': True}
        with patch.object(m, 'check_history', side_effect=checked):
            result = REAL_PROBE_HISTORIES()
        self.assertEqual(set(calls), {(origin + '/api/' + kind, kind)
            for origin in (m.LOCAL, m.PUBLIC) for kind in ('market', 'events')})
        self.assertEqual(result, self.histories)

    def test_actual_mixed_history_availability_does_not_rollback_good_state_and_is_reported(self):
        def response(url):
            if url == m.LOCAL + '/api/market':
                return {'status': 503, 'headers': {'retry-after': '15'},
                    'body': b'{"error":"Market history temporarily unavailable."}'}
            body = {'fromBlock': 128837100, 'toBlock': 128837199, 'trades': []} if url.endswith('/market') else []
            return {'status': 200, 'headers': {}, 'body': json.dumps(body).encode()}
        output = io.StringIO()
        with patch.object(m, 'wait_ready', side_effect=REAL_WAIT_READY), \
                patch.object(m, 'probe_histories', side_effect=REAL_PROBE_HISTORIES), \
                patch.object(m, 'history_response', side_effect=response), redirect_stdout(output):
            m.apply(self.release)
            m.apply(self.release)
        reports = [json.loads(line) for line in output.getvalue().splitlines() if line.startswith('{')]
        self.assertEqual(reports[0]['result'], 'FTI_WEB_API_REPAIR_INSTALLED')
        self.assertEqual(reports[1]['result'], 'FTI_WEB_API_REPAIR_ALREADY_INSTALLED')
        for report in reports:
            availability = report['historyAvailable']
            self.assertEqual(availability['local']['market'], {'status': 503, 'available': False, 'retryAfter': 15})
            self.assertEqual(availability['public']['market'], {'status': 200, 'available': True})
            self.assertEqual(availability['local']['events'], {'status': 200, 'available': True})
        self.assert_installed()
        self.assertEqual(self.restart_calls, 1)
        self.assert_unrelated_unchanged()

    def test_malformed_history_postflight_rolls_back_backend_without_fabricated_success(self):
        response = {'status': 503, 'headers': {'retry-after': '5'}, 'body': b'{"error":"unavailable"}'}
        with patch.object(m, 'wait_ready', side_effect=REAL_WAIT_READY), \
                patch.object(m, 'probe_histories', side_effect=REAL_PROBE_HISTORIES), \
                patch.object(m, 'history_response', return_value=response):
            with self.assertRaisesRegex(RuntimeError, 'retry interval'):
                m.apply(self.release)
        self.assert_original_existing_files()
        self.assertEqual(self.restart_calls, 2)
        self.assert_unrelated_unchanged()

    def test_default_reviewed_server_and_absent_csp_helper_install_idempotently_and_restore(self):
        m.apply(self.release)
        record = json.loads((self.backup() / 'record.json').read_text())
        self.assertEqual(record['before'][self.server], m.sha(self.old_server))
        self.assertIsNone(record['before'][self.csp])
        self.assert_installed()
        m.apply(self.release)
        self.assertEqual(self.restart_calls, 1)
        m.restore(self.backup())
        self.assert_original_existing_files()
        self.assertFalse((self.live / self.csp).exists())
        self.assertEqual(self.restart_calls, 2)
        self.assert_unrelated_unchanged()

    def test_reviewed_alternate_server_and_identical_csp_are_not_rewritten_and_restore_exactly(self):
        self.use_reviewed_alternate_baseline()
        original_csp_inode = (self.live / self.csp).stat().st_ino
        original_replace = m.replace
        with patch.object(m, 'replace', wraps=original_replace) as replacements:
            m.apply(self.release)
            record = json.loads((self.backup() / 'record.json').read_text())
            self.assertEqual(record['before'][self.server], m.sha(self.alternate_server))
            self.assertEqual(record['before'][self.csp], m.sha(self.new_content[self.csp]))
            self.assert_installed()
            m.apply(self.release)
            self.assertEqual(self.restart_calls, 1)
            m.restore(self.backup())
        self.assertFalse(any(call.args[0] == self.live / self.csp for call in replacements.call_args_list))
        self.assertEqual((self.live / self.csp).stat().st_ino, original_csp_inode)
        self.assert_original_existing_files()
        self.assertEqual(self.restart_calls, 2)
        for name in self.new_content:
            if name not in self.old_content:
                self.assertFalse((self.live / name).exists(), name)
        self.assert_unrelated_unchanged()

    def test_alternate_baseline_postflight_failure_restores_actual_server_and_keeps_existing_csp(self):
        self.use_reviewed_alternate_baseline()
        csp_inode = (self.live / self.csp).stat().st_ino
        self.ready_failures = 1
        with self.assertRaisesRegex(RuntimeError, 'postflight failure'):
            m.apply(self.release)
        self.assert_original_existing_files()
        self.assertEqual((self.live / self.csp).stat().st_ino, csp_inode)
        self.assertEqual(self.restart_calls, 2)
        for name in self.new_content:
            if name not in self.old_content:
                self.assertFalse((self.live / name).exists(), name)
        self.assert_unrelated_unchanged()

    def test_unreviewed_present_csp_helper_is_preserved_and_rejected_before_any_install_write(self):
        operator = b'export function contentSecurityPolicy() { return "operator"; }\n'
        self.write(self.csp, operator)
        with self.assertRaisesRegex(RuntimeError, 'base mismatch'):
            m.apply(self.release)
        self.assertEqual((self.live / self.csp).read_bytes(), operator)
        self.assert_original_existing_files()
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.restart_calls, 0)

    def test_reviewed_alternate_hashes_are_accepted_only_for_their_own_paths(self):
        self.write(self.csp, self.alternate_server)
        with self.assertRaisesRegex(RuntimeError, 'base mismatch'):
            m.apply(self.release)
        self.assertEqual((self.live / self.csp).read_bytes(), self.alternate_server)
        self.assert_original_existing_files()
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.restart_calls, 0)

    def test_manual_restore_preserves_foreign_edit_to_preexisting_reviewed_csp_helper(self):
        self.use_reviewed_alternate_baseline()
        m.apply(self.release)
        operator = b'operator CSP change after backend install'
        self.write(self.csp, operator)
        with self.assertRaisesRegex(RuntimeError, 'changed concurrently'):
            m.restore(self.backup())
        self.assertEqual((self.live / self.csp).read_bytes(), operator)
        self.assertEqual((self.live / self.server).read_bytes(), self.new_server)
        self.assertEqual(self.restart_calls, 1)
        self.assert_unrelated_unchanged()


if __name__ == '__main__':
    unittest.main()
