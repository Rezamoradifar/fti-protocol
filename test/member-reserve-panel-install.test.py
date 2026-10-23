import base64
import gzip
import importlib.util
import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('member_reserve_panel', ROOT / 'tools/install-member-reserve-panel.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SERVED = m.served
APP = b"import {x} from './vendor/ethers.js'; const control='retry-pending-check member-reserve';\n"


IMAGE = b'RIFF' + (22).to_bytes(4, 'little') + b'WEBPVP8 ' + (10).to_bytes(4, 'little') + b'0123456789'
CSS = ('body[data-surface=member] .member-reserve-art{background-image:url("./' + m.image_name(IMAGE) + '")}').encode()

def release(data=APP, css=CSS, image=IMAGE):
    return {'schema': 'FTI_MEMBER_RESERVE_PANEL_V1', 'app': m.compressed(data),
            'css': m.compressed(css), 'image': m.compressed(image)}


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.before = ('<html><head><link rel="stylesheet" href="/' + m.BASE + '/style.css"></head>'
            '<body><script type="module" src="' + m.CURRENT_ENTRY + '"></script></body></html>').encode()
        self.target = self.root / 'web/index.html'
        files = {
            'web/index.html': self.before, 'web/app.js': b'protected application',
            'web/app.js.LEGAL.txt': b'legal notice',
            'scripts/server.mjs': b'protected server',
            'scripts/continuity-release.mjs': b'protected verification',
            'web/vendor/walletconnect.js': b'protected wallet SDK',
            'landing/dist/index.html': b'protected landing',
            'web/' + m.BASE + '/app.js': b'baseline app',
            'web/' + m.BASE + '/app.js.LEGAL.txt': b'legal notice',
            'web/' + m.BASE + '/vendor/ethers.js': b'protected ethers',
            'web/' + m.BASE + '/vendor/walletconnect.js': b'protected base SDK',
            'web' + m.CURRENT_APP: b'current registration app',
            'web' + m.CURRENT_ENTRY: m.entry_code(m.CURRENT_APP),
            'web' + m.REFERRAL + 'referral-context.js': b'preserve referrals',
            'web' + m.REFERRAL + 'entry.js': b'original wrapper',
        }
        for name, data in files.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.saved = {'MainPID': str(os.getpid()), 'WorkingDirectory': str(self.root), 'NRestarts': '0'}
        self.config = dict(m.CONFIG, referralPlacementEnabled=True)
        self.calls = []
        self.failed = False
        self.failure_mode = None

        def served(url, expected, kind='html'):
            self.calls.append(url)
            from urllib.parse import urlsplit
            path = urlsplit(url).path
            actual = self.target.read_bytes() if path in m.ROUTES else (self.root / ('web' + path)).read_bytes()
            self.assertEqual(actual, expected)
            if self.failure_mode and path in m.ROUTES and actual != self.before and not self.failed:
                self.failed = True
                if self.failure_mode == 'concurrent':
                    self.target.write_bytes(b'concurrent operator HTML')
                raise RuntimeError('verification failed')

        module = files['web' + m.REFERRAL + 'referral-context.js']
        blob = m.hashlib.sha1(b'blob ' + str(len(module)).encode() + b'\0' + module).hexdigest()
        patches = [patch.object(m, 'service', return_value=(self.saved, self.root)),
            patch.object(m, 'properties', return_value=self.saved),
            patch.object(m, 'config', return_value=self.config), patch.object(m, 'served', side_effect=served),
            patch.object(m, 'node_executable', return_value='/test/node'),
            patch.object(m, 'BASE_APP', m.sha(b'baseline app')), patch.object(m, 'LEGAL', m.sha(b'legal notice')),
            patch.object(m, 'CURRENT_APP_SHA', m.sha(b'current registration app')),
            patch.object(m, 'REFERRAL_BLOB', blob), patch.object(m, 'BACKUPS', self.root / 'backups'),
            patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0))]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    def test_payload_matches_its_digest(self):
        self.assertEqual(m.payload(release()), (APP, CSS, IMAGE))

    def test_bad_package_schema_or_checksum_is_rejected(self):
        for item in [None, {}, dict(release(), schema='other'), dict(release(), app=dict(release()['app'], sha256='a' * 64))]:
            with self.subTest(item=type(item)), self.assertRaises(RuntimeError):
                m.payload(item)

    def test_decompression_is_bounded(self):
        with patch.object(m, 'LIMIT', 300):
            with self.assertRaises(RuntimeError):
                m.payload(release(b'x' * 301))

    def test_html_plan_preserves_existing_style_and_installed_referral(self):
        after, assets = m.plan(self.before, APP, CSS, IMAGE)
        self.assertIn(('/' + m.BASE + '/style.css').encode(), after)
        self.assertEqual(len(assets), 4)
        entry = next(data for url, (data, kind) in assets.items() if url.endswith('/entry.js'))
        self.assertIn((m.REFERRAL + 'referral-context.js').encode(), entry)
        self.assertIn(b'installReferralContext(window)', entry)
        self.assertIn(b'app-member-reserve-', entry)
        self.assertIn(b'fti-member-reserve-theme-', after)
        self.assertLess(after.index(b'/style.css'), after.index(b'fti-member-reserve-theme-'))
        self.assertEqual([kind for _data, kind in assets.values()].count('css'), 1)
        self.assertEqual([kind for _data, kind in assets.values()].count('webp'), 1)

    def test_legacy_referral_entry_cannot_bypass_registration_recovery_prerequisite(self):
        old = self.before.replace(m.CURRENT_ENTRY.encode(), (m.REFERRAL + 'entry.js').encode())
        with self.assertRaisesRegex(RuntimeError, 'UNRECOGNIZED_INSTALLED_ENTRY'):
            m.plan(old, APP, CSS, IMAGE)

    def test_current_registration_app_or_wrapper_tampering_is_rejected(self):
        for name in [m.CURRENT_APP, m.CURRENT_ENTRY]:
            target = self.root / ('web' + name)
            expected = target.read_bytes()
            target.write_bytes(b'tampered current recovery')
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, 'REGISTRATION_RECOVERY_MISMATCH'):
                m.install(release(), apply=True)
            self.assertEqual(self.target.read_bytes(), self.before)
            self.assertFalse(m.BACKUPS.exists())
            target.write_bytes(expected)

    def test_all_three_payload_digests_are_checked(self):
        for key in ['app', 'css', 'image']:
            item = release()
            item[key]['sha256'] = 'f' * 64
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'RELEASE_HASH_MISMATCH'):
                m.payload(item)

    def test_invalid_webp_or_unexpected_css_resource_is_rejected(self):
        for image in [b'not an image', IMAGE[:-1], IMAGE.replace(b'VP8 ', b'HTML')]:
            with self.subTest(image=image[:16]), self.assertRaisesRegex(RuntimeError, 'INVALID_WEBP_ASSET'):
                m.payload(release(image=image))
        for css in [CSS.replace(b'url("./', b'url("https://other.test/'),
                    CSS + b'@import "other.css";', CSS + b'p{background:url(other.webp)}',
                    CSS.replace(m.image_name(IMAGE).encode(), b'unknown.webp')]:
            with self.subTest(css=css[:70]), self.assertRaisesRegex(RuntimeError, 'INVALID_PANEL_STYLESHEET'):
                m.payload(release(css=css))

    def test_package_rewrites_one_built_webp_and_is_deterministic(self):
        (self.root / 'web/app.js').write_bytes(APP)
        image = self.root / 'web/assets/member-reserve-flow-ABC123.webp'
        image.parent.mkdir()
        image.write_bytes(IMAGE)
        (self.root / 'web/member-reserve-panel.css').write_bytes(
            b'body[data-surface=member] .member-reserve-art{background-image:url(./assets/member-reserve-flow-ABC123.webp)}')
        outputs = [self.root / 'installer-a.py', self.root / 'installer-b.py']
        for output in outputs:
            m.package(self.root, output)
        self.assertEqual(outputs[0].read_bytes(), outputs[1].read_bytes())
        module_spec = importlib.util.spec_from_file_location('packaged_panel', outputs[0])
        packaged = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(packaged)
        app, css, image = m.payload(packaged.RELEASE)
        self.assertEqual((app, image), (APP, IMAGE))
        self.assertNotIn(b'assets/', css)
        self.assertIn(('./' + m.image_name(IMAGE)).encode(), css)

    def test_packager_rejects_nonlocal_asset_paths(self):
        for url in ['../private.webp', '/assets/art.webp', 'https://other.test/art.webp']:
            (self.root / 'web/app.js').write_bytes(APP)
            (self.root / 'web/member-reserve-panel.css').write_text(
                'body[data-surface=member]{background-image:url(' + url + ')}')
            with self.subTest(url=url), self.assertRaisesRegex(RuntimeError, 'UNEXPECTED_PANEL_IMAGE_PATH'):
                m.package(self.root, self.root / 'rejected.py')

    def test_ambiguous_html_entries_are_rejected(self):
        for value in [b'<html></html>', self.before + self.before,
                      b'<base href="https://other.test">' + self.before]:
            with self.assertRaises(RuntimeError):
                m.plan(value, APP, CSS, IMAGE)

    def test_default_preflight_writes_no_files(self):
        before = sorted(str(p) for p in self.root.rglob('*'))
        m.install(release())
        self.assertEqual(before, sorted(str(p) for p in self.root.rglob('*')))
        self.assertEqual(self.target.read_bytes(), self.before)

    def test_install_publishes_new_assets_and_only_switches_html(self):
        protected = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file() and p != self.target}
        m.install(release(), apply=True)
        self.assertNotEqual(self.target.read_bytes(), self.before)
        for file, value in protected.items():
            self.assertEqual(file.read_bytes(), value)
        backups = list(m.BACKUPS.glob('install-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / 'before.html').read_bytes(), self.before)
        self.assertEqual((backups[0] / 'before.html').stat().st_mode & 0o777, 0o600)

    def install_with_private_umask(self):
        previous = os.umask(0o077)
        try:
            m.install(release(), apply=True)
        finally:
            os.umask(previous)

    def entry_asset(self):
        _, assets = m.plan(self.before, APP, CSS, IMAGE)
        url = next(url for url in assets if url.endswith('/entry.js'))
        return url, self.root / ('web' + url), assets[url][0]

    def test_main_umask_publishes_readable_entry_and_keeps_backups_private(self):
        self.install_with_private_umask()
        _, entry, data = self.entry_asset()
        self.assertEqual(entry.parent.stat().st_mode & 0o777, 0o755)
        self.assertEqual(entry.stat().st_mode & 0o777, 0o644)
        self.assertEqual(entry.read_bytes(), data)
        backup = next(m.BACKUPS.glob('install-*'))
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertEqual((backup / 'installer.py').stat().st_mode & 0o777, 0o600)
        _after, assets = m.plan(self.before, APP, CSS, IMAGE)
        for url, (data, _kind) in assets.items():
            file = self.root / ('web' + url)
            self.assertEqual(file.parent.stat().st_mode & 0o777, 0o755)
            self.assertEqual(file.stat().st_mode & 0o777, 0o644)
            self.assertEqual(file.read_bytes(), data)

    def test_retry_recovers_matching_css_and_image_in_same_private_directory(self):
        _after, assets = m.plan(self.before, APP, CSS, IMAGE)
        for url, (data, kind) in assets.items():
            if kind not in ('css', 'webp'):
                continue
            file = self.root / ('web' + url)
            file.parent.mkdir(mode=0o700, exist_ok=True)
            file.write_bytes(data)
        self.install_with_private_umask()
        for url, (_data, kind) in assets.items():
            if kind in ('css', 'webp'):
                self.assertEqual((self.root / ('web' + url)).parent.stat().st_mode & 0o777, 0o755)

    def test_node_checks_only_javascript_not_stylesheet_or_webp(self):
        m.install(release())
        checked = [call.kwargs['input'] for call in m.subprocess.run.call_args_list]
        self.assertEqual(len(checked), 2)
        self.assertIn(APP, checked)
        self.assertNotIn(CSS, checked)
        self.assertNotIn(IMAGE, checked)

    def test_each_asset_requires_the_correct_http_mime(self):
        for kind, mime, data in [('css', 'text/css', CSS), ('webp', 'image/webp', IMAGE),
                                 ('js', 'application/javascript', APP), ('html', 'text/html', self.before)]:
            with self.subTest(kind=kind), patch.object(m, 'fetch', return_value=(data, mime)):
                SERVED('https://fixture.test/asset', data, kind)
            with self.subTest(kind=kind), patch.object(m, 'fetch', return_value=(data, 'application/octet-stream')):
                with self.assertRaisesRegex(RuntimeError, 'HTTP_MIME_MISMATCH'):
                    SERVED('https://fixture.test/asset', data, kind)

    def test_retry_repairs_matching_private_entry_left_by_older_installer(self):
        _, entry, data = self.entry_asset()
        entry.parent.mkdir(mode=0o700)
        entry.write_bytes(data)
        entry.chmod(0o644)
        before_inode = entry.stat().st_ino
        self.install_with_private_umask()
        self.assertEqual(entry.parent.stat().st_mode & 0o777, 0o755)
        self.assertEqual(entry.stat().st_ino, before_inode)
        self.assertEqual(entry.read_bytes(), data)

    def test_retry_never_publishes_unexpected_private_directory_contents(self):
        _, entry, _ = self.entry_asset()
        entry.parent.mkdir(mode=0o700)
        (entry.parent / 'operator-private.txt').write_bytes(b'private fixture')
        with self.assertRaisesRegex(RuntimeError, 'UNSAFE_PRIVATE_ASSET_DIRECTORY'):
            self.install_with_private_umask()
        self.assertEqual(entry.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.target.read_bytes(), self.before)

    def test_http_failure_identifies_the_exact_failed_asset_url(self):
        url = 'http://127.0.0.1:3110/fti-member-reserve-fixture/entry.js'
        error = m.urllib.error.HTTPError(url, 404, 'Not found', {}, None)
        with patch.object(m.urllib.request, 'build_opener') as opener:
            opener.return_value.open.side_effect = error
            with self.assertRaisesRegex(RuntimeError, 'HTTP_STATUS_404: ' + url):
                m.fetch(url)

    @unittest.skipUnless(os.geteuid() == 0, 'production permission check requires root')
    def test_unprivileged_http_service_can_read_js_css_and_image_after_main_umask(self):
        self.root.chmod(0o755)
        self.install_with_private_umask()
        url, _, data = self.entry_asset()
        # Match the production Node static file checks under an unprivileged
        # service identity. Root-only mocked reads cannot detect a 0700 parent.
        code = '''
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[1];
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=path.resolve(root,pathname.slice(1));
 if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('Not found');}
 res.writeHead(200,{'Content-Type':pathname.endsWith('.css')?'text/css':pathname.endsWith('.webp')?'image/webp':'text/javascript'});fs.createReadStream(file).pipe(res);
});
server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
'''
        try:
            process = subprocess.Popen([shutil.which('node'), '--input-type=module', '-e', code,
                str(self.root / 'web')], cwd=self.root, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, user=65534, group=65534, extra_groups=())
        except PermissionError:
            if os.environ.get('FTI_REQUIRE_SERVICE_UID_HTTP_TEST') == '1':
                raise
            self.skipTest('Executor cannot switch service UID/GID; exercised by root CI')
        try:
            self.assertTrue(select.select([process.stdout], [], [], 10)[0], 'HTTP service did not start')
            port = process.stdout.readline().strip()
            self.assertTrue(port.isdecimal(), 'Unprivileged Node service did not report a port')
            opener = m.urllib.request.build_opener(m.urllib.request.ProxyHandler({}))
            _after, assets = m.plan(self.before, APP, CSS, IMAGE)
            for url, (data, kind) in assets.items():
                with opener.open('http://127.0.0.1:' + port + url, timeout=5) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.read(), data)
                    self.assertEqual(response.headers.get_content_type(),
                                     {'css': 'text/css', 'webp': 'image/webp', 'js': 'text/javascript'}[kind])
        finally:
            process.terminate()
            process.wait(timeout=5)
            process.stdout.close()
            process.stderr.close()

    def test_failed_post_switch_verification_restores_original_html(self):
        self.failure_mode = 'served'
        with self.assertRaisesRegex(RuntimeError, 'verification failed'):
            m.install(release(), apply=True)
        self.assertEqual(self.target.read_bytes(), self.before)

    def test_failed_verification_preserves_a_concurrent_operator_edit(self):
        self.failure_mode = 'concurrent'
        with self.assertRaises(RuntimeError):
            m.install(release(), apply=True)
        self.assertEqual(self.target.read_bytes(), b'concurrent operator HTML')

    def test_restore_verifies_backup_and_does_not_restart(self):
        m.install(release(), apply=True)
        backup = next(m.BACKUPS.glob('install-*'))
        m.restore(backup)
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual(m.properties(), self.saved)

    def test_restore_rejects_a_different_active_release(self):
        m.install(release(), apply=True)
        backup = next(m.BACKUPS.glob('install-*'))
        record = json.loads((backup / 'record.json').read_text())
        record['root'] = '/other/release'
        (backup / 'record.json').write_text(json.dumps(record))
        with self.assertRaisesRegex(RuntimeError, 'ACTIVE_RELEASE_CHANGED'):
            m.restore(backup)

    def test_wrong_baseline_fails_before_any_html_change(self):
        (self.root / ('web/' + m.BASE + '/app.js')).write_bytes(b'other version')
        with self.assertRaisesRegex(RuntimeError, 'BASE_BUNDLE_MISMATCH'):
            m.install(release(), apply=True)
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertFalse(m.BACKUPS.exists())

    def test_repeated_install_checks_assets_without_replacing_html_or_creating_another_backup(self):
        m.install(release(), apply=True)
        before = self.target.stat().st_ino
        m.install(release(), apply=True)
        self.assertEqual(self.target.stat().st_ino, before)
        self.assertEqual(len(list(m.BACKUPS.glob('install-*'))), 1)

    def test_symlinks_and_hardlinks_are_rejected(self):
        linked = self.root / 'link'
        linked.symlink_to(self.target)
        with self.assertRaises(RuntimeError):
            m.regular(linked)
        hard = self.root / 'hard'
        os.link(self.target, hard)
        with self.assertRaises(RuntimeError):
            m.regular(hard)

    def test_atomic_replace_keeps_mode_and_rejects_stale_metadata(self):
        self.target.chmod(0o640)
        before, info = m.regular(self.target)
        m.replace(self.target, before, b'after', info)
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o640)
        with self.assertRaises(RuntimeError):
            m.replace(self.target, before, b'overwrite', info)


if __name__ == '__main__':
    unittest.main()
