import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout

spec = importlib.util.spec_from_file_location('journey_launcher', Path(__file__).resolve().parents[1] / 'tools/run-fresh-testnet-journey.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def test_confirmation_cancellation_never_starts_worker(self):
        prepared = (Path('/tmp/runner.mjs'), Path('/tmp/source'), Path('/tmp/node'), {}, '0x' + '1' * 40)
        calls = []
        with patch.object(launcher, 'prepare', return_value=prepared), patch.object(launcher, 'run', side_effect=lambda args, **kw: calls.append(args) or 'inactive\n'), patch('builtins.input', return_value=''), patch('sys.argv', ['runner.py']), redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, 'Cancelled'):
                launcher.main()
        self.assertEqual(len(calls), 1)
        self.assertNotIn('systemd-run', calls[0])

    def test_active_worker_is_not_started_twice(self):
        prepared = (Path('/tmp/runner.mjs'), Path('/tmp/source'), Path('/tmp/node'), {}, '0x' + '1' * 40)
        with patch.object(launcher, 'prepare', return_value=prepared), patch.object(launcher, 'run', return_value='active\n') as run, patch('builtins.input') as prompt, patch('sys.argv', ['runner.py']), redirect_stdout(io.StringIO()):
            launcher.main()
        self.assertEqual(run.call_count, 1)
        prompt.assert_not_called()

    def test_approval_starts_detached_service_without_credentials_in_arguments(self):
        prepared = (Path('/tmp/runner.mjs'), Path('/tmp/source'), Path('/tmp/node'), {'FTI_JOURNEY_RPC': 'https://secret.invalid/token'}, '0x' + '1' * 40)
        calls, out = [], io.StringIO()
        with patch.object(launcher, 'prepare', return_value=prepared), patch.object(launcher, 'run', side_effect=lambda args, **kw: calls.append(args) or 'inactive\n'), patch('builtins.input', return_value='TEST 97'), patch('sys.argv', ['runner.py']), redirect_stdout(out):
            launcher.main()
        self.assertEqual(calls[-1][0], 'systemd-run')
        self.assertIn('--worker', calls[-1])
        self.assertNotIn('secret.invalid', str(calls) + out.getvalue())
        self.assertIn('0.03', out.getvalue())

    def test_wrong_runner_hash_fails_before_service_inspection(self):
        with patch.object(launcher.os, 'geteuid', return_value=0), patch.object(launcher, 'RUNNER_HASH', '0' * 64), patch.object(launcher, 'inspect_service') as inspect:
            with self.assertRaisesRegex(RuntimeError, 'hash mismatch'):
                launcher.prepare()
        inspect.assert_not_called()

    def test_key_symlink_and_shared_permissions_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            key = Path(tmp) / 'key'
            key.write_text('dummy, no signing material')
            key.chmod(0o644)
            with self.assertRaisesRegex(RuntimeError, 'Private root-owned'):
                launcher.private_regular(key)
            link = Path(tmp) / 'link'
            link.symlink_to(key)
            with self.assertRaisesRegex(RuntimeError, 'Private root-owned'):
                launcher.private_regular(link)


if __name__ == '__main__':
    unittest.main()
