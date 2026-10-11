#!/usr/bin/env python3
"""Install the reviewed member CSS on an identified, already running FTI server.

Presentation-only overlay: one immutable web asset and one HTML link. No git
checkout, dependency install, contract call, config rewrite or service restart.
The existing release fingerprint is NOT rewritten; overlay hashes are recorded
separately. This does not activate the parent branch's financial features.
"""
import argparse
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import urllib.request

THEME_REV = 'fd22458ee6b1ee87eac856fa76cfaf69be088d2d'
THEME_BLOB = '2d0e0e9c5c0e227f8997370ccce2ff3b81ebef39'
THEME_URL = ('https://raw.githubusercontent.com/Rezamoradifar/fti-protocol/'
             + THEME_REV + '/frontend/member-landing-theme.css')
ASSET = 'member-theme-' + THEME_REV[:12] + '.css'
MARKER = 'fti-member-theme-overlay-v1'
SERVER_BLOBS = {
    'a3bfcf8b3973fb3cad0ce03c5cff2ce560d71859',  # Installed continuity 2afdc682
    '66ab3d1dc1ecf757c37904f6077ed4fa155af0b9',  # Reviewed Builder API
}
BACKUPS = Path('/var/backups/fti-member-theme')


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def read_regular(file, limit=16_000_000):
    fd = os.open(str(file), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                and info.st_size <= limit, 'UNSUPPORTED_FILE')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            data = stream.read(limit + 1)
        require(len(data) <= limit, 'FILE_TOO_LARGE')
        return data, info
    finally:
        os.close(fd)


