#!/usr/bin/env python3
"""Install a presentation-only official-channel overlay. Default: read-only preflight."""
import argparse
import fcntl
import hashlib
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

UNIT = 'fti-continuity-web.service'
ORIGINS = ('http://127.0.0.1:3110', 'https://ftiprotocol.com')
BACKUPS = Path('/var/backups/fti-telegram-site-link')
LOCK = '/run/lock/fti-service-cutover.lock'
LIMIT = 4_000_000
# BEGIN EMBEDDED JS
EMBEDDED_JS = "// Tiny presentation-only overlay for installed releases awaiting a full rebuild.\nexport const OFFICIAL_TELEGRAM = 'https://t.me/FTIProtocol_Official';\nconst hosts = new Set(['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me']);\nconst handles = new Set(['/ftiprotocol', '/fti_protocol', '/ftiprotocol_official']);\n\nexport function updateTelegramLinks(root) {\n  const anchors = [];\n  if (root?.matches?.('a[href]')) anchors.push(root);\n  if (root?.querySelectorAll) anchors.push(...root.querySelectorAll('a[href]'));\n  for (const anchor of anchors) {\n    let url;\n    try { url = new URL(anchor.getAttribute('href'), 'https://ftiprotocol.com/'); }\n    catch { continue; }\n    if (!['https:', 'http:'].includes(url.protocol) || !hosts.has(url.hostname.toLowerCase()) ||\n        !handles.has(url.pathname.replace(/\\/$/, '').toLowerCase())) continue;\n    if (anchor.getAttribute('href') !== OFFICIAL_TELEGRAM) anchor.setAttribute('href', OFFICIAL_TELEGRAM);\n    for (const label of anchor.querySelectorAll('small')) {\n      const text = label.textContent.trim();\n      if (/^@(?:FTIProtocol|fti_protocol)$/i.test(text)) label.textContent = '@FTIProtocol_Official';\n    }\n    for (const node of anchor.childNodes) {\n      if (node.nodeType !== 3) continue;\n      const text = node.textContent.trim();\n      if (/^@(?:FTIProtocol|fti_protocol)$/i.test(text)) node.textContent = '@FTIProtocol_Official';\n      else if (/^https?:\\/\\/(?:t\\.me|telegram\\.me)\\/(?:FTIProtocol|fti_protocol)\\/?$/i.test(text)) node.textContent = OFFICIAL_TELEGRAM;\n    }\n    for (const name of ['title', 'aria-label']) {\n      const value = anchor.getAttribute(name);\n      if (value && /@(?:FTIProtocol|fti_protocol)(?!_Official)\\b/i.test(value)) {\n        anchor.setAttribute(name, value.replace(/@(?:FTIProtocol|fti_protocol)(?!_Official)\\b/gi, '@FTIProtocol_Official'));\n      }\n    }\n  }\n}\n\nif (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {\n  updateTelegramLinks(document);\n  new MutationObserver(records => {\n    for (const record of records) {\n      if (record.type === 'attributes') updateTelegramLinks(record.target);\n      else {\n        updateTelegramLinks(record.target.closest?.('a[href]'));\n        for (const node of record.addedNodes) updateTelegramLinks(node);\n      }\n    }\n  }).observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['href']});\n}\n"
# END EMBEDDED JS


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe(path):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'UNSAFE_PATH')
    for item in (path, *path.parents):
        require(not item.is_symlink(), 'SYMLINK_REJECTED')
    return path


def read(path):
    safe(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= LIMIT, 'UNSAFE_FILE')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            data = stream.read(LIMIT + 1)
        require(len(data) <= LIMIT, 'FILE_TOO_LARGE')
        return data, info
    finally:
        os.close(fd)


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def create(path, data, mode=0o600):
    safe(path)
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        os.fchmod(stream.fileno(), mode)
        stream.flush()
        os.fsync(stream.fileno())
    sync(path.parent)


