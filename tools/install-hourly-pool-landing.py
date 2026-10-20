#!/usr/bin/env python3
"""Package/install the hourly-pool landing overlay without npm or service changes."""
import argparse
import base64
import fcntl
import gzip
import hashlib
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import urllib.request

SERVICE = 'fti-continuity-web.service'
LOCAL = 'http://127.0.0.1:3110'
PUBLIC = 'https://ftiprotocol.com'
RELEASES = Path('/opt/fti/releases')
BACKUPS = Path('/var/backups/fti-hourly-pool-landing')
PROTECTED = ('web/index.html', 'web/app.js', 'web/vendor/walletconnect.js', 'scripts/server.mjs')
EXPECTED_CONFIG = {'chainId': 56, 'mode': 'bnb-mainnet', 'sourceRevision': 'ba82373a83d63fba0643332371cfb6d62903c849', 'sourceFingerprint': 'eaf50289e56998959303757f443b80d38caa7002427f4a5b126f5b00dee3e934', 'mainnetPlanDigest': '0ec3a7d93f5e1225cbd4f5671f4ee6b92423718898f1734c42390337467f7480', 'binary': '0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9', 'token': '0x43755B1E813b2d41F669ea08bcf859De07195eA1', 'usd': '0x55d398326f99059fF775485246999027B3197955', 'council': '0x85F567C2c59e766847D9dC18328C3B54cDf80DE4', 'timelock': '0xcf3eCA1E96db99E478e81C79f2Ae03dEec80CA86'}
# BEGIN EMBEDDED RELEASE
RELEASE = None
# END EMBEDDED RELEASE


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def child(root, name):
    require(name and not Path(name).is_absolute() and '..' not in Path(name).parts,
            'Unsafe file path')
    target = root
    for part in Path(name).parts:
        target /= part
        require(not target.is_symlink(), 'Symlink path rejected: ' + name)
    return target


def regular(file, limit=8_000_000):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= limit,
                'Expected bounded regular file: ' + str(file))
        with os.fdopen(os.dup(fd), 'rb') as stream:
            data = stream.read(limit + 1)
        require(len(data) <= limit, 'File too large')
        return data, info
    finally:
        os.close(fd)


def save_new(file, data, mode=0o600):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        os.fchmod(stream.fileno(), mode)
        stream.flush()
        os.fsync(stream.fileno())


def replace(file, data, info):
    fd, temporary = tempfile.mkstemp(prefix='.fti-hourly-landing-', dir=file.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            os.fchmod(stream.fileno(), stat.S_IMODE(info.st_mode))
            if os.geteuid() == 0:
                os.fchown(stream.fileno(), info.st_uid, info.st_gid)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, file)
        directory = os.open(file.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def fetch(url, limit=8_000_000):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_):
            raise RuntimeError('Unexpected HTTP redirect')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache',
                                                  'User-Agent': 'FTI-Hourly-Pool-Landing/1'})
    with opener.open(request, timeout=25) as response:
        require(response.status == 200, 'Unexpected HTTP status')
        data = response.read(limit + 1)
        require(len(data) <= limit, 'HTTP response too large')
        return data


def properties():
    result = subprocess.check_output(['systemctl', 'show', SERVICE,
        '--property=LoadState,ActiveState,SubState,User,Group,WorkingDirectory,MainPID'],
        text=True, timeout=10)
    return dict(line.split('=', 1) for line in result.splitlines() if '=' in line)


def check_service(saved):
    require(saved.get('LoadState') == 'loaded' and saved.get('ActiveState') == 'active' and
            saved.get('SubState') == 'running' and
            saved.get('User') == saved.get('Group') == 'fti-v3' and
            int(saved.get('MainPID', '0')) > 1, 'Expected the active FTI web service')
    root = Path(saved['WorkingDirectory'])
    require(root.parent == RELEASES and root.resolve() == root and root.is_dir(),
            'Unexpected running release')
    return root


def check_web(base):
    health = json.loads(fetch(base + '/health'))
    require(health.get('ok') is True and health.get('chainId') == 56,
            'Mainnet web health unavailable; no landing switch permitted')
    cfg = json.loads(fetch(base + '/api/config'))
    for key, expected in EXPECTED_CONFIG.items():
        require(cfg.get(key) == expected, 'Wrong mainnet deployment: ' + key)
    require(cfg.get('poolDistributionVersion') == 1 and cfg.get('hourlyCapFlushVersion') == 1,
            'Wrong mainnet pool configuration')


class HtmlAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('src'):
            self.paths.append(attrs['src'])
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            self.paths.append(attrs.get('href', ''))


