import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('fti_metamask_install', Path(__file__).with_name('install.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class InstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        module.ROUTES = self.root / 'routes.conf'
        module.ROUTES.write_text('location /api/ { proxy_pass http://127.0.0.1:3110; }\n')
        self.before = module.ROUTES.read_bytes()
        module.PUBLIC = self.root / 'public'
        module.PUBLIC.mkdir()
        module.BACKUPS = self.root / 'backups'
        self.source = self.root / 'generated'
        self.source.mkdir()
        body = {'schema': 'FTI_MAINNET_UNSIGNED_PLAN_V1', 'input': {'chainId': 56}, 'readyToBroadcast': False, 'manifest': {'sourceRevision': 'a' * 40}}
        self.digest = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        body['digest'] = self.digest
        (self.source / 'plan.json').write_text(json.dumps(body))
        (self.source / 'index.html').write_text('<meta content="' + self.digest + '">')
        (self.source / 'operator.js').write_text('console.log("test");')
        self.commands = []
        self.fail_check = False
        self.fail_content = False
        self.old_sleep = module.time.sleep
        module.time.sleep = lambda seconds: None
        self.transient_failures = 0
        self.old_run = module.run
        module.run = self.run_fake

    def tearDown(self):
        module.run = self.old_run
        module.time.sleep = self.old_sleep
        self.tmp.cleanup()

    def run_fake(self, args):
        self.commands.append(args)
        if args == ['nginx', '-T']:
            return str(module.ROUTES) + '\nserver_name ftiprotocol.com;'
        if args == ['nginx', '-t'] and self.fail_check:
            self.fail_check = False
            raise RuntimeError('syntax failure')
        if args[0] == 'curl':
            self.assertEqual(args[1:3], ['--noproxy', '*'])
            if self.transient_failures:
                self.transient_failures -= 1
                raise subprocess.CalledProcessError(22, args, output='curl: (22) HTTP 404')
            if self.fail_content:
                return 'wrong upstream'
            return (self.source / args[-1].rsplit('/', 1)[1]).read_text()
        return ''

    def test_success_retains_old_routes_and_checks_all_https_assets(self):
        result = module.install(self.source, self.digest)
        self.assertTrue(module.ROUTES.read_bytes().startswith(self.before))
        self.assertIn(b'location ^~ /fti-mainnet-sign-', module.ROUTES.read_bytes())
        self.assertEqual(len([x for x in self.commands if x[0] == 'curl']), 3)
        self.assertEqual(result['submitted'], False)
        self.assertEqual((Path(result['backup']) / 'before.conf').read_bytes(), self.before)
        module.rollback(Path(result['backup']))
        self.assertEqual(module.ROUTES.read_bytes(), self.before)

    def test_reload_delay_retries_then_checks_every_asset(self):
        self.transient_failures = 2
        result = module.install(self.source, self.digest)
        self.assertEqual(len([x for x in self.commands if x[0] == 'curl']), 5)
        self.assertFalse(result['submitted'])

    def test_persistent_http_failure_reports_status_and_rolls_back(self):
        self.transient_failures = 10
        with self.assertRaisesRegex(RuntimeError, 'HTTP 404'):
            module.install(self.source, self.digest)
        self.assertEqual(len([x for x in self.commands if x[0] == 'curl']), 5)
        self.assertEqual(module.ROUTES.read_bytes(), self.before)

    def test_restrictive_umask_still_allows_static_directory_traversal(self):
        previous = os.umask(0o077)
        try:
            result = module.install(self.source, self.digest)
        finally:
            os.umask(previous)
        folder = Path(result['planFile']).parent
        self.assertEqual(folder.stat().st_mode & 0o777, 0o755)
        self.assertEqual((folder / 'plan.json').stat().st_mode & 0o777, 0o644)

    def test_syntax_failure_restores_exact_previous_routes(self):
        self.fail_check = True
        with self.assertRaisesRegex(RuntimeError, 'syntax failure'):
            module.install(self.source, self.digest)
        self.assertEqual(module.ROUTES.read_bytes(), self.before)

    def test_https_content_failure_rolls_back(self):
        self.fail_content = True
        with self.assertRaisesRegex(RuntimeError, 'content mismatch'):
            module.install(self.source, self.digest)
        self.assertEqual(module.ROUTES.read_bytes(), self.before)

    def test_rollback_preserves_concurrent_configuration_edits(self):
        result = module.install(self.source, self.digest)
        module.ROUTES.write_text(module.ROUTES.read_text() + '# concurrent edit\n')
        after = module.ROUTES.read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'changed since'):
            module.rollback(Path(result['backup']))
        self.assertEqual(module.ROUTES.read_bytes(), after)

    def test_refuses_secret_extra_files_symlinks_and_changed_plans_before_nginx(self):
        (self.source / 'secret.key').write_text('must never publish')
        with self.assertRaisesRegex(RuntimeError, 'Only generated'):
            module.install(self.source, self.digest)
        (self.source / 'secret.key').unlink()
        (self.source / 'operator.js').unlink()
        (self.source / 'operator.js').symlink_to(self.root / 'other')
        with self.assertRaises((RuntimeError, FileNotFoundError)):
            module.install(self.source, self.digest)
        self.assertEqual(self.commands, [])
        (self.source / 'operator.js').unlink()
        (self.source / 'operator.js').write_text('safe')
        plan = json.loads((self.source / 'plan.json').read_text())
        plan['input']['chainId'] = 97
        (self.source / 'plan.json').write_text(json.dumps(plan))
        with self.assertRaisesRegex(RuntimeError, 'digest mismatch'):
            module.install(self.source, self.digest)
        self.assertEqual(self.commands, [])

if __name__ == '__main__':
    unittest.main()
