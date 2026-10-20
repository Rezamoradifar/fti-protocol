import contextlib
import fcntl
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('installer', ROOT / 'install_dist.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.source = self.base / 'build'
        shutil.copytree(ROOT / 'dist', self.source)
        self.target = self.base / 'live' / 'dist'
        self.target.mkdir(parents=True)
        (self.target / 'index.html').write_text('OLD HTML')
        (self.target / 'assets').mkdir()
        (self.target / 'assets/old-hash.js').write_text('OLD JS')
        self.old = self.snapshot()

    def snapshot(self):
        return {str(p.relative_to(self.target)):p.read_bytes() for p in self.target.rglob('*') if p.is_file()}

    @contextlib.contextmanager
    def server(self, mode='good'):
        target = self.target
        self.http_started = threading.Event()
        http_started = self.http_started
        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kw):
                super().__init__(*args, directory=str(target), **kw)
            def log_message(self, *_args):
                pass
            def guess_type(self, path):
                if mode == 'mime' and path.endswith('.js'):
                    return 'text/html'
                return super().guess_type(path)
            def do_GET(self):
                http_started.set()
                if mode == 'slow':time.sleep(.4)
                if mode == 'body' and '.js' in self.path:
                    self.send_response(200);self.send_header('Content-Type','text/javascript');self.end_headers();self.wfile.write(b'WRONG JS');return
                if mode == '404' and '.css' in self.path:
                    self.send_error(404);return
                if mode == 'redirect':
                    self.send_response(302);self.send_header('Location','/');self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write((target/'index.html').read_bytes());return
                try:
                    super().do_GET()
                except (BrokenPipeError, ConnectionResetError):
                    # Expected when the signal test terminates curl mid-response.
                    pass
        server = ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread = threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            yield 'http://127.0.0.1:' + str(server.server_port)
        finally:
            server.shutdown();server.server_close();thread.join()

    def install(self, mode='good'):
        real_run = subprocess.run
        def run(cmd, *args, **kwargs):
            if cmd == ['nginx','-t']:
                return subprocess.CompletedProcess(cmd,0)
            return real_run(cmd,*args,**kwargs)
        with self.server(mode) as origin, patch.object(installer.subprocess,'run',side_effect=run):
            installer.install(self.source,self.target,origin,'')

    def test_success_keeps_backup_and_previous_assets(self):
        self.install()
        self.assertEqual((self.target/'index.html').read_bytes(),(self.source/'index.html').read_bytes())
        backup = next(self.target.parent.glob('dist.backup.*'))
        self.assertEqual((backup/'index.html').read_text(),'OLD HTML')
        self.assertEqual((self.target/'assets/old-hash.js').read_text(),'OLD JS')
        self.assertFalse(list(self.target.parent.glob('.landing-stage-*')))

    def test_atomic_exchange_never_removes_target(self):
        candidate = self.target.parent/'candidate';candidate.mkdir()
        (candidate/'index.html').write_text('NEW HTML')
        errors=[]
        stop=threading.Event()
        def reader():
            while not stop.is_set():
                try:
                    value=(self.target/'index.html').read_text()
                    if value not in ('OLD HTML','NEW HTML'):errors.append(value)
                except FileNotFoundError:errors.append('missing')
        thread=threading.Thread(target=reader);thread.start()
        try:
            for _ in range(100):installer.exchange(candidate,self.target)
        finally:
            stop.set();thread.join()
        self.assertEqual(errors,[])

    def test_bad_http_rolls_back_byte_for_byte(self):
        for mode in ('mime','body','404','redirect'):
            with self.subTest(mode=mode):
                with self.assertRaises((RuntimeError,subprocess.CalledProcessError)):
                    self.install(mode)
                self.assertEqual(self.snapshot(),self.old)
                self.assertFalse(list(self.target.parent.glob('.landing-stage-*')))

    def test_corrupt_source_rejected_before_activation(self):
        next((self.source/'assets').glob('*.js')).write_text('corrupt')
        with self.assertRaisesRegex(ValueError,'checksum'):self.install()
        self.assertEqual(self.snapshot(),self.old)

    def test_symlink_and_live_source_rejected(self):
        (self.source/'assets/bad.js').symlink_to(self.target/'index.html')
        with self.assertRaisesRegex(ValueError,'symlink'):self.install()
        with self.assertRaisesRegex(ValueError,'live docroot'):
            installer.install(self.target,self.target,'http://localhost','')
        self.assertEqual(self.snapshot(),self.old)

    def test_target_inside_source_rejected(self):
        with self.assertRaisesRegex(ValueError,'live docroot'):
            installer.install(self.source,self.source/'nested'/'dist','http://localhost','')
        self.assertEqual(self.snapshot(),self.old)

    def test_target_symlink_rejected(self):
        link=self.target.parent/'link';link.symlink_to(self.target)
        with self.assertRaisesRegex(ValueError,'symlink'):
            installer.install(self.source,link,'http://localhost','')
        self.assertEqual(self.snapshot(),self.old)

    def test_missing_html_asset_rejected(self):
        p=self.source/'index.html';p.write_text(p.read_text().replace('/assets/main-','/assets/missing-'))
        manifest=json.loads((self.source/'release.json').read_text())
        manifest['files']['index.html']=hashlib.sha256(p.read_bytes()).hexdigest()
        (self.source/'release.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError,'missing'):self.install()
        self.assertEqual(self.snapshot(),self.old)

    def test_unsupported_exchange_preserves_target(self):
        with patch.object(installer,'exchange',side_effect=OSError('unsupported')):
            with self.assertRaises(OSError):self.install()
        self.assertEqual(self.snapshot(),self.old)

    def test_nginx_failure_preserves_target(self):
        with patch.object(installer.subprocess,'run',side_effect=subprocess.CalledProcessError(1,'nginx')):
            with self.assertRaises(subprocess.CalledProcessError):self.install()
        self.assertEqual(self.snapshot(),self.old)

    def test_first_install_failure_removes_candidate(self):
        shutil.rmtree(self.target)
        with self.assertRaises(RuntimeError):self.install('mime')
        self.assertFalse(self.target.exists())

    def test_interrupt_during_verification_restores_old(self):
        with patch.object(installer,'verify',side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):self.install()
        self.assertEqual(self.snapshot(),self.old)

    def test_sigterm_cli_restores_old(self):
        bindir=self.base/'bin';bindir.mkdir()
        nginx=bindir/'nginx';nginx.write_text('#!/bin/sh\nexit 0\n');nginx.chmod(0o755)
        with self.server('slow') as origin:
            proc=subprocess.Popen(['bash',str(ROOT/'install-dist.sh'),'--source',str(self.source),'--target',str(self.target),'--origin',origin,'--resolve',''],env={**os.environ,'PATH':str(bindir)+os.pathsep+os.environ['PATH']},stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                self.assertTrue(self.http_started.wait(10),'Installer did not reach HTTP verification')
                proc.send_signal(signal.SIGTERM)
                proc.communicate(timeout=10)
            finally:
                if proc.poll() is None:proc.kill();proc.communicate()
        self.assertNotEqual(proc.returncode,0)
        self.assertEqual(self.snapshot(),self.old)

    def test_first_install_success(self):
        shutil.rmtree(self.target)
        self.install()
        self.assertEqual((self.target/'index.html').read_bytes(),(self.source/'index.html').read_bytes())
        self.assertFalse(list(self.target.parent.glob('dist.backup.*')))

    def test_lock_rejects_concurrent_installer(self):
        with (self.target.parent/'.landing-install.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            result=subprocess.run(['bash',str(ROOT/'install-dist.sh'),'--source',str(self.source),'--target',str(self.target)],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Another landing installation',result.stderr)
        self.assertEqual(self.snapshot(),self.old)


if __name__=='__main__':unittest.main()
