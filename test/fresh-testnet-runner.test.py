"""No public network or signing: deployment runner input and retry boundaries."""
import hashlib
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('runner', ROOT / 'tools/start-fresh-testnet.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def test_release_and_preparation_are_pinned_to_the_same_committed_bytes(self):
        source = subprocess.check_output(['git', 'show', runner.BASE_REV + ':tools/prepare-fresh-testnet.sh'], cwd=ROOT)
        self.assertEqual(hashlib.sha256(source).hexdigest(), runner.PREP_SHA256)
        self.assertIn(runner.BASE_REV, runner.PREP_URL)
        self.assertIn(b'test/pool-*.test.mjs', source)
        self.assertIn(b'test/funded-keeper.test.mjs', source)

    def test_mainnet_rpc_cannot_reach_balance_or_send(self):
        with patch.object(runner, 'rpc', return_value=56) as rpc:
            with self.assertRaisesRegex(runner.SetupError, 'TESTNET'):
                runner.read_preflight('https://example.invalid', '0x' + '1' * 40, 1, 1)
            self.assertEqual(rpc.call_count, 1)

    def test_pending_nonce_high_gas_and_insufficient_funds_are_rejected(self):
        for responses in [[97, 100, 2, 0, 1], [97, 100, 11, 0, 0], [97, 9, 2, 0, 0]]:
            with patch.object(runner, 'rpc', side_effect=responses):
                with self.assertRaises(runner.SetupError):
                    runner.read_preflight('https://example.invalid', '0x' + '1' * 40, 10, 10)

    def test_budget_uses_exact_decimal_units(self):
        self.assertEqual(runner.atomic_units('0.100000000000000001', 18), 100000000000000001)
        for value in ['0', '-1', '1e18', '1,000', '0.0000000000000000001']:
            with self.assertRaises(runner.SetupError):
                runner.atomic_units(value, 18)

    def test_cancel_creates_no_marker_and_never_starts_signer(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(runner, 'run_checked') as execute:
            folder = Path(tmp)
            with self.assertRaises(runner.SetupError):
                runner.confirm_and_deploy('DEPLOY 56 ' + 'a' * 64, 'a' * 64, folder / 'marker.json',
                                          folder, Path('/usr/bin/node'), folder / 'key', 10, 10, folder, {})
            execute.assert_not_called()
            self.assertFalse((folder / 'marker.json').exists())

    def test_partial_failure_keeps_marker_and_repeat_cannot_submit(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            args = ('DEPLOY 97 ' + 'a' * 64, 'a' * 64, folder / 'marker.json', folder,
                    Path('/usr/bin/node'), folder / 'key', 10, 10, folder, {})
            with patch.object(runner, 'run_checked', side_effect=runner.SetupError('partial')):
                with self.assertRaises(runner.SetupError):
                    runner.confirm_and_deploy(*args)
            original = (folder / 'marker.json').read_bytes()
            with patch.object(runner, 'run_checked') as execute:
                with self.assertRaises(FileExistsError):
                    runner.confirm_and_deploy(*args)
                execute.assert_not_called()
            self.assertEqual((folder / 'marker.json').read_bytes(), original)

    def test_new_release_directory_preserves_previous_journal(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = runner.private_dir(Path(tmp) / 'fti-fresh-testnet-runner')
            old = parent / 'deployment-requested.json'
            runner.write_new(old, {'source': 'previous release'})
            new = runner.private_dir(parent / runner.BASE_REV)
            self.assertTrue(old.exists())
            self.assertFalse((new / 'deployment-requested.json').exists())


if __name__ == '__main__':
    unittest.main()
