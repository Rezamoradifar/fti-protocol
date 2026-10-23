#!/usr/bin/env python3
"""Install a packaged registration recovery UI, without a build or restart.

Default is read-only preflight. --apply publishes immutable JS and atomically
switches only web/index.html. --restore BACKUP restores that HTML.
"""
import argparse
import base64
import fcntl
import gzip
import hashlib
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
import urllib.error
import urllib.request

UNIT = 'fti-continuity-web.service'
LOCAL = 'http://127.0.0.1:3110'
PUBLIC = 'https://ftiprotocol.com'
ROUTES = ('/app/', '/token/', '/admin/')
BACKUPS = Path('/var/backups/fti-registration-recovery')
BASE = 'fti-mainnet-ui-eead15d141fbbc07'
BASE_APP = 'a6ed0da9729698dd66d3db996e8d1dc370d0fd6bd088d0d1730c8f7ab3dcfacc'
LEGAL = '573cc95a6417c69a6ca44804f440f00965283c8cdcc50025305a7a50f53940ac'
REFERRAL = '/fti-referral-c6abd61ddf79782e795c2484/'
REFERRAL_BLOB = '32c0099a90c32e183fcd66309fdaa78ec7c8801d'
CONFIG = {
    'chainId': 56, 'mode': 'bnb-mainnet',
    'binary': '0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9',
    'token': '0x43755B1E813b2d41F669ea08bcf859De07195eA1',
    'usd': '0x55d398326f99059fF775485246999027B3197955',
    'sourceRevision': 'ba82373a83d63fba0643332371cfb6d62903c849',
    'sourceFingerprint': 'eaf50289e56998959303757f443b80d38caa7002427f4a5b126f5b00dee3e934',
    'mainnetPlanDigest': '0ec3a7d93f5e1225cbd4f5671f4ee6b92423718898f1734c42390337467f7480',
}
LIMIT = 4_000_000
# BEGIN EMBEDDED RELEASE
RELEASE = None
# END EMBEDDED RELEASE


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(path):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'UNSAFE_PATH')
    current = Path('/')
    for part in path.parts[1:]:
        current /= part
        require(not current.is_symlink(), 'SYMLINK_REJECTED')
    return path


def regular(path):
    safe_path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= LIMIT,
                'UNSAFE_FILE')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            data = stream.read(LIMIT + 1)
        require(len(data) <= LIMIT, 'FILE_TOO_LARGE')
        return data, info
    finally:
        os.close(fd)


def create(path, data, mode=0o644):
    safe_path(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        os.fchmod(stream.fileno(), mode)
        stream.flush()
        os.fsync(stream.fileno())


def replace(path, expected, data, info):
    current, now = regular(path)
    fields = ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_mtime_ns')
    require(current == expected and all(getattr(now, x) == getattr(info, x) for x in fields),
            'CONCURRENT_HTML_EDIT')
    attrs = {key: os.getxattr(path, key) for key in os.listxattr(path)}
    fd, name = tempfile.mkstemp(prefix='.fti-registration-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            if os.geteuid() == 0:
                os.fchown(stream.fileno(), info.st_uid, info.st_gid)
            os.fchmod(stream.fileno(), stat.S_IMODE(info.st_mode))
            for key, value in attrs.items():
                os.setxattr(stream.fileno(), key, value)
            stream.flush()
            os.fsync(stream.fileno())
        require(regular(path)[0] == expected, 'CONCURRENT_HTML_EDIT')
        os.replace(name, path)
        folder = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(folder)
        finally:
            os.close(folder)
    finally:
        if os.path.exists(name):
            os.unlink(name)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args):
        raise RuntimeError('HTTP_REDIRECT_REJECTED')


def fetch(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache',
        'Accept-Encoding': 'identity', 'User-Agent': 'FTI-Registration-Recovery/1'})
    try:
        with opener.open(request, timeout=20) as response:
            data = response.read(LIMIT + 1)
            require(response.status == 200 and len(data) <= LIMIT, 'INVALID_HTTP_RESPONSE')
            return data, response.headers.get_content_type()
    except urllib.error.HTTPError as error:
        raise RuntimeError('HTTP_STATUS_' + str(error.code) + ': ' + url) from None


