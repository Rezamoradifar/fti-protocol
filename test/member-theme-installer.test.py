"""Installer orchestration only: synthetic static assets, no wallets or EVM."""
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('installer', Path(__file__).resolve().parents[1] / 'tools/install-member-theme.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='fti-theme-test-')
        self.root = Path(self.temporary.name) / 'source'
        (self.root / 'web/vendor').mkdir(parents=True)
        (self.root / 'frontend').mkdir()
        (self.root / 'scripts').mkdir()
        self.html = b'<html><head><link href="./style.css"></head><body><div id="root"></div><script src="./app.js"></script></body></html>'
        (self.root / 'web/index.html').write_bytes(self.html)
        (self.root / 'web/app.js').write_bytes(b'document.body.dataset.surface="member"; /* workspace-header */')
        (self.root / 'web/style.css').write_bytes(b'body{color:white}')
        (self.root / 'frontend/controller.js').write_bytes(b'// unchanged transaction handler')
        (self.root / 'scripts/server.mjs').write_bytes(b'// unchanged server verifier')
        self.css = b'body[data-surface="member"] { --bg: #080d0b; --accent: #b2ffd0; }\n'
        self.backups = Path(self.temporary.name) / 'backups'
        self.cfg = {'chainId': 97, 'sourceRevision': '0' * 40}
        self.pin = patch.object(m, 'THEME_BLOB', m.blob(self.css))
        self.pin.start()

    def tearDown(self):
        self.pin.stop()
        self.temporary.cleanup()

    def get(self, route):
        if route == '/api/config':
            return json.dumps(self.cfg).encode(), 'application/json'
        file = self.root / 'web' / ('index.html' if route == '/app/' else route.removeprefix('/app/'))
        return file.read_bytes(), 'text/css' if file.suffix == '.css' else 'text/html'

    def install(self, get=None, **kwargs):
        return m.apply_overlay(self.root, self.css, self.cfg, get or self.get, self.backups, **kwargs)

    def test_install_changes_only_html_and_one_reviewed_css(self):
        before = m.protected_hashes(self.root)
        result = self.install()
        self.assertEqual(result['result'], 'FTI_MEMBER_THEME_INSTALLED')
        self.assertEqual(before, m.protected_hashes(self.root))
        self.assertFalse(result['contractsChanged'])
        self.assertFalse(result['servicesRestarted'])
        current = (self.root / 'web/index.html').read_bytes()
        self.assertEqual(current, m.template(self.html, self.css))
        self.assertIn(b'integrity="sha256-', current)
        backup = Path(result['backup'])
        self.assertEqual((backup / 'index.before.html').read_bytes(), self.html)
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertEqual((backup / 'record.json').stat().st_mode & 0o777, 0o600)

    def test_rerun_is_idempotent_without_duplicate_links(self):
        self.install()
        result = self.install()
        self.assertEqual(result['result'], 'FTI_MEMBER_THEME_ALREADY_INSTALLED')
        self.assertEqual((self.root / 'web/index.html').read_text().count(m.MARKER), 1)

    def test_changed_download_rejected_before_html_write(self):
        with self.assertRaisesRegex(RuntimeError, 'INTEGRITY'):
            m.apply_overlay(self.root, self.css + b'changed', self.cfg, self.get, self.backups)
        self.assertEqual((self.root / 'web/index.html').read_bytes(), self.html)
        self.assertFalse(self.backups.exists())

    def test_different_served_html_is_not_patched(self):
        with self.assertRaisesRegex(RuntimeError, 'SELECTED_HTML'):
            self.install(lambda route: (b'other service', 'text/html'))
        self.assertEqual((self.root / 'web/index.html').read_bytes(), self.html)

    def test_symlink_template_is_rejected(self):
        index = self.root / 'web/index.html'
        actual = self.root / 'private.html'
        index.rename(actual)
        index.symlink_to(actual)
        with self.assertRaises(OSError):
            self.install()
        self.assertEqual(actual.read_bytes(), self.html)

    def test_different_or_symlinked_asset_is_rejected(self):
        file = self.root / 'web' / m.ASSET
        file.write_text('other bytes')
        with self.assertRaisesRegex(RuntimeError, 'ASSET_DIFFERS'):
            self.install()
        file.unlink()
        file.symlink_to(self.root / 'web/style.css')
        with self.assertRaises(OSError):
            self.install()

    def test_css_http_failure_leaves_original_html(self):
        def get(route):
            if route.endswith('.css'):
                return b'not css', 'text/html'
            return self.get(route)
        with self.assertRaisesRegex(RuntimeError, 'CSS_HTTP'):
            self.install(get)
        self.assertEqual((self.root / 'web/index.html').read_bytes(), self.html)

    def test_changed_config_restores_html_after_write(self):
        def get(route):
            if route == '/api/config':
                return b'{"changed": true}', 'application/json'
            return self.get(route)
        with self.assertRaisesRegex(RuntimeError, 'CONFIG_CHANGED'):
            self.install(get)
        self.assertEqual((self.root / 'web/index.html').read_bytes(), self.html)

    def test_failed_postwrite_html_probe_restores_original(self):
        calls = 0
        def get(route):
            nonlocal calls
            if route == '/app/':
                calls += 1
                if calls > 1:
                    return b'stale cached document', 'text/html'
            return self.get(route)
        with self.assertRaisesRegex(RuntimeError, 'HTML_HTTP'):
            self.install(get)
        self.assertEqual((self.root / 'web/index.html').read_bytes(), self.html)

    def test_concurrent_edit_is_never_overwritten(self):
        index = self.root / 'web/index.html'
        changed = self.html + b'<!-- another administrator -->'
        def identity():
            index.write_bytes(changed)
        with self.assertRaisesRegex(RuntimeError, 'CONCURRENT_HTML_CHANGE'):
            self.install(identity_check=identity)
        self.assertEqual(index.read_bytes(), changed)

    def test_explicit_rollback_preserves_bundle_and_is_idempotent(self):
        before = m.protected_hashes(self.root)
        result = self.install()
        restored = m.restore(self.root, Path(result['backup']), self.cfg)
        self.assertEqual(restored['result'], 'FTI_MEMBER_THEME_RESTORED')
        self.assertEqual((self.root / 'web/index.html').read_bytes(), self.html)
        self.assertEqual(before, m.protected_hashes(self.root))
        self.assertEqual(m.restore(self.root, Path(result['backup']), self.cfg)['result'],
                         'FTI_MEMBER_THEME_ALREADY_RESTORED')

    def test_restore_refuses_later_edits_and_changed_config(self):
        result = self.install()
        backup = Path(result['backup'])
        with self.assertRaisesRegex(RuntimeError, 'CONFIG_CHANGED'):
            m.restore(self.root, backup, {'chainId': 56})
        index = self.root / 'web/index.html'
        index.write_bytes(index.read_bytes() + b'new edit')
        with self.assertRaisesRegex(RuntimeError, 'HTML_CHANGED'):
            m.restore(self.root, backup, self.cfg)

    def test_http_client_and_successful_checks_use_real_local_http(self):
        fixture = self
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                try:
                    data, mime = fixture.get(self.path)
                except FileNotFoundError:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.end_headers()
                self.wfile.write(data)
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = server.server_address[1]
            result = self.install(lambda route: m.local_get(port, route))
            self.assertEqual(result['result'], 'FTI_MEMBER_THEME_INSTALLED')
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_other_theme_reference_is_not_overwritten(self):
        html = self.html.replace(b'</head>', b'<link href="./member-landing-theme.css"></head>')
        with self.assertRaisesRegex(RuntimeError, 'OTHER_MEMBER_THEME'):
            m.template(html, self.css)


if __name__ == '__main__':
    unittest.main(verbosity=2)
