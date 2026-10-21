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
SPEC = importlib.util.spec_from_file_location('event_repair', ROOT / 'tools/repair-mainnet-event-rpc.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
r = m.r


class EventRpcTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'releases/mainnet-web-20261016T041703Z-351769'
        for directory in r.DIRS:
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        self.write('contracts/One.sol', b'contract One {}\n')
        self.write('scripts/server.mjs', b'// verified source\n')
        for name in r.EXTRAS:
            self.write(name, b'{}\n' if name.endswith('.json') else b'// original\n')
        self.sources = r.source_hashes(self.root)
        fingerprint = r.fingerprint(self.sources)
        self.cfg = dict(r.TARGET, sourceFingerprint=fingerprint, deployedBlock=100)
        self.cfg['artifactHashes'] = {}
        contract_digest = r.digest(r.packed([['One.sol', r.digest(b'contract One {}\n')]]))
        for name in r.ARTIFACTS:
            data = r.packed({'name': name, 'sourceDigest': contract_digest})
            self.write('artifacts/' + name + '.json', data)
            self.cfg['artifactHashes'][name] = r.digest(data)
        self.state = self.base / 'states' / self.root.name
        self.state.mkdir(parents=True)
        self.cfgfile = self.state / 'deployment.json'
        self.cfgfile.write_bytes(r.packed(self.cfg))
        self.node = self.base / 'runtime/node-v22.23.3-x64/bin/node'
        self.node.parent.mkdir(parents=True)
        self.node.write_text('#!/bin/sh\nexit 0\n')
        self.node.chmod(0o755)
        self.unit = self.base / 'web.service'
        self.unit.write_text('[Service]\n')
        self.web_env = self.state / 'web.env'
        self.web_env.write_text('DEPLOYMENT_FILE="' + str(self.cfgfile) + '"\nFTI_SOURCE_REVISION="'
                                + r.REVISION + '"\nPORT=3110\nHOST=127.0.0.1\n'
                                'RPC_URL=https://primary.invalid/PRIMARY_SECRET\n')
        self.override_env = self.base / 'rpc.env'
        self.override_env.write_text('RPC_URL=https://limited.invalid/OVERRIDE_SECRET\nEVENT_RPC_URL=\n')
        self.original_env = self.override_env.read_bytes()
        self.pid = 123
        self.commands = []
        self.running_env = {}
        self.on_restart = None
        self.new_url = 'https://events.invalid/PRIVATE_SECRET?token=hidden'
        for key, value in {
            'RELEASES': self.base / 'releases', 'STATES': self.base / 'states', 'RUNTIME': self.base / 'runtime',
            'BASELINE': self.sources, 'FINGERPRINT': fingerprint, 'ARTIFACTS': dict(self.cfg['artifactHashes']),
            'TARGET': dict(self.cfg), 'command': self.command,
        }.items():
            self.mock(r, key, value)
        self.mock(m, 'BACKUPS', self.base / 'backups')
        self.mock(r, 'wait_health', lambda: True)
        self.mock(m, 'wait_placement', lambda: True)

    def mock(self, obj, key, value):
        p = patch.object(obj, key, value)
        p.start()
        self.addCleanup(p.stop)

    def write(self, name, data):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)

    def command(self, args, **kwargs):
        self.commands.append(args)
        if args[:2] == ['systemctl', 'show']:
            return '\n'.join([
                'LoadState=loaded', 'User=fti-v3', 'Group=fti-v3', 'WorkingDirectory=' + str(self.root),
                'ExecStart={ path=' + str(self.node) + ' ; argv[]=' + str(self.node) + ' '
                + str(self.root / 'scripts/server.mjs') + ' ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid='
                + str(self.pid) + ' ; code=(null) ; status=0/0 }',
                'Environment=', 'EnvironmentFiles=' + str(self.web_env) + ' (ignore_errors=no)',
                'EnvironmentFiles=' + str(self.override_env) + ' (ignore_errors=no)',
                'UnsetEnvironment=', 'FragmentPath=' + str(self.unit), 'DropInPaths=',
            ])
        self.assertEqual(args, ['systemctl', 'restart', r.SERVICE])
        backup = next(m.BACKUPS.iterdir())
        self.assertEqual((backup / 'original.env').read_bytes(), self.original_env)
        self.assertTrue((backup / 'recover-mainnet-source.py').is_file())
        self.assertTrue((backup / 'repair-mainnet-event-rpc.py').is_file())
        self.running_env = m.env_values(self.override_env.read_text(), m.env_values(self.web_env.read_text()))
        self.pid += 1
        if self.on_restart:
            self.on_restart()
        return ''

    def apply(self):
        snapshot = r.inspect_service()
        props = r.properties()
        with contextlib.redirect_stdout(io.StringIO()) as out:
            m.apply(self.new_url, snapshot, props)
        return out.getvalue()

    def test_verified_change_uses_last_environment_file_and_preserves_sources(self):
        original_web = self.web_env.read_bytes()
        original_cfg = self.cfgfile.read_bytes()
        output = self.apply()
        self.assertIn('FTI_EVENT_RPC_AND_PLACEMENT_READY', output)
        self.assertNotIn('SECRET', output)
        self.assertEqual(self.running_env['EVENT_RPC_URL'], self.new_url)
        self.assertEqual(self.running_env['RPC_URL'], 'https://limited.invalid/OVERRIDE_SECRET')
        self.assertEqual(r.source_hashes(self.root), self.sources)
        self.assertEqual(self.web_env.read_bytes(), original_web)
        self.assertEqual(self.cfgfile.read_bytes(), original_cfg)
        self.assertEqual(self.override_env.stat().st_mode & 0o777, 0o644)
        self.assertEqual(self.pid, 124)
        self.assertNotIn(['systemctl', 'daemon-reload'], self.commands)

    def test_backup_is_readable_and_private_before_environment_write(self):
        replace = r.replace
        def guarded_replace(file, data, info):
            backup = next(m.BACKUPS.iterdir())
            self.assertEqual((backup / 'original.env').read_bytes(), self.original_env)
            self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
            self.assertEqual((backup / 'original.env').stat().st_mode & 0o777, 0o600)
            return replace(file, data, info)
        with patch.object(r, 'replace', side_effect=guarded_replace):
            self.apply()

    def test_placement_failure_rolls_back_exact_environment_after_pid_change(self):
        snapshot = r.inspect_service()
        with patch.object(m, 'wait_placement', return_value=False), contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaisesRegex(RuntimeError, 'PLACEMENT_NOT_READY'):
                m.apply(self.new_url, snapshot, r.properties())
        self.assertEqual(self.override_env.read_bytes(), self.original_env)
        self.assertIn('FTI_PREVIOUS_EVENT_RPC_RESTORED', out.getvalue())
        self.assertNotIn('ROLLBACK_INCOMPLETE', out.getvalue())
        self.assertEqual(r.inspect_service()[4], snapshot[4])
        self.assertEqual(self.running_env['EVENT_RPC_URL'], '')
        self.assertEqual(self.pid, 125)

    def test_health_failure_rolls_back(self):
        with patch.object(r, 'wait_health', side_effect=[False, True]):
            with self.assertRaisesRegex(RuntimeError, 'WEB_HEALTH_FAILED'):
                self.apply()
        self.assertEqual(self.override_env.read_bytes(), self.original_env)

    def test_concurrent_configuration_edit_is_not_overwritten_by_rollback(self):
        self.on_restart = lambda: self.override_env.write_bytes(self.override_env.read_bytes() + b'# operator change\n')
        with self.assertRaisesRegex(RuntimeError, 'CONCURRENT_CONFIGURATION_CHANGE'):
            self.apply()
        self.assertTrue(self.override_env.read_bytes().endswith(b'# operator change\n'))
        self.assertEqual(self.pid, 124)

    def test_source_drift_refused_before_backup_or_restart(self):
        self.write('scripts/server.mjs', b'// wrong source\n')
        with self.assertRaisesRegex(RuntimeError, 'RESTORE_ORIGINAL_SOURCE_FIRST'):
            self.apply()
        self.assertFalse(m.BACKUPS.exists())
        self.assertEqual(self.override_env.read_bytes(), self.original_env)
        self.assertEqual(self.pid, 123)

    def test_manual_rollback_uses_saved_bytes(self):
        self.apply()
        with contextlib.redirect_stdout(io.StringIO()):
            m.restore(next(m.BACKUPS.iterdir()))
        self.assertEqual(self.override_env.read_bytes(), self.original_env)
        self.assertEqual(r.source_hashes(self.root), self.sources)

    def test_candidate_order_reuses_existing_urls_without_printing_them(self):
        snapshot = r.inspect_service()
        rows = m.candidates(r.properties(), snapshot[3])
        self.assertEqual([row[0] for row in rows], ['configured-rpc-1', 'configured-rpc-2', 'publicnode'])
        self.assertEqual(m.candidates(r.properties(), snapshot[3], self.new_url), [('private-input', self.new_url)])

    def test_failed_provider_preflights_never_change_environment_or_restart(self):
        real_open = os.open
        def local_lock(file, *args, **kwargs):
            if Path(file) == Path('/run/lock/fti-service-cutover.lock'):
                file = self.base / 'lock'
            return real_open(file, *args, **kwargs)
        with patch('sys.argv', ['repair-mainnet-event-rpc.py', '--apply']), patch.object(m.os, 'open', side_effect=local_lock), \
                patch.object(m.os, 'umask'), patch.object(m, 'anchor_block', return_value={}), \
                patch.object(m, 'verify_provider', side_effect=RuntimeError('RPC_REJECTED_-32005')), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaisesRegex(RuntimeError, 'NO_USABLE_LOG_RPC_NO_CHANGES'):
                m.main()
        self.assertEqual(self.override_env.read_bytes(), self.original_env)
        self.assertFalse(m.BACKUPS.exists())
        self.assertEqual(self.pid, 123)
        self.assertNotIn('SECRET', out.getvalue())


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.cfg = {'binary': r.TARGET['binary'], 'deployedBlock': 100}
        self.anchor = {'number': hex(4000), 'hash': '0x' + 'a' * 64}
        self.url = 'https://events.invalid/SECRET'

    def test_recent_and_historical_1500_block_queries_are_required(self):
        with patch.object(m, 'rpc', side_effect=['0x38', self.anchor, [], []]) as call:
            m.verify_provider(self.url, self.cfg, self.anchor)
        filters = [call.args[2][0] for call in call.call_args_list if call.args[1] == 'eth_getLogs']
        self.assertEqual([(int(x['fromBlock'], 16), int(x['toBlock'], 16)) for x in filters], [(100, 1599), (2501, 4000)])
        self.assertTrue(all(x['address'] == self.cfg['binary'] and x['topics'] == [m.TOPIC] for x in filters))

    def test_wrong_chain_fails_before_log_requests(self):
        with patch.object(m, 'rpc', return_value='0x61') as call:
            with self.assertRaisesRegex(RuntimeError, 'WRONG_RPC_CHAIN'):
                m.verify_provider(self.url, self.cfg, self.anchor)
        self.assertEqual(call.call_count, 1)

    def test_disagreeing_recent_block_is_refused(self):
        with patch.object(m, 'rpc', side_effect=['0x38', dict(self.anchor, hash='0x' + 'b' * 64)]):
            with self.assertRaisesRegex(RuntimeError, 'RPC_BLOCK_DISAGREEMENT'):
                m.verify_provider(self.url, self.cfg, self.anchor)

    def test_logs_from_unrequested_contract_are_rejected(self):
        with patch.object(m, 'rpc', side_effect=['0x38', self.anchor, [{'address': '0x' + '1' * 40}]]):
            with self.assertRaisesRegex(RuntimeError, 'INVALID_FILTERED_LOG'):
                m.verify_provider(self.url, self.cfg, self.anchor)

    def test_private_url_validation_and_write_method_rejection(self):
        for value in (None, 'http://events.invalid', 'https://user:pass@events.invalid', 'https://events.invalid/#secret', 'https://events.invalid/\nsecret'):
            self.assertFalse(m.valid_url(value))
        with self.assertRaisesRegex(RuntimeError, 'READ_ONLY_RPC_REQUIRED'):
            m.rpc(self.url, 'eth_sendRawTransaction', ['0x'])

    def test_rpc_error_does_not_expose_provider_credentials(self):
        response = io.BytesIO(r.packed({'jsonrpc': '2.0', 'id': 1, 'error': {'code': -32005, 'message': self.url}}))
        with patch.object(m.urllib.request.OpenerDirector, 'open', return_value=response):
            with self.assertRaisesRegex(RuntimeError, '^RPC_REJECTED_-32005$'):
                m.rpc(self.url, 'eth_chainId', [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
