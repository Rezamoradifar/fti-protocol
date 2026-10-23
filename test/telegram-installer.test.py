import contextlib
from datetime import datetime, timedelta
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('fti_telegram_install', ROOT / 'tools/install-telegram-publisher.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class FakeAPI:
    calls = []

    def __init__(self, token):
        pass

    def call(self, method, params):
        self.calls.append(method)
        if method == 'getMe':
            return {'id': 123456, 'is_bot': True, 'username': 'FTITestBot'}
        if method == 'getChat':
            return {'id': -1001234567890, 'type': 'channel', 'username': 'FTITestChannel'}
        if method == 'getChatMember':
            return {'user': {'id': 123456}, 'status': 'administrator', 'can_post_messages': True}
        raise AssertionError('Installer must never send messages')


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fti-telegram-test-')
        self.root = Path(self.temp.name)
        self.root.chmod(0o755)
        self.content = json.loads((ROOT / 'config/telegram-launch-posts.en.json').read_text())
        self.now = datetime.now(m.TZ)
        self.queue = m.build_queue(self.content, self.now)
        FakeAPI.calls = []

    def tearDown(self):
        self.temp.cleanup()

    def test_default_future_schedule_and_single_post_per_day(self):
        posts = self.queue['posts']
        self.assertEqual(len(posts), 10)
        times = [datetime.fromisoformat(p['scheduled_at']) for p in posts]
        self.assertEqual(times[0].date(), (self.now + timedelta(days=1)).date())
        self.assertTrue(all(t.hour == 19 and t.utcoffset() == timedelta(hours=3, minutes=30) for t in times))
        module = m.publisher()
        path = self.root / 'queue.json'
        path.write_text(json.dumps(self.queue))
        self.assertEqual(len(module.load_queue(path)), 10)

    def test_past_naive_and_duplicate_content_rejected(self):
        for timestamp in [self.now.replace(tzinfo=None).isoformat(), (self.now - timedelta(days=1)).isoformat()]:
            with self.assertRaises(m.InstallError):
                m.build_queue(self.content, self.now, timestamp)
        self.content['posts'][1]['id'] = self.content['posts'][0]['id']
        with self.assertRaises(m.InstallError):
            m.build_queue(self.content, self.now)

    def install_in_temporary_root(self, fail_verify=False):
        module = m.publisher()
        units = self.root / 'systemd'
        units.mkdir(exist_ok=True)
        config = self.root / 'etc-fti/config.json'
        releases = self.root / 'opt-fti/releases'
        commands = []
        original_is_dir = Path.is_dir

        def command(*args):
            commands.append(args)
            if fail_verify and args[0] == 'systemd-analyze':
                raise subprocess.CalledProcessError(1, args)
            if args[:2] == ('systemctl', 'start'):
                text = (units / m.SERVICE).read_text()
                self.assertIn(' --validate\n', text)
                self.assertNotIn(' --publish\n', text)
            return subprocess.CompletedProcess(args, 0, '', '')

        with patch.object(m, 'UNITS', units), patch.object(m, 'CONFIG', config), patch.object(m, 'RELEASES', releases), \
             patch.object(m, 'run', side_effect=command), patch.object(m, 'clean_empty_state'), \
             patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')), \
             patch.object(m.Path, 'is_dir', lambda p: True if str(p) == '/run/systemd/system' else original_is_dir(p)), \
             patch.object(m.sys.stdin, 'isatty', return_value=True), patch.object(m.sys.stderr, 'isatty', return_value=True), \
             patch.object(m.getpass, 'getpass', return_value='123456:' + 'a' * 35), \
             patch.object(module, 'TelegramAPI', FakeAPI), contextlib.redirect_stdout(io.StringIO()):
            old_umask = os.umask(0o077)
            try:
                m.install(self.queue, '@FTITestChannel', module)
            finally:
                os.umask(old_umask)
        return units, config, releases, commands

    @unittest.skipUnless(os.geteuid() == 0, 'installer file ownership requires root')
    def test_install_private_config_readonly_initial_service_and_public_asset_permissions(self):
        units, config, releases, commands = self.install_in_temporary_root()
        self.assertEqual(config.stat().st_mode & 0o777, 0o600)
        self.assertEqual(config.parent.stat().st_mode & 0o777, 0o700)
        release = next(releases.iterdir())
        self.assertEqual(release.stat().st_mode & 0o777, 0o755)
        self.assertIn(' --publish\n', (units / m.SERVICE).read_text())
        self.assertLess(commands.index(('systemctl', 'start', m.SERVICE)), commands.index(('systemctl', 'enable', '--now', m.TIMER)))
        self.assertNotIn('sendMessage', FakeAPI.calls)
        for directory in (self.root, releases.parent, releases, release):
            self.assertEqual(directory.stat().st_mode & 0o005, 0o005)
        for filename in ('telegram-publisher.py', 'queue.json'):
            path = release / filename
            self.assertFalse(path.is_symlink())
            self.assertEqual(path.stat().st_mode & 0o004, 0o004)

    @unittest.skipUnless(os.geteuid() == 0, 'installer file ownership requires root')
    def test_verify_failure_can_retry_without_partial_release(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.install_in_temporary_root(fail_verify=True)
        self.assertEqual(list((self.root / 'opt-fti/releases').iterdir()), [])
        self.assertFalse((self.root / 'etc-fti/config.json').exists())
        self.install_in_temporary_root()


if __name__ == '__main__':
    unittest.main()
