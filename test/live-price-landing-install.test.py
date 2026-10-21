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
spec = importlib.util.spec_from_file_location('live_price_landing', ROOT / 'tools/install-live-price-landing.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
PRODUCTION_BASE_ID = m.EXPECTED_BASE_ID


def html(js, css):
    return ('<html><head><link rel="stylesheet" href="/assets/' + css + '"></head><body>' +
            '<script type="module" src="/assets/' + js + '"></script></body></html>').encode()


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.releases = self.folder / 'releases'
        self.live = self.releases / 'live'
        self.landing = self.live / 'landing/dist'
        self.landing.mkdir(parents=True)
        self.backups = self.folder / 'backups'
        self.base = {'index.html': html('main-OLDOLD01.js', 'main-OLDOLD01.css'),
            'assets/main-OLDOLD01.js': b'old main', 'assets/main-OLDOLD01.css': b'old main CSS',
            'assets/public-OLDOLD01.js': b'old public', 'assets/public-OLDOLD01.css': b'old public CSS',
            'assets/font-FONT0001.woff2': b'font'}
        self.base.update({name: html('public-OLDOLD01.js', 'public-OLDOLD01.css')
                          for name in m.HTML_FILES if name != 'index.html'})
        self.new = {'index.html': html('main-NEWNEW01.js', 'main-NEWNEW01.css'),
            'assets/main-NEWNEW01.js': b'new live price main', 'assets/main-NEWNEW01.css': b'new main CSS',
            'assets/public-NEWNEW01.js': b'new live price public', 'assets/public-NEWNEW01.css': b'new public CSS',
            'assets/font-FONT0001.woff2': b'font'}
        self.new.update({name: html('public-NEWNEW01.js', 'public-NEWNEW01.css')
                         for name in m.HTML_FILES if name != 'index.html'})
        self.release = self.payload(self.base, self.new)
        for name, data in self.base.items():
            self.write(self.landing / name, data)
        for name in m.PROTECTED:
            self.write(self.live / name, b'protected ' + name.encode())
        self.write(self.live / '.env', b'private environment unchanged')
        self.write(self.landing / 'operator.txt', b'operator content')
        self.protected = {n: (self.live / n).read_bytes() for n in m.PROTECTED}
        self.saved = {'LoadState': 'loaded', 'ActiveState': 'active', 'SubState': 'running',
            'User': 'fti-v3', 'Group': 'fti-v3', 'MainPID': '1234', 'WorkingDirectory': str(self.live)}
        self.cfg = dict(m.EXPECTED_CONFIG, poolDistributionVersion=1, hourlyCapFlushVersion=1)
        self.failure = None
        self.requests = []
        base_id = m.sha(json.dumps(self.release['baseFiles'], sort_keys=True).encode())
        for name, value in [('RELEASES', self.releases), ('BACKUPS', self.backups),
                            ('EXPECTED_BASE_ID', base_id)]:
            p = patch.object(m, name, value); p.start(); self.addCleanup(p.stop)
        for name, fn in [('properties', lambda: dict(self.saved)), ('fetch', self.fetch),
                         ('private_backups', lambda: self.backups.mkdir(mode=0o700, exist_ok=True))]:
            p = patch.object(m, name, side_effect=fn); p.start(); self.addCleanup(p.stop)

    def write(self, file, data):
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)

    def payload(self, base, new):
        hashes = lambda files: {n: m.sha(v) for n, v in files.items()}
        files = hashes(new)
        return {'schema': 'FTI_LIVE_PRICE_LANDING_V1', 'baseFiles': hashes(base), 'files': files,
            'payloads': {n: base64.b64encode(gzip.compress(v, mtime=0)).decode()
                         for n, v in new.items() if base.get(n) != v},
            'releaseId': m.sha(json.dumps(files, sort_keys=True).encode())[:16]}

    def fetch(self, url):
        self.requests.append(url)
        route = url.split('://', 1)[1].partition('/')[2]
        if route == 'health':
            return json.dumps({'ok': self.failure != 'unhealthy', 'chainId': 56}).encode()
        if route == 'api/config':
            return json.dumps(self.cfg).encode()
        routes = {route.lstrip('/'): name for name, route in m.HTML_ROUTES.items()}
        if route in routes:
            name = routes[route]
            current = (self.landing / name).read_bytes()
            if self.failure == 'wrong-base-route' and name == 'whitepaper/index.html':
                return b'unreviewed served HTML'
            if self.failure == 'after-switch' and name == 'roadmap/index.html' and self.all_new():
                self.failure = None
                raise RuntimeError('Simulated post-switch HTTP failure')
            return current
        data = (self.landing / route).read_bytes()
        if route == 'assets/main-NEWNEW01.css':
            if self.failure == 'concurrent-staging':
                self.write(self.landing / 'index.html', b'operator staging edit')
            if self.failure == 'process-staging':
                self.saved['MainPID'] = '5678'
            if self.failure == 'protected-staging':
                self.write(self.live / 'scripts/server.mjs', b'operator backend update')
            if self.failure == 'unreachable-asset':
                return b'wrong served asset'
        return data

    def all_new(self):
        return all((self.landing / n).read_bytes() == self.new[n] for n in m.HTML_FILES)

    def assert_original_html(self):
        for name in m.HTML_FILES:
            self.assertEqual((self.landing / name).read_bytes(), self.base[name], name)

    def backup(self):
        return next(self.backups.glob('install-*'))

    def test_installs_all_four_pages_and_only_new_assets_with_backup_and_idempotence(self):
        m.apply(self.release)
        self.assertTrue(self.all_new())
        for name, data in self.new.items():
            self.assertEqual((self.landing / name).read_bytes(), data)
        for name, data in self.base.items():
            if name.startswith('assets/'):
                self.assertEqual((self.landing / name).read_bytes(), data)
        for name, data in self.protected.items():
            self.assertEqual((self.live / name).read_bytes(), data)
        self.assertEqual((self.live / '.env').read_bytes(), b'private environment unchanged')
        self.assertEqual((self.landing / 'operator.txt').read_bytes(), b'operator content')
        for name in m.HTML_FILES:
            self.assertEqual((self.backup() / 'before' / name).read_bytes(), self.base[name])
        self.assertTrue((self.backup() / 'installer.py').exists())
        record = json.loads((self.backup() / 'record.json').read_text())
        self.assertEqual(record['changedHtml'], list(m.HTML_FILES))
        for origin in (m.LOCAL, m.PUBLIC):
            for route in m.HTML_ROUTES.values():
                self.assertIn(origin + route, self.requests)
        m.apply(self.release)
        self.assertEqual(len(list(self.backups.glob('install-*'))), 1)

    def test_unknown_document_base_stops_before_any_writes(self):
        self.write(self.landing / 'whitepaper/index.html', b'operator document')
        with self.assertRaisesRegex(RuntimeError, 'reviewed base'):
            m.apply(self.release)
        self.assertFalse(self.backups.exists())
        self.assertFalse((self.landing / 'assets/main-NEWNEW01.js').exists())

    def test_every_base_public_route_must_match_before_staging(self):
        self.failure = 'wrong-base-route'
        with self.assertRaisesRegex(RuntimeError, 'Served public HTML mismatch'):
            m.apply(self.release)
        self.assertFalse(self.backups.exists())
        self.assert_original_html()

    def test_tampered_reusable_asset_stops_before_backup(self):
        self.write(self.landing / 'assets/font-FONT0001.woff2', b'corrupt')
        with self.assertRaisesRegex(RuntimeError, 'Installed asset differs'):
            m.apply(self.release)
        self.assertFalse(self.backups.exists())

    def test_wrong_chain_contract_and_health_stop_before_writes(self):
        for key, value in [('chainId', 97), ('binary', '0x' + '0' * 40)]:
            old = self.cfg[key]; self.cfg[key] = value
            with self.assertRaisesRegex(RuntimeError, 'Wrong mainnet deployment'):
                m.apply(self.release)
            self.cfg[key] = old
        self.failure = 'unhealthy'
        with self.assertRaisesRegex(RuntimeError, 'health unavailable'):
            m.apply(self.release)
        self.assertFalse(self.backups.exists())

    def test_post_switch_failure_restores_all_four_original_pages(self):
        self.failure = 'after-switch'
        with self.assertRaisesRegex(RuntimeError, 'post-switch'):
            m.apply(self.release)
        self.assert_original_html()

    def test_partial_switch_failure_before_second_rename_rolls_back_first(self):
        original = m.replace
        def fail_second(file, data, info):
            if file == self.landing / 'token-site/index.html' and data == self.new['token-site/index.html']:
                raise OSError('failure before second rename')
            original(file, data, info)
        with patch.object(m, 'replace', side_effect=fail_second):
            with self.assertRaisesRegex(OSError, 'before second rename'):
                m.apply(self.release)
        self.assert_original_html()

    def test_fsync_failure_after_second_rename_rolls_back_both_pages(self):
        original = m.replace
        def fail_after_second(file, data, info):
            original(file, data, info)
            if file == self.landing / 'token-site/index.html' and data == self.new['token-site/index.html']:
                raise OSError('directory fsync failed after second rename')
        with patch.object(m, 'replace', side_effect=fail_after_second):
            with self.assertRaisesRegex(OSError, 'fsync'):
                m.apply(self.release)
        self.assert_original_html()

    def test_concurrent_staging_edit_is_preserved_without_switching_other_pages(self):
        self.failure = 'concurrent-staging'
        with self.assertRaisesRegex(RuntimeError, 'Concurrent landing HTML edit'):
            m.apply(self.release)
        self.assertEqual((self.landing / 'index.html').read_bytes(), b'operator staging edit')
        for name in m.HTML_FILES[1:]:
            self.assertEqual((self.landing / name).read_bytes(), self.base[name])

    def test_concurrent_edit_after_partial_switch_is_preserved_and_other_switches_rollback(self):
        original = m.replace
        def operator_edit(file, data, info):
            original(file, data, info)
            if file == self.landing / 'token-site/index.html' and data == self.new['token-site/index.html']:
                self.write(self.landing / 'index.html', b'operator edit after switch')
        with patch.object(m, 'replace', side_effect=operator_edit):
            with self.assertRaisesRegex(RuntimeError, 'Concurrent landing HTML edit'):
                m.apply(self.release)
        self.assertEqual((self.landing / 'index.html').read_bytes(), b'operator edit after switch')
        for name in m.HTML_FILES[1:]:
            self.assertEqual((self.landing / name).read_bytes(), self.base[name])

    def test_concurrent_edit_to_unswitched_page_is_preserved_and_first_switch_rollback(self):
        original = m.replace
        def operator_edit(file, data, info):
            original(file, data, info)
            if file == self.landing / 'index.html' and data == self.new['index.html']:
                self.write(self.landing / 'whitepaper/index.html', b'operator document update')
        with patch.object(m, 'replace', side_effect=operator_edit):
            with self.assertRaisesRegex(RuntimeError, 'Concurrent landing HTML edit'):
                m.apply(self.release)
        self.assertEqual((self.landing / 'whitepaper/index.html').read_bytes(), b'operator document update')
        for name in ['index.html', 'token-site/index.html', 'roadmap/index.html']:
            self.assertEqual((self.landing / name).read_bytes(), self.base[name])

    def test_concurrent_unswitched_page_deletion_does_not_prevent_other_rollback(self):
        original = m.replace
        deleted = self.landing / 'whitepaper/index.html'
        def operator_delete(file, data, info):
            original(file, data, info)
            if file == self.landing / 'index.html' and data == self.new['index.html']:
                deleted.unlink()
        with patch.object(m, 'replace', side_effect=operator_delete):
            with self.assertRaises(FileNotFoundError):
                m.apply(self.release)
        self.assertFalse(deleted.exists())
        for name in ['index.html', 'token-site/index.html', 'roadmap/index.html']:
            self.assertEqual((self.landing / name).read_bytes(), self.base[name])

    def test_concurrent_unswitched_page_symlink_does_not_prevent_other_rollback(self):
        original = m.replace
        linked = self.landing / 'whitepaper/index.html'
        outside = self.live / 'scripts/server.mjs'
        def operator_symlink(file, data, info):
            original(file, data, info)
            if file == self.landing / 'index.html' and data == self.new['index.html']:
                linked.unlink(); linked.symlink_to(outside)
        with patch.object(m, 'replace', side_effect=operator_symlink):
            with self.assertRaisesRegex(RuntimeError, 'Symlink path rejected'):
                m.apply(self.release)
        self.assertTrue(linked.is_symlink())
        self.assertEqual(outside.read_bytes(), self.protected['scripts/server.mjs'])
        for name in ['index.html', 'token-site/index.html', 'roadmap/index.html']:
            self.assertEqual((self.landing / name).read_bytes(), self.base[name])

    def test_process_change_during_staging_prevents_switch(self):
        self.failure = 'process-staging'
        with self.assertRaisesRegex(RuntimeError, 'process changed'):
            m.apply(self.release)
        self.assert_original_html()

    def test_process_restart_after_first_switch_rolls_back_html_batch(self):
        original = m.replace
        def process_restart(file, data, info):
            original(file, data, info)
            if file == self.landing / 'index.html' and data == self.new['index.html']:
                self.saved['MainPID'] = '5678'
        with patch.object(m, 'replace', side_effect=process_restart):
            with self.assertRaisesRegex(RuntimeError, 'process changed'):
                m.apply(self.release)
        self.assert_original_html()

    def test_concurrent_backend_edit_is_preserved_and_blocks_html_switch(self):
        self.failure = 'protected-staging'
        with self.assertRaisesRegex(RuntimeError, 'Protected runtime changed'):
            m.apply(self.release)
        self.assert_original_html()
        self.assertEqual((self.live / 'scripts/server.mjs').read_bytes(), b'operator backend update')

    def test_service_stop_after_first_switch_still_restores_owned_html(self):
        original = m.replace
        def service_stop(file, data, info):
            original(file, data, info)
            if file == self.landing / 'index.html' and data == self.new['index.html']:
                self.saved.update(ActiveState='failed', SubState='failed', MainPID='0')
        with patch.object(m, 'replace', side_effect=service_stop):
            with self.assertRaisesRegex(RuntimeError, 'process changed'):
                m.apply(self.release)
        self.assert_original_html()

    def test_manual_restore_restores_all_four_and_is_idempotent(self):
        m.apply(self.release)
        m.restore(self.backup())
        self.assert_original_html()
        m.restore(self.backup())
        self.assert_original_html()

    def test_manual_restore_refuses_foreign_edit_before_restoring_any_page(self):
        m.apply(self.release)
        self.write(self.landing / 'whitepaper/index.html', b'operator edit')
        with self.assertRaisesRegex(RuntimeError, 'changed concurrently'):
            m.restore(self.backup())
        for name in ['index.html', 'token-site/index.html', 'roadmap/index.html']:
            self.assertEqual((self.landing / name).read_bytes(), self.new[name])
        self.assertEqual((self.landing / 'whitepaper/index.html').read_bytes(), b'operator edit')

    def test_manual_restore_completes_known_partial_restore(self):
        m.apply(self.release)
        self.write(self.landing / 'token-site/index.html', self.base['token-site/index.html'])
        m.restore(self.backup())
        self.assert_original_html()

    def test_corrupted_backup_is_rejected_before_any_restore(self):
        m.apply(self.release)
        self.write(self.backup() / 'before/roadmap/index.html', b'corrupt')
        with self.assertRaisesRegex(RuntimeError, 'Backup HTML checksum mismatch'):
            m.restore(self.backup())
        self.assertTrue(self.all_new())

    def test_payload_manifest_and_reviewed_base_tampering_are_rejected(self):
        broken = json.loads(json.dumps(self.release))
        broken['payloads']['assets/main-NEWNEW01.js'] = base64.b64encode(gzip.compress(b'wrong')).decode()
        with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
            m.apply(broken)
        broken = json.loads(json.dumps(self.release)); broken['files']['../secret'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'Unsafe manifest path'):
            m.apply(broken)
        broken = json.loads(json.dumps(self.release)); broken['baseFiles']['assets/font-FONT0001.woff2'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'reviewed live release'):
            m.apply(broken)
        self.assertFalse(self.backups.exists())

    def test_missing_public_document_and_unhashed_or_mutated_assets_are_rejected(self):
        broken = dict(self.new); del broken['roadmap/index.html']
        with self.assertRaisesRegex(RuntimeError, 'Incomplete landing manifest'):
            m.release_files(self.payload(self.base, broken))
        broken = dict(self.new, **{'assets/current.js': b'unhashed'})
        with self.assertRaisesRegex(RuntimeError, 'immutable hashed filename'):
            m.release_files(self.payload(self.base, broken))
        broken = dict(self.new, **{'assets/font-FONT0001.woff2': b'mutated old font'})
        with self.assertRaisesRegex(RuntimeError, 'cannot change in place'):
            m.release_files(self.payload(self.base, broken))

    def test_all_changed_html_must_reference_local_manifest_assets(self):
        for name in m.HTML_FILES:
            broken = dict(self.new, **{name: self.new[name].replace(b'/assets/public-', b'https://example.com/public-')
                                      if name != 'index.html' else self.new[name].replace(b'/assets/main-', b'/missing/main-')})
            with self.assertRaisesRegex(RuntimeError, 'missing or external assets'):
                m.release_files(self.payload(self.base, broken))

    def test_bounded_changed_manifest_is_enforced(self):
        extra = {'assets/new-' + str(i).zfill(8) + '.js': b'new' for i in range(25)}
        with self.assertRaisesRegex(RuntimeError, 'bounded set'):
            m.release_files(self.payload(self.base, dict(self.new, **extra)))

    def test_symlinked_asset_and_low_space_stop_before_backup(self):
        file = self.landing / 'assets/font-FONT0001.woff2'
        file.unlink(); file.symlink_to(self.live / 'web/app.js')
        with self.assertRaisesRegex(RuntimeError, 'Symlink path rejected'):
            m.apply(self.release)
        file.unlink(); file.write_bytes(b'font')
        with patch.object(m.os, 'statvfs', return_value=SimpleNamespace(f_bavail=0, f_frsize=4096, f_favail=10000)):
            with self.assertRaisesRegex(RuntimeError, 'Insufficient free space'):
                m.apply(self.release)
        self.assertFalse(self.backups.exists())

    def test_new_immutable_asset_conflict_or_http_mismatch_cannot_switch(self):
        file = self.landing / 'assets/main-NEWNEW01.js'
        self.write(file, b'operator asset')
        with self.assertRaisesRegex(RuntimeError, 'Immutable asset already differs'):
            m.apply(self.release)
        file.unlink(); self.failure = 'unreachable-asset'
        with self.assertRaisesRegex(RuntimeError, 'New asset not reachable'):
            m.apply(self.release)
        self.assert_original_html()

    def test_package_validates_all_four_pages_and_embeds_only_changed_files(self):
        for dirname, content in [('base', self.base), ('new', self.new)]:
            folder = self.folder / dirname
            for name, data in content.items():
                self.write(folder / name, data)
            self.write(folder / 'release.json', json.dumps({'files': {n: m.sha(v) for n, v in content.items()}}).encode())
        output = self.folder / 'release.py'
        m.package(self.folder / 'new', self.folder / 'base', output)
        s = importlib.util.spec_from_file_location('packaged_live_price_landing', output)
        packaged = importlib.util.module_from_spec(s); s.loader.exec_module(packaged)
        with patch.object(packaged, 'EXPECTED_BASE_ID', m.EXPECTED_BASE_ID):
            _, _, content, _ = packaged.release_files(packaged.RELEASE)
        self.assertEqual(set(content), set(m.HTML_FILES) | {
            'assets/main-NEWNEW01.js', 'assets/main-NEWNEW01.css',
            'assets/public-NEWNEW01.js', 'assets/public-NEWNEW01.css'})
        with self.assertRaises(FileExistsError):
            m.package(self.folder / 'new', self.folder / 'base', output)
        self.write(self.folder / 'base/whitepaper/index.html', b'corrupt')
        with self.assertRaisesRegex(RuntimeError, 'Build checksum mismatch'):
            m.package(self.folder / 'new', self.folder / 'base', self.folder / 'bad.py')

    def test_production_base_fingerprint_and_routes_are_pinned(self):
        self.assertEqual(PRODUCTION_BASE_ID,
            '5abf361eafc515ec82c4ee03a408e18e3c3f47bd32fb3dd41c6092b152744b01')
        self.assertEqual(m.HTML_ROUTES, {'index.html': '/', 'token-site/index.html': '/token-site/',
            'whitepaper/index.html': '/whitepaper/', 'roadmap/index.html': '/roadmap/'})


if __name__ == '__main__':
    unittest.main()
