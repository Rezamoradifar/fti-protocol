import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('fti_site_link_install', ROOT / 'tools/install-telegram-site-link.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class SiteLinkInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.html = b'<html><body><div id="root">keep panel</div><script type="module" src="/existing.js"></script></body></html>'
        files = {'web/index.html': self.html, 'web/existing.js': b'keep application bundle',
                 'landing/dist/index.html': self.html.replace(b'keep panel', b'keep landing'),
                 'landing/dist/whitepaper/index.html': self.html.replace(b'keep panel', b'keep whitepaper'),
                 'landing/dist/roadmap/index.html': self.html.replace(b'keep panel', b'keep roadmap'),
                 'scripts/server.mjs': b"const PUBLIC_ROUTES=[]; const root='landing/dist'; const app='web';",
                 'scripts/site-routing.mjs': b"export const PUBLIC_ROUTES=['/whitepaper/','/roadmap/'];"}
        self.original = {}
        for name, data in files.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            self.original[path] = data
        self.saved = {'MainPID': '1234', 'WorkingDirectory': str(self.root), 'NRestarts': '0'}
        self.cfg = {'chainId': 56, 'binary': 'current live address', 'sourceRevision': 'live revision'}
        self.failure = None
        self.calls = []
        def served(route, expected, kind='html'):
            self.calls.append((route, kind))
            if route in {'/app/', '/token/', '/admin/'}:
                path = self.root / 'web/index.html'
            elif route == '/':
                path = self.root / 'landing/dist/index.html'
            elif kind == 'js':
                path = self.root / ('web' + route)
            else:
                path = self.root / ('landing/dist' + route + 'index.html')
            self.assertEqual(path.read_bytes(), expected)
            if self.failure and kind == 'html' and b'fti-official-channel-' in expected:
                mode, self.failure = self.failure, None
                if mode == 'concurrent':
                    path.write_bytes(b'later operator edit')
                raise RuntimeError('HTTP_BYTES_MISMATCH')
        for p in [patch.object(m, 'BACKUPS', self.root / 'backups'),
                  patch.object(m, 'service', return_value=(self.saved, self.root)),
                  patch.object(m, 'properties', return_value=self.saved),
                  patch.object(m, 'config', return_value=self.cfg),
                  patch.object(m, 'served', side_effect=served)]:
            p.start()
            self.addCleanup(p.stop)
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)

    def test_embedded_code_exact_and_preflight_is_read_only(self):
        self.assertEqual(m.EMBEDDED_JS.encode(), (ROOT / 'tools/telegram-site-link.js').read_bytes())
        before = {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        m.install()
        after = {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(after, before)
        self.assertFalse(m.BACKUPS.exists())

    def test_install_preserves_scripts_runtime_attributes_and_is_idempotent(self):
        target = self.root / 'web/index.html'
        target.chmod(0o640)
        old_info = target.stat()
        m.install(True)
        for path, data in self.original.items():
            if path.suffix == '.html':
                installed = path.read_bytes()
                self.assertEqual(installed.count(b'fti-official-channel-'), 1)
                self.assertEqual(installed.count(b'/existing.js'), 1)
                self.assertEqual(installed.replace(installed[installed.index(b'<script type="module" src="/fti-official-channel-'):
                    installed.index(b'</body>')], b''), data)
            else:
                self.assertEqual(path.read_bytes(), data)
        self.assertEqual(target.stat().st_mode & 0o777, 0o640)
        self.assertEqual((target.stat().st_uid, target.stat().st_gid), (old_info.st_uid, old_info.st_gid))
        backup = next(m.BACKUPS.glob('install-*'))
        record = json.loads((backup / 'record.json').read_text())
        self.assertEqual(record['state'], 'verified')
        self.assertEqual(len(record['intents']), 4)
        self.assertEqual((backup / 'installer.py').read_bytes(), Path(m.__file__).read_bytes())
        m.install(True)
        self.assertEqual(len(list(m.BACKUPS.glob('install-*'))), 1)

    def test_verification_failure_restores_only_exact_patched_html(self):
        self.failure = 'failure'
        with self.assertRaisesRegex(RuntimeError, 'HTTP_BYTES_MISMATCH'):
            m.install(True)
        self.assertTrue(all(path.read_bytes() == data for path, data in self.original.items()))
        self.failure = 'concurrent'
        with self.assertRaisesRegex(RuntimeError, 'HTTP_BYTES_MISMATCH'):
            m.install(True)
        self.assertEqual((self.root / 'web/index.html').read_bytes(), b'later operator edit')
        for path, data in self.original.items():
            if path != self.root / 'web/index.html':
                self.assertEqual(path.read_bytes(), data)

    def test_restore_checks_all_after_hashes_before_writing_and_preserves_later_edits(self):
        m.install(True)
        backup = next(m.BACKUPS.glob('install-*'))
        target = self.root / 'landing/dist/roadmap/index.html'
        installed = {p: p.read_bytes() for p in self.original if p.suffix == '.html'}
        target.write_bytes(b'later change')
        with self.assertRaisesRegex(RuntimeError, 'RESTORE_CONFLICT'):
            m.restore(backup)
        self.assertEqual((self.root / 'web/index.html').read_bytes(), installed[self.root / 'web/index.html'])
        self.assertEqual(target.read_bytes(), b'later change')
        target.write_bytes(installed[target])
        m.restore(backup)
        self.assertTrue(all(path.read_bytes() == data for path, data in self.original.items()))

    def test_conflicting_overlay_and_immutable_asset_are_rejected(self):
        target = self.root / 'web/index.html'
        target.write_bytes(self.html.replace(b'</body>', b'<script type="module" src="/fti-official-channel-other/official-channel.js"></script></body>'))
        with self.assertRaisesRegex(RuntimeError, 'CONFLICTING_CHANNEL_OVERLAY'):
            m.install(True)
        self.assertFalse(m.BACKUPS.exists())
        target.write_bytes(self.html)
        folder = self.root / ('web/fti-official-channel-' + m.sha(m.EMBEDDED_JS.encode())[:24])
        folder.mkdir()
        (folder / 'official-channel.js').write_bytes(b'unexpected bytes')
        with self.assertRaisesRegex(RuntimeError, 'IMMUTABLE_ASSET_COLLISION'):
            m.install(True)
        self.assertFalse(m.BACKUPS.exists())

    def test_apply_root_guard_and_service_change_abort_before_html(self):
        with patch.object(m.os, 'geteuid', return_value=1234):
            with self.assertRaisesRegex(RuntimeError, 'ROOT_REQUIRED'):
                m.main(['--apply'])
        with patch.object(m, 'properties', return_value=dict(self.saved, MainPID='5678')):
            with self.assertRaisesRegex(RuntimeError, 'SERVICE_CHANGED'):
                m.install(True)
        self.assertFalse(m.BACKUPS.exists())
        self.assertTrue(all(path.read_bytes() == data for path, data in self.original.items()))


if __name__ == '__main__':
    unittest.main()
