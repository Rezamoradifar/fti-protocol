"""Linux-only static landing installer; no services, configs or contracts are changed."""
import argparse
import ctypes
import fcntl
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import time
from urllib.parse import urlsplit


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('src'):
            self.paths.append(attrs['src'])
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            self.paths.append(attrs['href'])


def validate(source):
    if source.is_symlink() or not source.is_dir():
        raise ValueError('Source must be a real build directory')
    if any(p.is_symlink() for p in source.rglob('*')):
        raise ValueError('Build must not contain symlinks')
    manifest = json.loads((source / 'release.json').read_text())
    files = manifest['files']
    if 'index.html' not in files or not any(p.endswith('.js') for p in files) or not any(p.endswith('.css') for p in files):
        raise ValueError('Incomplete release manifest')
    for name, digest in files.items():
        if not re.fullmatch(r'(index\.html|(?:token-site|whitepaper|roadmap)/index\.html|assets/[A-Za-z0-9_.-]+)', name):
            raise ValueError('Unsafe manifest path')
        if hashlib.sha256((source / name).read_bytes()).hexdigest() != digest:
            raise ValueError('Build checksum mismatch: ' + name)
    parser = Assets()
    parser.feed((source / 'index.html').read_text())
    if not any(p.endswith('.js') for p in parser.paths) or not any(p.endswith('.css') for p in parser.paths):
        raise ValueError('HTML must reference JS and CSS')
    if any(p.removeprefix('/') not in files or not p.startswith('/assets/') for p in parser.paths):
        raise ValueError('HTML references missing or external assets')
    return files


def exchange(a, b):
    # One atomic syscall: concurrent requests never see a missing docroot.
    libc = ctypes.CDLL(None, use_errno=True)
    fn = getattr(libc, 'renameat2', None)
    if fn is None:
        raise OSError('Linux renameat2 is required; live files were not moved')
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    if fn(-100, os.fsencode(a), -100, os.fsencode(b), 2):
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def verify(target, files, origin, resolve):
    with tempfile.TemporaryDirectory(prefix='.landing-http-', dir=target.parent) as tmp:
        for name in files:
            output = Path(tmp) / 'body'
            cmd = ['curl', '--fail', '--silent', '--show-error', '--noproxy', '*',
                   '--connect-timeout', '5', '--max-time', '20', '--header', 'Cache-Control: no-cache',
                   '--output', str(output), '--write-out', '%{http_code} %{content_type}', '--max-redirs', '0']
            if resolve:
                cmd += ['--resolve', resolve]
            route = '' if name == 'index.html' else name.removesuffix('index.html') if name.endswith('/index.html') else name
            url = origin.rstrip('/') + '/' + route
            status, content_type = subprocess.check_output(cmd + [url + '?release=' + str(time.time_ns())], text=True).split(' ', 1)
            mime = content_type.split(';')[0].strip()
            allowed = {'text/html'} if name.endswith('.html') else {'text/css'} if name.endswith('.css') else {'text/javascript', 'application/javascript'} if name.endswith('.js') else {'font/woff2', 'application/font-woff2', 'application/octet-stream'}
            if status != '200' or mime not in allowed or output.read_bytes() != (target / name).read_bytes():
                raise RuntimeError('HTTP content/type mismatch: ' + name)


def install(source, target, origin, resolve):
    if target.is_symlink() or (target.exists() and not target.is_dir()):
        raise ValueError('Target must be a real directory, not a symlink')
    if source.resolve() == target.resolve() or target.resolve() in source.resolve().parents or source.resolve() in target.resolve().parents:
        raise ValueError('Build outside the live docroot before installing')
    files = validate(source)
    subprocess.run(['nginx', '-t'], check=True)
    stage = Path(tempfile.mkdtemp(prefix='.landing-stage-', dir=target.parent))
    previous = target.exists()
    activated = False
    backup = target.parent / ('dist.backup.' + str(time.time_ns()))
    try:
        shutil.copytree(source, stage, dirs_exist_ok=True)
        # Preserve immutable files still referenced by already-open pages.
        if previous and (target / 'assets').is_dir():
            for asset in (target / 'assets').iterdir():
                if asset.is_symlink() or not asset.is_file():
                    raise ValueError('Unsafe previous asset')
                dest = stage / 'assets' / asset.name
                if dest.exists() and dest.read_bytes() != asset.read_bytes():
                    raise ValueError('Immutable asset name collision: ' + asset.name)
                if not dest.exists():
                    shutil.copy2(asset, dest)
        validate(stage)
        for p in [stage, *stage.rglob('*')]:
            p.chmod(0o755 if p.is_dir() else 0o644)
        # Hold signals across syscall + bookkeeping; handler runs after activated is set.
        signals = {signal.SIGINT, signal.SIGTERM, signal.SIGHUP}
        mask = signal.pthread_sigmask(signal.SIG_BLOCK, signals)
        try:
            if previous:
                exchange(stage, target)
            else:
                os.replace(stage, target)
            activated = True
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, mask)
        verify(target, files, origin, resolve)
        if previous:
            os.replace(stage, backup)
        print('Local HTTP verification passed. Backup: ' + (str(backup) if previous else 'none (first install)'))
        print('Production browser verification is still required; this is not a launch confirmation.')
    except BaseException:
        # Finish restoration even if a second interrupt arrives.
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, signal.SIG_IGN)
        if activated:
            if previous:
                old = backup if backup.exists() else stage
                exchange(old, target)
                # Retain the failed candidate for inspection without exposing it.
                os.replace(old, target.parent / ('dist.failed.' + str(time.time_ns())))
            else:
                os.replace(target, stage)
        print('Installation failed; previous docroot restored (or first install removed).', file=__import__('sys').stderr)
        raise
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parent / 'dist')
    parser.add_argument('--target', type=Path, default=Path('/opt/fti-protocol/landing/dist'))
    parser.add_argument('--origin', default='https://ftiprotocol.com')
    parser.add_argument('--resolve', default='ftiprotocol.com:443:127.0.0.1')
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Run with sudo bash landing/install-dist.sh')
    url = urlsplit(args.origin)
    if url.scheme not in ('http', 'https') or not url.netloc or url.path not in ('', '/') or url.query or url.fragment or url.username:
        parser.error('Origin must be an HTTP(S) origin without credentials/path/query')
    args.target = args.target.absolute()
    args.target.parent.mkdir(parents=True, exist_ok=True)
    # Parent lock serializes installers and remains held during verification/rollback.
    with (args.target.parent / '.landing-install.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error('Another landing installation is running')
        def interrupted(signum, _frame):
            raise RuntimeError('Interrupted by signal ' + str(signum))
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, interrupted)
        install(args.source, args.target, args.origin, args.resolve)


if __name__ == '__main__':
    main()
