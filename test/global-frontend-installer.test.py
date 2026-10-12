"""Installer file/HTTP transaction tests. No wallets or public-network writes."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('installer', REPO / 'tools/install-global-frontend.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
OLD_WEB = b'<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#000000"><meta name="description" content="FTI Protocol testnet workspace. Explore live reserves, manage membership and trade FTI through your wallet."><title>FTI Protocol \xe2\x80\x94 Your on-chain workspace</title><link rel="icon" href="./favicon.svg"><link rel="stylesheet" href="./style.css"></head><body><div id="root"></div><noscript>This workspace requires JavaScript to read contract data.</noscript><script type="module" src="./app.js"></script></body></html>'
ASSETS = {name: (REPO / item['source']).read_bytes() for name, item in m.MANIFEST['assets'].items()}
RENDERED = m.render_entries(REPO, ASSETS)


class Fixture:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.root = self.base / 'root'
        for folder in ('web/vendor', 'landing/dist', 'frontend', 'scripts', 'contracts', 'artifacts', 'landing/src'):
            (self.root / folder).mkdir(parents=True, exist_ok=True)
        for path, data in {'web/index.html': OLD_WEB,
                           'landing/dist/index.html': (REPO / 'landing/public/index.html').read_bytes(),
                           'web/app.js': b'original application bytes', 'web/style.css': b'original css',
                           'web/vendor/walletconnect.js': b'original wallet library', 'package.json': b'{}',
                           'package-lock.json': b'original lock', 'contracts/stub.sol': b'original contract',
                           'scripts/server.mjs': b'original server'}.items():
            (self.root / path).write_bytes(data)
        self.backups = self.base / 'backups'
        self.cfg = {'chainId': 97, 'sourceRevision': 'a'*40,
                    'binaryContract': 'FundedBinaryPlanUpgradeable', 'tokenContract': 'FTIReserveTokenUpgradeable',
                    **{k:'0x'+str(i)*40 for i,k in enumerate(('binary','token','usd','council','timelock'),1)}}
        self.originals = {p:(self.root/p).read_bytes() for p in m.ENTRYPOINTS}
        self.protected = m.protected_hashes(self.root)
        self.fail_asset = False
        self.fail_after = False
        self.change_config = False

    def get(self, route):
        changed = (self.root/'web/index.html').read_bytes() == RENDERED['web/index.html']
        if route == '/health':
            return json.dumps({'ok':True,'chainId':97}).encode(), 'application/json'
        if route == '/api/config':
            cfg = dict(self.cfg)
            if changed and self.change_config: cfg['sourceRevision'] = 'b'*40
            return json.dumps(cfg).encode(), 'application/json'
        for p, routes in m.ENTRYPOINTS.items():
            if route in routes:
                if changed and self.fail_after: raise RuntimeError('TEST_HTTP_FAILURE')
                return (self.root / p).read_bytes(), 'text/html'
        if route == '/protocol-ring.webp': return ASSETS['landing/protocol-ring.webp'], 'image/webp'
        if route.startswith('/'+m.PREFIX+'/'):
            if self.fail_asset: return b'wrong bytes', 'text/css'
            file = self.root / 'web' / route[1:]
            mime = 'text/css' if file.suffix=='.css' else 'text/javascript'
            return file.read_bytes(), mime
        raise RuntimeError('UNEXPECTED_TEST_ROUTE')

    def install(self, **kwargs):
        return m.install(self.root, ASSETS, RENDERED, self.cfg, self.get, self.backups, **kwargs)

    def unchanged(self):
        return all((self.root/p).read_bytes()==v for p,v in self.originals.items())


class InstallerTests(unittest.TestCase):
    def setUp(self): self.f = Fixture()
    def tearDown(self): self.f.temp.cleanup()

    def test_success_preserves_backend_and_independent_revision(self):
        result = self.f.install()
        self.assertEqual(result['result'],'FTI_GLOBAL_FRONTEND_INSTALLED')
        self.assertFalse(result['contractsChanged']);self.assertFalse(result['fundsMoved'])
        self.assertEqual(m.protected_hashes(self.f.root),self.f.protected)
        for p in m.ENTRYPOINTS: self.assertIn(m.REV.encode(),(self.f.root/p).read_bytes())
        info = json.loads((Path(result['backup'])/'record.json').read_text())
        self.assertEqual(info['backendRevision'],'a'*40)
        self.assertEqual(Path(result['backup']).stat().st_mode&0o777,0o700)
        self.assertEqual((Path(result['backup'])/'record.json').stat().st_mode&0o777,0o600)

    def test_idempotent_install_does_not_duplicate_html_or_backup(self):
        self.f.install(); before = list(self.f.backups.iterdir())
        self.assertEqual(self.f.install()['result'],'FTI_GLOBAL_FRONTEND_ALREADY_INSTALLED')
        self.assertEqual(list(self.f.backups.iterdir()),before)

    def test_css_http_mismatch_does_not_change_html(self):
        self.f.fail_asset = True
        with self.assertRaisesRegex(RuntimeError,'ASSET_HTTP'): self.f.install()
        self.assertTrue(self.f.unchanged())

    def test_postwrite_failure_restores_both_entries(self):
        self.f.fail_after=True
        with self.assertRaisesRegex(RuntimeError,'TEST_HTTP_FAILURE'): self.f.install()
        self.assertTrue(self.f.unchanged())

    def test_backend_change_restores_both_entries(self):
        self.f.change_config=True
        with self.assertRaisesRegex(RuntimeError,'BACKEND_CHANGED'): self.f.install()
        self.assertTrue(self.f.unchanged())

    def test_unknown_html_is_not_replaced(self):
        (self.f.root/'web/index.html').write_bytes(b'<html>custom</html>')
        with self.assertRaisesRegex(RuntimeError,'UNREVIEWED_WORKSPACE'): self.f.install()
        self.assertFalse(self.f.backups.exists())

    def test_symlink_template_is_rejected(self):
        index=self.f.root/'web/index.html';data=index.read_bytes();index.unlink()
        (self.f.base/'private').write_bytes(data);index.symlink_to(self.f.base/'private')
        with self.assertRaisesRegex(RuntimeError,'SYMLINK'): self.f.install()

    def test_symlink_version_namespace_is_rejected(self):
        (self.f.root/'web'/m.PREFIX).symlink_to(self.f.base,target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError,'SYMLINK'): self.f.install()
        self.assertTrue(self.f.unchanged())

    def test_process_identity_change_does_not_switch_html(self):
        def identity(): raise RuntimeError('SERVING_PROCESS_CHANGED')
        with self.assertRaisesRegex(RuntimeError,'SERVING_PROCESS_CHANGED'): self.f.install(identity=identity)
        self.assertTrue(self.f.unchanged())

    def test_concurrent_administrator_edit_is_not_overwritten(self):
        n=0
        def identity():
            nonlocal n
            n+=1
            if n==2: (self.f.root/'web/index.html').write_bytes(b'new administrator content')
        with self.assertRaisesRegex(RuntimeError,'CONCURRENT_EDIT_PRESERVED'): self.f.install(identity=identity)
        self.assertEqual((self.f.root/'web/index.html').read_bytes(),b'new administrator content')

    def test_restore_is_exact_and_repeatable(self):
        result=self.f.install();b=Path(result['backup'])
        self.assertEqual(m.restore(self.f.root,b,self.f.cfg,self.f.get)['result'],'FTI_GLOBAL_FRONTEND_RESTORED')
        self.assertTrue(self.f.unchanged())
        m.restore(self.f.root,b,self.f.cfg,self.f.get)
        self.assertEqual(m.protected_hashes(self.f.root),self.f.protected)

    def test_restore_refuses_new_html_edits(self):
        result=self.f.install();(self.f.root/'web/index.html').write_bytes(b'later edit')
        with self.assertRaisesRegex(RuntimeError,'LATER_HTML_EDIT'):
            m.restore(self.f.root,Path(result['backup']),self.f.cfg,self.f.get)

    def test_restore_refuses_changed_backend(self):
        result=self.f.install();(self.f.root/'web/app.js').write_bytes(b'changed backend bundle')
        with self.assertRaisesRegex(RuntimeError,'BACKEND_CHANGED'):
            m.restore(self.f.root,Path(result['backup']),self.f.cfg,self.f.get)

    def test_immutable_asset_conflict_is_not_overwritten(self):
        asset=self.f.root/'web'/m.PREFIX/'workspace/app.js';asset.parent.mkdir(parents=True)
        asset.write_bytes(b'unknown code')
        with self.assertRaisesRegex(RuntimeError,'EXISTING_VERSIONED_ASSET_DIFFERS'): self.f.install()
        self.assertEqual(asset.read_bytes(),b'unknown code');self.assertTrue(self.f.unchanged())

    def test_restrictive_umask_still_creates_readable_assets(self):
        old=os.umask(0o077)
        try: self.f.install()
        finally:os.umask(old)
        root=self.f.root/'web'/m.PREFIX
        self.assertEqual(root.stat().st_mode&0o777,0o755)
        self.assertEqual((root/'workspace').stat().st_mode&0o777,0o755)
        self.assertEqual((root/'workspace/app.js').stat().st_mode&0o777,0o644)

    def test_html_has_integrity_for_new_scripts_and_styles(self):
        for html in RENDERED.values():
            self.assertIn(b'integrity="sha256-',html)
            self.assertNotIn(b'src="./app.js"',html)
            self.assertNotIn(b'src="/app.js"',html)
            self.assertIn(('name="fti-frontend-revision" content="'+m.REV+'"').encode(),html)

    def test_built_bytes_match_the_original_verified_ci(self):
        for name,data in ASSETS.items(): self.assertEqual(m.sha(data),m.MANIFEST['assets'][name]['sha256'])

    def test_source_manifest_matches_pinned_repository_inputs(self):
        for name,expected in m.MANIFEST['source'].items():
            self.assertEqual(m.sha((REPO/name).read_bytes()),expected,name)

    def archive(self, changed=None, symlink=False):
        buffer=io.BytesIO()
        with tarfile.open(fileobj=buffer,mode='w:gz') as tar:
            for name in m.MANIFEST['source']:
                data=(REPO/name).read_bytes() if name!=changed else b'tampered'
                item=tarfile.TarInfo('fti-protocol-'+m.REV+'/'+name);item.size=len(data)
                if symlink and name==changed:item.type=tarfile.SYMTYPE;item.linkname='/etc/passwd'
                tar.addfile(item,io.BytesIO(data))
        return buffer.getvalue()

    def test_verified_source_extraction_uses_no_arbitrary_archive_paths(self):
        out=self.f.base/'extracted';out.mkdir()
        m.source_from_archive(self.archive(),out)
        self.assertEqual(set(str(p.relative_to(out)) for p in out.rglob('*') if p.is_file()),set(m.MANIFEST['source']))

    def test_modified_download_fails_before_build(self):
        out=self.f.base/'extracted';out.mkdir()
        with self.assertRaisesRegex(RuntimeError,'SOURCE_HASH_MISMATCH'):
            m.source_from_archive(self.archive('frontend/controller.js'),out)

    def test_symlink_in_download_fails_before_extraction(self):
        out=self.f.base/'extracted';out.mkdir()
        with self.assertRaisesRegex(RuntimeError,'UNSAFE_OR_DUPLICATE_SOURCE'):
            m.source_from_archive(self.archive('frontend/controller.js',True),out)


if __name__=='__main__':unittest.main(verbosity=2)
