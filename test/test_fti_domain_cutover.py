"""Safe, local-only tests for FTI same-domain cutover. No server modification."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / 'tools' / 'fti-same-domain-cutover.py'
spec = importlib.util.spec_from_file_location('fti_domain_cutover', SCRIPT)
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)

DOMAIN = """server {
 listen 80;
 server_name ftiprotocol.com www.ftiprotocol.com;
 location / { return 301 https://ftiprotocol.com$request_uri; }
}
server {
 listen 443 ssl;
 server_name www.ftiprotocol.com;
 return 301 https://ftiprotocol.com$request_uri;
}
server {
 listen 443 ssl;
 server_name ftiprotocol.com;
 location ^~ /app/ { proxy_pass http://127.0.0.1:3110; }
 location ~ ^/(api|abi|vendor|rpc$|health$) { proxy_pass http://127.0.0.1:3110; }
 location / { proxy_pass http://127.0.0.1:3110; }
}
"""
WORK = """server {
 listen 80;
 server_name app.ftiprotocol.com token.ftiprotocol.com council.ftiprotocol.com;
 return 301 https://$host$request_uri;
}
server {
 listen 443 ssl;
 server_name app.ftiprotocol.com token.ftiprotocol.com council.ftiprotocol.com;
 location / { proxy_pass http://127.0.0.1:3110; }
}
"""

class Cutover(unittest.TestCase):
    def test_patches_only_real_tls_main_site(self):
        patched = f.patch(DOMAIN.encode(), ['ftiprotocol.com']).decode()
        self.assertEqual(patched.count('include /etc/nginx/fti-fresh-api-routes.conf;'), 1)
        self.assertIn('server_name www.ftiprotocol.com;\n return 301', patched)
        self.assertIn('server_name ftiprotocol.com www.ftiprotocol.com;', patched)
        self.assertEqual(patched.count('proxy_pass http://127.0.0.1:3110;'), 3)

    def test_workspace_http_redirect_stays(self):
        patched = f.patch(WORK.encode(), f.HOSTS[1:]).decode()
        self.assertEqual(patched.count('include /etc/nginx/fti-fresh-api-routes.conf;'), 1)
        self.assertEqual(patched.count('return 301 https://$host'), 1)

    def test_wrong_or_duplicate_tls_vhost_refused(self):
        for bad in [b'', DOMAIN.encode().replace(b'listen 443 ssl;', b'listen 444 ssl;'),
                    (DOMAIN+DOMAIN).encode()]:
            with self.assertRaises(RuntimeError):
                f.patch(bad, ['ftiprotocol.com'])
        with self.assertRaises(RuntimeError):
            f.patch(f.patch(DOMAIN.encode(), ['ftiprotocol.com']), ['ftiprotocol.com'])

    def test_routes_do_not_move_frontend_or_vendor(self):
        self.assertIn('location ^~ /api/',f.ROUTES)
        self.assertIn('location ^~ /abi/',f.ROUTES)
        self.assertIn('location = /rpc',f.ROUTES)
        self.assertIn('location = /health',f.ROUTES)
        self.assertNotIn('location / {',f.ROUTES)
        self.assertNotIn('location /vendor',f.ROUTES)
        self.assertNotIn('3081',f.ROUTES)

    def test_reject_wrong_chain_or_addresses(self):
        self.assertTrue(f.check_addresses(f.EXPECTED))
        self.assertTrue(f.check_addresses({k:(v.lower() if isinstance(v,str) else v)
            for k,v in f.EXPECTED.items()}))
        for key,value in [('chainId',56),('token','0x'+'0'*40),('binary',None)]:
            obj={**f.EXPECTED,key:value}
            self.assertFalse(f.check_addresses(obj))

    def test_reload_race_waits_for_new_nginx_workers(self):
        with mock.patch.object(f, 'verify_domain',
                               side_effect=[RuntimeError('stale worker'), None]) as check, \
             mock.patch.object(f.time, 'monotonic', side_effect=[0, 1]), \
             mock.patch.object(f.time, 'sleep') as sleep:
            f.wait_for_domain(timeout=40, interval=2)
            self.assertEqual(check.call_count, 2)
            sleep.assert_called_once_with(2)

    def test_stale_domain_timeout_still_fails_closed(self):
        with mock.patch.object(f, 'verify_domain',
                               side_effect=RuntimeError('old contract still responding')) as check, \
             mock.patch.object(f.time, 'monotonic', side_effect=[0, 99]), \
             mock.patch.object(f.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'CUTOVER_VERIFICATION_TIMEOUT'):
                f.wait_for_domain(timeout=40, interval=2)
            self.assertEqual(check.call_count, 1)
            sleep.assert_not_called()

    def patched_paths(self, base):
        main=base/'fti-domain.conf'
        work=base/'fti-workspaces.conf'
        inc=base/'fti-fresh-api-routes.conf'
        backups=base/'backups'
        main.write_text(DOMAIN)
        work.write_text(WORK)
        return main,work,inc,backups

    def test_end_to_end_local_apply_and_rollback(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder)
            main,work,inc,backups=self.patched_paths(base)
            backups.mkdir(mode=0o700)
            with mock.patch.object(f,'TARGETS',{str(main):['ftiprotocol.com'],str(work):f.HOSTS[1:]}), \
                 mock.patch.object(f,'INCLUDE',inc), \
                 mock.patch.object(f,'BACKUPS',backups), \
                 mock.patch.object(f,'STATE',backups/'state.json'), \
                 mock.patch.object(f,'verify_ready'), \
                 mock.patch.object(f,'verify_domain'), \
                 mock.patch.object(f,'command',return_value=''):
                f.apply()
                self.assertTrue((backups/'state.json').exists())
                self.assertTrue(inc.exists())
                self.assertIn('include ',main.read_text())
                self.assertIn('include ',work.read_text())
                f.rollback()
                self.assertEqual(main.read_text(),DOMAIN)
                self.assertEqual(work.read_text(),WORK)
                self.assertFalse(inc.exists())
                self.assertFalse((backups/'state.json').exists())

    def test_live_check_failure_rolls_back(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder)
            main,work,inc,backups=self.patched_paths(base)
            backups.mkdir(mode=0o700)
            with mock.patch.object(f,'TARGETS',{str(main):['ftiprotocol.com'],str(work):f.HOSTS[1:]}), \
                 mock.patch.object(f,'INCLUDE',inc), \
                 mock.patch.object(f,'BACKUPS',backups), \
                 mock.patch.object(f,'STATE',backups/'state.json'), \
                 mock.patch.object(f,'verify_ready'), \
                 mock.patch.object(f,'verify_domain',side_effect=RuntimeError('live failed')), \
                 mock.patch.object(f,'command',return_value=''):
                with self.assertRaisesRegex(RuntimeError,'live failed'):
                    f.apply()
                self.assertEqual(main.read_text(),DOMAIN)
                self.assertEqual(work.read_text(),WORK)
                self.assertFalse(inc.exists())
                self.assertFalse((backups/'state.json').exists())

if __name__=='__main__':
    unittest.main()
