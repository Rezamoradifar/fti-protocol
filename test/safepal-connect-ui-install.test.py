import base64
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('safepal_connect_overlay', ROOT / 'tools/install-safepal-connect-ui.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
PRODUCTION_BASE = dict(m.BASE_ASSETS)
PRODUCTION_BACKUPS = m.BACKUPS


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.releases = self.folder / 'releases'
        self.live = self.releases / 'live'
        self.live.mkdir(parents=True)
        self.backups = self.folder / 'backups'
        self.base = {'app.js': b'old app', 'style.css': b'style',
                     'member-landing-theme.css': b'member', 'global-interface.css': b'global',
                     'panel-identity.css': b'identity', 'vendor/ethers.js': b'ethers'}
        self.assets = {name: m.sha(data) for name, data in self.base.items()}
        self.before = ('<head>' + ''.join('<link href="/' + m.BASE_PREFIX + '/' + name + '">'
            for name in self.base if name.endswith('.css')) + '</head><script src="/' +
            m.BASE_PREFIX + '/app.js"></script>').encode()
        for name, data in self.base.items():
            self.write('web/' + m.BASE_PREFIX + '/' + name, data)
        self.write('web/index.html', self.before)
        for name in m.PROTECTED:
            self.write(name, b'protected ' + name.encode())
        self.original_protected = {name: (self.live / name).read_bytes() for name in m.PROTECTED}
        self.saved = {'LoadState': 'loaded', 'ActiveState': 'active', 'SubState': 'running',
            'User': 'fti-v3', 'Group': 'fti-v3', 'MainPID': '1234', 'WorkingDirectory': str(self.live)}
        app = b'new app with SafePal connection controls'
        updated = dict(self.assets, **{'app.js': m.sha(app)})
        self.prefix = 'fti-mainnet-ui-' + m.sha(json.dumps(updated, sort_keys=True).encode())[:16]
        self.release = {'schema': 'FTI_SAFEPAL_CONNECT_UI_V1', 'appSHA256': m.sha(app),
            'appGzipBase64': base64.b64encode(gzip.compress(app, mtime=0)).decode(), 'prefix': self.prefix}
        self.cfg = dict(m.EXPECTED_CONFIG, poolDistributionVersion=1, hourlyCapFlushVersion=1)
        self.failure = None
        self.asset_requests = 0
        for name, value in [('RELEASES', self.releases), ('BACKUPS', self.backups),
                            ('BASE_ASSETS', self.assets)]:
            mocked = patch.object(m, name, value)
            mocked.start()
            self.addCleanup(mocked.stop)
        for name, function in [('properties', lambda: dict(self.saved)), ('fetch', self.fetch),
                               ('private_backups', lambda: self.backups.mkdir(mode=0o700, exist_ok=True))]:
            mocked = patch.object(m, name, side_effect=function)
            mocked.start()
            self.addCleanup(mocked.stop)

    def write(self, name, data):
        file = self.live / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)

    def fetch(self, url):
        route = url.split('://', 1)[1].partition('/')[2]
        if route == 'health':
            return json.dumps({'ok': True, 'chainId': 56}).encode()
        if route == 'api/config':
            return json.dumps(self.cfg).encode()
        current = (self.live / 'web/index.html').read_bytes()
        if route in ('app/', 'token/', 'admin/'):
            if self.failure == 'after-switch' and route == 'token/' and self.prefix.encode() in current:
                raise RuntimeError('Simulated post-switch HTTP failure')
            return current
        self.asset_requests += 1
        if self.failure == 'concurrent-html' and self.asset_requests == len(self.assets):
            self.write('web/index.html', b'operator change')
        return (self.live / 'web' / route).read_bytes()

    def installed_backup(self):
        return next(self.backups.glob('install-*'))

    def test_installs_only_overlay_with_backup_and_idempotent_rerun(self):
        m.apply(self.release)
        self.assertIn(self.prefix.encode(), (self.live / 'web/index.html').read_bytes())
        for name, data in self.original_protected.items():
            self.assertEqual((self.live / name).read_bytes(), data)
        for name, data in self.base.items():
            expected = b'new app with SafePal connection controls' if name == 'app.js' else data
            self.assertEqual((self.live / 'web' / self.prefix / name).read_bytes(), expected)
            self.assertEqual((self.live / 'web' / m.BASE_PREFIX / name).read_bytes(), data)
        backup = self.installed_backup()
        self.assertEqual((backup / 'before.html').read_bytes(), self.before)
        self.assertTrue((backup / 'installer.py').is_file())
        m.apply(self.release)
        self.assertEqual(len(list(self.backups.glob('install-*'))), 1)

    def test_tampered_reusable_asset_stops_before_backup_or_html_switch(self):
        self.write('web/' + m.BASE_PREFIX + '/vendor/ethers.js', b'tampered')
        with self.assertRaisesRegex(RuntimeError, 'Installed asset differs'):
            m.apply(self.release)
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)
        self.assertFalse(self.backups.exists())

    def test_wrong_chain_or_contract_stops_before_writes(self):
        for key, value in [('chainId', 97), ('binary', '0x' + '0' * 40)]:
            old = self.cfg[key]
            self.cfg[key] = value
            with self.assertRaisesRegex(RuntimeError, 'Wrong mainnet deployment'):
                m.apply(self.release)
            self.cfg[key] = old
        self.assertFalse(self.backups.exists())
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)

    def test_public_check_failure_after_switch_restores_previous_html(self):
        self.failure = 'after-switch'
        with self.assertRaisesRegex(RuntimeError, 'post-switch HTTP failure'):
            m.apply(self.release)
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)
        for name, data in self.original_protected.items():
            self.assertEqual((self.live / name).read_bytes(), data)

    def test_concurrent_operator_html_edit_is_preserved(self):
        self.failure = 'concurrent-html'
        with self.assertRaisesRegex(RuntimeError, 'Concurrent HTML edit'):
            m.apply(self.release)
        self.assertEqual((self.live / 'web/index.html').read_bytes(), b'operator change')

    def test_restore_refuses_concurrent_html_edit_then_restores_exact_backup(self):
        m.apply(self.release)
        installed = (self.live / 'web/index.html').read_bytes()
        self.write('web/index.html', b'operator change')
        with self.assertRaisesRegex(RuntimeError, 'changed concurrently'):
            m.restore(self.installed_backup())
        self.assertEqual((self.live / 'web/index.html').read_bytes(), b'operator change')
        self.write('web/index.html', installed)
        m.restore(self.installed_backup())
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)

    def test_landing_and_public_documents_are_untouched(self):
        self.write('landing/dist/token-site/index.html', b'token document')
        self.write('landing/dist/roadmap/index.html', b'roadmap document')
        landing = (self.live / 'landing/dist/index.html').read_bytes()
        m.apply(self.release)
        self.assertEqual((self.live / 'landing/dist/index.html').read_bytes(), landing)
        self.assertEqual((self.live / 'landing/dist/token-site/index.html').read_bytes(), b'token document')
        self.assertEqual((self.live / 'landing/dist/roadmap/index.html').read_bytes(), b'roadmap document')

    def test_exception_after_html_rename_still_restores_the_previous_ui(self):
        original_replace = m.replace
        calls = []
        def fail_after_replace(file, data, info):
            original_replace(file, data, info)
            calls.append(data)
            if len(calls) == 1:
                raise OSError('Simulated directory fsync failure after rename')
        with patch.object(m, 'replace', side_effect=fail_after_replace):
            with self.assertRaisesRegex(OSError, 'fsync failure'):
                m.apply(self.release)
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)
        self.assertEqual(len(calls), 2)

    def test_unknown_html_layout_and_symlinked_assets_are_rejected(self):
        self.write('web/index.html', self.before.replace(b'panel-identity.css', b'custom.css'))
        with self.assertRaisesRegex(RuntimeError, 'Unexpected installed asset URL'):
            m.apply(self.release)
        self.write('web/index.html', self.before)
        asset = self.live / 'web' / m.BASE_PREFIX / 'vendor/ethers.js'
        asset.unlink()
        asset.symlink_to(self.live / 'web/app.js')
        with self.assertRaisesRegex(RuntimeError, 'Symlink path rejected'):
            m.apply(self.release)
        self.assertFalse(self.backups.exists())

    def test_corrupted_payload_cannot_install(self):
        broken = dict(self.release, appSHA256='0' * 64)
        with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
            m.apply(broken)
        self.assertFalse(self.backups.exists())

    def test_production_asset_fingerprint_matches_installed_base_prefix(self):
        actual = 'fti-mainnet-ui-' + m.sha(json.dumps(PRODUCTION_BASE, sort_keys=True).encode())[:16]
        self.assertEqual(actual, m.BASE_PREFIX)
        self.assertEqual(len(PRODUCTION_BASE), 113)

    def test_only_verified_installed_safepal_baseline_is_accepted(self):
        self.assertEqual(m.BASE_PREFIX, 'fti-mainnet-ui-9d1cb38dba79fd30')
        self.assertEqual(PRODUCTION_BASE['app.js'],
            '7b9b69fe487fe7f8da4872ff08623762e961cc63abe0e91257568a2f7bd8b81f')
        self.write('web/index.html', self.before.replace(m.BASE_PREFIX.encode(),
            b'fti-mainnet-ui-3fe4788a7ebeef12'))
        with self.assertRaisesRegex(RuntimeError, 'Unexpected installed asset URL'):
            m.apply(self.release)
        self.assertFalse(self.backups.exists())

    def test_existing_reusable_assets_preserve_previous_manifest(self):
        old_spec = importlib.util.spec_from_file_location('previous_smart_cancellation_overlay',
            ROOT / 'tools/install-smart-cancellation-ui.py')
        old = importlib.util.module_from_spec(old_spec)
        old_spec.loader.exec_module(old)
        self.assertEqual({k: v for k, v in PRODUCTION_BASE.items() if k != 'app.js'},
            {k: v for k, v in old.BASE_ASSETS.items() if k != 'app.js'})
        self.assertIn('landing/dist/index.html', m.PROTECTED)
        self.assertEqual(PRODUCTION_BACKUPS, Path('/var/backups/fti-safepal-connect-ui'))

    def test_packaged_script_contains_verified_exact_app_and_is_importable(self):
        source = self.folder / 'source'
        (source / 'web').mkdir(parents=True)
        (source / 'web/app.js').write_bytes(b'new app with SafePal connection controls')
        output = self.folder / 'release.py'
        m.package(source, output)
        packaged_spec = importlib.util.spec_from_file_location('packaged_safepal_connect_ui', output)
        packaged = importlib.util.module_from_spec(packaged_spec)
        packaged_spec.loader.exec_module(packaged)
        # The source embeds the production asset set; this fixture substitutes a small set.
        with patch.object(packaged, 'BASE_ASSETS', self.assets):
            _, app, prefix = packaged.release_assets(packaged.RELEASE)
        self.assertEqual(app, b'new app with SafePal connection controls')
        self.assertEqual(prefix, self.prefix)
        with self.assertRaises(FileExistsError):
            m.package(source, output)

    def test_insufficient_space_preserves_every_existing_file(self):
        from types import SimpleNamespace
        tiny = SimpleNamespace(f_bavail=0, f_frsize=4096, f_favail=10000)
        with patch.object(m.os, 'statvfs', return_value=tiny):
            with self.assertRaisesRegex(RuntimeError, 'Insufficient free space'):
                m.apply(self.release)
        self.assertFalse(self.backups.exists())
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)

    def test_process_change_during_asset_staging_stops_before_html_switch(self):
        original_fetch = self.fetch
        def changed(url):
            value = original_fetch(url)
            if self.asset_requests == len(self.assets):
                self.saved['MainPID'] = '5678'
            return value
        with patch.object(m, 'properties', side_effect=[dict(self.saved), dict(self.saved, MainPID='5678')]), \
             patch.object(m, 'fetch', side_effect=changed):
            with self.assertRaisesRegex(RuntimeError, 'process changed'):
                m.apply(self.release)
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)


if __name__ == '__main__':
    unittest.main()