def served(url, data, javascript=False):
    actual, mime = fetch(url)
    require(actual == data, 'HTTP_BYTES_MISMATCH')
    require(mime in ('text/javascript', 'application/javascript') if javascript
            else mime == 'text/html', 'HTTP_MIME_MISMATCH')


def config(expected=None):
    values = []
    for base in (LOCAL, PUBLIC):
        data, mime = fetch(base + '/api/config')
        value = json.loads(data)
        require(mime == 'application/json' and isinstance(value, dict) and
                all(value.get(key) == item for key, item in CONFIG.items()), 'DEPLOYMENT_MISMATCH')
        values.append(value)
    require(values[0] == values[1], 'PUBLIC_ORIGIN_CONFIG_MISMATCH')
    require(expected is None or values[0] == expected, 'CONFIG_CHANGED_DURING_INSTALL')
    return values[0]


def properties():
    keys = ('WorkingDirectory', 'MainPID', 'User', 'Group', 'ActiveState', 'SubState', 'NRestarts')
    result = subprocess.run(['systemctl', 'show', UNIT, '--no-pager',
        *['--property=' + key for key in keys]], check=True, capture_output=True, timeout=15)
    return dict(line.split('=', 1) for line in result.stdout.decode().splitlines() if '=' in line)


def service():
    saved = properties()
    require(saved.get('User') == saved.get('Group') == 'fti-v3' and
            saved.get('ActiveState') == 'active' and saved.get('SubState') == 'running' and
            int(saved.get('MainPID', 0)) > 1, 'UNEXPECTED_FTI_SERVICE')
    root = safe_path(saved['WorkingDirectory'])
    require(root.parent == Path('/opt/fti/releases') and root.is_dir() and
            Path('/proc/' + saved['MainPID'] + '/cwd').resolve() == root, 'UNEXPECTED_RELEASE')
    return saved, root


def node_executable(saved):
    return str(Path('/proc/' + saved['MainPID'] + '/exe').resolve(strict=True))


def payload(release):
    require(isinstance(release, dict) and release.get('schema') == 'FTI_REGISTRATION_RECOVERY_UI_V1',
            'PACKAGED_INSTALLER_REQUIRED')
    require(re.fullmatch('[0-9a-f]{64}', release.get('sha256', '')) and
            isinstance(release.get('gzipBase64'), str) and len(release['gzipBase64']) <= LIMIT,
            'INVALID_RELEASE')
    with gzip.GzipFile(fileobj=io.BytesIO(base64.b64decode(release['gzipBase64'], validate=True))) as stream:
        data = stream.read(LIMIT + 1)
    require(len(data) <= LIMIT and sha(data) == release['sha256'], 'RELEASE_HASH_MISMATCH')
    require(b'./vendor/ethers.js' in data and
            b'retry-pending-check' in data, 'UNEXPECTED_BUNDLE')
    return data


def plan(before, app):
    name = 'app-registration-recovery-' + sha(app)[:20] + '.js'
    app_url = '/' + BASE + '/' + name
    entry = ("import {installReferralContext} from '" + REFERRAL + "referral-context.js';\n"
             "installReferralContext(window);\nawait import('" + app_url + "');\n").encode()
    entry_url = '/fti-registration-recovery-' + sha(entry)[:20] + '/entry.js'
    old = ('src="' + REFERRAL + 'entry.js"').encode()
    new = ('src="' + entry_url + '"').encode()
    require((before.count(old) == 1 or before.count(new) == 1) and
            len(re.findall(rb'<script\b', before)) == 1 and
            b'<base' not in before.lower(), 'UNRECOGNIZED_INSTALLED_ENTRY')
    return before.replace(old, new, 1), {app_url: app, entry_url: entry}