def replace(path, before, after, info):
    current, actual = read(path)
    fields = ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_mtime_ns')
    require(current == before and all(getattr(actual, k) == getattr(info, k) for k in fields), 'CONCURRENT_HTML_EDIT')
    attrs = {k: os.getxattr(path, k) for k in os.listxattr(path)}
    fd, temporary = tempfile.mkstemp(prefix='.fti-official-channel-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(after)
            if os.geteuid() == 0:
                os.fchown(stream.fileno(), info.st_uid, info.st_gid)
            os.fchmod(stream.fileno(), stat.S_IMODE(info.st_mode))
            for key, value in attrs.items():
                os.setxattr(stream.fileno(), key, value)
            stream.flush()
            os.fsync(stream.fileno())
        require(read(path)[0] == before, 'CONCURRENT_HTML_EDIT')
        os.replace(temporary, path)
        sync(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args):
        raise RuntimeError('HTTP_REDIRECT_REJECTED')


def fetch(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(urllib.request.Request(url, headers={'Cache-Control': 'no-cache',
            'Accept-Encoding': 'identity', 'User-Agent': 'FTI-Official-Channel/1'}), timeout=20) as response:
        data = response.read(LIMIT + 1)
        require(response.status == 200 and len(data) <= LIMIT, 'HTTP_200_REQUIRED')
        return data, response.headers.get_content_type()


def served(route, data, kind='html'):
    for origin in ORIGINS:
        actual, mime = fetch(origin + route)
        require(actual == data, 'HTTP_BYTES_MISMATCH:' + route)
        require(mime in ({'text/html'} if kind == 'html' else {'text/javascript', 'application/javascript'}), 'HTTP_MIME_MISMATCH')


def config(expected=None):
    values = []
    for origin in ORIGINS:
        data, mime = fetch(origin + '/api/config')
        value = json.loads(data)
        require(mime == 'application/json' and isinstance(value, dict), 'INVALID_API_CONFIG')
        values.append(value)
    require(values[0] == values[1] and (expected is None or values[0] == expected), 'API_CONFIG_CHANGED')
    return values[0]


def properties():
    keys = ('WorkingDirectory', 'MainPID', 'User', 'Group', 'ActiveState', 'SubState', 'NRestarts')
    result = subprocess.run(['systemctl', 'show', UNIT, '--no-pager', *['--property=' + k for k in keys]],
                            check=True, capture_output=True, timeout=15)
    return dict(line.split('=', 1) for line in result.stdout.decode().splitlines() if '=' in line)


def service():
    saved = properties()
    require(saved.get('User') == saved.get('Group') == 'fti-v3' and saved.get('ActiveState') == 'active'
            and saved.get('SubState') == 'running' and re.fullmatch(r'[1-9][0-9]*', saved.get('MainPID', ''))
            and int(saved['MainPID']) > 1, 'UNEXPECTED_SERVICE')
    root = safe(saved['WorkingDirectory'])
    process = Path('/proc') / saved['MainPID']
    command = (process / 'cmdline').read_bytes()[:16384].split(b'\0')
    require(root.parent == Path('/opt/fti/releases') and root.is_dir() and (process / 'cwd').resolve() == root
            and any(value.decode(errors='replace') in {'scripts/server.mjs', './scripts/server.mjs', str(root / 'scripts/server.mjs')}
                    for value in command), 'UNEXPECTED_SERVER_PROCESS')
    return saved, root


def plan(root, url):
    server = read(root / 'scripts/server.mjs')[0]
    require(b'PUBLIC_ROUTES' in server and b'landing/dist' in server and b"'web'" in server, 'UNEXPECTED_STATIC_ROUTING')
    routing = read(root / 'scripts/site-routing.mjs')[0] if (root / 'scripts/site-routing.mjs').exists() else server
    match = re.search(rb'\bPUBLIC_ROUTES\s*=\s*\[([^\]]+)\]', routing)
    require(match is not None, 'PUBLIC_ROUTES_NOT_FOUND')
    routes = re.findall(rb"['\"](/[a-z][a-z0-9-]{0,40}/)['\"]", match[1])
    require(0 < len(routes) <= 30 and len(routes) == len(set(routes)), 'UNSAFE_PUBLIC_ROUTES')
    candidates = list((root / 'landing/dist').glob('*/index.html'))
    require(len(candidates) <= 30, 'TOO_MANY_PUBLIC_PAGES')
    targets = [(root / 'web/index.html', ['/app/', '/token/', '/admin/']), (root / 'landing/dist/index.html', ['/'])]
    targets += [(root / ('landing/dist' + route.decode() + 'index.html'), [route.decode()]) for route in routes
                if (root / ('landing/dist' + route.decode() + 'index.html')).exists()]
    tag = ('<script type="module" src="' + url + '"></script>').encode()
    result = []
    for path, endpoints in targets:
        before, info = read(path)
        require(before.lower().count(b'</body>') == 1, 'ONE_BODY_CLOSE_REQUIRED')
        found = re.findall(rb'<script\b[^>]*\bsrc\s*=\s*["\'][^"\']*fti-official-channel-[^"\']*["\'][^>]*></script>', before, flags=re.I)
        require(not found or (found == [tag] and before.count(tag) == 1), 'CONFLICTING_CHANNEL_OVERLAY')
        after = before if found else re.sub(rb'</body>', lambda m: tag + b'\n' + m[0], before, count=1, flags=re.I)
        result.append((path, endpoints, before, after, info))
    return result


def record_write(backup, record):
    path = backup / 'record.json'
    data = json.dumps(record, indent=2, sort_keys=True).encode()
    if path.exists():
        before, info = read(path)
        replace(path, before, data, info)
    else:
        create(path, data)


def verify(saved, cfg, entries, after=True):
    for _path, routes, before, updated, _info in entries:
        for route in routes:
            served(route, updated if after else before)
    config(cfg)
    require(properties() == saved, 'SERVICE_CHANGED_NO_RESTART_PERFORMED')


def install(apply=False):
    code = EMBEDDED_JS.encode()
    require(0 < len(code) < 100_000 and b'https://t.me/FTIProtocol_Official' in code, 'EMBEDDED_OVERLAY_REQUIRED')
    url = '/fti-official-channel-' + sha(code)[:24] + '/official-channel.js'
    saved, root = service()
    cfg, entries = config(), plan(root, url)
    asset = safe(root / ('web' + url))
    if asset.exists():
        require(read(asset)[0] == code, 'IMMUTABLE_ASSET_COLLISION')
    verify(saved, cfg, entries, False)
    if all(before == after for _p, _r, before, after, _i in entries):
        require(read(asset)[0] == code, 'INSTALLED_ASSET_MISSING')
        served(url, code, 'js')
        print('FTI_OFFICIAL_CHANNEL_ALREADY_INSTALLED_NO_RESTART')
        return
    print('FTI_OFFICIAL_CHANNEL_PREFLIGHT_OK_NO_RESTART')
    if not apply:
        return
    safe(BACKUPS).mkdir(mode=0o700, parents=True, exist_ok=True)
    require(BACKUPS.stat().st_uid == os.geteuid() and not BACKUPS.stat().st_mode & 0o077, 'PRIVATE_BACKUP_REQUIRED')
    backup = Path(tempfile.mkdtemp(prefix='install-', dir=BACKUPS))
    sync(BACKUPS)
    record = {'root': str(root), 'asset': url, 'asset_sha256': sha(code), 'state': 'intent', 'entries': [], 'intents': []}
    for n, (path, routes, before, after, _info) in enumerate(entries):
        create(backup / (str(n) + '.html'), before)
        record['entries'].append({'path': str(path.relative_to(root)), 'routes': routes,
                                  'before': sha(before), 'after': sha(after), 'backup': str(n) + '.html'})
    create(backup / 'installer.py', read(Path(__file__).resolve())[0])
    record_write(backup, record)
    print('RESTORE_COMMAND=python3 ' + str(backup / 'installer.py') + ' --restore ' + str(backup), flush=True)
    try:
        safe(asset.parent).mkdir(mode=0o755, exist_ok=True)
        require(asset.parent.stat().st_uid == os.geteuid() and not asset.parent.stat().st_mode & 0o022, 'UNSAFE_ASSET_DIRECTORY')
        os.chmod(asset.parent, 0o755)
        if not asset.exists():
            temporary = asset.parent / ('.upload-' + os.urandom(8).hex())
            create(temporary, code, 0o644)
            try:
                os.link(temporary, asset, follow_symlinks=False)
            finally:
                temporary.unlink()
            sync(asset.parent)
            sync(asset.parent.parent)
        require(read(asset)[0] == code, 'IMMUTABLE_ASSET_COLLISION')
        served(url, code, 'js')
        require(properties() == saved, 'SERVICE_CHANGED')
        for path, _routes, before, after, info in entries:
            if before != after:
                record['intents'].append(str(path.relative_to(root)))
                record_write(backup, record)
                replace(path, before, after, info)
        verify(saved, cfg, entries)
        record['state'] = 'verified'
        record_write(backup, record)
    except BaseException:
        complete = True
        for path, _routes, before, after, _info in reversed(entries):
            try:
                current, info = read(path)
                if before != after and current == after:
                    replace(path, after, before, info)
                elif current != before:
                    raise RuntimeError('CONCURRENT_HTML_EDIT')
            except Exception:
                complete = False
                print('CONCURRENT_HTML_EDIT_PRESERVED_REVIEW:' + str(path), flush=True)
        print('FTI_OFFICIAL_CHANNEL_' + ('ROLLED_BACK' if complete else 'ROLLBACK_REVIEW_REQUIRED') + '_NO_RESTART', flush=True)
        raise
    print('FTI_OFFICIAL_CHANNEL_INSTALLED_NO_RESTART', flush=True)


def restore(backup):
    backup = safe(backup)
    require(backup.parent == BACKUPS, 'UNEXPECTED_BACKUP_PATH')
    record = json.loads(read(backup / 'record.json')[0])
    saved, root = service()
    require(record['root'] == str(root), 'ACTIVE_RELEASE_CHANGED')
    cfg, entries = config(), []
    for item in record['entries']:
        require(re.fullmatch(r'(web/index.html|landing/dist/(?:[a-z][a-z0-9-]{0,40}/)?index.html)', item['path'])
                and re.fullmatch(r'[0-9]+\.html', item['backup']), 'INVALID_BACKUP_ENTRY')
        path, before = safe(root / item['path']), read(backup / item['backup'])[0]
        current, info = read(path)
        require(sha(before) == item['before'] and sha(current) in {item['before'], item['after']}, 'RESTORE_CONFLICT_NO_CLOBBER')
        entries.append((path, item['routes'], before, current, info))
    for path, _routes, before, current, info in entries:
        if before != current:
            replace(path, current, before, info)
    verify(saved, cfg, entries, False)
    print('FTI_OFFICIAL_CHANNEL_RESTORED_NO_RESTART')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--restore', type=Path)
    args = parser.parse_args(argv)
    if not args.apply and not args.restore:
        install()
        return
    require(os.geteuid() == 0, 'ROOT_REQUIRED_FOR_APPLY_OR_RESTORE')
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
        restore(args.restore) if args.restore else install(True)


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print('FTI_OFFICIAL_CHANNEL_STOPPED:' + (str(error) if isinstance(error, RuntimeError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