def validate_files(files):
    require(isinstance(files, dict) and 1 < len(files) < 300 and 'index.html' in files,
            'Incomplete landing manifest')
    for name, digest in files.items():
        require(re.fullmatch(r'(index\.html|(?:token-site|whitepaper|roadmap)/index\.html|assets/[A-Za-z0-9_.-]+)', name),
                'Unsafe manifest path: ' + name)
        require(re.fullmatch(r'[a-f0-9]{64}', str(digest)), 'Invalid file checksum')


def validate_html(html, files):
    parser = HtmlAssets()
    parser.feed(html.decode())
    require(any(x.endswith('.js') for x in parser.paths) and any(x.endswith('.css') for x in parser.paths),
            'Landing HTML must reference JS and CSS')
    require(all(x.startswith('/assets/') and x[1:] in files for x in parser.paths),
            'Landing HTML references missing or external assets')


def release_files(release):
    require(isinstance(release, dict) and release.get('schema') == 'FTI_HOURLY_POOL_LANDING_V1',
            'This source template must be packaged before installation')
    base, files = release.get('baseFiles'), release.get('files')
    validate_files(base)
    validate_files(files)
    changed = {name for name, digest in files.items() if base.get(name) != digest}
    require('index.html' in changed and 1 < len(changed) <= 12,
            'Expected only the homepage and its new assets')
    require(all(name == 'index.html' or name.startswith('assets/') for name in changed),
            'Public document changes are outside this installer')
    require(all(files.get(name) == digest for name, digest in base.items() if not name.startswith('assets/') and name != 'index.html'),
            'Public document changes are outside this installer')
    require(set(release.get('payloads', {})) == changed, 'Changed payload set mismatch')
    content = {}
    total = 0
    for name in changed:
        compressed = base64.b64decode(release['payloads'][name], validate=True)
        require(len(compressed) <= 4_000_000, 'Compressed asset too large')
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
            data = stream.read(8_000_001)
        total += len(data)
        require(len(data) <= 8_000_000 and total <= 16_000_000 and sha(data) == files[name],
                'Packaged file checksum mismatch: ' + name)
        content[name] = data
    validate_html(content['index.html'], files)
    release_id = sha(json.dumps(files, sort_keys=True).encode())[:16]
    require(release.get('releaseId') == release_id, 'Landing release fingerprint mismatch')
    return base, files, content, release_id


def read_build(root):
    files = json.loads(regular(child(root, 'release.json'))[0])['files']
    validate_files(files)
    content = {}
    for name, digest in files.items():
        data = regular(child(root, name))[0]
        require(sha(data) == digest, 'Build checksum mismatch: ' + name)
        content[name] = data
    validate_html(content['index.html'], files)
    return files, content


def verify_files(root, files):
    for name, digest in files.items():
        require(sha(regular(child(root, name))[0]) == digest, 'Installed asset differs: ' + name)


def verify_public(html, files):
    for base in (LOCAL, PUBLIC):
        require(fetch(base + '/') == html, 'Served landing HTML mismatch')
    for name, digest in files.items():
        if name.startswith('assets/'):
            require(sha(fetch(PUBLIC + '/' + name)) == digest, 'Served asset differs: ' + name)
    check_web(LOCAL)
    check_web(PUBLIC)


def private_backups():
    require(not BACKUPS.is_symlink(), 'Unexpected backup directory')
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = BACKUPS.stat()
    require(info.st_uid == 0 and not info.st_mode & 0o077, 'Private root-owned backup directory required')


def protected_files(root):
    return {name: sha(regular(child(root, name))[0]) for name in PROTECTED}


def check_protected(root, expected):
    for name, digest in expected.items():
        require(sha(regular(child(root, name))[0]) == digest, 'Protected runtime changed: ' + name)


def restore(backup):
    require(backup.parent == BACKUPS and backup.resolve() == backup and backup.is_dir(),
            'Unexpected backup path')
    record = json.loads(regular(child(backup, 'record.json'))[0])
    root = Path(record['root'])
    require(check_service(properties()) == root, 'Web release changed; preserve concurrent deployment')
    target = child(root, 'landing/dist/index.html')
    current, info = regular(target)
    require(sha(current) == record['after'], 'HTML changed concurrently; preserve operator edit')
    before = regular(child(backup, 'before.html'))[0]
    require(sha(before) == record['before'], 'Backup HTML checksum mismatch')
    replace(target, before, info)
    require(fetch(LOCAL + '/') == before and fetch(PUBLIC + '/') == before,
            'Restored landing HTML verification failed')
    print('FTI_HOURLY_POOL_LANDING_RESTORED', flush=True)


