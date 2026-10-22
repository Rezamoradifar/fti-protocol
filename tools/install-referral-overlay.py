#!/usr/bin/env python3
"""Install a pinned referral bootstrap without rebuilding/restarting FTI.

Only versioned static JS and web/index.html are changed. The old app bundle,
backend source, release fingerprints, RPC settings and contracts are untouched.
Default: read-only preflight. --apply installs. --restore DIR rolls back the HTML.
"""
import argparse
import fcntl
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

REV = '6066738c777729fc65662b400dcebea0ad30d8ac'
MODULE_BLOB = '32c0099a90c32e183fcd66309fdaa78ec7c8801d'
REPO = 'Rezamoradifar/fti-protocol'
CI_RUN = 39805408449
UNIT = 'fti-continuity-web.service'
LOCAL = 'http://127.0.0.1:3110'
PUBLIC = 'https://ftiprotocol.com'
ROUTES = ('/app/', '/token/', '/admin/')
BACKUPS = Path('/var/backups/fti-referral-overlay')
CONFIG_KEYS = ('chainId', 'mode', 'binary', 'token', 'usd', 'council', 'timelock',
               'sourceRevision', 'sourceFingerprint', 'mainnetPlanDigest')
LIMIT = 16_000_000


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def read_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
                info.st_size <= LIMIT, 'UNSAFE_FILE')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            data = stream.read(LIMIT + 1)
        require(len(data) <= LIMIT, 'FILE_TOO_LARGE')
        return data, info
    finally:
        os.close(fd)


def safe_path(path):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'UNSAFE_PATH')
    current = Path('/')
    for part in path.parts[1:]:
        current /= part
        require(not current.is_symlink(), 'SYMLINK_REJECTED')
    return path


def run(args, **kwargs):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, timeout=30, **kwargs)


def properties():
    keys = ('WorkingDirectory', 'MainPID', 'User', 'Group', 'ActiveState',
            'SubState', 'NRestarts')
    args = ['systemctl', 'show', UNIT, '--no-pager']
    args += ['--property=' + key for key in keys]
    return dict(line.split('=', 1) for line in run(args).stdout.decode().splitlines()
                if '=' in line)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('HTTP_REDIRECT_REJECTED')


def fetch(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, headers={'User-Agent': 'FTI-Referral-Installer/1',
                                                  'Cache-Control': 'no-cache',
                                                  'Accept-Encoding': 'identity'})
    with opener.open(request, timeout=25) as response:
        require(response.status == 200, 'HTTP_NOT_200')
        data = response.read(LIMIT + 1)
        require(len(data) <= LIMIT, 'RESPONSE_TOO_LARGE')
        return data, response.headers.get_content_type()


def get_json(url):
    data, mime = fetch(url)
    require(mime == 'application/json', 'EXPECTED_JSON')
    result = json.loads(data)
    require(isinstance(result, dict) and not result.get('error'), 'INVALID_JSON_RESPONSE')
    return result


def check_ci(data):
    require(data.get('head_sha') == REV and data.get('name') == 'Protocol checks',
            'CI_REVISION_MISMATCH')
    require(data.get('status') == 'completed' and data.get('conclusion') == 'success',
            'CI_NOT_SUCCESS_NO_INSTALL')


def check_config(expected=None):
    cfg = get_json(LOCAL + '/api/config')
    require(cfg.get('chainId') == 56 and cfg.get('mode') == 'bnb-mainnet', 'WRONG_NETWORK')
    require(str(cfg.get('binary', '')).lower() ==
            '0x13ac3af4fe3e72dccffd52ab67e4d884b6d97df9', 'WRONG_BINARY')
    require(all(key in cfg for key in CONFIG_KEYS), 'INCOMPLETE_CONFIG')
    public = get_json(PUBLIC + '/api/config')
    values = {key: cfg[key] for key in CONFIG_KEYS}
    require(all(public.get(key) == value for key, value in values.items()),
            'PUBLIC_BACKEND_MISMATCH')
    if expected is not None:
        require(values == expected, 'BACKEND_CONFIG_CHANGED')
    get_json(LOCAL + '/api/state')
    return values


class EntryParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.entries = []
        self.has_base = False

    def handle_starttag(self, tag, attrs):
        if tag == 'base':
            self.has_base = True
        if tag != 'script':
            return
        require(len(attrs) == len({key for key, _ in attrs}), 'DUPLICATE_SCRIPT_ATTRIBUTE')
        values = dict(attrs)
        if values.get('type') == 'module':
            require(values.get('src') and not any(key in values for key in ('integrity', 'async')),
                    'UNSUPPORTED_MODULE_ENTRY')
            self.entries.append((self.get_starttag_text(), values['src']))


