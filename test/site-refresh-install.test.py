"""Local filesystem and rollback fixtures. Never contacts production or runs systemd."""
import copy
import base64
import gzip
import importlib.util
import json
import lzma
import os
import subprocess
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('site_refresh', ROOT / 'tools/install-site-refresh.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def release_fixture():
    canonical = {f'scripts/frozen-{i:03d}.mjs': b'export const frozen=true;' for i in range(100)}
    canonical.update({'scripts/operational-release.mjs': b'export const operational=true;',
        'scripts/continuity-release.mjs': b'export const continuity=true;',
        'scripts/server.mjs': b'original financial server', 'scripts/keeper.mjs': b'original keeper',
        'contracts/Token.sol': b'original financial contract'})
    runtime = {name: b'export const fixture=true;' for name in m.RUNTIME_FILES}
    runtime['scripts/server.mjs'] = (b"import './customer-services.mjs';import './site-routing.mjs';"
        b"import './static-response.mjs';import './operational-release.mjs';export const startWeb=()=>{};")
    web = {name: b'/* built fixture */' for name in ('app.js', 'app.css', 'boot-guard.js', 'style.css',
        'member-landing-theme.css', 'global-interface.css', 'panel-identity.css', 'member-reserve-panel.css',
        'vendor/ethers.js', 'vendor/walletconnect.js', 'customer-widget.js', 'customer-widget.css')}
    web['index.html'] = b'<html><head><link href="./app.css" rel="stylesheet"></head><body><script src="./app.js"></script></body></html>'
    landing = {(route.strip('/') + '/index.html' if route != '/' else 'index.html'):
        b'<html><head><link href="/assets/main-ABCDEFGH.css"></head><body><script src="/assets/main-ABCDEFGH.js"></script><script src="/customer-widget.js"></script></body></html>'
        for route in m.PUBLIC_ROUTES}
    landing.update({'assets/main-ABCDEFGH.js': b'/* hashed landing fixture */',
                    'assets/main-ABCDEFGH.css': b'body{color:green}',
                    'assets/main-ABCDEFGH.js.gz': gzip.compress(b'/* hashed landing fixture */'),
                    'index.html.gz': gzip.compress(landing['index.html'])})
    landing['release.json'] = json.dumps({'files': {name: m.sha(data) for name, data in landing.items()}}).encode()
    return {'schema': m.SCHEMA, 'sourceRevision': m.MAINNET_REVISION,
            **{name: {path: m.packed(data) for path, data in files.items()}
               for name, files in (('canonical', canonical), ('runtime', runtime), ('web', web), ('landing', landing))}}


class ManifestTests(unittest.TestCase):
    def test_xz_envelope_rejects_truncation_and_trailing_payload(self):
        value = {'release': 'fixture'}
        data = lzma.compress(json.dumps(value).encode())
        self.assertEqual(m.release_bundle(base64.b64encode(data).decode()), value)
        for damaged in (data[:-8], data + lzma.compress(b'{}')):
            with self.subTest(size=len(damaged)), self.assertRaisesRegex(RuntimeError, 'BUNDLE_DECOMPRESSION_LIMIT'):
                m.release_bundle(base64.b64encode(damaged).decode())

    def test_public_delivery_reports_headers_observed_and_checks_gzip_bytes(self):
        expected = b'export const fixture = true;'
        def response(_h, _url, metadata, **_kwargs):
            metadata.update({'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=31536000, immutable',
                             'Vary': 'Accept-Encoding'})
            return gzip.compress(expected), 'text/javascript'
        with patch.object(m, 'fetch', side_effect=response):
            actual = m.delivery_observation(None, {}, '/asset.js', expected, 100)
            self.assertEqual(actual['contentEncoding'], 'gzip')
            self.assertTrue(actual['immutableCacheObserved'])
            self.assertTrue(actual['varyAcceptEncodingObserved'])
        with patch.object(m, 'fetch', return_value=(expected, 'text/javascript')):
            actual = m.delivery_observation(None, {}, '/asset.js', expected, 100)
            self.assertEqual(actual['contentEncoding'], 'identity')
            self.assertFalse(actual['immutableCacheObserved'])
            self.assertFalse(actual['varyAcceptEncodingObserved'])

    def test_rejects_tampered_file_before_install(self):
        release = release_fixture()
        release['web']['app.js']['sha256'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'PACKAGE_HASH_MISMATCH'):
            m.validate_release(release)

    def test_rejects_parent_and_private_paths(self):
        for name in ('../.env', '/etc/passwd', 'assets/../secret.js', '.env', 'assets/.hidden.json'):
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                m.relative_name(name, True)

    def test_rejects_compression_without_original_and_incomplete_routes(self):
        with self.assertRaisesRegex(RuntimeError, 'WITHOUT_ORIGINAL'):
            m.decode_files({'asset.js.gz': m.packed(b'fixture')}, True)
        release = release_fixture()
        del release['landing']['vpn/index.html']
        with self.assertRaisesRegex(RuntimeError, 'INCOMPLETE_PUBLIC_ROUTES'):
            m.validate_release(release)

    def test_stale_compressed_javascript_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'STALE_GZIP_ASSET'):
            m.decode_files({'asset.js': m.packed(b'new code'),
                            'asset.js.gz': m.packed(gzip.compress(b'old code'))}, True)

    def test_immutable_entries_and_new_shared_widget_are_rewritten(self):
        payload = m.validate_release(release_fixture())
        index, assets, landing = m.candidate_content(payload)
        prefix = '/fti-site-refresh-' + payload['id'] + '/'
        self.assertIn((prefix + 'app.js').encode(), index)
        self.assertIn((prefix + 'app.css').encode(), index)
        self.assertIn((prefix + 'customer-widget.js').encode(), landing['index.html'])
        self.assertIn(b'/assets/main-ABCDEFGH.js', landing['index.html'])
        self.assertNotIn('index.html.gz', landing)
        self.assertEqual(json.loads(landing['release.json'])['files'],
                         {name: m.sha(data) for name, data in landing.items() if name != 'release.json'})

    def test_runtime_uses_frozen_verifier_and_local_customer_modules(self):
        payload = m.validate_release(release_fixture())
        overlay = m.overlay_files(payload['runtime'], payload['canonical'])
        self.assertIn(b"'../scripts/operational-release.mjs'", overlay['server.mjs'])
        self.assertIn(b"'./customer-services.mjs'", overlay['server.mjs'])
        self.assertIn(b"'./static-response.mjs'", overlay['server.mjs'])
        payload['runtime']['scripts/server.mjs'] += b"import './not-packaged.mjs';"
        with self.assertRaisesRegex(RuntimeError, 'UNPACKAGED_RUNTIME_IMPORT'):
            m.overlay_files(payload['runtime'], payload['canonical'])

    def test_dropin_never_enables_provider_or_changes_keeper(self):
        settings = {'node': '/usr/bin/node', 'deployment': '/etc/fti/mainnet.json',
                    'support': '/var/lib/fti-support/example', 'customer': '/var/lib/fti-customer-services/example'}
        data = m.dropin_code(settings, Path('/opt/fti/releases/example'), Path('/opt/fti/releases/example/runtime'))
        self.assertIn(b'Environment=DEPLOYMENT_FILE=/etc/fti/mainnet.json', data)
        self.assertIn(b'ReadWritePaths=/var/lib/fti-support/example /var/lib/fti-customer-services/example', data)
        for forbidden in (b'OPENAI', b'API_KEY', b'VPN_', b'keeper', b'EnvironmentFile=', b'Environment=\n'):
            self.assertNotIn(forbidden, data)


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.releases = self.base / 'releases'
        self.root = self.releases / 'original'
        self.root.mkdir(parents=True)
        self.drop = self.base / 'unit.d/zzzzzzz-fti-site-refresh.conf'
        self.fragment = self.base / 'web.service'
        self.fragment.write_bytes(b'[Service]\nExisting hardening preserved\n')
        self.env = self.base / 'web.env'
        self.env.write_bytes(b'OPERATOR_SECRET=fixture-never-copy\n')
        self.deployment = self.base / 'deployment.json'
        self.deployment.write_text(json.dumps(m.EXPECTED))
        self.cfg = dict(m.EXPECTED, supportTicketVersion=1, memberHistoryVersion=1)
        self.release = release_fixture()
        self.payload = m.validate_release(self.release)
        self.stage = self.releases / self.payload['name']
        self.before_html = b'<html><body>previous member panel</body></html>'
        self.before_landing = b'<html><body>previous homepage</body></html>'
        files = dict(self.payload['canonical'])
        files.update({'web/index.html': self.before_html, 'web/app.js': b'original fingerprint app',
            'web/vendor/walletconnect.js': b'original fingerprint wallet bridge',
            'web/old-immutable/app.js': b'open browser tab still needs this',
            'landing/dist/index.html': self.before_landing,
            'landing/dist/index.html.gz': gzip.compress(self.before_landing),
            'landing/dist/assets/previous-ABCDEFGH.js': b'previous hashed asset',
            'artifacts/Token.json': b'original immutable artifact',
            '.env': b'never copied runtime secret', 'data/users.json': b'never copied user records'})
        for name, data in files.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        (self.root / 'node_modules').mkdir()
        self.saved = {'WorkingDirectory': str(self.root), 'User': 'fti-v3', 'Group': 'fti-v3',
            'FragmentPath': str(self.fragment), 'DropInPaths': '', 'EnvironmentFiles': [str(self.env)],
            'MainPID': '100', 'ActiveState': 'active', 'SubState': 'running',
            'ExecStart': self.command(self.root / 'scripts/server.mjs')}
        self.original_saved = dict(self.saved)
        self.settings = {'node': '/usr/bin/node', 'entry': str(self.root / 'scripts/server.mjs'),
            'local': 'http://127.0.0.1:3110', 'deployment': str(self.deployment),
            'support': '/var/lib/fti-support/example', 'customer': '/var/lib/fti-customer-services/example'}
        self.h = m.load_helper(ROOT / 'tools/install-panel-completion.py')
        self.restarts = 0
        self.fail_health = False
        self.fail_import = False
        self.private_calls = []
        original_stat = Path.stat
        original_regular = self.h.regular
        def root_info(info):
            values = {name: getattr(info, name) for name in dir(info) if name.startswith('st_')}
            values['st_uid'] = 0
            return types.SimpleNamespace(**values)
        def stat_fixture(path, *args, **kwargs):
            return root_info(original_stat(path, *args, **kwargs))
        def regular_fixture(path):
            data, info = original_regular(path)
            return data, root_info(info)
        replacements = [patch.object(m, 'RELEASES', self.releases),
            patch.object(m, 'BACKUPS', self.base / 'backups'), patch.object(m, 'DROP', self.drop),
            patch.object(m, 'unit_info', side_effect=lambda _h: dict(self.saved)),
            patch.object(m, 'process_settings', side_effect=lambda *_: dict(self.settings)),
            patch.object(m, 'config', side_effect=lambda *_a, **_k: dict(self.cfg)),
            patch.object(m, 'root_dependencies', return_value=self.root),
            patch.object(m, 'private_directory', side_effect=lambda *a, **kw: self.private_calls.append(kw.get('create', True))),
            patch.object(m, 'syntax_and_import', side_effect=self.import_check),
            patch.object(m, 'wait_candidate', side_effect=self.health),
            patch.object(m, 'storage_probe'),
            patch.object(m, 'fetch', side_effect=self.fetch),
            patch.object(m.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=os.getuid())),
            patch.object(m.grp, 'getgrnam', return_value=types.SimpleNamespace(gr_gid=os.getgid())),
            patch.object(m.os, 'statvfs', return_value=types.SimpleNamespace(f_bavail=1_000_000, f_frsize=4096, f_favail=100_000)),
            patch.object(self.h, 'active_service', side_effect=lambda: (dict(self.saved), Path(self.saved['WorkingDirectory']))),
            patch.object(self.h, 'fingerprint_preflight', side_effect=self.fingerprint),
            patch.object(self.h, 'reload_units', side_effect=self.reload),
            patch.object(self.h, 'restart_web', side_effect=self.restart),
            patch.object(self.h, 'regular', side_effect=regular_fixture),
            patch.object(Path, 'stat', stat_fixture)]
        for item in replacements:
            item.start()
            self.addCleanup(item.stop)
        self.original_files = {name: data for name, data in files.items()}

    def command(self, entry):
        return '{ path=/usr/bin/node ; argv[]=/usr/bin/node ' + str(entry) + ' ; ignore_errors=no }'

    def fingerprint(self, root, *_args):
        for name, data in self.payload['canonical'].items():
            self.assertEqual((root / name).read_bytes(), data)
        self.assertEqual((root / 'web/app.js').read_bytes(), b'original fingerprint app')
        self.assertEqual((root / 'web/vendor/walletconnect.js').read_bytes(), b'original fingerprint wallet bridge')

    def import_check(self, _h, _settings, _overlay, stage=None):
        if stage and self.fail_import:
            raise RuntimeError('STAGED_IMPORT_TEST_FAILURE')

    def reload(self):
        if self.drop.exists():
            rows = self.drop.read_text().splitlines()
            self.saved['WorkingDirectory'] = next(x.split('=', 1)[1] for x in rows if x.startswith('WorkingDirectory='))
            entry = [x.split('=', 1)[1] for x in rows if x.startswith('ExecStart=') and x != 'ExecStart='][0].split(' ', 1)[1]
            self.saved['ExecStart'] = self.command(entry)
            self.saved['DropInPaths'] = str(self.drop)
        else:
            for name in ('WorkingDirectory', 'ExecStart', 'DropInPaths'):
                self.saved[name] = self.original_saved[name]

    def restart(self):
        self.restarts += 1
        self.saved['MainPID'] = str(100 + self.restarts)

    def health(self, *_args):
        if self.fail_health:
            raise RuntimeError('SIMULATED_HEALTH_FAILURE')

    def fetch(self, _h, url, **_kwargs):
        if url.endswith('/app/'):
            return self.before_html, 'text/html'
        if url.endswith('/'):
            return self.before_landing, 'text/html'
        raise AssertionError('Unexpected network fixture request: ' + url)

    def backup(self):
        values = list((self.base / 'backups').iterdir())
        self.assertEqual(len(values), 1)
        return values[0]

    def assert_original_untouched(self):
        for name, data in self.original_files.items():
            self.assertEqual((self.root / name).read_bytes(), data, name)
        self.assertEqual(self.env.read_bytes(), b'OPERATOR_SECRET=fixture-never-copy\n')

    def test_default_preflight_has_no_writes_or_restarts(self):
        before = sorted(str(x) for x in self.base.rglob('*'))
        m.install(self.h, self.release)
        self.assertEqual(before, sorted(str(x) for x in self.base.rglob('*')))
        self.assertEqual(self.restarts, 0)
        self.assertEqual(self.private_calls, [False, False])
        self.assert_original_untouched()

    def test_large_existing_public_tree_is_counted_and_copied(self):
        folder = self.root / 'web/old-immutable'
        for i in range(27):
            (folder / f'large-{i:02}.js').write_bytes(b'x' * 3_900_000)
        m.install(self.h, self.release, True)
        self.assertEqual((self.stage / 'web/old-immutable/large-26.js').stat().st_size, 3_900_000)
        self.assertEqual(self.restarts, 1)

    def test_more_than_5000_historical_files_are_copied(self):
        folder = self.root / 'web/old-immutable'
        for i in range(5001):
            (folder / f'old-{i:04}.js').write_bytes(b'x')
        m.install(self.h, self.release, True)
        self.assertEqual((self.stage / 'web/old-immutable/old-5000.js').read_bytes(), b'x')
        self.assertEqual(self.restarts, 1)

    def test_aggregate_public_budget_rejects_before_mutation(self):
        with patch.object(self.h, 'PUBLIC_COPY_MAX_BYTES', 100):
            with self.assertRaisesRegex(RuntimeError, 'PUBLIC_RUNTIME_COPY_BUDGET_EXCEEDED'):
                m.install(self.h, self.release, True)
        self.assertEqual(self.restarts, 0)
        self.assertFalse(self.drop.exists())

    def test_aggregate_entry_budget_rejects_before_mutation(self):
        with patch.object(self.h, 'PUBLIC_COPY_MAX_ENTRIES', 10):
            with self.assertRaisesRegex(RuntimeError, 'PUBLIC_RUNTIME_COPY_BUDGET_EXCEEDED'):
                m.install(self.h, self.release, True)
        self.assertEqual(self.restarts, 0)
        self.assertFalse(self.drop.exists())

    def test_preflight_checks_space_and_inodes_without_mutation(self):
        for space in (types.SimpleNamespace(f_bavail=1, f_frsize=4096, f_favail=100_000),
                      types.SimpleNamespace(f_bavail=1_000_000, f_frsize=4096, f_favail=1)):
            with self.subTest(space=space), patch.object(m.os, 'statvfs', return_value=space):
                with self.assertRaisesRegex(RuntimeError, 'INSUFFICIENT_SPACE_OR_INODES'):
                    m.install(self.h, self.release)
        self.assertEqual(self.restarts, 0)
        self.assertFalse(self.drop.exists())

    def test_changed_public_tree_between_preflight_and_copy_is_rejected(self):
        original = self.h.copy_public_tree
        def mutate(source, destination, expected=None):
            (source / 'new.js').write_bytes(b'concurrent change')
            return original(source, destination, expected)
        with patch.object(self.h, 'copy_public_tree', side_effect=mutate):
            with self.assertRaisesRegex(RuntimeError, 'PUBLIC_RUNTIME_CHANGED_DURING_COPY'):
                m.install(self.h, self.release, True)
        self.assertEqual(self.restarts, 0)
        self.assertFalse(self.drop.exists())

    def test_preexisting_unverified_stage_fails_closed(self):
        self.stage.mkdir()
        with self.assertRaisesRegex(RuntimeError, 'PREEXISTING_STAGE_REQUIRES_REVIEW'):
            m.install(self.h, self.release, True)
        self.assertEqual(self.restarts, 0)
        self.assertFalse(self.drop.exists())

    def test_source_change_after_all_public_copies_fails_before_switch(self):
        original = self.h.fingerprint_preflight
        def mutate(root, *args):
            result = original(root, *args)
            if Path(root) == self.stage:
                (self.root / 'web/old-immutable/late.js').write_bytes(b'late change')
            return result
        with patch.object(self.h, 'fingerprint_preflight', side_effect=mutate):
            with self.assertRaisesRegex(RuntimeError, 'PUBLIC_RUNTIME_CHANGED_BEFORE_SWITCH'):
                m.install(self.h, self.release, True)
        self.assertEqual(self.restarts, 0)
        self.assertFalse(self.drop.exists())

    def test_deep_new_paths_increase_inode_reservation(self):
        # The base 14,000-inode threshold is insufficient for these deep
        # paths when conservative parent-directory counts are included.
        original = m.candidate_content
        def with_deep_assets(payload):
            index, assets, landing = original(payload)
            assets.update({f'/new/a/b/c/d/item-{i}.js': b'x' for i in range(2200)})
            return index, assets, landing
        with patch.object(m.os, 'statvfs', return_value=types.SimpleNamespace(
                f_bavail=1_000_000, f_frsize=4096, f_favail=14_000)), \
             patch.object(m, 'candidate_content', side_effect=with_deep_assets):
                with self.assertRaisesRegex(RuntimeError, 'INSUFFICIENT_SPACE_OR_INODES'):
                    m.install(self.h, self.release)
        self.assertEqual(self.restarts, 0)

    def test_hardlinked_public_file_is_rejected(self):
        os.link(self.root / 'web/app.js', self.root / 'web/hardlink.js')
        with self.assertRaisesRegex(RuntimeError, 'UNSAFE_FILE'):
            m.install(self.h, self.release, True)
        self.assertEqual(self.restarts, 0)
        self.assertFalse(self.drop.exists())

    def test_public_static_root_mismatch_stops_before_any_mutation(self):
        original = self.fetch
        def mismatched(_h, url, **kwargs):
            if url == m.PUBLIC + '/':
                return b'<html><body>different nginx document root</body></html>', 'text/html'
            return original(_h, url, **kwargs)
        before = sorted(str(x) for x in self.base.rglob('*'))
        with patch.object(m, 'fetch', side_effect=mismatched):
            with self.assertRaisesRegex(RuntimeError, 'ACTIVE_PUBLIC_ROUTE_MISMATCH'):
                m.install(self.h, self.release, True)
        self.assertEqual(before, sorted(str(x) for x in self.base.rglob('*')))
        self.assertEqual(self.restarts, 0)
        self.assertEqual(self.private_calls, [])
        self.assert_original_untouched()

    def test_staging_keeps_fingerprint_and_previous_assets_without_private_data(self):
        m.install(self.h, self.release, True)
        self.assertEqual(self.restarts, 1)
        self.assertEqual(self.saved['WorkingDirectory'], str(self.stage))
        self.assertTrue((self.stage / 'node_modules').is_symlink())
        self.assertFalse((self.stage / '.env').exists())
        self.assertFalse((self.stage / 'data').exists())
        self.assertFalse((self.stage / 'deployments').exists())
        self.assertEqual((self.stage / 'web/old-immutable/app.js').read_bytes(), b'open browser tab still needs this')
        self.assertFalse((self.stage / 'landing/dist/index.html.gz').exists())
        self.assert_original_untouched()

    def test_private_umask_keeps_landing_accessible_to_service_user(self):
        os.chmod(self.base, 0o755)
        before = os.umask(0o077)
        try:
            m.install(self.h, self.release, True)
        finally:
            os.umask(before)
        for directory in (self.stage, self.stage / 'landing', self.stage / 'landing/dist'):
            self.assertEqual(directory.stat().st_mode & 0o777, 0o755, str(directory))
        if os.environ.get('FTI_REQUIRE_SERVICE_UID_HTTP_TEST') == '1':
            self.assertEqual(os.geteuid(), 0, 'The service UID acceptance test requires root')
        if os.geteuid() == 0:
            result = subprocess.run(['setpriv', '--reuid=65534', '--regid=65534', '--clear-groups',
                                     'cat', str(self.stage / 'landing/dist/index.html')],
                                    capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace'))
            print('FTI_UNPRIVILEGED_LANDING_READ_OK', flush=True)

    def test_health_failure_restores_original_configuration_and_preserves_failed_stage(self):
        self.fail_health = True
        with self.assertRaisesRegex(RuntimeError, 'SIMULATED_HEALTH_FAILURE'):
            m.install(self.h, self.release, True)
        self.assertEqual(self.restarts, 2)
        self.assertEqual(self.saved['WorkingDirectory'], str(self.root))
        self.assertFalse(self.drop.exists())
        self.assertTrue(self.stage.exists())
        self.assert_original_untouched()

    def test_stage_import_failure_leaves_current_service_running(self):
        self.fail_import = True
        with self.assertRaisesRegex(RuntimeError, 'STAGED_IMPORT_TEST_FAILURE'):
            m.install(self.h, self.release, True)
        self.assertEqual(self.restarts, 0)
        self.assertFalse(self.drop.exists())
        self.assert_original_untouched()

    def test_immutable_landing_collision_does_not_switch_service(self):
        target = self.root / 'landing/dist/assets/main-ABCDEFGH.js'
        target.write_bytes(b'operator asset with same immutable name')
        with self.assertRaisesRegex(RuntimeError, 'IMMUTABLE_ASSET_COLLISION'):
            m.install(self.h, self.release, True)
        self.assertEqual(target.read_bytes(), b'operator asset with same immutable name')
        self.assertEqual(self.restarts, 0)
        self.assertFalse(self.drop.exists())

    def test_restore_refuses_concurrent_dropin_edit(self):
        m.install(self.h, self.release, True)
        self.drop.write_bytes(b'[Service]\nOperator change after installation\n')
        with self.assertRaisesRegex(RuntimeError, 'CONCURRENT_DROPIN_EDIT_PRESERVED'):
            m.restore(self.h, self.backup())
        self.assertIn(b'Operator change', self.drop.read_bytes())
        self.assertEqual(self.restarts, 1)

    def test_restore_refuses_concurrent_environment_edit(self):
        m.install(self.h, self.release, True)
        self.env.write_bytes(b'OPERATOR_SECRET=edited-fixture\n')
        with self.assertRaisesRegex(RuntimeError, 'CONCURRENT_CONFIGURATION_CHANGE'):
            m.restore(self.h, self.backup())
        self.assertEqual(self.restarts, 1)

    def test_restore_checks_its_backup_before_changing_service(self):
        m.install(self.h, self.release, True)
        (self.backup() / 'before-workspace.html').write_bytes(b'tampered')
        with self.assertRaisesRegex(RuntimeError, 'BACKUP_HTML_HASH_MISMATCH'):
            m.restore(self.h, self.backup())
        self.assertEqual(self.restarts, 1)

    def test_restore_does_not_delete_private_data_created_after_install(self):
        m.install(self.h, self.release, True)
        retained = self.base / 'customer-record.json'
        retained.write_bytes(b'new private lead fixture')
        m.restore(self.h, self.backup())
        self.assertEqual(retained.read_bytes(), b'new private lead fixture')
        self.assertEqual(self.saved['WorkingDirectory'], str(self.root))
        self.assert_original_untouched()

    def test_symlink_public_file_fails_before_switch(self):
        (self.root / 'web/secret.json').symlink_to(self.env)
        with self.assertRaisesRegex(RuntimeError, 'SYMLINK_REJECTED'):
            m.install(self.h, self.release, True)
        self.assertFalse(self.drop.exists())
        self.assertEqual(self.restarts, 0)

    def test_changed_canonical_source_fails_before_any_write(self):
        (self.root / 'scripts/keeper.mjs').write_bytes(b'operator changed keeper')
        with self.assertRaises(AssertionError):
            m.install(self.h, self.release, True)
        self.assertFalse((self.base / 'backups').exists())
        self.assertEqual(self.restarts, 0)


if __name__ == '__main__':
    unittest.main()
