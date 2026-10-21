import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('recover', ROOT / 'tools/recover-mainnet-source.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
REAL_INSPECT_SERVICE = m.inspect_service


def exec_start(node, root, state='running'):
    # systemctl show includes process status in the ExecStart property itself.
    runtime = {
        'running': 'start_time=[Wed 2026-10-21 11:00:00 UTC] ; stop_time=[n/a] ; pid=4421 ; code=(null) ; status=0/0',
        'stopped': 'start_time=[Wed 2026-10-21 11:00:00 UTC] ; stop_time=[Wed 2026-10-21 11:01:00 UTC] ; pid=4421 ; code=killed ; status=15/TERM',
        'restarted': 'start_time=[Wed 2026-10-21 11:02:00 UTC] ; stop_time=[n/a] ; pid=4500 ; code=(null) ; status=0/0',
        'never-started': 'start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0',
    }[state]
    return ('{ path=' + str(node) + ' ; argv[]=' + str(node) + ' ' + str(root / 'scripts/server.mjs')
            + ' ; ignore_errors=no ; ' + runtime + ' }')


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'releases/mainnet-web-20261016T041703Z-351769'
        self.root.mkdir(parents=True)
        for directory in m.DIRS:
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        for name, data in {'contracts/One.sol': b'contract One {}\n',
                           'scripts/server.mjs': b'export const original = true;\n',
                           'frontend/controller.js': b'const original = true;\n',
                           'landing/src/main.jsx': b'const old = true;\n'}.items():
            self.write(name, data)
        # Use the real releaseManifest implementation as an independent oracle.
        for name in ('scripts/continuity-release.mjs', 'core/deployment-network.mjs'):
            self.write(name, (ROOT / name).read_bytes())
        for name in m.EXTRAS:
            self.write(name, b'{}\n' if name.endswith('.json') else b'// original\n')
        self.original = {name: (self.root / name).read_bytes() for name in m.source_hashes(self.root)}
        self.original_hashes = m.source_hashes(self.root)
        self.fingerprint = m.fingerprint(self.original_hashes)
        self.cfg = dict(m.TARGET, sourceFingerprint=self.fingerprint)
        contract_digest = m.digest(m.packed([['One.sol', m.digest(self.original['contracts/One.sol'])]]))
        self.cfg['artifactHashes'] = {}
        for name in m.ARTIFACTS:
            data = m.packed({'sourceDigest': contract_digest, 'name': name})
            self.write('artifacts/' + name + '.json', data)
            self.cfg['artifactHashes'][name] = m.digest(data)
        self.cfg_raw = m.packed(self.cfg)
        self.private = {'/fixture/deployment.json': self.cfg_raw, '/fixture/web.env': b'RPC_URL=secret\n'}
        self.identity = 'verified-identity'
        self.commands = []
        self.node = shutil.which('node')
        self.mock('BASELINE', {name: value for name, value in self.original_hashes.items()
                               if name not in ('web/app.js', 'web/vendor/walletconnect.js')})
        self.mock('FINGERPRINT', self.fingerprint)
        self.mock('ARTIFACTS', dict(self.cfg['artifactHashes']))
        self.mock('BACKUPS', self.base / 'backups')
        self.mock('inspect_service', lambda: (self.root, self.node, self.cfg, self.private, self.identity))
        self.mock('download', lambda name, expected: self.original[name])
        self.mock('command', self.command)
        self.mock('wait_health', lambda: True)
        self.mock('json_get', lambda *args, **kwargs: {})

    def mock(self, name, value):
        p = patch.object(m, name, value)
        p.start()
        self.addCleanup(p.stop)

    def write(self, name, data):
        file = self.root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)

    def command(self, args, **kwargs):
        self.commands.append(args)
        if '--check' in args:
            subprocess.run(args, check=True, capture_output=True)
        if args[:2] == ['systemctl', 'stop']:
            backup = next(m.BACKUPS.iterdir())
            record = json.loads((backup / 'record.json').read_text())
            for name in record['changes']:
                if name in record['before']:
                    self.assertEqual(m.digest((backup / 'before' / name).read_bytes()), record['before'][name])
        return ''

    def apply(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            m.apply(self.root, self.node, self.cfg, self.private, self.identity)
        return output.getvalue()

    def run_main(self):
        real_open = os.open
        def local_lock(path, *args, **kwargs):
            if Path(path) == Path('/run/lock/fti-service-cutover.lock'):
                path = self.base / 'lock'
            return real_open(path, *args, **kwargs)
        with patch('sys.argv', ['recover-mainnet-source.py', '--apply']), \
                patch.object(m.os, 'open', side_effect=local_lock), patch.object(m.os, 'umask'), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            m.main()
        return output.getvalue()

    def test_healthy_process_does_not_hide_source_drift_on_disk(self):
        self.write('scripts/server.mjs', b'// would fail next restart\n')
        with patch.object(m, 'health', return_value=True):
            output = self.run_main()
        self.assertIn('FTI_WEB_RECOVERED', output)
        self.assertEqual(m.source_hashes(self.root), self.original_hashes)

    def test_healthy_matching_source_is_checked_without_restart(self):
        with patch.object(m, 'health', return_value=True):
            output = self.run_main()
        self.assertIn('FTI_ALREADY_HEALTHY_NO_CHANGES', output)
        self.assertIn('FOLLOWUP_OK=/api/placement', output)
        self.assertFalse(self.commands)
        self.assertFalse(m.BACKUPS.exists())

    def test_legacy_runtime_identity_backup_is_not_silently_trusted(self):
        self.write('scripts/server.mjs', b'// changed\n')
        self.apply()
        backup = next(m.BACKUPS.iterdir())
        record = json.loads((backup / 'record.json').read_text())
        record['schema'] = 'FTI_ORIGINAL_SOURCE_RECOVERY_V1'
        (backup / 'record.json').write_bytes(m.packed(record))
        before = m.source_hashes(self.root)
        self.commands.clear()
        with self.assertRaisesRegex(RuntimeError, 'UNSUPPORTED_BACKUP_RECORD_REQUIRES_REVIEW'):
            m.restore(backup)
        self.assertEqual(m.source_hashes(self.root), before)
        self.assertFalse(self.commands)

    def real_service_lifecycle(self, change_on_stop=False):
        """Use the real inspector across stop/start, not a constant identity mock."""
        state = self.base / 'states' / self.root.name
        state.mkdir(parents=True)
        cfgfile = state / 'deployment.json'
        cfgfile.write_bytes(self.cfg_raw)
        self.runtime_node = self.base / 'runtime/node-v22.23.3-x64/bin/node'
        self.runtime_node.parent.mkdir(parents=True)
        self.runtime_node.write_text('#!/bin/sh\nexit 0\n')
        self.runtime_node.chmod(0o755)
        unit = self.base / 'web.service'
        unit.write_text('[Service]\n')
        web_env = state / 'web.env'
        web_env.write_text('DEPLOYMENT_FILE=' + str(cfgfile) + '\nFTI_SOURCE_REVISION=' + m.REVISION
                           + '\nPORT=3110\nHOST=127.0.0.1\nRPC_URL=https://original.invalid/SECRET\n')
        self.lifecycle = 'running'
        self.config_before = web_env.read_bytes()
        self.config_file = web_env
        def systemd(args, **kwargs):
            if args[:2] == ['systemctl', 'show']:
                return '\n'.join([
                    'LoadState=loaded', 'User=fti-v3', 'Group=fti-v3',
                    'WorkingDirectory=' + str(self.root), 'ExecStart=' + exec_start(self.runtime_node, self.root, self.lifecycle),
                    'Environment=', 'EnvironmentFiles=' + str(web_env) + ' (ignore_errors=no)',
                    'UnsetEnvironment=', 'FragmentPath=' + str(unit), 'DropInPaths=',
                ])
            result = self.command(args, **kwargs)
            if args[:2] == ['systemctl', 'stop']:
                self.lifecycle = 'stopped'
                if change_on_stop:
                    web_env.write_bytes(self.config_before + b'RPC_URL=https://operator.invalid/NEW_SECRET\n')
            elif args[:2] == ['systemctl', 'start']:
                self.lifecycle = 'restarted'
            return result
        self.mock('RELEASES', self.base / 'releases')
        self.mock('STATES', self.base / 'states')
        self.mock('RUNTIME', self.base / 'runtime')
        self.mock('TARGET', dict(self.cfg))
        self.mock('inspect_service', REAL_INSPECT_SERVICE)
        self.mock('command', systemd)
        _, self.node, _, self.private, self.identity = m.inspect_service()

    def test_real_service_stop_start_does_not_look_like_config_edit(self):
        self.write('scripts/server.mjs', b'// accidental change\n')
        self.real_service_lifecycle()
        output = self.apply()
        self.assertIn('FTI_WEB_RECOVERED', output)
        self.assertEqual(self.lifecycle, 'restarted')
        self.assertEqual(m.source_hashes(self.root), self.original_hashes)
        self.assertEqual(m.inspect_service()[4], self.identity)
        self.assertEqual(self.config_file.read_bytes(), self.config_before)

    def test_real_service_health_failure_rolls_back_after_pid_change(self):
        self.write('scripts/server.mjs', b'// accidental change\n')
        before = m.source_hashes(self.root)
        self.real_service_lifecycle()
        with contextlib.redirect_stdout(io.StringIO()) as output:
            with patch.object(m, 'wait_health', return_value=False), self.assertRaisesRegex(RuntimeError, 'WEB_HEALTH_FAILED'):
                m.apply(self.root, self.node, self.cfg, self.private, self.identity)
        self.assertIn('FTI_SOURCE_FILES_RESTORED_TO_PREVIOUS_STATE', output.getvalue())
        self.assertNotIn('ROLLBACK_INCOMPLETE', output.getvalue())
        self.assertEqual(m.source_hashes(self.root), before)

    def test_real_configuration_edit_during_stop_is_still_refused(self):
        self.write('scripts/server.mjs', b'// accidental change\n')
        before = m.source_hashes(self.root)
        self.real_service_lifecycle(change_on_stop=True)
        with contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaisesRegex(RuntimeError, 'CONCURRENT_CONFIGURATION_CHANGE'):
                m.apply(self.root, self.node, self.cfg, self.private, self.identity)
        self.assertEqual(m.source_hashes(self.root), before)
        self.assertIn('operator.invalid', self.config_file.read_text())
        self.assertNotIn('NEW_SECRET', output.getvalue())
        self.assertNotIn(['systemctl', 'start', m.SERVICE], self.commands)

    def test_real_js_manifest_matches_python_fingerprint(self):
        deps = ROOT / 'node_modules'
        if not deps.is_dir():
            self.fail('Install project dependencies before the real manifest integration test')
        (self.root / 'node_modules').symlink_to(deps.resolve(), target_is_directory=True)
        output = subprocess.check_output([self.node, '--input-type=module', '-e',
            "import {releaseManifest} from './scripts/continuity-release.mjs'; console.log(JSON.stringify(releaseManifest()));"],
            cwd=self.root, env={**os.environ, 'FTI_SOURCE_REVISION': m.REVISION}, text=True)
        actual = json.loads(output)
        self.assertEqual(actual['sourceFingerprint'], self.fingerprint)
        self.assertEqual(actual['artifactHashes'], self.cfg['artifactHashes'])

    def test_restores_changed_source_and_quarantines_extra_without_touching_contracts(self):
        self.write('scripts/server.mjs', b'// accidental change\n')
        self.write('scripts/temporary-repair.mjs', b'// accidental extra fingerprint input\n')
        protected = {name: data for name, data in self.original.items() if not m.mutable(name)}
        output = self.apply()
        self.assertIn('FTI_WEB_RECOVERED', output)
        self.assertNotIn('secret', output)
        self.assertEqual(m.source_hashes(self.root), self.original_hashes)
        for name, data in protected.items():
            self.assertEqual((self.root / name).read_bytes(), data)
        self.assertEqual(m.packed(self.cfg), self.cfg_raw)
        backup = next(m.BACKUPS.iterdir())
        self.assertEqual((backup / 'before/scripts/temporary-repair.mjs').read_bytes(), b'// accidental extra fingerprint input\n')
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertTrue(all('keeper' not in ' '.join(args) for args in self.commands))

    def test_failed_health_restores_every_changed_and_quarantined_byte(self):
        self.write('scripts/server.mjs', b'// changed\n')
        self.write('scripts/new-file.mjs', b'// added\n')
        before = m.source_hashes(self.root)
        with patch.object(m, 'wait_health', return_value=False), self.assertRaisesRegex(RuntimeError, 'WEB_HEALTH_FAILED'):
            self.apply()
        self.assertEqual(m.source_hashes(self.root), before)

    def test_partial_replacement_error_rolls_back(self):
        self.write('scripts/server.mjs', b'// changed\n')
        self.write('frontend/controller.js', b'// changed frontend\n')
        before = m.source_hashes(self.root)
        original_replace = m.replace
        calls = []
        def fail_second(*args):
            calls.append(1)
            if len(calls) == 2:
                raise RuntimeError('SIMULATED_REPLACEMENT_FAILURE')
            return original_replace(*args)
        with patch.object(m, 'replace', side_effect=fail_second), self.assertRaisesRegex(RuntimeError, 'SIMULATED_REPLACEMENT'):
            self.apply()
        self.assertEqual(m.source_hashes(self.root), before)

    def test_contract_drift_is_never_rewritten(self):
        self.write('contracts/One.sol', b'contract Changed {}\n')
        before = m.source_hashes(self.root)
        with self.assertRaisesRegex(RuntimeError, 'ARTIFACT_MISMATCH'):
            self.apply()
        self.assertEqual(before, m.source_hashes(self.root))
        self.assertFalse(self.commands)

    def test_generated_bundle_drift_cannot_be_blessed(self):
        self.write('web/app.js', b'// changed generated bundle\n')
        with self.assertRaisesRegex(RuntimeError, 'ORIGINAL_FINGERPRINT_NOT_RECONSTRUCTED'):
            self.apply()
        self.assertFalse(self.commands)
        self.assertEqual(self.cfg['sourceFingerprint'], self.fingerprint)

    def test_artifact_and_deployment_hash_edits_are_rejected(self):
        self.write('artifacts/FTIProxy.json', b'{"sourceDigest":"fake"}')
        self.cfg['artifactHashes']['FTIProxy'] = m.digest(b'{"sourceDigest":"fake"}')
        with self.assertRaisesRegex(RuntimeError, 'UNREVIEWED_ARTIFACT_MANIFEST'):
            self.apply()
        self.assertFalse(self.commands)

    def test_rollback_preserves_a_concurrent_operator_edit(self):
        self.write('scripts/server.mjs', b'// initial change\n')
        self.apply()
        self.write('scripts/server.mjs', b'// newer operator edit\n')
        with self.assertRaisesRegex(RuntimeError, 'CONCURRENT_SOURCE_CHANGE_NO_ROLLBACK'):
            m.restore(next(m.BACKUPS.iterdir()))
        self.assertEqual((self.root / 'scripts/server.mjs').read_bytes(), b'// newer operator edit\n')

    def test_download_tampering_is_rejected_before_service_stop(self):
        self.write('scripts/server.mjs', b'// changed\n')
        # Exercise the real downloader against a bad response; no network.
        response = io.BytesIO(b'// wrong source\n')
        with patch.object(m.urllib.request, 'urlopen', return_value=response):
            with self.assertRaisesRegex(RuntimeError, 'DOWNLOADED_HASH_MISMATCH'):
                # setUp replaced download; load the real function from a fresh module.
                other = importlib.util.module_from_spec(SPEC)
                SPEC.loader.exec_module(other)
                other.download('scripts/server.mjs', m.BASELINE['scripts/server.mjs'])
        self.assertFalse(self.commands)

    def test_symlink_source_refused(self):
        file = self.root / 'scripts/server.mjs'
        file.unlink()
        file.symlink_to('/etc/passwd')
        with self.assertRaisesRegex(RuntimeError, 'SYMLINK_SOURCE_REJECTED'):
            self.apply()
        self.assertFalse(self.commands)

    def test_systemd_environment_files_parser_is_strict(self):
        self.assertEqual(m.environment_files('/one/web.env (ignore_errors=no) /two/rpc.env (ignore_errors=yes)'),
                         ['/one/web.env', '/two/rpc.env'])
        with self.assertRaisesRegex(RuntimeError, 'UNSUPPORTED_ENVIRONMENT_FILES'):
            m.environment_files('/one/web.env extra-unparsed-content')


class ServiceInspectionTests(unittest.TestCase):
    """Exercise the real service inspector, including repeated systemctl rows."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'releases/mainnet-web-20261016T041703Z-351769'
        self.root.mkdir(parents=True)
        self.state = self.base / 'states' / self.root.name
        self.state.mkdir(parents=True)
        self.cfgfile = self.state / 'deployment.json'
        self.cfgfile.write_text(json.dumps(m.TARGET))
        self.node = self.base / 'runtime/node-v22.23.3-x64/bin/node'
        self.node.parent.mkdir(parents=True)
        self.node.write_text('#!/bin/sh\nexit 0\n')
        self.node.chmod(0o755)
        self.unit = self.base / 'fti-continuity-web.service'
        self.unit.write_text('[Service]\n')
        self.web_env = self.state / 'web.env'
        self.web_env.write_text('DEPLOYMENT_FILE="' + str(self.cfgfile) + '"\n'
                                'FTI_SOURCE_REVISION="' + m.REVISION + '"\n'
                                'PORT="3110"\nHOST="127.0.0.1"\nRPC_URL="https://original.invalid/SECRET"\n')
        self.rpc_env = self.base / 'rpc.env'
        self.rpc_env.write_text('RPC_URL="https://override.invalid/SECRET"\nFTI_MAINNET_RPC_URL=\nFTI_MAINNET_RPC_FILE=\n')
        self.raw = '\n'.join([
            'LoadState=loaded', 'User=fti-v3', 'Group=fti-v3',
            'WorkingDirectory=' + str(self.root),
            'ExecStart=' + exec_start(self.node, self.root),
            'Environment=',
            'EnvironmentFiles=' + str(self.web_env) + ' (ignore_errors=no)',
            'EnvironmentFiles=' + str(self.rpc_env) + ' (ignore_errors=no)',
            'UnsetEnvironment=', 'FragmentPath=' + str(self.unit), 'DropInPaths=',
        ])
        for name, value in [('RELEASES', self.base / 'releases'), ('STATES', self.base / 'states'),
                             ('RUNTIME', self.base / 'runtime')]:
            p = patch.object(m, name, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(m, 'command', side_effect=lambda *args, **kwargs: self.raw)
        p.start()
        self.addCleanup(p.stop)

    def test_real_inspector_keeps_primary_env_before_rpc_override(self):
        old = dict(line.split('=', 1) for line in self.raw.splitlines())
        self.assertNotIn(str(self.web_env), old['EnvironmentFiles'])
        with contextlib.redirect_stdout(io.StringIO()) as out:
            root, node, cfg, private, identity = m.inspect_service()
        self.assertEqual(root, self.root)
        self.assertEqual(node, str(self.node))
        self.assertEqual(cfg, m.TARGET)
        self.assertIn(str(self.web_env), private)
        self.assertIn(str(self.rpc_env), private)
        self.assertIn(str(self.cfgfile), private)
        self.assertEqual(len(identity), 64)
        self.assertNotIn('SECRET', out.getvalue())

    def test_legacy_singular_and_multiple_rows_keep_order(self):
        self.raw = self.raw.replace('EnvironmentFiles=', 'EnvironmentFile=')
        parsed = m.properties()
        self.assertEqual(m.environment_files(parsed['EnvironmentFiles']), [str(self.web_env), str(self.rpc_env)])
        self.assertEqual(m.inspect_service()[2], m.TARGET)

    def test_later_env_override_must_not_be_ignored(self):
        self.rpc_env.write_text('DEPLOYMENT_FILE="/unexpected/deployment.json"\n')
        with self.assertRaisesRegex(RuntimeError, 'WRONG_DEPLOYMENT_FILE'):
            m.inspect_service()

    def test_empty_deployment_path_has_specific_error(self):
        self.rpc_env.write_text('DEPLOYMENT_FILE=""\n')
        with self.assertRaisesRegex(RuntimeError, 'MISSING_DEPLOYMENT_FILE_FROM_SERVICE_ENVIRONMENT'):
            m.inspect_service()

    def test_changed_config_changes_inspection_identity(self):
        first = m.inspect_service()[4]
        self.rpc_env.write_text('RPC_URL="https://changed.invalid/SECRET"\n')
        self.assertNotEqual(m.inspect_service()[4], first)

    def test_process_lifecycle_does_not_change_configuration_identity(self):
        first = m.inspect_service()[4]
        for state in ('stopped', 'restarted', 'never-started'):
            with self.subTest(state=state):
                self.raw = re.sub(r'^ExecStart=.*$', 'ExecStart=' + exec_start(self.node, self.root, state), self.raw, flags=re.M)
                self.assertEqual(m.inspect_service()[4], first)

    def test_restart_between_inspector_reads_is_not_a_config_change(self):
        restarted = self.raw.replace(exec_start(self.node, self.root), exec_start(self.node, self.root, 'restarted'))
        first = m.inspect_service()[4]
        with patch.object(m, 'command', side_effect=[self.raw, restarted]):
            self.assertEqual(m.inspect_service()[4], first)

    def test_real_exec_changes_still_change_configuration_identity(self):
        first = m.inspect_service()[4]
        original = self.raw
        for changed in (
            original.replace('ignore_errors=no ; start_time=', 'ignore_errors=yes ; start_time='),
            original.replace(' ; ignore_errors=', ' --trace-warnings ; ignore_errors='),
        ):
            with self.subTest(change=changed):
                self.raw = changed
                self.assertNotEqual(m.inspect_service()[4], first)

    def test_command_edit_between_inspector_reads_is_refused(self):
        changed = self.raw.replace(' ; ignore_errors=', ' --trace-warnings ; ignore_errors=')
        with patch.object(m, 'command', side_effect=[self.raw, changed]):
            with self.assertRaisesRegex(RuntimeError, 'SERVICE_CHANGED_DURING_INSPECTION'):
                m.inspect_service()

    def test_unrecognized_exec_status_is_not_silently_discarded(self):
        self.raw = self.raw.replace(' ; pid=4421', ' ; unexpected_field=1 ; pid=4421')
        with self.assertRaisesRegex(RuntimeError, 'UNSUPPORTED_EXEC_START'):
            m.inspect_service()

    def test_duplicate_single_value_property_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'DUPLICATE_SERVICE_PROPERTY:WorkingDirectory'):
            m.parse_properties(self.raw + '\nWorkingDirectory=/unexpected')

    def test_missing_unit_file_is_named(self):
        self.raw = self.raw.replace('FragmentPath=' + str(self.unit), 'FragmentPath=')
        with self.assertRaisesRegex(RuntimeError, 'MISSING_SERVICE_UNIT_FILE'):
            m.inspect_service()


if __name__ == '__main__':
    unittest.main(verbosity=2)
