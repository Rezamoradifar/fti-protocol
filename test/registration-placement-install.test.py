import base64
import gzip
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('registration_placement_installer',
    ROOT / 'tools/install-registration-placement.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
PRODUCTION_BASE_FILES = dict(m.BASE_FILES)
PRODUCTION_REQUIRED_FILES = dict(m.REQUIRED_FILES)
PRODUCTION_SERVERS = tuple(m.REVIEWED_SERVERS)
REAL_CAPTURE_UI = m.capture_ui
REAL_CHECK_UI = m.check_ui
REAL_WAIT_READY = m.wait_ready
REAL_RPC_ANCHOR = m.rpc_anchor


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.releases = self.folder / 'releases'
        self.live = self.releases / 'live'
        self.live.mkdir(parents=True)
        self.backups = self.folder / 'backups'
        self.entry = m.ENTRY
        self.old_module = b'export const previousPlacement = true;\n'
        self.new_module = b'export const verifiedPlacement = true;\n'
        self.write(self.entry, self.old_module)
        self.dependencies = {name: ('reviewed dependency ' + name).encode() for name in PRODUCTION_REQUIRED_FILES}
        self.servers = [b'reviewed old server', b'reviewed CSP server', b'reviewed API repair server']
        self.dependencies['scripts/server.mjs'] = self.servers[0]
        for name, data in self.dependencies.items():
            self.write(name, data)
        self.ui = {
            'web/index.html': b'unchanged app entry', 'web/app.js': b'unchanged app JavaScript',
            'web/vendor/walletconnect.js': b'unchanged wallet SDK',
            'landing/dist/index.html': b'unchanged landing',
            'landing/dist/token-site/index.html': b'unchanged public token page',
            'landing/dist/whitepaper/index.html': b'unchanged whitepaper',
            'landing/dist/roadmap/index.html': b'unchanged roadmap',
        }
        for name, data in self.ui.items():
            self.write(name, data)
        self.write('.env', b'private environment sentinel')
        self.write('node_modules/dependency/keep.js', b'preserved dependency')
        self.saved = {'LoadState': 'loaded', 'ActiveState': 'active', 'SubState': 'running',
            'User': 'fti-v3', 'Group': 'fti-v3', 'MainPID': '1234',
            'WorkingDirectory': str(self.live)}
        self.cfg = dict(m.EXPECTED_CONFIG, poolDistributionVersion=1, hourlyCapFlushVersion=1,
            referralPlacementEnabled=True, genesisLayout='FTI_GENESIS_1_2_4_8_8_8_20261016')
        self.sponsor = '0x87aC0Bd5daD51FEE1bFd813271d171C994620bFF'
        self.cfg['genesis'] = ['0x' + format(i + 1, '040x') for i in range(31)]
        self.cfg['genesis'][22] = self.sponsor
        self.restart_calls = 0
        self.restart_failures = 0
        self.ready_failures = 0
        self.requests = []
        self.height = 128837199
        self.placement_data = {'referrer': self.sponsor, 'placementParent': self.sponsor, 'side': 'left',
            'depth': 1, 'placementParentDepth': 4, 'visited': 1, 'source': 'canonical-state',
            'chainId': 56, 'block': self.height, 'blockHash': '0x' + '1' * 64}
        self.public_placement_data = None
        self.headers = {self.height: {'number': hex(self.height), 'hash': '0x' + '1' * 64}}
        self.placement_summary = {'local': {'available': True}, 'public': {'available': True}}
        files = {self.entry: m.sha(self.new_module)}
        self.release = {'schema': 'FTI_REGISTRATION_PLACEMENT_V1', 'files': files,
            'payloads': {self.entry: base64.b64encode(gzip.compress(self.new_module, mtime=0)).decode()},
            'releaseId': m.sha(json.dumps(files, sort_keys=True).encode())[:16]}
        for name, value in [('RELEASES', self.releases), ('BACKUPS', self.backups),
                ('BASE_FILES', {self.entry: m.sha(self.old_module)}),
                ('REQUIRED_FILES', {name: m.sha(data) for name, data in self.dependencies.items()
                                    if name != 'scripts/server.mjs'}),
                ('REVIEWED_SERVERS', tuple(m.sha(data) for data in self.servers))]:
            p = patch.object(m, name, value)
            p.start()
            self.addCleanup(p.stop)
        for name, fn in [('properties', lambda: dict(self.saved)),
                ('unit_metadata', lambda *_: {}),
                ('capture_runtime', lambda *_: {'node': '/opt/fti/runtime/node-v22.20.0/bin/node', 'unitMeta': {}}),
                ('capture_ui', self.capture_ui), ('check_ui', self.check_ui),
                ('run_syntax', lambda *_: None), ('run_import', lambda *_: None),
                ('restart_web', self.restart_web), ('wait_ready', self.wait_ready), ('fetch', self.fetch),
                ('rpc_anchor', lambda base, block: self.headers[block])]:
            p = patch.object(m, name, side_effect=fn)
            p.start()
            self.addCleanup(p.stop)

    def write(self, name, data):
        target = self.live / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def capture_ui(self, root):
        return {'files': {name: m.sha(data) for name, data in self.ui.items()}, 'routes': {}}

    def check_ui(self, root, ui):
        for name, digest in ui['files'].items():
            if m.sha((root / name).read_bytes()) != digest:
                raise RuntimeError('Protected UI changed: ' + name)

    def fetch(self, url, *args, **kwargs):
        self.requests.append(url)
        if url.endswith('/health'):
            return json.dumps({'ok': True, 'chainId': self.cfg['chainId'], 'block': self.height}).encode()
        if url.endswith('/api/config'):
            return json.dumps(self.cfg).encode()
        if '/api/placement?referrer=' in url:
            data = self.public_placement_data if url.startswith(m.PUBLIC) and self.public_placement_data else self.placement_data
            return json.dumps(data).encode()
        route = '/' + url.split('://', 1)[1].partition('/')[2]
        if route in m.UI_ROUTES:
            return (self.live / m.UI_ROUTES[route]).read_bytes()
        if route.startswith('/assets/'):
            return (self.live / ('landing/dist' + route)).read_bytes()
        if route.startswith('/fti-mainnet-ui-'):
            return (self.live / ('web' + route)).read_bytes()
        raise AssertionError('Unexpected HTTP request: ' + url)

    def restart_web(self):
        self.restart_calls += 1
        if self.restart_failures:
            self.restart_failures -= 1
            self.saved.update(ActiveState='failed', SubState='failed', MainPID='0')
            raise RuntimeError('Simulated web restart failure')
        self.saved.update(ActiveState='active', SubState='running', MainPID=str(1234 + self.restart_calls))

    def wait_ready(self, root, config, ui, *args, **kwargs):
        if self.ready_failures:
            self.ready_failures -= 1
            raise RuntimeError('Simulated placement postflight failure')
        self.check_ui(root, ui)
        return self.placement_summary

    def backup(self):
        return next(self.backups.glob('install-*'))

    def assert_original(self):
        self.assertEqual((self.live / self.entry).read_bytes(), self.old_module)

    def assert_unchanged(self):
        for name, data in dict(self.ui, **self.dependencies).items():
            self.assertEqual((self.live / name).read_bytes(), data, name)
        self.assertEqual((self.live / '.env').read_bytes(), b'private environment sentinel')
        self.assertEqual((self.live / 'node_modules/dependency/keep.js').read_bytes(), b'preserved dependency')

    def test_installs_only_placement_module_with_one_restart_and_idempotent_rerun(self):
        m.apply(self.release)
        self.assertEqual((self.live / self.entry).read_bytes(), self.new_module)
        self.assertEqual(self.restart_calls, 1)
        self.assertTrue((self.backup() / 'installer.py').is_file())
        self.assert_unchanged()
        m.apply(self.release)
        self.assertEqual(self.restart_calls, 1)
        self.assertEqual(len(list(self.backups.glob('install-*'))), 1)
        self.assert_unchanged()

    def test_every_reviewed_server_version_is_accepted_without_rewriting_server(self):
        for server in self.servers:
            self.write('scripts/server.mjs', server)
            self.dependencies['scripts/server.mjs'] = server
            m.apply(self.release)
            self.assertEqual((self.live / self.entry).read_bytes(), self.new_module)
            self.assertEqual((self.live / 'scripts/server.mjs').read_bytes(), server)
        self.assertEqual(self.restart_calls, 1)

    def test_unknown_placement_module_is_preserved_and_blocks_install(self):
        self.write(self.entry, b'operator placement change')
        with self.assertRaises(RuntimeError):
            m.apply(self.release)
        self.assertEqual((self.live / self.entry).read_bytes(), b'operator placement change')
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.restart_calls, 0)

    def test_unknown_server_is_preserved_and_blocks_install_before_writes(self):
        self.write('scripts/server.mjs', b'operator unreviewed server')
        with self.assertRaises(RuntimeError):
            m.apply(self.release)
        self.assert_original()
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.restart_calls, 0)

    def test_each_required_dependency_hash_is_checked_before_any_write(self):
        for name in PRODUCTION_REQUIRED_FILES:
            self.write(name, b'operator prerequisite change')
            with self.assertRaises(RuntimeError):
                m.apply(self.release)
            self.assert_original()
            self.assertEqual((self.live / name).read_bytes(), b'operator prerequisite change')
            self.write(name, self.dependencies[name])
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.restart_calls, 0)

    def test_wrong_chain_or_contract_blocks_install_before_backup(self):
        for key, value in [('chainId', 97), ('binary', '0x' + '0' * 40), ('mode', 'bnb-testnet')]:
            previous = self.cfg[key]
            self.cfg[key] = value
            with self.assertRaises(RuntimeError):
                m.apply(self.release)
            self.cfg[key] = previous
        self.assert_original()
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.restart_calls, 0)

    def test_corrupt_payload_or_extra_target_cannot_write_or_restart(self):
        broken = json.loads(json.dumps(self.release))
        broken['payloads'][self.entry] = base64.b64encode(gzip.compress(b'corrupt')).decode()
        with self.assertRaises(RuntimeError):
            m.apply(broken)
        broken = json.loads(json.dumps(self.release))
        broken['files']['scripts/server.mjs'] = m.sha(b'unauthorized')
        broken['payloads']['scripts/server.mjs'] = base64.b64encode(gzip.compress(b'unauthorized')).decode()
        with self.assertRaises(RuntimeError):
            m.apply(broken)
        self.assert_original()
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.restart_calls, 0)

    def test_restart_failure_rolls_back_even_with_inactive_service(self):
        self.restart_failures = 1
        with self.assertRaisesRegex(RuntimeError, 'restart failure'):
            m.apply(self.release)
        self.assert_original()
        self.assertEqual(self.restart_calls, 2)
        self.assertEqual(self.saved['ActiveState'], 'active')
        self.assert_unchanged()

    def test_placement_postflight_failure_restores_module_and_restarts_old_web(self):
        self.ready_failures = 1
        with self.assertRaisesRegex(RuntimeError, 'postflight failure'):
            m.apply(self.release)
        self.assert_original()
        self.assertEqual(self.restart_calls, 2)
        self.assert_unchanged()

    def test_failure_before_module_rename_does_not_restart_or_change_module(self):
        original = m.replace
        def fail_before(file, data, info):
            if file == self.live / self.entry and data == self.new_module:
                raise OSError('Simulated module rename failure')
            return original(file, data, info)
        with patch.object(m, 'replace', side_effect=fail_before):
            with self.assertRaisesRegex(OSError, 'rename failure'):
                m.apply(self.release)
        self.assert_original()
        self.assertEqual(self.restart_calls, 0)

    def test_fsync_failure_after_module_rename_restores_module_without_restart(self):
        original = m.replace
        def fail_after(file, data, info):
            original(file, data, info)
            if file == self.live / self.entry and data == self.new_module:
                raise OSError('Simulated fsync failure')
        with patch.object(m, 'replace', side_effect=fail_after):
            with self.assertRaisesRegex(OSError, 'fsync failure'):
                m.apply(self.release)
        self.assert_original()
        self.assertEqual(self.restart_calls, 0)

    def test_import_failure_rolls_back_without_restart(self):
        with patch.object(m, 'run_import', side_effect=RuntimeError('Simulated import failure')):
            with self.assertRaisesRegex(RuntimeError, 'import failure'):
                m.apply(self.release)
        self.assert_original()
        self.assertEqual(self.restart_calls, 0)

    def test_operator_module_edit_during_import_is_preserved_without_restart(self):
        def operator_edit(*_):
            self.write(self.entry, b'operator module during import')
        with patch.object(m, 'run_import', side_effect=operator_edit):
            with self.assertRaises(RuntimeError):
                m.apply(self.release)
        self.assertEqual((self.live / self.entry).read_bytes(), b'operator module during import')
        self.assertEqual(self.restart_calls, 0)

    def test_concurrent_server_edit_during_import_prevents_restart_and_is_preserved(self):
        def operator_edit(*_):
            self.write('scripts/server.mjs', b'operator server during import')
        with patch.object(m, 'run_import', side_effect=operator_edit):
            with self.assertRaises(RuntimeError):
                m.apply(self.release)
        self.assertEqual((self.live / 'scripts/server.mjs').read_bytes(), b'operator server during import')
        self.assertEqual(self.restart_calls, 0)

    def test_concurrent_working_directory_change_never_restarts_or_changes_new_deployment(self):
        new = self.releases / 'operator-release'
        new.mkdir()
        def deployment_changed(*_):
            self.saved['WorkingDirectory'] = str(new)
        with patch.object(m, 'run_import', side_effect=deployment_changed):
            with self.assertRaises(RuntimeError):
                m.apply(self.release)
        self.assertEqual(list(new.iterdir()), [])
        self.assertEqual(self.restart_calls, 0)

    def test_manual_restore_restores_exact_module_without_touching_other_files(self):
        m.apply(self.release)
        m.restore(self.backup())
        self.assert_original()
        self.assertEqual(self.restart_calls, 2)
        self.assert_unchanged()

    def test_manual_restore_refuses_foreign_module_without_restart(self):
        m.apply(self.release)
        self.write(self.entry, b'operator module after install')
        with self.assertRaises(RuntimeError):
            m.restore(self.backup())
        self.assertEqual((self.live / self.entry).read_bytes(), b'operator module after install')
        self.assertEqual(self.restart_calls, 1)

    def test_low_space_and_symlinked_module_stop_before_backup(self):
        tiny = SimpleNamespace(f_bavail=0, f_frsize=4096, f_favail=10000)
        with patch.object(m.os, 'statvfs', return_value=tiny):
            with self.assertRaisesRegex(RuntimeError, 'Insufficient'):
                m.apply(self.release)
        (self.live / self.entry).unlink()
        (self.live / self.entry).symlink_to(self.live / 'node_modules/dependency/keep.js')
        with self.assertRaisesRegex(RuntimeError, 'Symlink'):
            m.apply(self.release)
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.restart_calls, 0)

    def test_direct_placement_check_accepts_canonical_sponsor_child_without_chain_writes(self):
        result = m.check_placement(m.LOCAL)
        self.assertEqual(result, self.placement_data)
        self.assertIn(m.LOCAL + '/api/placement?referrer=' + self.sponsor, self.requests)
        self.assertEqual(self.restart_calls, 0)
        self.assert_original()
        self.assert_unchanged()

    def test_direct_placement_check_accepts_a_consistent_deeper_parent(self):
        self.placement_data.update(placementParent='0x' + '3' * 40, depth=3,
            placementParentDepth=6, visited=5, side='right')
        result = m.check_placement(m.PUBLIC)
        self.assertEqual(result, self.placement_data)

    def test_placement_identity_addresses_and_metadata_bounds_are_strict(self):
        original = dict(self.placement_data)
        cases = [('referrer', '0x' + '4' * 40), ('referrer', None),
            ('placementParent', '0x' + '0' * 40), ('placementParent', '0x1234'),
            ('source', 'historical-index'), ('chainId', 97), ('chainId', '56'), ('chainId', True),
            ('side', 'center'), ('depth', 0), ('depth', 65), ('depth', True),
            ('placementParentDepth', -1), ('placementParentDepth', 64),
            ('visited', 0), ('visited', 4097), ('visited', True),
            ('block', 0), ('block', 2 ** 53), ('block', True),
            ('blockHash', None), ('blockHash', '0x' + '0' * 64), ('blockHash', '0x1234')]
        for key, value in cases:
            with self.subTest(key=key, value=value):
                self.placement_data = dict(original, **{key: value})
                with self.assertRaises(RuntimeError):
                    m.check_placement(m.LOCAL)
        self.placement_data = original

    def test_placement_ancestry_and_bfs_visit_metadata_are_consistent(self):
        original = dict(self.placement_data)
        cases = [dict(depth=2), dict(placementParent='0x' + '3' * 40),
            dict(placementParent='0x' + '3' * 40, depth=3, placementParentDepth=1, visited=3),
            dict(placementParent='0x' + '3' * 40, depth=3, placementParentDepth=6, visited=2)]
        for fields in cases:
            with self.subTest(fields=fields):
                self.placement_data = dict(original, **fields)
                with self.assertRaises(RuntimeError):
                    m.check_placement(m.LOCAL)
        self.placement_data = original

    def test_placement_block_header_number_and_hash_must_match_canonical_anchor(self):
        block = self.placement_data['block']
        for header in ({'number': hex(block + 1), 'hash': self.placement_data['blockHash']},
                       {'number': hex(block), 'hash': '0x' + '2' * 64}):
            with self.subTest(header=header):
                self.headers[block] = header
                with self.assertRaisesRegex(RuntimeError, 'not canonical'):
                    m.check_placement(m.LOCAL)

    def test_placement_freshness_accepts_0_to_64_blocks_and_rejects_future_stale_or_boolean(self):
        block = self.placement_data['block']
        for age in (0, 64):
            self.height = block + age
            self.assertEqual(m.check_placement(m.LOCAL)['block'], block)
        for height in (block - 1, block + 65, True):
            with self.subTest(height=height):
                self.height = height
                with self.assertRaisesRegex(RuntimeError, 'not current'):
                    m.check_placement(m.LOCAL)

    def test_canonical_rpc_anchor_sends_only_two_bounded_read_only_methods(self):
        header = self.headers[self.height]
        rows = [{'jsonrpc': '2.0', 'id': 1, 'result': '0x38'},
                {'jsonrpc': '2.0', 'id': 2, 'result': header}]
        response = io.BytesIO(json.dumps(rows).encode())
        response.status = 200
        opener = MagicMock()
        opener.open.return_value = response
        with patch.object(m.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(REAL_RPC_ANCHOR(m.LOCAL, self.height), header)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), 'POST')
        self.assertEqual(request.full_url, m.LOCAL + '/rpc')
        self.assertEqual(opener.open.call_args.kwargs['timeout'], 20)
        packets = json.loads(request.data)
        self.assertEqual([(p['method'], p['params']) for p in packets],
            [('eth_chainId', []), ('eth_getBlockByNumber', [hex(self.height), False])])

    def test_canonical_rpc_anchor_rejects_wrong_network_missing_or_error_response(self):
        header = self.headers[self.height]
        cases = [[{'id': 1, 'result': '0x61'}, {'id': 2, 'result': header}],
            [{'id': 1, 'result': '0x38'}, {'id': 2, 'error': {'code': -32000}}],
            [{'id': 1, 'result': '0x38'}, {'id': 1, 'result': header}],
            [{'id': 1, 'result': '0x38'}]]
        for rows in cases:
            with self.subTest(rows=rows):
                response = io.BytesIO(json.dumps(rows).encode())
                response.status = 200
                opener = MagicMock()
                opener.open.return_value = response
                with patch.object(m.urllib.request, 'build_opener', return_value=opener):
                    with self.assertRaises(RuntimeError):
                        REAL_RPC_ANCHOR(m.LOCAL, self.height)

    def test_valid_concurrent_fill_can_choose_different_parents_at_successive_canonical_blocks(self):
        previous_block = self.height
        self.height += 1
        self.headers[self.height] = {'number': hex(self.height), 'hash': '0x' + '2' * 64}
        self.public_placement_data = dict(self.placement_data,
            placementParent='0x' + '3' * 40, depth=2, placementParentDepth=5, visited=2,
            block=self.height, blockHash='0x' + '2' * 64)
        with patch.object(m, 'wait_ready', side_effect=REAL_WAIT_READY):
            m.apply(self.release)
        self.assertEqual((self.live / self.entry).read_bytes(), self.new_module)
        self.assertEqual(self.restart_calls, 1)
        self.assertEqual(self.placement_data['block'], previous_block)
        self.assertNotEqual(self.placement_data['placementParent'], self.public_placement_data['placementParent'])
        self.assert_unchanged()

    def test_malformed_placement_postflight_rolls_back_without_accepting_a_fake_success(self):
        self.placement_data['depth'] = 2
        with patch.object(m, 'wait_ready', side_effect=REAL_WAIT_READY), patch.object(m.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'Inconsistent'):
                m.apply(self.release)
        sleep.assert_not_called()
        self.assert_original()
        self.assertEqual(self.restart_calls, 2)
        self.assert_unchanged()

    def test_operator_target_edit_after_restart_is_preserved_without_rollback_restart(self):
        def operator_edit(*_):
            self.write(self.entry, b'operator target after restart')
            raise RuntimeError('Simulated operator target edit')
        with patch.object(m, 'wait_ready', side_effect=operator_edit):
            with self.assertRaisesRegex(RuntimeError, 'operator target edit'):
                m.apply(self.release)
        self.assertEqual((self.live / self.entry).read_bytes(), b'operator target after restart')
        self.assertEqual(self.restart_calls, 1)
        self.assert_unchanged()

    def test_optional_backend_change_after_restart_is_preserved_and_prevents_foreign_restart(self):
        def operator_edit(*_):
            self.write('scripts/state-reader.mjs', b'operator optional module')
            raise RuntimeError('Simulated optional module edit')
        with patch.object(m, 'wait_ready', side_effect=operator_edit):
            with self.assertRaisesRegex(RuntimeError, 'optional module edit'):
                m.apply(self.release)
        self.assert_original()
        self.assertEqual((self.live / 'scripts/state-reader.mjs').read_bytes(), b'operator optional module')
        self.assertEqual(self.restart_calls, 1)

    def test_corrupt_backup_refuses_restore_before_any_change(self):
        m.apply(self.release)
        (self.backup() / 'before' / self.entry).write_bytes(b'corrupt backup')
        with self.assertRaisesRegex(RuntimeError, 'backup checksum mismatch'):
            m.restore(self.backup())
        self.assertEqual((self.live / self.entry).read_bytes(), self.new_module)
        self.assertEqual(self.restart_calls, 1)

    def test_dynamic_ui_capture_accepts_current_prefix_and_preserves_its_complete_asset_tree(self):
        prefix = 'fti-mainnet-ui-abcdef0123456789'
        self.write('web/index.html', ('<link href="/' + prefix + '/panel-identity.css">' +
            '<script src="/' + prefix + '/app.js"></script>').encode())
        assets = {'app.js': b'current app', 'panel-identity.css': b'current CSS',
            'fonts/keep.woff2': b'current font', 'vendor/walletconnect.js': b'current SDK'}
        for name, data in assets.items():
            self.write('web/' + prefix + '/' + name, data)
        self.write('landing/dist/assets/main-CURRENT1.js', b'current public app')
        self.write('landing/dist/assets/main-CURRENT1.css', b'current public CSS')
        with patch.object(m, 'check_ui', side_effect=REAL_CHECK_UI):
            captured = REAL_CAPTURE_UI(self.live)
            for name in assets:
                self.assertIn('web/' + prefix + '/' + name, captured['files'])
            self.assertIn('landing/dist/assets/main-CURRENT1.css', captured['files'])
            self.write('web/' + prefix + '/fonts/keep.woff2', b'operator changed font')
            with self.assertRaisesRegex(RuntimeError, 'Protected UI changed'):
                REAL_CHECK_UI(self.live, captured)

    def test_production_module_dependencies_and_reviewed_server_hashes_are_exact(self):
        self.assertEqual(PRODUCTION_BASE_FILES, {'scripts/referral-placement-index.mjs':
            '48e58fa81d5381262c0f7cf5d4aa9870d86af9f0dca90058c0c49cbac3da4572'})
        self.assertEqual(PRODUCTION_REQUIRED_FILES, {
            'core/referral-placement.mjs': 'e8802d486c0e1ca8474e715a74613af21ef9e28536cd3b02965d5d24495dc95b',
            'scripts/approved-genesis-layout.mjs': '5c0ba15c023a6d0a0dd08ea1aa109f6129e2d9a5b86294d679ea4d38ad1723fe',
            'config/mainnet-genesis-layout.json': '10296ed628e90ed7322009d2943f9510ff01cac570650f6a5278e28d44921efd'})
        self.assertEqual(PRODUCTION_SERVERS, (
            '31b576910e1d7573d7efd34efa16ecbcc84eb236c72a00579d59acc173a34353',
            '24acf84c4b74703c47228184b999dc5007a983e7df13ded5814739a400cc957d',
            '287907263043ccc612d173031826e10add55c7f6d0ac1df121f50dfcc37f4c77'))

    def test_package_embeds_only_target_and_is_importable_without_reading_build_server(self):
        build = self.folder / 'build'
        target = build / self.entry
        target.parent.mkdir(parents=True)
        target.write_bytes(self.new_module)
        (build / 'scripts/server.mjs').write_bytes(b'must never be packaged')
        output = self.folder / 'release.py'
        original_regular = m.regular
        with patch.object(m, 'regular', wraps=original_regular) as reads:
            m.package(build, output)
        self.assertFalse(any(call.args[0] == build / 'scripts/server.mjs' for call in reads.call_args_list))
        packaged_spec = importlib.util.spec_from_file_location('packaged_registration_placement', output)
        packaged = importlib.util.module_from_spec(packaged_spec)
        packaged_spec.loader.exec_module(packaged)
        files, content, _ = packaged.release_files(packaged.RELEASE)
        self.assertEqual(files, {self.entry: m.sha(self.new_module)})
        self.assertEqual(content, {self.entry: self.new_module})
        with self.assertRaises(FileExistsError):
            m.package(build, output)

    def test_first_placement_503_then_canonical_success_does_not_rollback_or_restart_again(self):
        original = self.fetch
        attempts = []
        def temporarily_unavailable(url, *args, **kwargs):
            if '/api/placement?' in url:
                attempts.append(url)
                if len(attempts) == 1:
                    raise HTTPError(url, 503, 'Temporarily unavailable', {}, None)
            return original(url, *args, **kwargs)
        with patch.object(m, 'fetch', side_effect=temporarily_unavailable), \
                patch.object(m, 'wait_ready', side_effect=REAL_WAIT_READY), \
                patch.object(m.time, 'sleep') as sleep:
            m.apply(self.release)
        self.assertEqual(len(attempts), 3)
        self.assertEqual(attempts[0], attempts[1])
        self.assertTrue(attempts[-1].startswith(m.PUBLIC))
        sleep.assert_called_once_with(2)
        self.assertEqual((self.live / self.entry).read_bytes(), self.new_module)
        self.assertEqual(self.restart_calls, 1)
        self.assert_unchanged()

    def test_persistent_placement_503_has_one_bounded_deadline_and_rolls_back(self):
        original = self.fetch
        clock = [0]
        attempts = []
        def unavailable(url, *args, **kwargs):
            if '/api/placement?' in url:
                attempts.append(url)
                raise HTTPError(url, 503, 'Temporarily unavailable', {}, None)
            return original(url, *args, **kwargs)
        def advance(seconds):
            clock[0] += seconds
        with patch.object(m, 'fetch', side_effect=unavailable), \
                patch.object(m, 'wait_ready', side_effect=REAL_WAIT_READY), \
                patch.object(m.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(m.time, 'sleep', side_effect=advance) as sleep:
            with self.assertRaisesRegex(RuntimeError, 'deadline|temporarily unavailable'):
                m.apply(self.release)
        self.assertGreater(len(attempts), 1)
        self.assertLessEqual(len(attempts), 91)
        self.assertLessEqual(clock[0], 180)
        self.assertTrue(all(call.args == (2,) for call in sleep.call_args_list))
        self.assert_original()
        self.assertEqual(self.restart_calls, 2)
        self.assert_unchanged()

    def test_only_429_503_and_real_timeouts_are_classified_as_transient(self):
        url = m.LOCAL + '/api/placement'
        transient = [HTTPError(url, 429, 'rate limited', {}, None),
            HTTPError(url, 503, 'unavailable', {}, None), TimeoutError('timed out'),
            URLError(TimeoutError('timed out'))]
        permanent = [HTTPError(url, 400, 'bad request', {}, None),
            HTTPError(url, 502, 'bad gateway', {}, None), URLError('DNS failure'),
            URLError(ConnectionRefusedError('refused')), RuntimeError('wrong chain'),
            ValueError('malformed metadata')]
        for error in transient:
            with self.subTest(error=repr(error)):
                self.assertTrue(m.transient_placement_error(error))
        for error in permanent:
            with self.subTest(error=repr(error)):
                self.assertFalse(m.transient_placement_error(error))

    def test_429_timeout_and_wrapped_timeout_retry_once_then_succeed(self):
        errors = [HTTPError(m.LOCAL, 429, 'rate limited', {}, None), TimeoutError('timed out'),
                  URLError(TimeoutError('timed out'))]
        for error in errors:
            with self.subTest(error=repr(error)):
                with patch.object(m, 'check_placement', side_effect=[error,
                        dict(self.placement_data), dict(self.placement_data)]) as checked, \
                        patch.object(m.time, 'sleep') as sleep:
                    result = REAL_WAIT_READY(self.live, dict(self.cfg), self.capture_ui(self.live))
                self.assertEqual(set(result), {'local', 'public'})
                self.assertEqual(checked.call_count, 3)
                sleep.assert_called_once_with(2)
        self.assertEqual(self.restart_calls, 0)

    def test_400_502_wrong_chain_and_invalid_metadata_fail_immediately_without_sleep(self):
        errors = [HTTPError(m.LOCAL, 400, 'bad request', {}, None),
            HTTPError(m.LOCAL, 502, 'bad gateway', {}, None),
            RuntimeError('Wrong placement chain'), RuntimeError('Invalid placement metadata')]
        for error in errors:
            with self.subTest(error=repr(error)):
                with patch.object(m, 'check_placement', side_effect=error) as checked, \
                        patch.object(m.time, 'sleep') as sleep:
                    with self.assertRaises(type(error)):
                        REAL_WAIT_READY(self.live, dict(self.cfg), self.capture_ui(self.live))
                checked.assert_called_once_with(m.LOCAL)
                sleep.assert_not_called()
        self.assertEqual(self.restart_calls, 0)

    def test_dependency_change_during_retry_is_preserved_and_blocks_next_request_and_restart(self):
        dependency = next(iter(PRODUCTION_REQUIRED_FILES))
        def operator_change(_):
            self.write(dependency, b'operator dependency during retry')
        error = HTTPError(m.LOCAL, 503, 'unavailable', {}, None)
        with patch.object(m, 'check_placement', side_effect=error) as checked, \
                patch.object(m, 'wait_ready', side_effect=REAL_WAIT_READY), \
                patch.object(m.time, 'sleep', side_effect=operator_change) as sleep:
            with self.assertRaisesRegex(RuntimeError, 'Required dependency differs'):
                m.apply(self.release)
        checked.assert_called_once_with(m.LOCAL)
        sleep.assert_called_once_with(2)
        self.assertEqual((self.live / dependency).read_bytes(), b'operator dependency during retry')
        self.assert_original()
        self.assertEqual(self.restart_calls, 1)

    def test_ui_change_during_retry_is_preserved_and_stops_the_next_placement_request(self):
        def operator_change(_):
            self.write('web/index.html', b'operator UI during retry')
        error = HTTPError(m.LOCAL, 503, 'unavailable', {}, None)
        with patch.object(m, 'check_placement', side_effect=error) as checked, \
                patch.object(m.time, 'sleep', side_effect=operator_change) as sleep:
            with self.assertRaisesRegex(RuntimeError, 'Protected UI changed'):
                REAL_WAIT_READY(self.live, dict(self.cfg), self.capture_ui(self.live))
        checked.assert_called_once_with(m.LOCAL)
        sleep.assert_called_once_with(2)
        self.assertEqual((self.live / 'web/index.html').read_bytes(), b'operator UI during retry')
        self.assert_original()
        self.assertEqual(self.restart_calls, 0)

    def test_target_change_during_retry_is_preserved_and_stops_the_next_placement_request(self):
        def operator_change(_):
            self.write(self.entry, b'operator target during retry')
        error = HTTPError(m.LOCAL, 503, 'unavailable', {}, None)
        with patch.object(m, 'check_placement', side_effect=error) as checked, \
                patch.object(m.time, 'sleep', side_effect=operator_change) as sleep:
            with self.assertRaisesRegex(RuntimeError, 'Placement module changed'):
                REAL_WAIT_READY(self.live, dict(self.cfg), self.capture_ui(self.live))
        checked.assert_called_once_with(m.LOCAL)
        sleep.assert_called_once_with(2)
        self.assertEqual((self.live / self.entry).read_bytes(), b'operator target during retry')
        self.assertEqual(self.restart_calls, 0)

    def test_new_working_directory_during_retry_is_not_touched_or_restarted(self):
        new = self.releases / 'operator-retry-release'
        new.mkdir()
        def operator_change(_):
            self.saved['WorkingDirectory'] = str(new)
        error = HTTPError(m.LOCAL, 503, 'unavailable', {}, None)
        with patch.object(m, 'check_placement', side_effect=error) as checked, \
                patch.object(m.time, 'sleep', side_effect=operator_change) as sleep:
            with self.assertRaisesRegex(RuntimeError, 'Web release changed'):
                REAL_WAIT_READY(self.live, dict(self.cfg), self.capture_ui(self.live))
        checked.assert_called_once_with(m.LOCAL)
        sleep.assert_called_once_with(2)
        self.assertEqual(list(new.iterdir()), [])
        self.assert_original()
        self.assertEqual(self.restart_calls, 0)


if __name__ == '__main__':
    unittest.main()
