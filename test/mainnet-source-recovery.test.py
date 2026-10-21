import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('recover', ROOT / 'tools/recover-mainnet-source.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'release'
        self.root.mkdir()
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
            'ExecStart={ path=' + str(self.node) + ' ; argv[]=' + str(self.node) + ' ' + str(self.root / 'scripts/server.mjs') + ' ; }',
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

    def test_duplicate_single_value_property_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'DUPLICATE_SERVICE_PROPERTY:WorkingDirectory'):
            m.parse_properties(self.raw + '\nWorkingDirectory=/unexpected')

    def test_missing_unit_file_is_named(self):
        self.raw = self.raw.replace('FragmentPath=' + str(self.unit), 'FragmentPath=')
        with self.assertRaisesRegex(RuntimeError, 'MISSING_SERVICE_UNIT_FILE'):
            m.inspect_service()


if __name__ == '__main__':
    unittest.main(verbosity=2)