def public_asset_directory(path, expected):
    safe_path(path)
    path.mkdir(mode=0o755, exist_ok=True)
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o022,
                'UNSAFE_ASSET_DIRECTORY')
        # The pre-existing base directory has already been served successfully
        # in preflight; preserve its operator-selected owner/group permissions.
        if not re.fullmatch(r'fti-registration-recovery-[0-9a-f]{20}', path.name):
            return
        if info.st_mode & 0o005 != 0o005:
            # main() deliberately uses umask 0077 for private backups. Public
            # entry directories need explicit traversal/read permissions, also
            # when retrying the 0700 directory left by an older installer.
            names = set(os.listdir(fd))
            require(info.st_uid == 0 and names <= set(expected), 'UNSAFE_PRIVATE_ASSET_DIRECTORY')
            for name in names:
                require(regular(path / name)[0] == expected[name], 'IMMUTABLE_ASSET_MISMATCH')
            os.fchmod(fd, 0o755)
        require(os.fstat(fd).st_mode & 0o005 == 0o005, 'ASSET_DIRECTORY_NOT_PUBLIC')
    finally:
        os.close(fd)


def switch(target, before, after, info, verify):
    try:
        replace(target, before, after, info)
        verify()
    except BaseException:
        current, now = regular(target)
        if current == after:
            for sig in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
                signal.signal(sig, signal.SIG_IGN)
            replace(target, after, before, now)
            print('FTI_REGISTRATION_RECOVERY_ROLLED_BACK', flush=True)
        elif current != before:
            print('CONCURRENT_HTML_EDIT_PRESERVED', flush=True)
        raise


def restore(backup):
    backup = safe_path(backup)
    require(backup.parent == BACKUPS, 'UNEXPECTED_BACKUP_PATH')
    record = json.loads(regular(backup / 'record.json')[0])
    saved, root = service()
    require(record['root'] == str(root), 'ACTIVE_RELEASE_CHANGED')
    before = regular(backup / 'before.html')[0]
    target = root / 'web/index.html'
    current, info = regular(target)
    require(sha(before) == record['before'] and sha(current) == record['after'], 'ROLLBACK_HASH_MISMATCH')
    replace(target, current, before, info)
    for base in (LOCAL, PUBLIC):
        for route in ROUTES:
            served(base + route, before)
    require(properties() == saved, 'SERVICE_CHANGED')
    print('FTI_REGISTRATION_RECOVERY_RESTORED')