def atomic_replace(file, data, info):
    fd, temporary = tempfile.mkstemp(prefix='.fti-theme-', dir=str(file.parent))
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            os.fchmod(stream.fileno(), stat.S_IMODE(info.st_mode))
            if os.geteuid() == 0:
                os.fchown(stream.fileno(), info.st_uid, info.st_gid)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, file)
        directory = os.open(str(file.parent), os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def fetch(url, limit, local=False):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise RuntimeError('REDIRECT_NOT_ALLOWED')
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache'})
    with opener.open(request, timeout=25) as response:
        require(response.status == 200, 'HTTP_STATUS')
        data = response.read(limit + 1)
        require(len(data) <= limit, 'HTTP_RESPONSE_TOO_LARGE')
        return data, response.headers.get_content_type()


def local_get(port, route):
    return fetch('http://127.0.0.1:' + str(port) + route, 16_000_000, True)


def read_config(port):
    data, _ = local_get(port, '/api/config')
    cfg = json.loads(data)
    require(isinstance(cfg, dict) and cfg.get('chainId') == 97,
            'EXPECTED_BNB_TESTNET_CONFIG')
    require(cfg.get('binaryContract') in ('FundedBinaryPlanUpgradeable', 'FundedBinaryPlan')
            and cfg.get('tokenContract') in ('FTIReserveTokenUpgradeable', 'FTIReserveTokenV3'),
            'UNKNOWN_CONTRACT_MODELS')
    for key in ('binary', 'token', 'usd', 'council', 'timelock'):
        require(re.fullmatch(r'0x[0-9a-fA-F]{40}', str(cfg.get(key, '')))
                and int(cfg[key], 16) != 0, 'INVALID_PUBLIC_CONFIG')
    require(re.fullmatch(r'[0-9a-f]{40}', str(cfg.get('sourceRevision', ''))),
            'MISSING_SOURCE_REVISION')
    return cfg


def resolve_root(port):
    # Identify the process listening on the EXPLICIT port, not the newest folder.
    result = subprocess.run(['ss', '-H', '-ltnp', 'sport = :' + str(port)],
                            check=True, capture_output=True, text=True, timeout=10)
    pids = set(re.findall(r'pid=(\d+)', result.stdout))
    require(len(pids) == 1, 'PORT_MUST_HAVE_ONE_IDENTIFIABLE_PROCESS')
    pid = next(iter(pids))
    cwd = Path('/proc/' + pid + '/cwd').resolve(strict=True)
    # Read command arguments, never /proc/.../environ or any private key file.
    args = Path('/proc/' + pid + '/cmdline').read_bytes().split(b'\0')
    entries = [os.fsdecode(a) for a in args if a.endswith(b'/scripts/server.mjs')
               or a == b'scripts/server.mjs']
    require(len(entries) == 1, 'EXPECTED_DIRECT_FTI_SERVER_PROCESS')
    entry = Path(entries[0])
    entry = (cwd / entry).resolve(strict=True) if not entry.is_absolute() else entry.resolve(strict=True)
    root = entry.parent.parent
    require(entry.parent.name == 'scripts', 'UNEXPECTED_SERVER_PATH')
    require(blob(read_regular(entry)[0]) in SERVER_BLOBS, 'UNREVIEWED_SERVER_CODE')
    require(not (root / 'web').is_symlink(), 'SYMLINK_WEB_ROOT_NOT_SUPPORTED')
    return root, pid


def protected_hashes(root):
    files = [root / p for p in ('package.json', 'package-lock.json', 'web/app.js',
             'web/vendor/walletconnect.js', 'web/style.css')]
    for dirname in ('contracts', 'frontend', 'scripts', 'landing/src', 'artifacts'):
        folder = root / dirname
        if folder.exists():
            files += [p for p in folder.rglob('*') if p.is_file()
                      and p.suffix in ('.sol', '.mjs', '.jsx', '.js', '.css', '.json')]
    return {str(p.relative_to(root)): digest(read_regular(p)[0])
            for p in sorted(set(files)) if p.exists()}


def template(original, css):
    text = original.decode('utf-8')
    require(text.count('</head>') == 1 and 'style.css' in text and 'app.js' in text,
            'UNSUPPORTED_WORKSPACE_HTML')
    sri = base64.b64encode(hashlib.sha256(css).digest()).decode()
    link = ('<link id="' + MARKER + '" rel="stylesheet" href="./' + ASSET
            + '" integrity="sha256-' + sri + '">')
    if MARKER in text:
        require(text.count(link) == 1, 'EXISTING_OVERLAY_DIFFERS')
        return original
    require('member-landing-theme' not in text and ASSET not in text,
            'OTHER_MEMBER_THEME_ALREADY_PRESENT')
    return text.replace('</head>', link + '</head>').encode('utf-8')


def save_new(file, data, mode=0o600):
    fd = os.open(str(file), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        os.fchmod(stream.fileno(), mode)
        stream.flush()
        os.fsync(stream.fileno())


def apply_overlay(root, css, cfg, get, backup_base, identity_check=lambda: None):
    require(blob(css) == THEME_BLOB, 'THEME_INTEGRITY_FAILED')
    require(b'body[data-surface="member"]' in css, 'NOT_MEMBER_SCOPED_CSS')
    index = root / 'web/index.html'
    original, info = read_regular(index)
    require(get('/app/')[0] == original, 'PORT_DOES_NOT_SERVE_SELECTED_HTML')
    app = read_regular(root / 'web/app.js')[0]
    require(b'dataset.surface' in app and b'workspace-header' in app,
            'UNSUPPORTED_WORKSPACE_BUNDLE')
    require(get('/app/app.js')[0] == app, 'SERVED_BUNDLE_DIFFERS')
    protected = protected_hashes(root)
    patched = template(original, css)
    asset = root / 'web' / ASSET
    if asset.exists() or asset.is_symlink():
        require(read_regular(asset)[0] == css, 'EXISTING_ASSET_DIFFERS')
    if patched == original:
        require(get('/app/' + ASSET)[0] == css, 'EXISTING_ASSET_NOT_SERVED')
        return {'result': 'FTI_MEMBER_THEME_ALREADY_INSTALLED', 'root': str(root)}
    backup_base.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(not backup_base.is_symlink() and backup_base.stat().st_mode & 0o077 == 0,
            'BACKUP_DIRECTORY_MUST_BE_PRIVATE')
    backup = Path(tempfile.mkdtemp(prefix='install-', dir=str(backup_base)))
    save_new(backup / 'index.before.html', original)
    metadata = {'schema': 'FTI_MEMBER_THEME_OVERLAY_V1', 'root': str(root),
                'original': digest(original), 'installed': digest(patched),
                'themeRevision': THEME_REV, 'themeSHA256': digest(css),
                'configSHA256': digest(json.dumps(cfg, sort_keys=True).encode())}
    save_new(backup / 'record.json', json.dumps(metadata, indent=2).encode())
    try:
        identity_check()
        require(read_regular(index)[0] == original, 'HTML_CHANGED_DURING_INSTALL')
        if not asset.exists():
            save_new(asset, css, 0o644)
        served, mime = get('/app/' + ASSET)
        require(served == css and mime == 'text/css', 'CSS_HTTP_CHECK_FAILED')
        atomic_replace(index, patched, info)
        require(get('/app/')[0] == patched, 'HTML_HTTP_CHECK_FAILED')
        require(json.loads(get('/api/config')[0]) == cfg, 'CONFIG_CHANGED')
        identity_check()
        require(protected_hashes(root) == protected, 'APPLICATION_FILES_CHANGED')
    except BaseException:
        current = read_regular(index)[0]
        if current == patched:
            atomic_replace(index, original, info)
        elif current != original:
            raise RuntimeError('CONCURRENT_HTML_CHANGE_MANUAL_REVIEW_REQUIRED') from None
        # Leave the immutable CSS for clients that cached the intermediate HTML.
        raise
    return {'result': 'FTI_MEMBER_THEME_INSTALLED', 'root': str(root),
            'backup': str(backup), 'themeRevision': THEME_REV,
            'contractsChanged': False, 'servicesRestarted': False, 'fundsMoved': False}


def restore(root, backup, cfg):
    metadata = json.loads(read_regular(backup / 'record.json', 100_000)[0])
    require(metadata.get('schema') == 'FTI_MEMBER_THEME_OVERLAY_V1'
            and metadata.get('root') == str(root), 'WRONG_BACKUP_TARGET')
    require(metadata['configSHA256'] == digest(json.dumps(cfg, sort_keys=True).encode()),
            'CONFIG_CHANGED_SINCE_INSTALL')
    original = read_regular(backup / 'index.before.html')[0]
    current, info = read_regular(root / 'web/index.html')
    require(digest(original) == metadata['original'], 'BACKUP_INTEGRITY_FAILED')
    if current == original:
        return {'result': 'FTI_MEMBER_THEME_ALREADY_RESTORED'}
    require(digest(current) == metadata['installed'], 'HTML_CHANGED_SINCE_INSTALL')
    atomic_replace(root / 'web/index.html', original, info)
    return {'result': 'FTI_MEMBER_THEME_RESTORED', 'root': str(root)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', required=True, type=int)
    parser.add_argument('--apply', action='store_true', help='explicitly install the static theme')
    parser.add_argument('--restore', type=Path, help='restore a specific recorded backup')
    args = parser.parse_args()
    require(os.geteuid() == 0, 'RUN_AS_ROOT_ON_THE_FTI_SERVER')
    require(args.port in (3110, 3108), 'EXPLICIT_KNOWN_FTI_PORT_REQUIRED')
    require(not (args.apply and args.restore), 'CHOOSE_INSTALL_OR_RESTORE')
    root, pid = resolve_root(args.port)
    cfg = read_config(args.port)
    def identity():
        require(resolve_root(args.port) == (root, pid), 'SERVING_PROCESS_CHANGED')
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(not BACKUPS.is_symlink() and BACKUPS.stat().st_mode & 0o077 == 0,
            'BACKUP_DIRECTORY_MUST_BE_PRIVATE')
    lock = os.open(str(BACKUPS / ('lock-' + digest(str(root).encode())[:20])),
                   os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.restore:
            result = restore(root, args.restore.resolve(strict=True), cfg)
        elif not args.apply:
            result = {'result': 'FTI_THEME_TARGET_IDENTIFIED', 'root': str(root),
                      'port': args.port, 'sourceRevision': cfg['sourceRevision'],
                      'note': 'No theme installed. Add --apply to install.'}
        else:
            css, _ = fetch(THEME_URL, 100_000)
            result = apply_overlay(root, css, cfg, lambda route: local_get(args.port, route),
                                   BACKUPS, identity)
        print(json.dumps(result, indent=2))
    finally:
        os.close(lock)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not print command lines, response bodies, RPC credentials or env values.
        code = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print('FTI_MEMBER_THEME_FAILED: ' + code, file=sys.stderr)
        sys.exit(1)
