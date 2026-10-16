import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('mainnet_web', ROOT / 'tools/activate-mainnet-web.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class MainnetWebTests(unittest.TestCase):
    def test_new_override_sorts_after_existing_late_overrides(self):
        names = ['90-frontend.conf', 'zz-fti-fresh-testnet.conf', 'zzzz-domain-hotfix.conf']
        chosen = m.choose_drop_name(' '.join('/etc/systemd/system/example.service.d/' + n for n in names))
        self.assertEqual(sorted([*names, chosen])[-1], chosen)
        with self.assertRaises(m.h.CutoverError):
            m.choose_drop_name('/etc/systemd/system/bad\\x20name.conf')

    def test_saved_env_round_trip_without_shell_expansion(self):
        env = {'RPC_URL': 'https://example.invalid/a$b`c`?x=1&y=2', 'PORT': '3110'}
        file = Mock()
        file.lstat.return_value = Mock(st_uid=0, st_mode=0o100640)
        file.is_file.return_value = True
        file.is_symlink.return_value = False
        file.read_text.return_value = m.h.env_text(env)
        self.assertEqual(m.read_saved_env(file), env)
        file.lstat.return_value.st_mode = 0o100666
        with self.assertRaises(m.h.CutoverError):
            m.read_saved_env(file)

    def test_dynamic_override_name_survives_rollback(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            (base / 'switch.json').write_text(json.dumps({'dropName': 'zzzz-hotfix.conf.fti-mainnet.conf'}))
            with patch.object(m.h, 'rollback') as restore:
                m.rollback(base)
                self.assertEqual(m.h.DROP_NAME, 'zzzz-hotfix.conf.fti-mainnet.conf')
                restore.assert_called_once_with(base)
            (base / 'switch.json').write_text(json.dumps({'dropName': '../unsafe.conf'}))
            with self.assertRaises(m.h.CutoverError):
                m.rollback(base)

    def test_pins_verified_deployment(self):
        cfg = json.loads(m.DEPLOYMENT.read_text())
        m.check_target(cfg)
        for key, value in [('chainId', 97), ('token', '0x' + '0' * 40), ('mainnetPlanDigest', 'wrong')]:
            with self.assertRaises(m.h.CutoverError):
                m.check_target({**cfg, key: value})

    def test_environment_excludes_signer_and_testnet_rpc(self):
        saved = {'node': Path('/opt/fti/runtime/node-v22.23.3-x64/bin/node'),
                 'env': {'PORT': '3110', 'KEEPER_PRIVATE_KEY': 'secret',
                         'EVENT_RPC_URL': 'https://testnet.invalid', 'RPC_URL': 'https://old.invalid'}}
        env = m.environment(saved, Path('/state'), 'https://mainnet.invalid/key')
        self.assertEqual(env['RPC_URL'], 'https://mainnet.invalid/key')
        self.assertNotIn('KEEPER_PRIVATE_KEY', env)
        self.assertNotIn('EVENT_RPC_URL', env)
        with self.assertRaises(m.h.CutoverError):
            m.environment(saved, Path('/state'), 'http://mainnet.invalid')

    def test_public_mismatch_restores_web_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            drop = base / 'drop/mainnet.conf'
            saved = {'properties': {'WorkingDirectory': '/release'}, 'node': Path('/bin/node')}
            def check(cfg, url):
                if url.startswith('https:'):
                    raise m.h.CutoverError('Wrong live deployment')
            with patch.object(m.h, 'drop_path', return_value=drop), \
                 patch.object(m.h, 'properties', return_value=saved['properties']), \
                 patch.object(m.h, 'run', return_value='') as run, \
                 patch.object(m, 'check_web', side_effect=check), \
                 patch.object(m, 'check_assets'), patch.object(m.h, 'rollback') as rollback:
                with self.assertRaises(m.h.CutoverError):
                    m.switch(Path('/release'), Path('/state'), base, saved, {})
                rollback.assert_called_once_with(base)
                self.assertTrue(all('keeper' not in str(call) for call in run.call_args_list))

    def test_rollback_preserves_concurrent_edit(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            drop = base / 'mainnet.conf'
            drop.write_text('operator edit')
            (base / 'switch.json').write_text(json.dumps({'dropHashes': {'web': 'oldhash'}}))
            with patch.object(m.h, 'drop_path', return_value=drop), patch.object(m.h, 'run') as run:
                with self.assertRaises(m.h.CutoverError):
                    m.h.rollback(base)
                self.assertEqual(drop.read_text(), 'operator edit')
                run.assert_not_called()

    def test_rollback_removes_only_owned_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            drop = base / 'mainnet.conf'
            drop.write_text('owned')
            (base / 'switch.json').write_text(json.dumps({'dropHashes': {'web': m.hashlib.sha256(b'owned').hexdigest()}}))
            with patch.object(m.h, 'drop_path', return_value=drop), patch.object(m.h, 'run') as run, \
                 patch.object(m.h, 'properties', return_value={'ActiveState': 'active'}):
                m.h.rollback(base)
                self.assertFalse(drop.exists())
                self.assertTrue(all('keeper' not in str(call) for call in run.call_args_list))


if __name__ == '__main__':
    unittest.main()