def plan_html(before, module):
    text = before.decode('utf-8')
    require('fti-referral-' not in text, 'OVERLAY_ALREADY_PRESENT_VERIFY_EXISTING_INSTALL')
    parser = EntryParser()
    parser.feed(text)
    require(not parser.has_base and len(parser.entries) == 1, 'UNEXPECTED_HTML_ENTRY')
    tag, src = parser.entries[0]
    require(re.fullmatch(r'(?:\./|/)?[A-Za-z0-9_./-]*app\.js(?:\?[A-Za-z0-9_.=&-]+)?', src),
            'UNEXPECTED_APP_URL')
    require(not src.startswith('//') and '..' not in src.split('/'), 'UNSAFE_APP_URL')
    urls = [urllib.parse.urljoin(route, src) for route in ROUTES]
    require(all(path.startswith('/') and not path.startswith('//') for path in urls),
            'UNSAFE_RESOLVED_URL')
    wrapper = ("import {installReferralContext} from './referral-context.js';\n"
               "installReferralContext(window);\n"
               'const entry = new URL(' + json.dumps(src) + ', document.baseURI);\n'
               "if(entry.origin !== location.origin) throw Error('FTI_ENTRY_ORIGIN');\n"
               'await import(entry.href);\n').encode()
    prefix = 'fti-referral-' + digest(module + b'\0' + wrapper)[:24]
    replacement = '/' + prefix + '/entry.js'
    pattern = r'(\bsrc\s*=\s*)([\"\x27])([^\"\x27]*)\2'
    new_tag, count = re.subn(pattern, lambda m: m[1] + m[2] + replacement + m[2], tag)
    require(count == 1 and text.count(tag) == 1, 'AMBIGUOUS_ENTRY_REWRITE')
    return text.replace(tag, new_tag, 1).encode(), prefix, wrapper, urls


def local_asset(root, url):
    path = urllib.parse.urlsplit(url).path
    for route in ROUTES:
        if path.startswith(route):
            path = '/' + path[len(route):]
            break
    require(path.startswith('/') and '..' not in path.split('/'), 'UNSAFE_ASSET')
    return safe_path(root / 'web' / path.lstrip('/'))


def verify_bytes(url, expected, javascript=False):
    actual, mime = fetch(url)
    require(actual == expected, 'HTTP_BYTES_MISMATCH')
    require(mime in ('text/javascript', 'application/javascript') if javascript
            else mime == 'text/html', 'HTTP_MIME_MISMATCH')


def atomic_replace(path, expected, data, info):
    current, current_info = read_file(path)
    require(current == expected and (current_info.st_uid, current_info.st_gid,
            stat.S_IMODE(current_info.st_mode)) == (info.st_uid, info.st_gid,
            stat.S_IMODE(info.st_mode)), 'CONCURRENT_FILE_EDIT')
    attrs = {key: os.getxattr(path, key) for key in os.listxattr(path)}
    fd, temp = tempfile.mkstemp(prefix='.fti-referral-', dir=path.parent)
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
        require(read_file(path)[0] == expected, 'CONCURRENT_FILE_EDIT')
        os.replace(temp, path)
        folder = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(folder)
        finally:
            os.close(folder)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def create_file(path, data, mode):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        os.fchmod(stream.fileno(), mode)
        stream.flush()
        os.fsync(stream.fileno())


def transaction(target, before, after, info, verify):
    try:
        atomic_replace(target, before, after, info)
        verify()
    except BaseException:
        current, now = read_file(target)
        if current == after:
            # Do not let a second ordinary termination signal interrupt recovery.
            for sig in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
                signal.signal(sig, signal.SIG_IGN)
            atomic_replace(target, after, before, now)
            print('FTI_REFERRAL_HTML_ROLLED_BACK', flush=True)
        elif current != before:
            print('CONCURRENT_HTML_EDIT_PRESERVED_USE_BACKUP', flush=True)
        raise


def restore(backup):
    backup = safe_path(backup)
    require(backup.parent == BACKUPS, 'UNEXPECTED_BACKUP_PATH')
    record = json.loads(read_file(backup / 'record.json')[0])
    root = safe_path(record['root'])
    require(root.parent == Path('/opt/fti/releases'), 'UNEXPECTED_RELEASE')
    target = safe_path(root / 'web/index.html')
    before = read_file(backup / 'before.html')[0]
    current, info = read_file(target)
    require(digest(before) == record['before'], 'BACKUP_HASH_MISMATCH')
    require(digest(current) == record['after'], 'HTML_CHANGED_SINCE_INSTALL')
    atomic_replace(target, current, before, info)
    for base in (LOCAL, PUBLIC):
        verify_bytes(base + '/app/', before)
    print('FTI_REFERRAL_RESTORED')


