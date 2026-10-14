"""No public network or signing: deployment runner input and retry boundaries."""
import hashlib
import fcntl
import importlib.util
import io
import argparse
import contextlib
import json
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
    def test_preselected_key_path_skips_only_path_prompt_and_keeps_budget_and_genesis_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            key = home / 'test-only.key'
            runner.write_new(key, ('0' * 63 + '1').encode())
            original = key.read_bytes()
            addresses = ['0x' + format(i, '040x') for i in range(1, 9)]
            with patch.object(runner.Path, 'home', return_value=home), \
                    patch.object(runner.sys.stdin, 'isatty', return_value=True), \
                    patch.object(runner.sys, 'stdout', new_callable=io.StringIO), \
                    patch.object(runner.getpass, 'getpass', return_value=''), \
                    patch('builtins.input', side_effect=addresses + ['0.1', '10', 'TEST-GENESIS']) as prompt, \
                    patch.object(runner, 'read_preflight', side_effect=runner.SetupError('TEST_STOP_BEFORE_NETWORK')) as preflight, \
                    patch.object(runner, 'request_bytes') as network, \
                    patch.object(runner, 'run_checked') as execute:
                with self.assertRaisesRegex(runner.SetupError, 'TEST_STOP_BEFORE_NETWORK'):
                    runner.main(['--key-file', str(key)])
                self.assertEqual(prompt.call_count, 11)
                self.assertFalse(any('PRIVATE KEY FILE PATH' in call.args[0] for call in prompt.call_args_list))
                preflight.assert_called_once_with(runner.DEFAULT_RPC, addresses[0], 10 ** 17, 10 ** 10)
                network.assert_not_called()
                execute.assert_not_called()
            self.assertEqual(key.read_bytes(), original)
            self.assertFalse((home / 'fti-fresh-testnet-runner' / runner.BASE_REV / 'deployment-requested.json').exists())

    def test_preselected_key_still_rejects_insecure_file_before_inputs_or_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            key = home / 'test-only.key'
            key.write_text('0' * 63 + '1')
            key.chmod(0o644)
            with patch.object(runner.Path, 'home', return_value=home), \
                    patch.object(runner.sys.stdin, 'isatty', return_value=True), \
                    patch.object(runner.getpass, 'getpass') as hidden, \
                    patch('builtins.input') as prompt, \
                    patch.object(runner, 'request_bytes') as network:
                with self.assertRaisesRegex(runner.SetupError, 'Key file must be private'):
                    runner.main(['--key-file', str(key)])
                hidden.assert_not_called()
                prompt.assert_not_called()
                network.assert_not_called()

    def test_second_runner_reports_active_lock_without_prompt_network_or_journal_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            parent = runner.private_dir(home / 'fti-fresh-testnet-runner')
            base = runner.private_dir(parent / runner.BASE_REV)
            marker = base / 'deployment-requested.json'
            runner.write_new(marker, {'source': 'existing deployment'})
            original = marker.read_bytes()
            with (base / 'runner.lock').open('a+b') as held:
                fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with patch.object(runner.Path, 'home', return_value=home), \
                        patch.object(runner.sys.stdin, 'isatty', return_value=True), \
                        patch.object(runner, 'request_bytes') as network, \
                        patch.object(runner, 'run_checked') as execute, \
                        patch.object(runner.getpass, 'getpass') as hidden_input, \
                        patch('builtins.input') as prompt:
                    with self.assertRaisesRegex(runner.SetupError, 'Another testnet runner is still active'):
                        runner.main([])
                    network.assert_not_called()
                    execute.assert_not_called()
                    hidden_input.assert_not_called()
                    prompt.assert_not_called()
                self.assertEqual(marker.read_bytes(), original)
                # The rejected second runner must not remove or release the first lock.
                with (base / 'runner.lock').open('rb') as contender:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)

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


class ResumeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        home = Path(self.tmp.name)
        self.base = runner.private_dir(home / runner.BASE_REV)
        self.work = runner.private_dir(self.base / 'run-existing')
        runner.private_dir(self.work / 'tmp')
        candidates = runner.private_dir(self.work / 'candidates')
        self.candidate = runner.private_dir(candidates / 'fresh-existing')
        self.root = runner.private_dir(self.candidate / 'source')
        self.out = runner.private_dir(self.work / 'deployment')
        self.digest = 'a' * 64
        self.plan = {'digest': self.digest, 'chainId': 97, 'manifest': {'sourceRevision': runner.BASE_REV},
                     'testGenesis': True, 'genesis': ['test-placeholder'] * 31, 'nonce': 565,
                     'transactions': [{}] * 8, 'deployer': '0x' + '1' * 40,
                     'partners': ['0x' + format(i, '040x') for i in range(2, 9)], 'addresses': {}}
        runner.write_new(self.out / 'plan.json', self.plan)
        runner.write_new(self.candidate / 'result.json', {'commit': runner.BASE_REV,
                         'result': 'CANDIDATE_PREPARED', 'stage': 'complete', 'exitCode': 0})
        self.key = home / 'test-only.key'
        runner.write_new(self.key, ('0' * 63 + '1').encode())
        self.args = argparse.Namespace(resume_work=str(self.work), plan_digest=self.digest,
                                       key_file=str(self.key), budget_tbnb='0.1', gas_price_gwei='0.1', node=None)

    @contextlib.contextmanager
    def environment(self, answer, nonce=565, execute=None):
        # The Node plan/artifact verifier and signer are tested by the JS suite.
        # This suite exercises Python's resume, consent and journal boundaries.
        checked = json.dumps({'digest': self.digest, 'address': self.plan['deployer']}).encode()
        with patch.object(runner, 'select_node', return_value=Path('/usr/bin/node')), \
                patch.object(runner.subprocess, 'check_output', side_effect=[runner.BASE_REV.encode(), checked]), \
                patch.object(runner.getpass, 'getpass', return_value=''), \
                patch.object(runner, 'read_preflight', return_value={'nonce': nonce}), \
                patch.object(runner.sys, 'stdout', new_callable=io.StringIO), \
                patch('builtins.input', side_effect=answer) as prompt, \
                patch.object(runner, 'run_checked', side_effect=execute) as run:
            yield prompt, run

    def test_cancelled_prepared_plan_is_reopened_without_rebuild_or_plan_replacement(self):
        original = (self.out / 'plan.json').read_bytes()
        with self.environment(['CANCEL']) as (_, run):
            with self.assertRaisesRegex(runner.SetupError, 'Cancelled'):
                runner.resume_prepared(self.args, self.base)
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0], ['git', 'diff', '--exit-code', 'HEAD', '--'])
        self.assertEqual((self.out / 'plan.json').read_bytes(), original)
        self.assertFalse((self.base / 'deployment-requested.json').exists())

    def test_every_prior_attempt_marker_blocks_resume_and_is_preserved(self):
        markers = [self.base / 'deployment-requested.json'] + [self.out / name for name in
                   ['deployment.started.json', 'journal.jsonl', 'failure.json', 'result.json', 'deployment.json']]
        for marker in markers:
            with self.subTest(marker=marker.name):
                runner.write_new(marker, b'preserve')
                with self.assertRaisesRegex(runner.SetupError, 'already exists'):
                    runner.load_resume(self.base, self.work, self.digest)
                self.assertEqual(marker.read_bytes(), b'preserve')
                marker.unlink()  # Test fixture only; production never removes markers.

    def test_wrong_digest_or_unfinished_build_cannot_resume(self):
        with self.assertRaisesRegex(runner.SetupError, 'does not match'):
            runner.load_resume(self.base, self.work, 'b' * 64)
        result = self.candidate / 'result.json'
        result.write_text(json.dumps({'commit': runner.BASE_REV, 'result': 'FAILED', 'stage': 'tests', 'exitCode': 1}))
        with self.assertRaisesRegex(runner.SetupError, 'did not complete'):
            runner.load_resume(self.base, self.work, self.digest)

    def test_nonce_change_stops_before_confirmation_or_marker(self):
        with self.environment([], nonce=566) as (prompt, run):
            with self.assertRaisesRegex(runner.SetupError, 'nonce changed'):
                runner.resume_prepared(self.args, self.base)
            prompt.assert_not_called()
            self.assertEqual(run.call_count, 1)  # git diff only
        self.assertFalse((self.base / 'deployment-requested.json').exists())

    def test_blank_confirmation_reprompts_and_exact_consent_uses_original_plan_once(self):
        original = (self.out / 'plan.json').read_bytes()
        def execute(args, *unused):
            if args[0] == 'git':
                return
            self.assertIn('--confirm-plan', args)
            self.assertEqual(args[args.index('--confirm-plan') + 1], self.digest)
            self.assertEqual(args[args.index('--max-fee-wei') + 1], str(10 ** 17))
            self.assertEqual(args[args.index('--max-gas-price-wei') + 1], str(10 ** 8))
            self.assertEqual(args[args.index('--out') + 1], str(self.out))
            self.assertTrue((self.base / 'deployment-requested.json').exists())
            runner.write_new(self.out / 'result.json', {'result': 'FTI_FRESH_TESTNET_DEPLOYED', 'chainId': 97,
                             'sourceRevision': runner.BASE_REV, 'importedUsers': 0,
                             'poolDistributionVersion': 1, 'rewardModel': 'hourly-global-pool-v2'})
        with self.environment(['', 'DEPLOY 97 ' + self.digest], execute=execute) as (prompt, run):
            runner.resume_prepared(self.args, self.base)
            self.assertEqual(prompt.call_count, 2)
            self.assertEqual(run.call_count, 2)  # git diff and one deployment invocation
        self.assertEqual((self.out / 'plan.json').read_bytes(), original)
        with self.assertRaisesRegex(runner.SetupError, 'already exists'):
            runner.load_resume(self.base, self.work, self.digest)


if __name__ == '__main__':
    unittest.main()