def apply(release):
    base, files, content, release_id = release_files(release)
    saved = properties()
    root = check_service(saved)
    landing = child(root, 'landing/dist')
    require(landing.is_dir() and landing.resolve() == landing, 'Unexpected landing directory')
    check_web(LOCAL)
    check_web(PUBLIC)
    target = child(landing, 'index.html')
    before, info = regular(target)
    if sha(before) == files['index.html']:
        verify_files(landing, files)
        verify_public(before, files)
        require(properties() == saved, 'Web process changed during verification')
        print('FTI_HOURLY_POOL_LANDING_ALREADY_INSTALLED', flush=True)
        return
    require(sha(before) == base['index.html'], 'Installed landing differs from the reviewed base')
    verify_files(landing, base)
    for name in files:
        if name not in content:
            require(sha(regular(child(landing, name))[0]) == files[name], 'Reusable asset differs: ' + name)
    protected = protected_files(root)
    space = os.statvfs(landing)
    require(space.f_bavail * space.f_frsize >= sum(map(len, content.values())) * 2 + 16 * 1024 * 1024 and
            space.f_favail > len(content) + 32, 'Insufficient free space or inodes; no files removed')
    private_backups()
    backup = Path(tempfile.mkdtemp(prefix='install-', dir=BACKUPS))
    record = {'root': str(root), 'before': sha(before), 'after': files['index.html'],
              'releaseId': release_id, 'protected': protected}
    save_new(backup / 'before.html', before)
    save_new(backup / 'record.json', json.dumps(record, sort_keys=True).encode())
    save_new(backup / 'installer.py', regular(Path(__file__).resolve())[0])
    print('ROLLBACK_COMMAND=python3 ' + str(backup / 'installer.py') + ' --restore ' + str(backup), flush=True)
    for name, data in content.items():
        if name == 'index.html':
            continue
        file = child(landing, name)
        file.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        file.parent.chmod(0o755)
        if file.exists():
            require(regular(file)[0] == data, 'Immutable asset already differs: ' + name)
        else:
            save_new(file, data, 0o644)
        require(sha(fetch(PUBLIC + '/' + name)) == files[name], 'New asset not reachable: ' + name)
    changed = False
    try:
        require(properties() == saved, 'Web process changed during preparation')
        require(regular(target)[0] == before, 'Concurrent landing HTML edit')
        check_protected(root, protected)
        # Do not leave an activated page untracked if a signal arrives between
        # the atomic rename and the rollback bookkeeping.
        mask = signal.pthread_sigmask(signal.SIG_BLOCK,
                                      {signal.SIGINT, signal.SIGTERM, signal.SIGHUP})
        try:
            try:
                replace(target, content['index.html'], info)
            finally:
                changed = sha(regular(target)[0]) == files['index.html']
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, mask)
        verify_public(content['index.html'], files)
        require(properties() == saved, 'Web process changed after landing switch')
        check_protected(root, protected)
    except BaseException:
        if changed:
            restore(backup)
        raise
    print(json.dumps({'result': 'FTI_HOURLY_POOL_LANDING_INSTALLED', 'chainId': 56,
        'backup': str(backup), 'releaseId': release_id, 'contractsChanged': False,
        'keeperActivated': False, 'serviceRestarted': False}), flush=True)


def package(root, base_root, output):
    base, _ = read_build(base_root)
    files, content = read_build(root)
    payloads = {name: base64.b64encode(gzip.compress(data, mtime=0)).decode()
                for name, data in content.items() if base.get(name) != files[name]}
    release = {'schema': 'FTI_HOURLY_POOL_LANDING_V1', 'baseFiles': base, 'files': files,
               'payloads': payloads, 'releaseId': sha(json.dumps(files, sort_keys=True).encode())[:16]}
    release_files(release)
    source = regular(Path(__file__).resolve())[0].decode()
    pattern = r'(# BEGIN EMBEDDED RELEASE\n).*?(\n# END EMBEDDED RELEASE)'
    text, count = re.subn(pattern, lambda m: m[1] + 'RELEASE = json.loads(' +
                         repr(json.dumps(release, sort_keys=True)) + ')' + m[2], source, flags=re.S)
    require(count == 1, 'Package marker mismatch')
    save_new(output, text.encode(), 0o644)
    print(json.dumps({'installer': str(output), 'sha256': sha(text.encode()),
                      'changedFiles': sorted(payloads), 'releaseId': release['releaseId']}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--package', type=Path)
    action.add_argument('--restore', type=Path)
    parser.add_argument('--base', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.package:
        require(args.output is not None and args.base is not None, '--package requires --base and --output')
        package(args.package.resolve(), args.base.resolve(), args.output)
        return
    require(args.output is None and args.base is None, '--base and --output require --package')
    require(os.geteuid() == 0, 'Run this packaged installer on the FTI VPS as root')
    os.umask(0o077)
    with open('/run/lock/fti-service-cutover.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def interrupted(*_):
            raise RuntimeError('Interrupted')
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGHUP, interrupted)
        if args.restore:
            restore(args.restore)
        else:
            apply(RELEASE)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('FTI_HOURLY_POOL_LANDING_STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
