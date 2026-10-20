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
spec = importlib.util.spec_from_file_location('hourly_landing', ROOT / 'tools/install-hourly-pool-landing.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


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
        self.base = {'index.html': html('main-OLD.js', 'main-OLD.css'),
            'assets/main-OLD.js': b'old app', 'assets/main-OLD.css': b'old style',
            'assets/font-ABC.woff2': b'font', 'token-site/index.html': b'token document',
            'whitepaper/index.html': b'whitepaper', 'roadmap/index.html': b'roadmap'}
        self.new = {'index.html': html('main-NEW.js', 'main-NEW.css'),
            'assets/main-NEW.js': b'new hourly pool app', 'assets/main-NEW.css': b'new style',
            **{n: v for n, v in self.base.items() if n not in ['index.html', 'assets/main-OLD.js', 'assets/main-OLD.css']}}
        self.release = self.payload(self.base, self.new)
        for name, data in self.base.items():
            self.write(self.landing / name, data)
        for name in m.PROTECTED:
            self.write(self.live / name, b'protected ' + name.encode())
        self.protected = {n: (self.live / n).read_bytes() for n in m.PROTECTED}
        self.saved = {'LoadState': 'loaded', 'ActiveState': 'active', 'SubState': 'running',
            'User': 'fti-v3', 'Group': 'fti-v3', 'MainPID': '1234', 'WorkingDirectory': str(self.live)}
        self.cfg = dict(m.EXPECTED_CONFIG, poolDistributionVersion=1, hourlyCapFlushVersion=1)
        self.failure = None
        for name, value in [('RELEASES', self.releases), ('BACKUPS', self.backups)]:
            p = patch.object(m, name, value);p.start();self.addCleanup(p.stop)
        for name, fn in [('properties', lambda: dict(self.saved)), ('fetch', self.fetch),
                         ('private_backups', lambda: self.backups.mkdir(mode=0o700, exist_ok=True))]:
            p = patch.object(m, name, side_effect=fn);p.start();self.addCleanup(p.stop)

    def write(self, file, data):
        file.parent.mkdir(parents=True, exist_ok=True);file.write_bytes(data)

    def payload(self, base, new):
        hashes = lambda files: {n: m.sha(v) for n, v in files.items()}
        files = hashes(new)
        return {'schema': 'FTI_HOURLY_POOL_LANDING_V1', 'baseFiles': hashes(base), 'files': files,
            'payloads': {n: base64.b64encode(gzip.compress(v, mtime=0)).decode() for n, v in new.items() if base.get(n) != v},
            'releaseId': m.sha(json.dumps(files, sort_keys=True).encode())[:16]}

    def fetch(self, url):
        route = url.split('://', 1)[1].partition('/')[2]
        if route == 'health':return json.dumps({'ok': True, 'chainId': 56}).encode()
        if route == 'api/config':return json.dumps(self.cfg).encode()
        if route == '':
            current = (self.landing / 'index.html').read_bytes()
            if self.failure == 'after-switch' and current == self.new['index.html']:
                self.failure = None
                raise RuntimeError('Simulated post-switch HTTP failure')
            return current
        data = (self.landing / route).read_bytes()
        if self.failure == 'concurrent-html' and route == 'assets/main-NEW.css':
            self.write(self.landing / 'index.html', b'operator change')
        if self.failure == 'process-change' and route == 'assets/main-NEW.css':self.saved['MainPID'] = '5678'
        return data

    def backup(self):return next(self.backups.glob('install-*'))

    def test_install_changes_only_homepage_and_new_immutable_assets_with_backup(self):
        m.apply(self.release)
        self.assertEqual((self.landing / 'index.html').read_bytes(), self.new['index.html'])
        for name, data in self.new.items():self.assertEqual((self.landing / name).read_bytes(), data)
        for name, data in self.protected.items():self.assertEqual((self.live / name).read_bytes(), data)
        for name in ['assets/main-OLD.js', 'assets/main-OLD.css', 'whitepaper/index.html']:
            self.assertEqual((self.landing / name).read_bytes(), self.base[name])
        self.assertEqual((self.backup() / 'before.html').read_bytes(), self.base['index.html'])
        self.assertTrue((self.backup() / 'installer.py').exists())
        m.apply(self.release)
        self.assertEqual(len(list(self.backups.glob('install-*'))), 1)

    def test_unknown_base_html_stops_before_writes(self):
        self.write(self.landing / 'index.html', b'operator landing')
        with self.assertRaisesRegex(RuntimeError, 'reviewed base'):m.apply(self.release)
        self.assertFalse(self.backups.exists())
        self.assertFalse((self.landing / 'assets/main-NEW.js').exists())

    def test_tampered_reusable_asset_stops_before_writes(self):
        self.write(self.landing / 'assets/font-ABC.woff2', b'corrupt')
        with self.assertRaisesRegex(RuntimeError, 'Installed asset differs'):m.apply(self.release)
        self.assertFalse(self.backups.exists())

    def test_wrong_network_contract_or_health_cannot_switch(self):
        for key, value in [('chainId', 97), ('binary', '0x' + '0' * 40)]:
            old = self.cfg[key];self.cfg[key] = value
            with self.assertRaisesRegex(RuntimeError, 'Wrong mainnet deployment'):m.apply(self.release)
            self.cfg[key] = old
        self.assertFalse(self.backups.exists())

    def test_post_switch_failure_restores_exact_original_html(self):
        self.failure = 'after-switch'
        with self.assertRaisesRegex(RuntimeError, 'post-switch'):m.apply(self.release)
        self.assertEqual((self.landing / 'index.html').read_bytes(), self.base['index.html'])
        for n, v in self.protected.items():self.assertEqual((self.live / n).read_bytes(), v)

    def test_error_after_atomic_rename_still_restores_original_html(self):
        original = m.replace
        def replace_then_error(file, data, info):
            original(file, data, info)
            if data == self.new['index.html']:raise OSError('simulated directory fsync failure')
        with patch.object(m, 'replace', side_effect=replace_then_error):
            with self.assertRaisesRegex(OSError, 'fsync failure'):m.apply(self.release)
        self.assertEqual((self.landing / 'index.html').read_bytes(), self.base['index.html'])

    def test_concurrent_html_edit_is_preserved(self):
        self.failure = 'concurrent-html'
        with self.assertRaisesRegex(RuntimeError, 'Concurrent landing HTML edit'):m.apply(self.release)
        self.assertEqual((self.landing / 'index.html').read_bytes(), b'operator change')

    def test_process_change_during_staging_prevents_switch(self):
        self.failure = 'process-change'
        with self.assertRaisesRegex(RuntimeError, 'process changed'):m.apply(self.release)
        self.assertEqual((self.landing / 'index.html').read_bytes(), self.base['index.html'])

    def test_restore_checks_concurrency_then_restores(self):
        m.apply(self.release)
        self.write(self.landing / 'index.html', b'operator change')
        with self.assertRaisesRegex(RuntimeError, 'changed concurrently'):m.restore(self.backup())
        self.assertEqual((self.landing / 'index.html').read_bytes(), b'operator change')
        self.write(self.landing / 'index.html', self.new['index.html'])
        m.restore(self.backup())
        self.assertEqual((self.landing / 'index.html').read_bytes(), self.base['index.html'])

    def test_corrupted_payload_and_unsafe_manifest_paths_are_rejected(self):
        broken = json.loads(json.dumps(self.release));broken['payloads']['assets/main-NEW.js'] = base64.b64encode(gzip.compress(b'wrong')).decode()
        with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):m.apply(broken)
        broken = json.loads(json.dumps(self.release));broken['files']['../secret'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'Unsafe manifest path'):m.apply(broken)
        self.assertFalse(self.backups.exists())

    def test_public_document_changes_are_out_of_scope(self):
        changed = dict(self.new, **{'whitepaper/index.html': b'changed whitepaper'})
        with self.assertRaisesRegex(RuntimeError, 'Public document changes'):m.release_files(self.payload(self.base, changed))

    def test_symlinked_assets_are_rejected(self):
        file = self.landing / 'assets/font-ABC.woff2';file.unlink();file.symlink_to(self.live / 'web/app.js')
        with self.assertRaisesRegex(RuntimeError, 'Symlink path rejected'):m.apply(self.release)
        self.assertFalse(self.backups.exists())

    def test_insufficient_space_stops_before_backup(self):
        with patch.object(m.os, 'statvfs', return_value=SimpleNamespace(f_bavail=0, f_frsize=4096, f_favail=10000)):
            with self.assertRaisesRegex(RuntimeError, 'Insufficient free space'):m.apply(self.release)
        self.assertFalse(self.backups.exists())

    def test_package_embeds_only_changed_files_and_validates_both_builds(self):
        for dirname, content in [('base', self.base), ('new', self.new)]:
            folder = self.folder / dirname
            for name, data in content.items():self.write(folder / name, data)
            self.write(folder / 'release.json', json.dumps({'files': {n: m.sha(v) for n, v in content.items()}}).encode())
        output = self.folder / 'release.py'
        m.package(self.folder / 'new', self.folder / 'base', output)
        s = importlib.util.spec_from_file_location('packaged_hourly', output);packaged = importlib.util.module_from_spec(s);s.loader.exec_module(packaged)
        _, _, content, _ = packaged.release_files(packaged.RELEASE)
        self.assertEqual(set(content), {'index.html', 'assets/main-NEW.js', 'assets/main-NEW.css'})
        with self.assertRaises(FileExistsError):m.package(self.folder / 'new', self.folder / 'base', output)
        self.write(self.folder / 'base/assets/font-ABC.woff2', b'corrupt')
        with self.assertRaisesRegex(RuntimeError, 'Build checksum mismatch'):m.package(self.folder / 'new', self.folder / 'base', self.folder / 'bad.py')


if __name__ == '__main__':unittest.main()
