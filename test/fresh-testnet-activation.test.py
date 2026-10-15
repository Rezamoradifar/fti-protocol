"""Service cutover safety with real files and simulated systemd/HTTP; no live sends."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import itertools
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('activation', Path(__file__).resolve().parents[1]
                                            / 'tools/activate-fresh-testnet.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


class ActivationTests(unittest.TestCase):
    def test_only_reviewed_deployed_testnet_is_accepted(self):
        cfg = dict(a.ADDRESSES, chainId=97, sourceRevision=a.REVISION,
                   poolDistributionVersion=1, rewardModel='hourly-global-pool-v2',
                   deploymentKind='fresh-testnet', planDigest=a.DIGEST)
        result = dict(cfg, result='FTI_FRESH_TESTNET_DEPLOYED', addresses=a.ADDRESSES)
        a.check_target(cfg, result)
        for field, value in [('chainId', 56), ('poolDistributionVersion', 0),
                             ('planDigest', '0' * 64), ('token', '0x' + '1' * 40)]:
            changed = dict(cfg, **{field: value})
            with self.subTest(field=field), self.assertRaises(a.CutoverError):
                a.check_target(changed, result)
        result['result'] = 'FTI_FRESH_PLAN_READY'
        with self.assertRaises(a.CutoverError):
            a.check_target(cfg, result)

    def test_environment_keeps_secret_in_keeper_only_and_preserves_literal_values(self):
        saved = {'node': Path('/opt/fti/runtime/node-v22.23.3-x64/bin/node'),
                 'env': {'RPC_URL': 'https://rpc.example/$token?x=`literal`',
                         'PORT': '3110', 'HOST': '127.0.0.1',
                         'WALLETCONNECT_PROJECT_ID': 'a' * 32,
                         'KEEPER_PRIVATE_KEY': '0x' + '1' * 64, 'UNRELATED_SECRET': 'private'}}
        web = a.runtime_env('web', saved, Path('/state'))
        keeper = a.runtime_env('keeper', saved, Path('/state'))
        self.assertNotIn('KEEPER_PRIVATE_KEY', web)
        self.assertNotIn('UNRELATED_SECRET', keeper)
        self.assertEqual(keeper['KEEPER_PRIVATE_KEY'], saved['env']['KEEPER_PRIVATE_KEY'])
        self.assertIn('$token?x=`literal`', a.env_text(web))
        self.assertEqual(a.env_text({'VALUE': 'a"b\\c'}), 'VALUE="a\\"b\\\\c"\n')
        with self.assertRaises(a.CutoverError):
            a.env_text({'VALUE': 'first\nKEEPER_PRIVATE_KEY=bad'})

    def test_copy_uses_build_allowlist_and_rejects_escaping_links(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src = root / 'source'
            src.mkdir()
            for name in a.COPY_DIRS:
                (src / name).mkdir(parents=True, exist_ok=True)
                (src / name / 'asset.txt').write_text('asset')
            for name in ('package.json', 'package-lock.json'):
                (src / name).write_text('{}')
            (src / '.env').write_text('secret')
            (src / 'test-genesis-keys.json').write_text('secret')
            (src / 'deployments').mkdir()
            (src / 'deployments/key.json').write_text('secret')
            release = root / 'release'
            with patch.object(a.os, 'chown'):
                a.stage_source(src, release, os.getgid())
            self.assertFalse((release / '.env').exists())
            self.assertFalse((release / 'test-genesis-keys.json').exists())
            self.assertFalse((release / 'deployments').exists())
            self.assertEqual((release / 'web/asset.txt').stat().st_mode & 0o777, 0o640)
            (src / 'web/escape').symlink_to(src / '.env')
            with patch.object(a.os, 'chown'), self.assertRaisesRegex(a.CutoverError, 'escapes'):
                a.stage_source(src, root / 'bad-release', os.getgid())

    @contextlib.contextmanager
    def fake_services(self):
        with tempfile.TemporaryDirectory() as tmp, contextlib.ExitStack() as stack:
            root = Path(tmp)
            backup = root / 'backup'
            backup.mkdir()
            release, state = root / 'release', root / 'state'
            paths = {r: root / (r + '.d') / a.DROP_NAME for r in a.UNITS}
            props = {r: {'WorkingDirectory': '/previous/' + r, 'ActiveState': 'active',
                         'MainPID': '100' if r == 'web' else '101'} for r in a.UNITS}
            saved = {r: {'properties': copy.deepcopy(props[r]), 'node': Path('/opt/node')}
                     for r in a.UNITS}
            calls = []
            def command(argv, **_):
                calls.append(argv)
                if argv[1] == 'stop':
                    for r in a.UNITS:
                        props[r]['ActiveState'] = 'inactive'
                if argv[1] == 'daemon-reload':
                    for r in a.UNITS:
                        props[r]['WorkingDirectory'] = str(release) if paths[r].exists() else '/previous/' + r
                if argv[1] == 'start':
                    for r in a.UNITS:
                        if a.UNITS[r] in argv:
                            props[r]['ActiveState'] = 'active'
                return ''
            stack.enter_context(patch.object(a, 'run', side_effect=command))
            stack.enter_context(patch.object(a, 'drop_path', side_effect=lambda r: paths[r]))
            stack.enter_context(patch.object(a, 'properties', side_effect=lambda r: copy.deepcopy(props[r])))
            stack.enter_context(patch.object(a, 'check_assets'))
            stack.enter_context(patch.object(a.time, 'sleep'))
            stack.enter_context(patch.object(a.time, 'monotonic', side_effect=itertools.count(0, 100)))
            stack.enter_context(patch.object(a, 'capture', return_value={
                'env': {'DEPLOYMENT_FILE': str(state / 'deployment.json')},
                'properties': {'MainPID': '101'}}))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            yield release, state, backup, paths, props, saved, calls

    def test_public_health_failure_restores_both_services_before_keeper_start(self):
        with self.fake_services() as (release, state, backup, paths, props, saved, calls):
            def health(_cfg, base=None):
                if base:
                    raise a.CutoverError('public route wrong')
            with patch.object(a, 'check_web', side_effect=health):
                with self.assertRaisesRegex(a.CutoverError, 'public route'):
                    a.switch(release, state, backup, saved, {})
            self.assertTrue(all(not p.exists() for p in paths.values()))
            self.assertTrue(all(v['ActiveState'] == 'active' for v in props.values()))
            self.assertTrue(all(v['WorkingDirectory'].startswith('/previous/') for v in props.values()))
            self.assertNotIn(['systemctl', 'start', a.UNITS['keeper']], calls)

    def test_success_checks_web_before_starting_keeper_and_preserves_older_dropin(self):
        with self.fake_services() as (release, state, backup, paths, props, saved, calls):
            old = paths['web'].parent / '90-frontend.conf'
            old.parent.mkdir()
            old.write_text('keep original')
            with patch.object(a, 'check_web') as health:
                a.switch(release, state, backup, saved, {})
            self.assertEqual(health.call_count, 2)
            self.assertEqual(old.read_text(), 'keep original')
            self.assertLess(calls.index(['systemctl', 'start', a.UNITS['web']]),
                            calls.index(['systemctl', 'start', a.UNITS['keeper']]))
            self.assertTrue(all(p.exists() for p in paths.values()))
            a.rollback(backup)
            self.assertEqual(old.read_text(), 'keep original')
            self.assertTrue(all(not p.exists() for p in paths.values()))

    def test_changed_service_during_preparation_is_not_stopped(self):
        with self.fake_services() as (release, state, backup, paths, props, saved, calls):
            props['web']['MainPID'] = '200'
            with self.assertRaisesRegex(a.CutoverError, 'changed during'):
                a.switch(release, state, backup, saved, {})
            self.assertEqual(calls, [])

    def test_rollback_preserves_subsequently_modified_dropin(self):
        with self.fake_services() as (release, state, backup, paths, props, saved, calls):
            with patch.object(a, 'check_web'):
                a.switch(release, state, backup, saved, {})
            paths['web'].write_text('new operator configuration')
            calls.clear()
            with self.assertRaisesRegex(a.CutoverError, 'changed'):
                a.rollback(backup)
            self.assertEqual(calls, [])
            self.assertEqual(paths['web'].read_text(), 'new operator configuration')

    def test_proxy_repair_preserves_routes_headers_auth_limits_and_uri(self):
        original = '''# proxy_pass http://127.0.0.1:9999; comment must survive
location ^~ /api/ {
    auth_basic "Existing policy";
    limit_req zone=api;
    proxy_set_header Host $host;
    proxy_pass http://127.0.0.1:3112/api/;
}
location = /rpc {
    proxy_pass http://localhost:3108/rpc?$args; # preserve URI and comment
}
'''
        expected = original.replace('127.0.0.1:3112/api/', '127.0.0.1:3110/api/').replace(
            'localhost:3108/rpc?', '127.0.0.1:3110/rpc?')
        self.assertEqual(a.repair_proxy_text(original), expected)
        self.assertEqual(a.repair_proxy_text(expected), expected)

    def test_proxy_repair_rejects_external_variable_or_mixed_targets(self):
        for bad in ('https://other.example', 'http://$backend', 'http://127.0.0.1:$port',
                    'http://127.0.0.1:80', 'http://192.0.2.10:3112'):
            with self.subTest(bad=bad), self.assertRaises(a.CutoverError):
                a.repair_proxy_text('location /api/ {\n proxy_pass ' + bad + ';\n}')
        with self.assertRaises(a.CutoverError):
            a.repair_proxy_text('proxy_pass http://127.0.0.1:3112;\nproxy_pass https://other.example;\n')

    def test_api_include_must_be_used_only_by_known_fti_vhosts(self):
        good = '# configuration file /etc/nginx/conf.d/fti-domain.conf:\ninclude ' + str(a.API_ROUTES) + ';\n'
        a.validate_api_references(good)
        with self.assertRaises(a.CutoverError):
            a.validate_api_references(good + '# configuration file /etc/nginx/conf.d/another-site.conf:\ninclude '
                                      + str(a.API_ROUTES) + ';\n')
        with self.assertRaises(a.CutoverError):
            a.validate_api_references('# configuration file /etc/nginx/nginx.conf:\n# include '
                                      + str(a.API_ROUTES) + ';\n')

    @contextlib.contextmanager
    def api_fixture(self, backup):
        api = backup.parent / 'fti-fresh-api-routes.conf'
        before = 'location ^~ /api/ {\n proxy_pass http://127.0.0.1:3112;\n}\n'
        after = a.repair_proxy_text(before)
        api.write_text(before)
        (backup / 'nginx-api.before.conf').write_text(before)
        (backup / 'nginx-api.after.conf').write_text(after)
        record = {'path': str(api), 'before': hashlib.sha256(before.encode()).hexdigest(),
                  'after': hashlib.sha256(after.encode()).hexdigest(),
                  'uid': os.getuid(), 'gid': os.getgid(), 'mode': 0o644}
        with patch.object(a, 'API_ROUTES', api):
            yield api, before, after, record

    def test_api_repair_happens_before_public_gate_and_manual_rollback_restores_both(self):
        with self.fake_services() as (release, state, backup, paths, props, saved, calls):
            with self.api_fixture(backup) as (api, before, after, record):
                def health(_cfg, base=None):
                    if base:
                        self.assertEqual(api.read_text(), after)
                        self.assertIn(['nginx', '-t'], calls)
                        self.assertIn(['systemctl', 'reload', 'nginx'], calls)
                with patch.object(a, 'check_web', side_effect=health):
                    a.switch(release, state, backup, saved, {}, record)
                self.assertEqual(api.read_text(), after)
                a.rollback(backup)
                self.assertEqual(api.read_text(), before)
                self.assertTrue(all(not p.exists() for p in paths.values()))
                self.assertTrue(all(v['ActiveState'] == 'active' for v in props.values()))

    def test_https_failure_after_api_repair_restores_nginx_and_both_services(self):
        with self.fake_services() as (release, state, backup, paths, props, saved, calls):
            with self.api_fixture(backup) as (api, before, after, record):
                def health(_cfg, base=None):
                    if base:
                        self.assertEqual(api.read_text(), after)
                        raise a.CutoverError('public route still wrong')
                with patch.object(a, 'check_web', side_effect=health):
                    with self.assertRaisesRegex(a.CutoverError, 'public route still wrong'):
                        a.switch(release, state, backup, saved, {}, record)
                self.assertEqual(api.read_text(), before)
                self.assertTrue(all(not p.exists() for p in paths.values()))
                self.assertTrue(all(v['ActiveState'] == 'active' for v in props.values()))
                self.assertNotIn(['systemctl', 'start', a.UNITS['keeper']], calls)

    def test_api_file_changed_during_preparation_is_preserved_without_stopping_services(self):
        with self.fake_services() as (release, state, backup, paths, props, saved, calls):
            with self.api_fixture(backup) as (api, before, after, record):
                api.write_text('operator edit')
                with self.assertRaisesRegex(a.CutoverError, 'edited after preparation'):
                    a.switch(release, state, backup, saved, {}, record)
                self.assertEqual(api.read_text(), 'operator edit')
                self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main()
