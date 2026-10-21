import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import http.server
import shutil
import ssl
import subprocess
import tempfile
import threading
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

    def test_public_mode_excludes_configured_credentials_and_low_capacity_fallback(self):
        snapshot = r.inspect_service()
        rows = m.candidates(r.properties(), snapshot[3], public_only=True)
        self.assertEqual(len(rows), 4)
        self.assertEqual(len({url for _, url in rows}), len(rows))
        for _, url in rows:
            self.assertTrue(m.valid_url(url))
            self.assertNotIn('SECRET', url)
            self.assertNotIn('blockmachine', url)
        with self.assertRaisesRegex(RuntimeError, 'CHOOSE_PUBLIC_OR_PRIVATE_RPC'):
            m.candidates({}, {}, self.new_url, public_only=True)

    def local_lock(self, file, *args, **kwargs):
        if Path(file) == Path('/run/lock/fti-service-cutover.lock'):
            file = self.base / 'lock'
        return self.real_open(file, *args, **kwargs)

    def test_public_mode_uses_first_verified_provider_and_existing_backup_path_without_prompt(self):
        self.real_open = os.open
        with patch('sys.argv', ['repair-mainnet-event-rpc.py', '--apply', '--public-rpcs']), \
                patch.object(m.os, 'open', side_effect=self.local_lock), patch.object(m.os, 'umask'), \
                patch.object(m, 'anchor_block', return_value={}), \
                patch.object(m, 'verify_provider', side_effect=[RuntimeError('RPC_HTTP_403:eth_chainId'), None]) as probe, \
                patch.object(m.getpass, 'getpass', side_effect=AssertionError('Public mode must not prompt')), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            m.main()
        self.assertEqual([call.args[0] for call in probe.call_args_list], [url for _, url in m.PUBLIC_CANDIDATES[:2]])
        self.assertEqual(self.running_env['EVENT_RPC_URL'], m.PUBLIC_CANDIDATES[1][1])
        self.assertEqual(self.running_env['RPC_URL'], 'https://limited.invalid/OVERRIDE_SECRET')
        self.assertEqual(r.source_hashes(self.root), self.sources)
        self.assertEqual(self.pid, 124)
        self.assertIn('FTI_EVENT_RPC_AND_PLACEMENT_READY', out.getvalue())
        self.assertNotIn('SECRET', out.getvalue())

    def test_all_public_providers_rejected_leave_service_and_configuration_untouched(self):
        self.real_open = os.open
        before = r.inspect_service()[4]
        with patch('sys.argv', ['repair-mainnet-event-rpc.py', '--apply', '--public-rpcs']), \
                patch.object(m.os, 'open', side_effect=self.local_lock), patch.object(m.os, 'umask'), \
                patch.object(m, 'anchor_block', return_value={}), \
                patch.object(m, 'verify_provider', side_effect=RuntimeError('RPC_HTTP_403:eth_chainId')) as probe, \
                contextlib.redirect_stdout(io.StringIO()) as out:
            with self.assertRaisesRegex(RuntimeError, '^NO_USABLE_PUBLIC_LOG_RPC_NO_CHANGES$'):
                m.main()
        self.assertEqual(probe.call_count, len(m.PUBLIC_CANDIDATES))
        self.assertEqual(r.inspect_service()[4], before)
        self.assertEqual(self.override_env.read_bytes(), self.original_env)
        self.assertFalse(m.BACKUPS.exists())
        self.assertEqual(self.pid, 123)
        self.assertNotIn('SECRET', out.getvalue())

    def test_public_check_only_does_not_install_verified_endpoint(self):
        self.real_open = os.open
        with patch('sys.argv', ['repair-mainnet-event-rpc.py', '--public-rpcs']), \
                patch.object(m.os, 'open', side_effect=self.local_lock), patch.object(m.os, 'umask'), \
                patch.object(m, 'anchor_block', return_value={}), \
                patch.object(m, 'verify_provider', return_value=None), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            m.main()
        self.assertIn('FTI_EVENT_RPC_CHECK_ONLY_NO_CHANGES', out.getvalue())
        self.assertEqual(self.override_env.read_bytes(), self.original_env)
        self.assertFalse(m.BACKUPS.exists())
        self.assertEqual(self.pid, 123)

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
            with self.assertRaisesRegex(RuntimeError, '^RPC_REJECTED_-32005:eth_chainId$'):
                m.rpc(self.url, 'eth_chainId', [])

    def test_http_denial_reports_only_status_and_method_without_retrying_or_exposing_private_url(self):
        error = m.urllib.error.HTTPError(self.url, 403, self.url, {}, io.BytesIO(self.url.encode()))
        with patch.object(m.urllib.request.OpenerDirector, 'open', side_effect=error) as request:
            with self.assertRaisesRegex(RuntimeError, '^RPC_HTTP_403:eth_getLogs$'):
                m.rpc(self.url, 'eth_getLogs', [{}])
        self.assertEqual(request.call_count, 1)


class RuntimeTransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.node = shutil.which('node')
        if not cls.node or not shutil.which('openssl'):
            raise unittest.SkipTest('Node and OpenSSL required for real TLS transport checks')
        cls.temp = tempfile.TemporaryDirectory()
        cls.cert = Path(cls.temp.name) / 'cert.pem'
        key = Path(cls.temp.name) / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-keyout', str(key), '-out', str(cls.cert), '-days', '1',
                        '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
                        '-addext', 'basicConstraints=critical,CA:TRUE'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                self.server.calls.append((self.path, payload))
                status, data, headers = self.server.reply(payload)
                body = r.packed(data)
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                for name, value in headers.items():
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *_):
                pass
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cls.cert, key)
        cls.server.socket = context.wrap_socket(cls.server.socket, server_side=True)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        cls.temp.cleanup()

    def setUp(self):
        self.server.calls = []
        self.url = 'https://127.0.0.1:' + str(self.server.server_port) + '/PRIVATE_SECRET'
        self.anchor = {'number': '0xfa0', 'hash': '0x' + 'a' * 64}
        self.trust_certificate = True
        self.real_run = subprocess.run
        def local_run(*args, **kwargs):
            # Production always drops to fti-v3. This sandbox forbids setgroups
            # even for its own UID, so the fixture keeps its existing identity
            # after verifying the production privilege-drop arguments.
            self.assertEqual((kwargs['user'], kwargs['group'], kwargs['extra_groups']), ('fti-v3', 'fti-v3', []))
            self.assertNotIn('NODE_OPTIONS', kwargs['env'])
            self.assertNotIn(self.url, args[0])
            self.assertEqual(json.loads(kwargs['input'])['url'], self.url)
            for argument in ('user', 'group', 'extra_groups'):
                kwargs.pop(argument)
            if self.trust_certificate:
                kwargs['env'] = dict(kwargs['env'], NODE_EXTRA_CA_CERTS=str(self.cert))
            return self.real_run(*args, **kwargs)
        patched = patch.object(m.subprocess, 'run', side_effect=local_run)
        patched.start()
        self.addCleanup(patched.stop)

    def call(self, url, method, params):
        return m.runtime_rpc(ROOT, self.node, url, method, params)

    def test_real_ethers_transport_passes_complete_chain_block_and_log_verification(self):
        def reply(payload):
            method = payload['method']
            result = '0x38' if method == 'eth_chainId' else self.anchor if method == 'eth_getBlockByNumber' else []
            return 200, {'jsonrpc': '2.0', 'id': payload['id'], 'result': result}, {}
        self.server.reply = reply
        with patch.dict(os.environ, NODE_OPTIONS='--require=UNTRUSTED_SECRET'):
            m.verify_provider(self.url, {'binary': r.TARGET['binary'], 'deployedBlock': 100}, self.anchor, call=self.call)
        self.assertEqual([payload['method'] for _, payload in self.server.calls],
                         ['eth_chainId', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_getLogs'])
        filters = [payload['params'][0] for _, payload in self.server.calls if payload['method'] == 'eth_getLogs']
        self.assertTrue(all(int(item['toBlock'], 16) - int(item['fromBlock'], 16) == 1499 for item in filters))

    def test_http_400_reports_range_category_without_reflecting_provider_secrets(self):
        self.server.reply = lambda _: (400, {'error': {'code': -32602,
            'message': 'Block range exceeds the maximum; https://provider.invalid/PRIVATE_SECRET'}}, {})
        with self.assertRaises(RuntimeError) as failure:
            self.call(self.url, 'eth_getLogs', [{}])
        self.assertIn('RPC_HTTP_400:eth_getLogs', str(failure.exception))
        self.assertIn('DETAIL=BLOCK_RANGE_LIMIT', str(failure.exception))
        self.assertNotIn('SECRET', str(failure.exception))
        self.assertEqual(len(self.server.calls), 1)

    def test_forbidden_response_is_not_retried_or_exposed(self):
        self.server.reply = lambda _: (403, {'error': {'message': self.url}}, {})
        with self.assertRaisesRegex(RuntimeError, '^RPC_HTTP_403:eth_chainId$'):
            self.call(self.url, 'eth_chainId', [])
        self.assertEqual(len(self.server.calls), 1)

    def test_rate_limit_is_not_retried(self):
        self.server.reply = lambda _: (429, {'error': {'message': 'Too many requests'}}, {'Retry-After': '1'})
        with self.assertRaisesRegex(RuntimeError, 'RPC_HTTP_429:eth_chainId:DETAIL=RATE_LIMIT'):
            self.call(self.url, 'eth_chainId', [])
        self.assertEqual(len(self.server.calls), 1)

    def test_redirect_is_rejected_without_contacting_redirect_target(self):
        self.server.reply = lambda _: (302, {}, {'Location': self.url + '/redirect-target'})
        with self.assertRaisesRegex(RuntimeError, '^RPC_REDIRECT_REJECTED:eth_chainId$'):
            self.call(self.url, 'eth_chainId', [])
        self.assertEqual(len(self.server.calls), 1)

    def test_untrusted_tls_certificate_is_rejected_before_rpc_request(self):
        self.trust_certificate = False
        with self.assertRaisesRegex(RuntimeError, '^RPC_UNREACHABLE_OR_INVALID_RESPONSE:eth_chainId$'):
            self.call(self.url, 'eth_chainId', [])
        self.assertEqual(self.server.calls, [])


class RuntimeIsolationTests(unittest.TestCase):
    def test_write_method_and_plain_http_fail_before_starting_runtime(self):
        with patch.object(m.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'READ_ONLY_RPC_REQUIRED'):
                m.runtime_rpc(ROOT, '/node', 'https://provider.invalid/SECRET', 'eth_sendRawTransaction', [])
            with self.assertRaisesRegex(RuntimeError, 'HTTPS_RPC_URL_REQUIRED'):
                m.runtime_rpc(ROOT, '/node', 'http://provider.invalid/SECRET', 'eth_chainId', [])
        run.assert_not_called()

    def test_timeout_invalid_output_and_unknown_child_errors_do_not_leak_credentials(self):
        cases = [subprocess.TimeoutExpired(['SECRET'], 18),
                 subprocess.CompletedProcess([], 0, b'SECRET not JSON', b'SECRET'),
                 subprocess.CompletedProcess([], 0, b'{"clientError":"SECRET"}', b'SECRET')]
        for result in cases:
            with self.subTest(result=type(result).__name__), patch.object(m.subprocess, 'run') as run:
                if isinstance(result, Exception):
                    run.side_effect = result
                else:
                    run.return_value = result
                with self.assertRaises(RuntimeError) as failure:
                    m.runtime_rpc(ROOT, '/node', 'https://provider.invalid/SECRET', 'eth_chainId', [])
                self.assertNotIn('SECRET', str(failure.exception))


if __name__ == '__main__':
    unittest.main(verbosity=2)