def install(release, apply=False):
    app = payload(release)
    saved, root = service()
    cfg = config()
    target = root / 'web/index.html'
    before, info = regular(target)
    paths = ['scripts/server.mjs', 'scripts/continuity-release.mjs', 'web/app.js',
             'web/vendor/walletconnect.js', 'landing/dist/index.html',
             'web/' + BASE + '/app.js', 'web/' + BASE + '/app.js.LEGAL.txt',
             'web' + REFERRAL + 'referral-context.js', 'web' + REFERRAL + 'entry.js']
    protected = {path: sha(regular(root / path)[0]) for path in paths}
    require(protected['web/' + BASE + '/app.js'] == BASE_APP and
            protected['web/' + BASE + '/app.js.LEGAL.txt'] == LEGAL, 'BASE_BUNDLE_MISMATCH')
    module = regular(root / ('web' + REFERRAL + 'referral-context.js'))[0]
    require(hashlib.sha1(b'blob ' + str(len(module)).encode() + b'\0' + module).hexdigest()
            == REFERRAL_BLOB, 'REFERRAL_MODULE_MISMATCH')
    after, assets = plan(before, app)
    for base in (LOCAL, PUBLIC):
        for route in ROUTES:
            served(base + route, before)
        for url in ('/' + BASE + '/app.js', REFERRAL + 'entry.js', REFERRAL + 'referral-context.js'):
            served(base + url, regular(root / ('web' + url))[0], True)
    node = node_executable(saved)
    for code in assets.values():
        subprocess.run([node, '--input-type=module', '--check'], input=code,
                       check=True, capture_output=True, timeout=20)
    require(properties() == saved, 'SERVICE_CHANGED_DURING_PREFLIGHT')
    if before == after:
        for url, data in assets.items():
            require(regular(root / ('web' + url))[0] == data, 'INSTALLED_ASSET_MISMATCH')
            for base in (LOCAL, PUBLIC):
                served(base + url, data, True)
        print('FTI_REGISTRATION_RECOVERY_ALREADY_INSTALLED', flush=True)
        return
    print('FTI_REGISTRATION_RECOVERY_PREFLIGHT_OK', flush=True)
    if not apply:
        return
    safe_path(BACKUPS)
    BACKUPS.mkdir(mode=0o700, exist_ok=True)
    require(BACKUPS.stat().st_uid == 0 and not BACKUPS.stat().st_mode & 0o077, 'PRIVATE_BACKUP_REQUIRED')
    backup = Path(tempfile.mkdtemp(prefix='install-', dir=BACKUPS))
    create(backup / 'before.html', before, 0o600)
    create(backup / 'record.json', json.dumps({'root': str(root), 'before': sha(before),
        'after': sha(after), 'protected': protected, 'app': sha(app)}).encode(), 0o600)
    create(backup / 'installer.py', regular(Path(__file__).resolve())[0], 0o600)
    print('ROLLBACK_COMMAND=python3 ' + str(backup / 'installer.py') + ' --restore ' + str(backup), flush=True)
    for url, data in assets.items():
        file = safe_path(root / ('web' + url))
        public_asset_directory(file.parent, {file.name: data})
        if file.exists():
            require(regular(file)[0] == data, 'IMMUTABLE_ASSET_MISMATCH')
        else:
            create(file, data)
        for base in (LOCAL, PUBLIC):
            served(base + url, data, True)

    def verify():
        for base in (LOCAL, PUBLIC):
            for route in ROUTES:
                served(base + route, after)
        config(cfg)
        require(properties() == saved, 'SERVICE_CHANGED')
        require(all(sha(regular(root / path)[0]) == value for path, value in protected.items()),
                'PROTECTED_RUNTIME_CHANGED')

    verify_before = {path: sha(regular(root / path)[0]) for path in paths}
    require(verify_before == protected and properties() == saved, 'RUNTIME_CHANGED_DURING_PREPARATION')
    switch(target, before, after, info, verify)
    print('FTI_REGISTRATION_RECOVERY_INSTALLED_NO_RESTART', flush=True)
    print('REAL_WALLET_REGISTRATION_NOT_TESTED', flush=True)


def package(root, output):
    app = regular(root / 'web/app.js')[0]
    require(sha(regular(root / 'web/app.js.LEGAL.txt')[0]) == LEGAL, 'LEGAL_NOTICE_CHANGED')
    release = {'schema': 'FTI_REGISTRATION_RECOVERY_UI_V1', 'sha256': sha(app),
               'gzipBase64': base64.b64encode(gzip.compress(app, mtime=0)).decode()}
    payload(release)
    source = regular(Path(__file__).resolve())[0].decode()
    text, count = re.subn(r'(# BEGIN EMBEDDED RELEASE\n).*?(\n# END EMBEDDED RELEASE)',
        lambda match: match[1] + 'RELEASE = json.loads(' + repr(json.dumps(release)) + ')' + match[2],
        source, flags=re.S)
    require(count == 1, 'PACKAGE_MARKER_MISMATCH')
    create(output, text.encode())
    print(json.dumps({'sha256': sha(text.encode()), 'appSHA256': sha(app)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--package', type=Path)
    group.add_argument('--restore', type=Path)
    group.add_argument('--apply', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.package:
        require(args.output is not None, 'PACKAGE_OUTPUT_REQUIRED')
        package(args.package.resolve(), args.output.resolve())
        return
    require(args.output is None and os.geteuid() == 0, 'RUN_ON_FTI_VPS_AS_ROOT')
    os.umask(0o077)
    with open('/run/lock/fti-service-cutover.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def interrupted(*_args):
            raise RuntimeError('INTERRUPTED')
        for sig in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, interrupted)
        if args.restore:
            restore(args.restore)
        else:
            install(RELEASE, args.apply)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('FTI_REGISTRATION_RECOVERY_STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
