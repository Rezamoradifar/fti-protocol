import base64
import gzip
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('registration_recovery', ROOT / 'tools/install-registration-recovery-ui.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
APP = b"import {x} from './vendor/ethers.js'; const control='retry-pending-check';\n"


def release(data=APP):
    return {'schema': 'FTI_REGISTRATION_RECOVERY_UI_V1', 'sha256': m.sha(data),
            'gzipBase64': base64.b64encode(gzip.compress(data, mtime=0)).decode()}


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.before = ('<html><head><link rel="stylesheet" href="/' + m.BASE + '/style.css"></head>'
            '<body><script type="module" src="' + m.REFERRAL + 'entry.js"></script></body></html>').encode()
        self.target = self.root / 'web/index.html'
        files = {
            'web/index.html': self.before, 'web/app.js': b'protected application',
            'scripts/server.mjs': b'protected server',
            'scripts/continuity-release.mjs': b'protected verification',
            'web/vendor/walletconnect.js': b'protected wallet SDK',
            'landing/dist/index.html': b'protected landing',
            'web/' + m.BASE + '/app.js': b'baseline app',
            'web/' + m.BASE + '/app.js.LEGAL.txt': b'legal notice',
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

        def served(url, expected, javascript=False):
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
            patch.object(m, 'REFERRAL_BLOB', blob), patch.object(m, 'BACKUPS', self.root / 'backups'),
            patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0))]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    def test_payload_matches_its_digest(self):
        self.assertEqual(m.payload(release()), APP)

    def test_bad_package_schema_or_checksum_is_rejected(self):
        for item in [None, {}, dict(release(), schema='other'), dict(release(), sha256='a' * 64)]:
            with self.subTest(item=type(item)), self.assertRaises(RuntimeError):
                m.payload(item)

    def test_decompression_is_bounded(self):
        with patch.object(m, 'LIMIT', 300):
            with self.assertRaises(RuntimeError):
                m.payload(release(b'x' * 301))

    def test_html_plan_preserves_existing_style_and_installed_referral(self):
        after, assets = m.plan(self.before, APP)
        self.assertIn(('/' + m.BASE + '/style.css').encode(), after)
        self.assertEqual(len(assets), 2)
        entry = next(data for url, data in assets.items() if url.endswith('/entry.js'))
        self.assertIn((m.REFERRAL + 'referral-context.js').encode(), entry)
        self.assertIn(b'installReferralContext(window)', entry)
        self.assertIn(b'app-registration-recovery-', entry)

    def test_ambiguous_html_entries_are_rejected(self):
        for value in [b'<html></html>', self.before + self.before,
                      b'<base href="https://other.test">' + self.before]:
            with self.assertRaises(RuntimeError):
                m.plan(value, APP)

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
