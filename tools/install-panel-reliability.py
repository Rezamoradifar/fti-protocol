#!/usr/bin/env python3
"""Install the packaged panel reliability update, without a build or restart.

Default is read-only preflight. --apply publishes immutable JS/CSS/art and atomically
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
BACKUPS = Path('/var/backups/fti-panel-reliability')
BASE = 'fti-mainnet-ui-eead15d141fbbc07'
BASE_APP = 'a6ed0da9729698dd66d3db996e8d1dc370d0fd6bd088d0d1730c8f7ab3dcfacc'
LEGAL = '573cc95a6417c69a6ca44804f440f00965283c8cdcc50025305a7a50f53940ac'
REFERRAL = '/fti-referral-c6abd61ddf79782e795c2484/'
REFERRAL_BLOB = '32c0099a90c32e183fcd66309fdaa78ec7c8801d'
CURRENT_APP_SHA = '26a077538e86dc33fc5b7f9ca719730ef95c0df41203188747dd401681fb8835'
CURRENT_APP = '/' + BASE + '/app-member-reserve-' + CURRENT_APP_SHA[:20] + '.js'
CURRENT_ENTRY = '/fti-member-reserve-9c9273e8a6637861d8b3/entry.js'
CURRENT_CSS = '/fti-member-reserve-theme-43c907b32da4849cc469/theme.css'
CURRENT_CSS_SHA = '1b343e4eb4dee16373092cef8b9b89b59558583bd941bf79f74e53ab14cd5538'
CURRENT_IMAGE = '/fti-member-reserve-theme-43c907b32da4849cc469/member-reserve-flow-27f8968f3353a95e51b1.webp'
CURRENT_IMAGE_SHA = '27f8968f3353a95e51b14df74943bfd723909a408043eff0a305cdb6892e705d'
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
    fd, name = tempfile.mkstemp(prefix='.fti-panel-reliability-', dir=path.parent)
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
        'Accept-Encoding': 'identity', 'User-Agent': 'FTI-Panel-Reliability/1'})
    try:
        with opener.open(request, timeout=20) as response:
            data = response.read(LIMIT + 1)
            require(response.status == 200 and len(data) <= LIMIT, 'INVALID_HTTP_RESPONSE')
            return data, response.headers.get_content_type()
    except urllib.error.HTTPError as error:
        raise RuntimeError('HTTP_STATUS_' + str(error.code) + ': ' + url) from None


def served(url, data, kind='html'):
    actual, mime = fetch(url)
    require(actual == data, 'HTTP_BYTES_MISMATCH')
    allowed = {'html': ('text/html',), 'js': ('text/javascript', 'application/javascript'),
               'css': ('text/css',), 'webp': ('image/webp',)}
    require(kind in allowed and mime in allowed[kind], 'HTTP_MIME_MISMATCH')


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


def compressed(data):
    return {'sha256': sha(data), 'gzipBase64': base64.b64encode(gzip.compress(data, mtime=0)).decode()}


def unpack(item):
    require(isinstance(item, dict) and isinstance(item.get('sha256'), str) and
            re.fullmatch('[0-9a-f]{64}', item['sha256']) and
            isinstance(item.get('gzipBase64'), str) and len(item['gzipBase64']) <= LIMIT,
            'INVALID_RELEASE')
    with gzip.GzipFile(fileobj=io.BytesIO(base64.b64decode(item['gzipBase64'], validate=True))) as stream:
        data = stream.read(LIMIT + 1)
    require(len(data) <= LIMIT and sha(data) == item['sha256'], 'RELEASE_HASH_MISMATCH')
    return data


def image_name(image):
    return 'member-reserve-flow-' + sha(image)[:20] + '.webp'


def validate_image(image):
    require(20 <= len(image) <= 300_000 and image[:4] == b'RIFF' and
            image[8:12] == b'WEBP' and image[12:16] in (b'VP8 ', b'VP8L', b'VP8X') and
            int.from_bytes(image[4:8], 'little') + 8 == len(image), 'INVALID_WEBP_ASSET')


def validate_css(css, image):
    try:
        text = css.decode('utf8')
    except UnicodeDecodeError:
        raise RuntimeError('INVALID_PANEL_STYLESHEET') from None
    expected = image_name(image)
    urls = re.findall(r'url\(([^)]+)\)', text, flags=re.I)
    require(len(css) <= 200_000 and 'data-surface' in text and 'member' in text and
            not re.search(r'@import|https?:|data:|javascript:', text, flags=re.I) and
            len(urls) == 1 and urls[0].strip(' \t\r\n\"\'') in (expected, './' + expected),
            'INVALID_PANEL_STYLESHEET')


def boot_fragments(index):
    styles = re.findall(rb'<style data-fti-boot-style>.*?</style>', index, flags=re.S)
    shells = re.findall(rb'<div id="root"><!-- FTI_BOOT_FALLBACK_BEGIN -->.*?'
                        rb'<!-- FTI_BOOT_FALLBACK_END --></div><noscript>.*?</noscript>', index, flags=re.S)
    require(len(styles) == len(shells) == 1, 'BOOT_MARKER_MISMATCH')
    return styles[0], shells[0]


def validate_boot(boot, style, shell):
    require(len(boot) <= 100_000 and b'data-fti-boot' in boot and
            b'location.reload' in boot and b'data-fti-app-entry' in boot,
            'INVALID_BOOT_GUARD')
    require(len(style) <= 20_000 and style.startswith(b'<style data-fti-boot-style>') and
            style.endswith(b'</style>') and style.count(b'<style') == style.count(b'</style>') == 1 and
            not re.search(rb'@import|url\s*\(|expression\s*\(|<script', style, flags=re.I),
            'INVALID_BOOT_STYLE')
    require(len(shell) <= 40_000 and boot_fragments(style + shell) == (style, shell) and
            shell.count(b'data-fti-boot data-state="loading"') == 1 and
            b'<a href="" target="_blank" rel="noopener" data-fti-boot-retry>' in shell and
            not re.search(rb'<script|<iframe|<object|<embed|<img|<link|<style|\son[a-z]+\s*=|'
                          rb'\bsrc\s*=|\bhref\s*=(?!"")', shell, flags=re.I), 'INVALID_BOOT_SHELL')


def payload(release):
    require(isinstance(release, dict) and release.get('schema') == 'FTI_PANEL_RELIABILITY_V1',
            'PACKAGED_INSTALLER_REQUIRED')
    keys = ('app', 'css', 'image', 'boot', 'style', 'shell')
    require(set(release) == {'schema', *keys}, 'INVALID_RELEASE')
    app, css, image, boot, style, shell = (unpack(release.get(key)) for key in keys)
    require(b'./vendor/ethers.js' in app and b'retry-pending-check' in app and
            b'member-reserve' in app, 'UNEXPECTED_BUNDLE')
    validate_image(image)
    validate_css(css, image)
    validate_boot(boot, style, shell)
    return app, css, image, boot, style, shell


def entry_code(app_url):
    return ("import {installReferralContext} from '" + REFERRAL + "referral-context.js';\n"
            "installReferralContext(window);\nawait import('" + app_url + "');\n").encode()


def plan(before, app, css, image, boot, style, shell):
    app_url = '/' + BASE + '/app-panel-reliability-' + sha(app)[:20] + '.js'
    entry = entry_code(app_url)
    prefix = '/fti-panel-reliability-' + sha(entry + boot + style + shell)[:20] + '/'
    entry_url, boot_url = prefix + 'entry.js', prefix + 'boot-guard.js'
    theme = '/fti-panel-reliability-theme-' + sha(css + image)[:20] + '/'
    css_url = theme + 'theme.css'
    old_script = ('<script type="module" src="' + CURRENT_ENTRY + '"></script>').encode()
    new_script = ('<script defer src="' + boot_url + '" data-fti-boot-guard></script>'
                  '<script type="module" src="' + entry_url + '" data-fti-app-entry></script>').encode()
    old_link = ('<link rel="stylesheet" href="' + CURRENT_CSS + '">').encode()
    new_link = ('<link rel="stylesheet" href="' + css_url + '">').encode()
    assets = {app_url: (app, 'js'), entry_url: (entry, 'js'), boot_url: (boot, 'js'),
              css_url: (css, 'css'), theme + image_name(image): (image, 'webp')}
    require(b'<base' not in before.lower() and before.count(b'</head>') == 1 and
            before.count(b'<div id="root">') == 1,
            'UNRECOGNIZED_INSTALLED_ENTRY')
    if before.count(new_script) == 1:
        require(before.count(new_link) == before.count(style) == before.count(shell) == 1 and
                before.count(b'fti-panel-reliability-theme-') == 1 and
                len(re.findall(rb'<script\b', before, flags=re.I)) == 2 and
                before.count(b'data-fti-boot-style') == before.count(b'data-fti-boot-guard') == 1 and
                before.count(b'FTI_BOOT_FALLBACK_BEGIN') == before.count(b'FTI_BOOT_FALLBACK_END') == 1 and
                CURRENT_ENTRY.encode() not in before and CURRENT_CSS.encode() not in before,
                'INSTALLED_RELIABILITY_MARKUP_MISMATCH')
        return before, assets
    require(before.count(old_script) == 1 and before.count(old_link) == 1 and
            len(re.findall(rb'<script\b', before, flags=re.I)) == 1 and
            before.count(b'fti-member-reserve-theme-') == 1 and
            not re.search(rb'data-fti-boot|FTI_BOOT_FALLBACK|fti-panel-reliability-', before),
            'UNRECOGNIZED_INSTALLED_ENTRY')
    roots = re.findall(rb'<div id="root"></div><noscript>[^<]*</noscript>', before)
    require(len(roots) == 1, 'UNRECOGNIZED_ROOT_SHELL')
    after = before.replace(old_script, new_script, 1).replace(old_link, new_link, 1)
    after = after.replace(roots[0], shell, 1).replace(b'</head>', style + b'</head>', 1)
    return after, assets


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
        if not re.fullmatch(r'fti-panel-reliability-(?:theme-)?[0-9a-f]{20}', path.name):
            return
        names = set(os.listdir(fd))
        require(info.st_uid == 0 and names <= set(expected), 'UNSAFE_PRIVATE_ASSET_DIRECTORY')
        for name in names:
            existing_asset(path / name, expected[name])
        if info.st_mode & 0o005 != 0o005:
            # main() deliberately uses umask 0077 for private backups. Public
            # entry directories need explicit traversal/read permissions, also
            # when retrying the 0700 directory left by an older installer.
            os.fchmod(fd, 0o755)
        require(os.fstat(fd).st_mode & 0o005 == 0o005, 'ASSET_DIRECTORY_NOT_PUBLIC')
    finally:
        os.close(fd)


def existing_asset(path, expected):
    data, info = regular(path)
    require(data == expected, 'IMMUTABLE_ASSET_MISMATCH')
    require(info.st_uid == 0 and not info.st_mode & 0o022, 'UNSAFE_ASSET_FILE')
    return info


def publish_asset(path, data):
    if not path.exists():
        fd, name = tempfile.mkstemp(prefix='.fti-panel-reliability-', dir=path.parent)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
                os.fchmod(stream.fileno(), 0o644)
                stream.flush()
                os.fsync(stream.fileno())
            # A partial write must never occupy the immutable final URL. Link
            # only complete durable bytes and refuse to overwrite a collision.
            try:
                os.link(name, path, follow_symlinks=False)
            except FileExistsError:
                existing_asset(path, data)
        finally:
            os.unlink(name)
            sync_directory(path.parent)
        return
    info = existing_asset(path, data)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        now = os.fstat(fd)
        require((now.st_dev, now.st_ino, now.st_uid, now.st_mode, now.st_mtime_ns) ==
                (info.st_dev, info.st_ino, info.st_uid, info.st_mode, info.st_mtime_ns),
                'ASSET_CHANGED_DURING_PREPARATION')
        os.fchmod(fd, 0o644)
        os.fsync(fd)
    finally:
        os.close(fd)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
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
            print('FTI_PANEL_RELIABILITY_ROLLED_BACK', flush=True)
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
    print('FTI_PANEL_RELIABILITY_RESTORED')


def install(release, apply=False):
    app, css, image, boot, style, shell = payload(release)
    saved, root = service()
    cfg = config()
    target = root / 'web/index.html'
    before, info = regular(target)
    paths = ['scripts/server.mjs', 'scripts/continuity-release.mjs', 'web/app.js',
             'web/vendor/walletconnect.js', 'landing/dist/index.html',
             'web/' + BASE + '/app.js', 'web/' + BASE + '/app.js.LEGAL.txt',
             'web/' + BASE + '/vendor/ethers.js', 'web/' + BASE + '/vendor/walletconnect.js',
             'web' + CURRENT_APP, 'web' + CURRENT_ENTRY, 'web' + CURRENT_CSS, 'web' + CURRENT_IMAGE,
             'web' + REFERRAL + 'referral-context.js', 'web' + REFERRAL + 'entry.js']
    if (root / 'scripts/history-cache.mjs').exists():
        paths.append('scripts/history-cache.mjs')
    protected = {path: sha(regular(root / path)[0]) for path in paths}
    print('RUNTIME_READ_ONLY=' + json.dumps({
        'serverSHA256': protected['scripts/server.mjs'],
        'historyCacheSHA256': protected.get('scripts/history-cache.mjs'),
        'eventHistoryVersion': cfg.get('eventHistoryVersion') if isinstance(cfg.get('eventHistoryVersion'), int) else None,
        'eventHistoryTimeoutMs': cfg.get('eventHistoryTimeoutMs') if isinstance(cfg.get('eventHistoryTimeoutMs'), int) else None,
    }, sort_keys=True), flush=True)
    require(protected['web/' + BASE + '/app.js'] == BASE_APP and
            protected['web/' + BASE + '/app.js.LEGAL.txt'] == LEGAL, 'BASE_BUNDLE_MISMATCH')
    require(protected['web' + CURRENT_APP] == CURRENT_APP_SHA and
            regular(root / ('web' + CURRENT_ENTRY))[0] == entry_code(CURRENT_APP) and
            protected['web' + CURRENT_CSS] == CURRENT_CSS_SHA and
            protected['web' + CURRENT_IMAGE] == CURRENT_IMAGE_SHA, 'MEMBER_PANEL_BASELINE_MISMATCH')
    module = regular(root / ('web' + REFERRAL + 'referral-context.js'))[0]
    require(hashlib.sha1(b'blob ' + str(len(module)).encode() + b'\0' + module).hexdigest()
            == REFERRAL_BLOB, 'REFERRAL_MODULE_MISMATCH')
    after, assets = plan(before, app, css, image, boot, style, shell)
    for url, (data, _kind) in assets.items():
        path = safe_path(root / ('web' + url))
        if path.exists():
            existing_asset(path, data)
    for base in (LOCAL, PUBLIC):
        for route in ROUTES:
            served(base + route, before)
        for url in ('/' + BASE + '/app.js', '/' + BASE + '/vendor/ethers.js',
                    '/' + BASE + '/vendor/walletconnect.js', CURRENT_APP, CURRENT_ENTRY,
                    REFERRAL + 'entry.js', REFERRAL + 'referral-context.js'):
            served(base + url, regular(root / ('web' + url))[0], 'js')
        served(base + CURRENT_CSS, regular(root / ('web' + CURRENT_CSS))[0], 'css')
        served(base + CURRENT_IMAGE, regular(root / ('web' + CURRENT_IMAGE))[0], 'webp')
    node = node_executable(saved)
    for url, (code, kind) in assets.items():
        if kind == 'js':
            syntax = 'commonjs' if url.endswith('/boot-guard.js') else 'module'
            subprocess.run([node, '--input-type=' + syntax, '--check'], input=code,
                           check=True, capture_output=True, timeout=20)
    require(properties() == saved, 'SERVICE_CHANGED_DURING_PREFLIGHT')
    if before == after:
        for url, (data, kind) in assets.items():
            require(regular(root / ('web' + url))[0] == data, 'INSTALLED_ASSET_MISMATCH')
            for base in (LOCAL, PUBLIC):
                served(base + url, data, kind)
        print('FTI_PANEL_RELIABILITY_ALREADY_INSTALLED', flush=True)
        return
    print('FTI_PANEL_RELIABILITY_PREFLIGHT_OK', flush=True)
    if not apply:
        return
    safe_path(BACKUPS)
    BACKUPS.mkdir(mode=0o700, exist_ok=True)
    require(BACKUPS.stat().st_uid == 0 and not BACKUPS.stat().st_mode & 0o077, 'PRIVATE_BACKUP_REQUIRED')
    backup = Path(tempfile.mkdtemp(prefix='install-', dir=BACKUPS))
    create(backup / 'before.html', before, 0o600)
    create(backup / 'record.json', json.dumps({'root': str(root), 'before': sha(before),
        'after': sha(after), 'protected': protected, 'app': sha(app),
        'css': sha(css), 'image': sha(image), 'boot': sha(boot),
        'style': sha(style), 'shell': sha(shell)}).encode(), 0o600)
    create(backup / 'installer.py', regular(Path(__file__).resolve())[0], 0o600)
    print('ROLLBACK_COMMAND=python3 ' + str(backup / 'installer.py') + ' --restore ' + str(backup), flush=True)
    # Group files before validating/recovering a private directory. A theme
    # directory contains both CSS and image; checking one basename at a time
    # could reject a valid partially installed sibling on retry.
    directories = {}
    for url, (data, _kind) in assets.items():
        file = safe_path(root / ('web' + url))
        directories.setdefault(file.parent, {})[file.name] = data
    for folder, expected in directories.items():
        public_asset_directory(folder, expected)
    for url, (data, kind) in assets.items():
        file = safe_path(root / ('web' + url))
        publish_asset(file, data)
        for base in (LOCAL, PUBLIC):
            served(base + url, data, kind)
    for folder in directories:
        sync_directory(folder)
    sync_directory(root / 'web')

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
    print('FTI_PANEL_RELIABILITY_INSTALLED_NO_RESTART', flush=True)
    print('REAL_WALLET_REGISTRATION_NOT_TESTED', flush=True)


def package(root, output):
    app = regular(root / 'web/app.js')[0]
    require(sha(regular(root / 'web/app.js.LEGAL.txt')[0]) == LEGAL, 'LEGAL_NOTICE_CHANGED')
    css = regular(root / 'web/member-reserve-panel.css')[0]
    text = css.decode('utf8')
    urls = re.findall(r'url\(([^)]+)\)', text, flags=re.I)
    require(len(urls) == 1, 'EXPECTED_ONE_PANEL_IMAGE')
    url = urls[0].strip(' \t\r\n\"\'')
    require(re.fullmatch(r'(?:\./)?assets/[A-Za-z0-9_-]+\.webp', url),
            'UNEXPECTED_PANEL_IMAGE_PATH')
    image = regular(root / 'web' / url)[0]
    validate_image(image)
    css = re.sub(r'url\([^)]+\)', 'url("./' + image_name(image) + '")', text,
                 count=1, flags=re.I).encode()
    boot = regular(root / 'web/boot-guard.js')[0]
    style, shell = boot_fragments(regular(root / 'web/index.html')[0])
    release = {'schema': 'FTI_PANEL_RELIABILITY_V1', 'app': compressed(app),
               'css': compressed(css), 'image': compressed(image), 'boot': compressed(boot),
               'style': compressed(style), 'shell': compressed(shell)}
    payload(release)
    source = regular(Path(__file__).resolve())[0].decode()
    text, count = re.subn(r'(# BEGIN EMBEDDED RELEASE\n).*?(\n# END EMBEDDED RELEASE)',
        lambda match: match[1] + 'RELEASE = json.loads(' + repr(json.dumps(release)) + ')' + match[2],
        source, flags=re.S)
    require(count == 1, 'PACKAGE_MARKER_MISMATCH')
    create(output, text.encode())
    print(json.dumps({'sha256': sha(text.encode()), 'appSHA256': sha(app),
                      'cssSHA256': sha(css), 'imageSHA256': sha(image), 'bootSHA256': sha(boot)}))


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
        print('FTI_PANEL_RELIABILITY_STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
