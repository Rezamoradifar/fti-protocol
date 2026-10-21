import base64
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('responsive_workspace_installer',
    ROOT / 'tools/install-responsive-workspace.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
PRODUCTION_ASSETS = dict(m.BASE_ASSETS)
PRODUCTION_APPS = dict(m.BASE_UI_APPS)
PRODUCTION_BACKUPS = m.BACKUPS


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.releases = self.folder / 'releases'
        self.live = self.releases / 'live'
        self.live.mkdir(parents=True)
        self.backups = self.folder / 'backups'
        self.baselines = tuple(PRODUCTION_APPS)
        self.base_apps = {name: ('unchanged app bytes for ' + name).encode() for name in self.baselines}
        self.base = {'app.js': self.base_apps[self.baselines[0]], 'style.css': b'base general CSS',
            'member-landing-theme.css': b'base member CSS', 'global-interface.css': b'base global CSS',
            'panel-identity.css': b'base responsive CSS', 'vendor/ethers.js': b'base ethers JS',
            'fonts/fixtureFONT0001.woff2': b'verified fixture font'}
        self.assets = {name: m.sha(data) for name, data in self.base.items()}
        self.apps = {name: m.sha(data) for name, data in self.base_apps.items()}
        self.css = b'@media(max-width:600px){.workspace{width:100%;min-width:0}}'
        self.prefixes = {}
        for baseline, app in self.base_apps.items():
            for name, data in self.base.items():
                self.write('web/' + baseline + '/' + name, app if name == 'app.js' else data)
            manifest = dict(self.assets, **{'app.js': m.sha(app), 'panel-identity.css': m.sha(self.css)})
            self.prefixes[baseline] = 'fti-mainnet-ui-' + m.sha(json.dumps(manifest, sort_keys=True).encode())[:16]
        self.baseline = self.baselines[0]
        self.before = self.html(self.baseline)
        self.write('web/index.html', self.before)
        self.sentinels = {
            'web/app.js': b'unchanged unversioned app JS',
            'web/vendor/walletconnect.js': b'unchanged wallet SDK',
            'scripts/server.mjs': b'old backend server accepted without a source pin',
            'scripts/event-reader.mjs': b'old event reader',
            'scripts/market-reader.mjs': b'old market reader',
            'landing/dist/index.html': b'unchanged live landing',
            'landing/dist/token-site/index.html': b'unchanged token document',
            'landing/dist/whitepaper/index.html': b'unchanged whitepaper',
            'landing/dist/roadmap/index.html': b'unchanged roadmap',
            '.env': b'private environment sentinel',
            'node_modules/dependency/keep.js': b'unchanged dependency',
        }
        for name, data in self.sentinels.items():
            self.write(name, data)
        self.release = {'schema': 'FTI_RESPONSIVE_WORKSPACE_V1', 'cssSHA256': m.sha(self.css),
            'cssGzipBase64': base64.b64encode(gzip.compress(self.css, mtime=0)).decode(),
            'prefixes': dict(self.prefixes)}
        self.saved = {'LoadState': 'loaded', 'ActiveState': 'active', 'SubState': 'running',
            'User': 'fti-v3', 'Group': 'fti-v3', 'MainPID': '1234', 'WorkingDirectory': str(self.live)}
        self.cfg = dict(m.EXPECTED_CONFIG, poolDistributionVersion=1, hourlyCapFlushVersion=1)
        self.failure = None
        self.asset_requests = 0
        for name, value in [('RELEASES', self.releases), ('BACKUPS', self.backups),
                            ('BASE_ASSETS', self.assets), ('BASE_UI_APPS', self.apps)]:
            p = patch.object(m, name, value)
            p.start()
            self.addCleanup(p.stop)
        for name, fn in [('properties', lambda: dict(self.saved)), ('fetch', self.fetch),
                        ('private_backups', lambda: self.backups.mkdir(mode=0o700, exist_ok=True))]:
            p = patch.object(m, name, side_effect=fn)
            p.start()
            self.addCleanup(p.stop)

    def write(self, name, data):
        file = self.live / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)

    def html(self, prefix):
        return ('<head>' + ''.join('<link href="/' + prefix + '/' + name + '">'
            for name in self.base if name.endswith('.css')) + '</head><script src="/' +
            prefix + '/app.js"></script>').encode()

    def css_release(self, css):
        prefixes = {}
        for baseline, app in self.base_apps.items():
            assets = dict(self.assets, **{'app.js': m.sha(app), m.TARGET: m.sha(css)})
            prefixes[baseline] = 'fti-mainnet-ui-' + m.sha(json.dumps(assets, sort_keys=True).encode())[:16]
        return {'schema': 'FTI_RESPONSIVE_WORKSPACE_V1', 'cssSHA256': m.sha(css),
            'cssGzipBase64': base64.b64encode(gzip.compress(css, mtime=0)).decode(), 'prefixes': prefixes}

    def fetch(self, url, *args, **kwargs):
        route = url.split('://', 1)[1].partition('/')[2]
        if route == 'health':
            if self.failure == 'preflight-backend':
                self.write('scripts/server.mjs', b'operator backend during preflight')
            return json.dumps({'ok': self.failure != 'unhealthy', 'chainId': self.cfg['chainId'],
                               'block': 128837199}).encode()
        if route == 'api/config':
            return json.dumps(self.cfg).encode()
        current = (self.live / 'web/index.html').read_bytes()
        if route in ('app/', 'token/', 'admin/'):
            if self.failure == 'idempotent-backend' and any(
                    prefix.encode() in current for prefix in self.prefixes.values()):
                self.write('scripts/server.mjs', b'operator backend during installed verification')
            if self.failure == 'idempotent-optional' and any(
                    prefix.encode() in current for prefix in self.prefixes.values()):
                self.write('scripts/state-reader.mjs', b'operator helper during installed verification')
            if self.failure == 'after-switch' and route == 'token/' and any(
                    prefix.encode() in current for prefix in self.prefixes.values()):
                self.failure = None
                raise RuntimeError('Simulated post-switch HTTP failure')
            return current
        self.asset_requests += 1
        if self.asset_requests == len(self.assets):
            if self.failure == 'concurrent-html':
                self.write('web/index.html', b'operator HTML change')
            elif self.failure == 'backend-change':
                self.write('scripts/server.mjs', b'operator backend change')
            elif self.failure == 'process-change':
                self.saved['MainPID'] = '5678'
            elif self.failure == 'optional-appeared':
                self.write('scripts/state-reader.mjs', b'operator newly installed backend module')
            elif self.failure == 'optional-removed':
                (self.live / 'scripts/state-reader.mjs').unlink()
            elif self.failure == 'optional-mutated':
                self.write('scripts/state-reader.mjs', b'operator updated backend module')
        data = (self.live / 'web' / route).read_bytes()
        if self.failure == 'bad-served-asset' and route.endswith('/panel-identity.css'):
            return b'wrong served CSS'
        return data

    def backup(self):
        return next(self.backups.glob('install-*'))

    def assert_sentinels(self):
        for name, data in self.sentinels.items():
            self.assertEqual((self.live / name).read_bytes(), data, name)

    def assert_install_profile(self, baseline):
        self.baseline = baseline
        self.before = self.html(baseline)
        self.write('web/index.html', self.before)
        m.apply(self.release)
        prefix = self.prefixes[baseline]
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.html(prefix))
        for name, data in self.base.items():
            expected = self.css if name == 'panel-identity.css' else self.base_apps[baseline] if name == 'app.js' else data
            self.assertEqual((self.live / 'web' / prefix / name).read_bytes(), expected, name)
            original = self.base_apps[baseline] if name == 'app.js' else data
            self.assertEqual((self.live / 'web' / baseline / name).read_bytes(), original, name)
        self.assertEqual((self.live / 'web' / prefix / 'app.js').read_bytes(), self.base_apps[baseline])
        self.assertEqual((self.backup() / 'before.html').read_bytes(), self.before)
        self.assertTrue((self.backup() / 'installer.py').is_file())
        self.assert_sentinels()
        m.apply(self.release)
        self.assertEqual(len(list(self.backups.glob('install-*'))), 1)
        self.assert_sentinels()

    def test_first_reviewed_base_installs_css_only_and_is_idempotent(self):
        self.assert_install_profile(self.baselines[0])

    def test_second_reviewed_base_installs_css_only_and_preserves_its_exact_app(self):
        self.assert_install_profile(self.baselines[1])

    def test_repaired_backend_modules_are_accepted_without_hash_pins_and_unchanged(self):
        for name in ('scripts/server.mjs', 'scripts/event-reader.mjs', 'scripts/market-reader.mjs',
                     'scripts/state-reader.mjs', 'scripts/history-cache.mjs',
                     'scripts/event-history-source.mjs', 'scripts/content-security-policy.mjs'):
            self.sentinels[name] = ('current repaired backend ' + name).encode()
            self.write(name, self.sentinels[name])
        self.cfg.update(stateReaderVersion=1, eventHistoryVersion=1)
        self.assert_install_profile(self.baselines[0])

    def test_wrong_chain_contract_or_health_stop_before_backup(self):
        for key, value in [('chainId', 97), ('binary', '0x' + '0' * 40), ('mode', 'bnb-testnet')]:
            old = self.cfg[key]
            self.cfg[key] = value
            with self.assertRaises(RuntimeError):
                m.apply(self.release)
            self.cfg[key] = old
        self.failure = 'unhealthy'
        with self.assertRaises(RuntimeError):
            m.apply(self.release)
        self.assertFalse(self.backups.exists())
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)

    def test_tampered_app_is_rejected_before_backup(self):
        self.write('web/' + self.baseline + '/app.js', b'operator app change')
        with self.assertRaisesRegex(RuntimeError, 'asset differs'):
            m.apply(self.release)
        self.assertFalse(self.backups.exists())
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)

    def test_tampered_reused_asset_is_rejected_before_backup(self):
        self.write('web/' + self.baseline + '/vendor/ethers.js', b'operator SDK change')
        with self.assertRaisesRegex(RuntimeError, 'asset differs'):
            m.apply(self.release)
        self.assertFalse(self.backups.exists())

    def test_unreviewed_workspace_prefix_is_rejected_before_writes(self):
        self.write('web/index.html', self.html('fti-mainnet-ui-1111111111111111'))
        with self.assertRaises(RuntimeError):
            m.apply(self.release)
        self.assertFalse(self.backups.exists())

    def test_corrupt_css_payload_and_prefix_mapping_cannot_install(self):
        for release in (dict(self.release, cssSHA256='0' * 64),
                        dict(self.release, prefixes={self.baselines[0]: 'fti-mainnet-ui-' + '0' * 16})):
            with self.assertRaises(RuntimeError):
                m.apply(release)
        self.assertFalse(self.backups.exists())
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)

    def test_public_failure_after_switch_rolls_back_exact_html(self):
        self.failure = 'after-switch'
        with self.assertRaisesRegex(RuntimeError, 'post-switch HTTP failure'):
            m.apply(self.release)
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)
        self.assert_sentinels()

    def test_concurrent_operator_html_is_preserved(self):
        self.failure = 'concurrent-html'
        with self.assertRaisesRegex(RuntimeError, 'Concurrent HTML'):
            m.apply(self.release)
        self.assertEqual((self.live / 'web/index.html').read_bytes(), b'operator HTML change')
        self.assert_sentinels()

    def test_concurrent_backend_edit_prevents_switch_and_is_preserved(self):
        self.failure = 'backend-change'
        with self.assertRaisesRegex(RuntimeError, 'Protected'):
            m.apply(self.release)
        self.assertEqual((self.live / 'scripts/server.mjs').read_bytes(), b'operator backend change')
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)

    def test_process_change_prevents_html_switch(self):
        self.failure = 'process-change'
        with self.assertRaisesRegex(RuntimeError, 'process changed'):
            m.apply(self.release)
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)

    def test_exception_after_html_rename_restores_previous_html(self):
        original = m.replace
        def fail_after_rename(file, data, info):
            original(file, data, info)
            if data == self.html(self.prefixes[self.baseline]):
                raise OSError('Simulated directory fsync failure')
        with patch.object(m, 'replace', side_effect=fail_after_rename):
            with self.assertRaisesRegex(OSError, 'fsync failure'):
                m.apply(self.release)
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)

    def test_restore_refuses_foreign_html_then_restores_owned_html(self):
        m.apply(self.release)
        installed = (self.live / 'web/index.html').read_bytes()
        self.write('web/index.html', b'operator HTML after install')
        with self.assertRaisesRegex(RuntimeError, 'changed concurrently'):
            m.restore(self.backup())
        self.assertEqual((self.live / 'web/index.html').read_bytes(), b'operator HTML after install')
        self.write('web/index.html', installed)
        m.restore(self.backup())
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)
        self.assert_sentinels()

    def test_low_space_and_symlinked_asset_stop_before_backup(self):
        with patch.object(m.os, 'statvfs', return_value=SimpleNamespace(f_bavail=0, f_frsize=4096, f_favail=10000)):
            with self.assertRaisesRegex(RuntimeError, 'Insufficient'):
                m.apply(self.release)
        asset = self.live / 'web' / self.baseline / 'vendor/ethers.js'
        asset.unlink()
        asset.symlink_to(self.live / 'node_modules/dependency/keep.js')
        with self.assertRaisesRegex(RuntimeError, 'Symlink'):
            m.apply(self.release)
        self.assertFalse(self.backups.exists())

    def test_both_production_asset_fingerprints_and_css_target_are_pinned(self):
        self.assertEqual(len(PRODUCTION_ASSETS), 113)
        self.assertEqual(PRODUCTION_APPS, {
            'fti-mainnet-ui-f52f5261b5b036f9': '2557e14510a1f017e8b3b6ad3f8957b8c56e85a55d1fdd3ee66e1ef4c0eadef2',
            'fti-mainnet-ui-2c0130354c3b16c3': 'ccea7812f67c925f7ffebc8c5d935e9651cc55fdef4ff40ea170a1b58bda14e1'})
        for prefix, app_hash in PRODUCTION_APPS.items():
            assets = dict(PRODUCTION_ASSETS, **{'app.js': app_hash})
            actual = 'fti-mainnet-ui-' + m.sha(json.dumps(assets, sort_keys=True).encode())[:16]
            self.assertEqual(actual, prefix)
        self.assertEqual(m.TARGET, 'panel-identity.css')
        self.assertEqual(PRODUCTION_ASSETS[m.TARGET],
            '12f294040117dd35e4e2c0d30b4e1f08e8da9727487b6a96458d089e5c95fece')
        self.assertEqual(PRODUCTION_BACKUPS, Path('/var/backups/fti-responsive-workspace'))

    def test_package_embeds_only_css_and_both_variants_are_importable(self):
        source = self.folder / 'source'
        (source / 'web').mkdir(parents=True)
        (source / 'web' / m.TARGET).write_bytes(self.css)
        output = self.folder / 'release.py'
        m.package(source, output)
        packaged_spec = importlib.util.spec_from_file_location('packaged_responsive_workspace', output)
        packaged = importlib.util.module_from_spec(packaged_spec)
        packaged_spec.loader.exec_module(packaged)
        with patch.object(packaged, 'BASE_ASSETS', self.assets), \
                patch.object(packaged, 'BASE_UI_APPS', self.apps):
            for baseline in self.baselines:
                assets, css, prefix = packaged.release_assets(packaged.RELEASE, baseline)
                self.assertEqual(css, self.css)
                self.assertEqual(prefix, self.prefixes[baseline])
                self.assertEqual(assets['app.js'], m.sha(self.base_apps[baseline]))
                for name in self.base:
                    if name not in ('app.js', m.TARGET):
                        self.assertEqual(assets[name], self.assets[name])
        self.assertNotIn('appGzipBase64', packaged.RELEASE)
        with self.assertRaises(FileExistsError):
            m.package(source, output)

    def test_optional_backend_module_appearing_during_staging_prevents_switch(self):
        self.failure = 'optional-appeared'
        with self.assertRaisesRegex(RuntimeError, 'Protected runtime changed'):
            m.apply(self.release)
        self.assertEqual((self.live / 'scripts/state-reader.mjs').read_bytes(),
            b'operator newly installed backend module')
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)

    def test_optional_backend_module_removed_during_staging_prevents_switch(self):
        self.write('scripts/state-reader.mjs', b'current repaired state reader')
        self.failure = 'optional-removed'
        with self.assertRaisesRegex(RuntimeError, 'Protected runtime changed'):
            m.apply(self.release)
        self.assertFalse((self.live / 'scripts/state-reader.mjs').exists())
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)

    def test_optional_backend_module_mutation_during_staging_prevents_switch(self):
        self.write('scripts/state-reader.mjs', b'current repaired state reader')
        self.failure = 'optional-mutated'
        with self.assertRaisesRegex(RuntimeError, 'Protected runtime changed'):
            m.apply(self.release)
        self.assertEqual((self.live / 'scripts/state-reader.mjs').read_bytes(), b'operator updated backend module')
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)

    def test_new_asset_serving_failure_cannot_switch_html(self):
        self.failure = 'bad-served-asset'
        with self.assertRaisesRegex(RuntimeError, 'New asset not reachable'):
            m.apply(self.release)
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)
        self.assert_sentinels()

    def test_existing_new_prefix_asset_cannot_be_overwritten(self):
        path = 'web/' + self.prefixes[self.baseline] + '/app.js'
        self.write(path, b'operator conflicting versioned app')
        with self.assertRaisesRegex(RuntimeError, 'Versioned asset already differs'):
            m.apply(self.release)
        self.assertEqual((self.live / path).read_bytes(), b'operator conflicting versioned app')
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)

    def test_css_restore_preserves_a_later_operator_backend_update(self):
        m.apply(self.release)
        self.write('scripts/server.mjs', b'operator backend after CSS install')
        m.restore(self.backup())
        self.assertEqual((self.live / 'scripts/server.mjs').read_bytes(), b'operator backend after CSS install')
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)

    def test_optional_backend_symlink_is_rejected_before_backup(self):
        (self.live / 'scripts/state-reader.mjs').symlink_to(self.live / '.env')
        with self.assertRaisesRegex(RuntimeError, 'Symlink'):
            m.apply(self.release)
        self.assertFalse(self.backups.exists())
        self.assertEqual((self.live / '.env').read_bytes(), self.sentinels['.env'])

    def test_css_accepts_only_reviewed_relative_font_urls(self):
        for url in ('./fonts/fixtureFONT0001.woff2', '"./fonts/fixtureFONT0001.woff2"',
                    "'./fonts/fixtureFONT0001.woff2'"):
            css = ('@font-face{font-family:Fixture;src:URL (' + url + ')}').encode()
            with self.subTest(url=url):
                assets, packaged_css, _ = m.release_assets(self.css_release(css), self.baseline)
                self.assertEqual(packaged_css, css)
                self.assertEqual(assets['fonts/fixtureFONT0001.woff2'],
                    m.sha(self.base['fonts/fixtureFONT0001.woff2']))

    def test_css_rejects_unknown_external_absolute_or_embedded_asset_urls_before_writes(self):
        for url in ('./fonts/unknown.woff2', 'https://example.com/font.woff2',
                    '//example.com/font.woff2', '/fonts/fixtureFONT0001.woff2',
                    'data:font/woff2;base64,AAAA', './fonts/fixtureFONT0001.woff2?version=2'):
            css = ('@font-face{font-family:Fixture;src:url("' + url + '")}').encode()
            with self.subTest(url=url):
                with self.assertRaisesRegex(RuntimeError, 'unreviewed asset'):
                    m.apply(self.css_release(css))
        self.assertFalse(self.backups.exists())
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)
        self.assert_sentinels()

    def test_backend_change_during_http_preflight_is_not_accepted_as_the_new_snapshot(self):
        self.failure = 'preflight-backend'
        with self.assertRaisesRegex(RuntimeError, 'Protected runtime changed'):
            m.apply(self.release)
        self.assertEqual((self.live / 'scripts/server.mjs').read_bytes(), b'operator backend during preflight')
        self.assertEqual((self.live / 'web/index.html').read_bytes(), self.before)

    def test_installed_verification_detects_and_preserves_concurrent_backend_change(self):
        m.apply(self.release)
        installed = (self.live / 'web/index.html').read_bytes()
        self.failure = 'idempotent-backend'
        with self.assertRaisesRegex(RuntimeError, 'Protected runtime changed'):
            m.apply(self.release)
        self.assertEqual((self.live / 'scripts/server.mjs').read_bytes(),
            b'operator backend during installed verification')
        self.assertEqual((self.live / 'web/index.html').read_bytes(), installed)
        self.assertEqual(len(list(self.backups.glob('install-*'))), 1)

    def test_installed_verification_detects_new_optional_module_without_rewriting_ui(self):
        m.apply(self.release)
        installed = (self.live / 'web/index.html').read_bytes()
        self.failure = 'idempotent-optional'
        with self.assertRaisesRegex(RuntimeError, 'Protected runtime changed'):
            m.apply(self.release)
        self.assertEqual((self.live / 'scripts/state-reader.mjs').read_bytes(),
            b'operator helper during installed verification')
        self.assertEqual((self.live / 'web/index.html').read_bytes(), installed)
        self.assertEqual(len(list(self.backups.glob('install-*'))), 1)

    def test_installed_workspace_with_mixed_stylesheet_prefix_is_refused_without_writes(self):
        m.apply(self.release)
        installed = (self.live / 'web/index.html').read_bytes()
        new_prefix = self.prefixes[self.baseline]
        mixed = installed.replace(('/' + new_prefix + '/global-interface.css').encode(),
            ('/' + self.baseline + '/global-interface.css').encode())
        self.assertNotEqual(mixed, installed)
        self.write('web/index.html', mixed)
        with self.assertRaisesRegex(RuntimeError, 'Unexpected installed asset URL'):
            m.apply(self.release)
        self.assertEqual((self.live / 'web/index.html').read_bytes(), mixed)
        self.assertEqual(len(list(self.backups.glob('install-*'))), 1)
        self.assert_sentinels()


if __name__ == '__main__':
    unittest.main()
