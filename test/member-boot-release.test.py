import contextlib
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from urllib.parse import urlparse
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SOURCE = ROOT / 'tools/member-boot-release.py'
if not SOURCE.exists():
    SOURCE = HERE / 'member-boot-release.py'
spec = importlib.util.spec_from_file_location('boot_release', SOURCE)
boot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boot)
PREVIOUS = Path(os.environ.get('FTI_PREVIOUS_WORKSPACE',
                               ROOT / 'delivery/fti-member-workspace-20261121.pyz'))


class BootInstaller(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        p = Path(cls.tmp.name)
        html = p / 'input.html'
        html.write_text('<script type="module" src="/{BOOT_ASSETS}/entry.js"></script>')
        assets = p / 'assets'
        (assets / 'vendor').mkdir(parents=True)
        (assets / 'entry.js').write_bytes(b'addEventListener("load",()=>{});' * 30)
        (assets / 'vendor' / 'ethers.js').write_text('export default 1;')
        (assets / 'notice.txt').write_text('Legal notice')
        pkg = p / 'test.pyz'
        boot.build(PREVIOUS, html, assets, pkg)
        cls.archive = zipfile.ZipFile(pkg)
        cls.name = json.loads(cls.archive.read('manifest.json'))['name']
        cls.helpers = types.ModuleType('fti_helpers')
        exec(cls.archive.read('fti_workspace_helpers.py'), cls.helpers.__dict__)

    @classmethod
    def tearDownClass(cls):
        cls.archive.close()
        cls.tmp.cleanup()

    def setUp(self):
        self.tmp2 = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp2.cleanup)
        self.root = Path(self.tmp2.name)
        self.web = self.root / 'web'
        self.web.mkdir()
        self.fail_public = False
        self.h = types.SimpleNamespace(LOCAL='http://localhost:3110', PUBLIC='https://ftiprotocol.com')
        for name in ('regular', 'replace', 'safe_path', 'sync_directory'):
            setattr(self.h, name, getattr(self.helpers, name))
        def publish(path, data):
            if path.exists() and os.geteuid() != 0:
                self.assertEqual(self.helpers.regular(path)[0], data)
            else:
                self.helpers.publish_asset(path, data)
        self.h.publish_asset = publish
        self.h.service = lambda: ({}, self.root)
        self.h.config = lambda: {'genesis': ['0xD6492377C2C33047aFE61768930b2aedFF2B2704']}
        def served(url, expected):
            self.assertIn(urlparse(url).path, boot.ROUTES)
            self.assertEqual((self.web / 'index.html').read_bytes(), expected)
            if self.fail_public and url.startswith(self.h.PUBLIC) and expected == self.archive.read('new.html'):
                raise RuntimeError('public check failed')
        def fetch(url):
            path = self.web / urlparse(url).path.lstrip('/')
            return path.read_bytes(), boot.TYPES[path.suffix][-1]
        self.h.served = served
        self.h.fetch = fetch
        for suffix in boot.SUFFIXES:
            (self.web / ('index.html' + suffix)).write_bytes(self.archive.read('old.html' + suffix))

    def run_mode(self, mode):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            boot.install(self.h, self.archive, mode)
        return out.getvalue().split()[0]

    def assert_files(self, version):
        for suffix in boot.SUFFIXES:
            self.assertEqual((self.web / ('index.html' + suffix)).read_bytes(),
                             self.archive.read(version + '.html' + suffix))

    def test_check_apply_retry_restore_and_precompression(self):
        self.assertEqual(self.run_mode('check'), 'PREFLIGHT_OK')
        self.assertFalse((self.web / self.name).exists())
        for mode in ('apply','apply','check'):
            self.assertEqual(self.run_mode(mode), 'INSTALLED')
        self.assert_files('new')
        entry = self.web / self.name / 'entry.js'
        self.assertEqual(gzip.decompress(Path(str(entry)+'.gz').read_bytes()), entry.read_bytes())
        br = subprocess.run(['node','-e',"process.stdout.write(require('node:zlib').brotliDecompressSync(require('node:fs').readFileSync(0)))"],
                            input=Path(str(entry)+'.br').read_bytes(),capture_output=True,check=True)
        self.assertEqual(br.stdout,entry.read_bytes())
        self.assertFalse((entry.parent / 'vendor' / 'ethers.js.br').exists())
        for _ in range(2):
            self.assertEqual(self.run_mode('restore'), 'RESTORED')
        self.assert_files('old')

    def test_failed_public_check_rolls_back(self):
        self.fail_public = True
        with self.assertRaisesRegex(RuntimeError, 'public check failed'):
            self.run_mode('apply')
        self.assert_files('old')

    def test_retry_after_interrupted_variant_swap(self):
        (self.web/'index.html.gz').write_bytes(self.archive.read('new.html.gz'))
        self.assertEqual(self.run_mode('apply'), 'INSTALLED')
        self.assert_files('new')

    def test_foreign_html_is_preserved(self):
        target = self.web / 'index.html'
        target.write_text('independent revision')
        for mode in ('apply','restore'):
            with self.assertRaisesRegex(RuntimeError, 'Active file changed'):
                self.run_mode(mode)
        self.assertEqual(target.read_text(),'independent revision')

    def test_install_without_existing_html_sidecars(self):
        for suffix in ('.gz','.br'):
            (self.web/('index.html'+suffix)).unlink()
        self.assertEqual(self.run_mode('apply'), 'INSTALLED')
        self.assertEqual(self.run_mode('restore'), 'RESTORED')
        self.assertEqual((self.web/'index.html').read_bytes(),self.archive.read('old.html'))

    def test_missing_compressed_asset_is_reported_and_repaired(self):
        self.run_mode('apply')
        (self.web/self.name/'entry.js.br').unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_mode('check')
        self.assertEqual(self.run_mode('apply'), 'INSTALLED')
        self.assertEqual(self.run_mode('check'), 'INSTALLED')

    def test_missing_existing_asset_detected_by_check_and_repaired_by_apply(self):
        self.run_mode('apply')
        (self.web/self.name/'entry.js').unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_mode('check')
        self.assertEqual(self.run_mode('apply'), 'INSTALLED')


if __name__ == '__main__':
    unittest.main()