def install(apply=False):
    saved = properties()
    require(saved.get('ActiveState') == 'active' and saved.get('SubState') == 'running'
            and int(saved.get('MainPID', 0)) > 0, 'WEB_NOT_RUNNING_NO_CHANGES')
    require(saved.get('User') == 'fti-v3' and saved.get('Group') == 'fti-v3',
            'UNEXPECTED_SERVICE_IDENTITY')
    root = safe_path(saved['WorkingDirectory'])
    require(root.parent == Path('/opt/fti/releases') and root.is_dir(), 'UNEXPECTED_RELEASE')
    require(Path('/proc/' + saved['MainPID'] + '/cwd').resolve() == root, 'PROCESS_CWD_MISMATCH')
    cfg = check_config()
    target = safe_path(root / 'web/index.html')
    before, info = read_file(target)
    for base in (LOCAL, PUBLIC):
        for route in ROUTES:
            verify_bytes(base + route, before)
    module, _ = fetch('https://raw.githubusercontent.com/' + REPO + '/' + REV +
                      '/frontend/referral-context.js')
    require(blob(module) == MODULE_BLOB, 'REFERRAL_MODULE_HASH_MISMATCH')
    after, prefix, wrapper, urls = plan_html(before, module)
    node = str(Path('/proc/' + saved['MainPID'] + '/exe').resolve(strict=True))
    for code in (module, wrapper):
        run([node, '--input-type=module', '--check'], input=code)
    protected_paths = {'scripts/server.mjs', 'scripts/continuity-release.mjs',
                       'scripts/referral-placement-index.mjs', 'web/app.js',
                       'web/vendor/walletconnect.js'}
    for url in urls:
        asset = local_asset(root, url)
        old = read_file(asset)[0]
        require(b'fti:registration-referrer:v1' not in old, 'FIX_ALREADY_IN_BUNDLE')
        protected_paths.add(str(asset.relative_to(root)))
        for base in (LOCAL, PUBLIC):
            verify_bytes(base + url, old, True)
    protected = {p: digest(read_file(safe_path(root / p))[0]) for p in protected_paths}
    ci = get_json('https://api.github.com/repos/' + REPO + '/actions/runs/' + str(CI_RUN))
    check_ci(ci)
    print('FTI_REFERRAL_PREFLIGHT_OK', flush=True)
    if not apply:
        return
    safe_path(BACKUPS)
    BACKUPS.mkdir(mode=0o700, exist_ok=True)
    require(BACKUPS.stat().st_uid == 0 and not BACKUPS.stat().st_mode & 0o077,
            'PRIVATE_BACKUP_DIRECTORY_REQUIRED')
    backup = Path(tempfile.mkdtemp(prefix='install-', dir=BACKUPS))
    record = dict(root=str(root), before=digest(before), after=digest(after),
                  prefix=prefix, sourceCommit=REV, moduleBlob=MODULE_BLOB,
                  protected=protected, config=cfg, service=saved)
    create_file(backup / 'before.html', before, 0o600)
    create_file(backup / 'record.json', json.dumps(record, indent=2).encode(), 0o600)
    create_file(backup / 'installer.py', read_file(Path(__file__))[0], 0o600)
    print('BACKUP=' + str(backup), flush=True)
    print('ROLLBACK_COMMAND=python3 ' + str(backup / 'installer.py') + ' --restore ' + str(backup), flush=True)
    destination = safe_path(root / 'web' / prefix)
    if not destination.exists():
        destination.mkdir(mode=0o755)
        destination.chmod(0o755)
    require(destination.is_dir() and destination.stat().st_uid == 0 and
            not destination.stat().st_mode & 0o022, 'UNSAFE_ASSET_DIRECTORY')
    for name, content in (('referral-context.js', module), ('entry.js', wrapper)):
        file = safe_path(destination / name)
        if file.exists():
            require(read_file(file)[0] == content, 'EXISTING_ASSET_DIFFERS')
        else:
            create_file(file, content, 0o644)
        run(['runuser', '-u', 'fti-v3', '--', 'test', '-r', str(file)])
        for base in (LOCAL, PUBLIC):
            verify_bytes(base + '/' + prefix + '/' + name, content, True)
    run(['runuser', '-u', 'fti-v3', '--', 'test', '-r', str(target)])
    require(properties() == saved, 'SERVICE_CHANGED_DURING_PREFLIGHT')

    def verify():
        for base in (LOCAL, PUBLIC):
            for route in ROUTES:
                verify_bytes(base + route, after)
        check_config(cfg)
        require(properties() == saved, 'SERVICE_CHANGED_DURING_INSTALL')
        require(all(digest(read_file(root / p)[0]) == value for p, value in protected.items()),
                'PROTECTED_RUNTIME_CHANGED')

    transaction(target, before, after, info, verify)
    print('FTI_REFERRAL_INSTALLED_NO_RESTART', flush=True)
    print('WALLET_SIGNING_AND_REGISTRATION_NOT_TESTED', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--apply', action='store_true')
    group.add_argument('--restore', type=Path)
    args = parser.parse_args()
    require(os.geteuid() == 0, 'RUN_ON_FTI_VPS_AS_ROOT')
    os.umask(0o077)
    with open('/run/lock/fti-service-cutover.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def interrupted(*_):
            raise RuntimeError('INTERRUPTED')
        for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            signal.signal(sig, interrupted)
        if args.restore:
            restore(args.restore)
        else:
            install(args.apply)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('FTI_REFERRAL_STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
