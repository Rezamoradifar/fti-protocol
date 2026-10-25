#!/usr/bin/env python3
"""Install the FTI completed member panel, patched wallet bridge and support/history API.

Default is read-only preflight. --apply performs one web restart; --restore
reverts only owned runtime/HTML changes and retains support records.
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

BASE = 'fti-mainnet-ui-eead15d141fbbc07'

BASE_APP = 'a6ed0da9729698dd66d3db996e8d1dc370d0fd6bd088d0d1730c8f7ab3dcfacc'

LEGAL = '573cc95a6417c69a6ca44804f440f00965283c8cdcc50025305a7a50f53940ac'

REFERRAL = '/fti-referral-c6abd61ddf79782e795c2484/'

REFERRAL_BLOB = '32c0099a90c32e183fcd66309fdaa78ec7c8801d'

OFFICIAL_OVERLAY = '/fti-official-channel-626c532ec31a4fd0280d9208/official-channel.js'

OFFICIAL_OVERLAY_SHA = '626c532ec31a4fd0280d9208d27dca0c55581a18cdc7551543da5a8abe8c4550'

IMAGE_SHA = '27f8968f3353a95e51b14df74943bfd723909a408043eff0a305cdb6892e705d'

BASELINES = {
    'member-reserve': {
        'app': '/' + BASE + '/app-member-reserve-26a077538e86dc33fc5b.js',
        'appSHA': '26a077538e86dc33fc5b7f9ca719730ef95c0df41203188747dd401681fb8835',
        'entry': '/fti-member-reserve-9c9273e8a6637861d8b3/entry.js',
        'css': '/fti-member-reserve-theme-43c907b32da4849cc469/theme.css',
        'cssSHA': '1b343e4eb4dee16373092cef8b9b89b59558583bd941bf79f74e53ab14cd5538',
        'image': '/fti-member-reserve-theme-43c907b32da4849cc469/member-reserve-flow-' + IMAGE_SHA[:20] + '.webp',
        'imageSHA': IMAGE_SHA,
    },
    'panel-reliability': {
        'app': '/' + BASE + '/app-panel-reliability-000f3cdac0d81f9d3e3f.js',
        'appSHA': '000f3cdac0d81f9d3e3f63adb97dca1e9b8ce1ab3cf7a54dfb5c05ae9b835b10',
        'entry': '/fti-panel-reliability-ebf8b5f2b9ef1814db51/entry.js',
        'css': '/fti-panel-reliability-theme-1d399875d5bee16fcabf/theme.css',
        'cssSHA': '8db9f8c71509b63088d58833ec5827e191e8df2f68d7770000e7a27dc58f2488',
        'image': '/fti-panel-reliability-theme-1d399875d5bee16fcabf/member-reserve-flow-' + IMAGE_SHA[:20] + '.webp',
        'imageSHA': IMAGE_SHA,
        'boot': '/fti-panel-reliability-ebf8b5f2b9ef1814db51/boot-guard.js',
        'bootSHA': 'fe215237f4fee2e083121b08d4b6b459fdb7cbae5a86667fb2ddcdfc582e16a9',
        'styleSHA': '065527f4421ae2ce7d2184182898d1257159f966eff617bf9d2058aa1b0a6e65',
        'shellSHA': '2eafcf9daa3f62627285ac887ee0dbd6926c350f0514fc6eb30b1589b3135d2f',
    },
}

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
    fd, name = tempfile.mkstemp(prefix='.fti-professional-user-panel-', dir=path.parent)
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
        'Accept-Encoding': 'identity', 'User-Agent': 'FTI-Professional-User-Panel/1'})
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

def entry_code(app_url):
    return ("import {installReferralContext} from '" + REFERRAL + "referral-context.js';\n"
            "installReferralContext(window);\nawait import('" + app_url + "');\n").encode()

def script_tag(url, boot=False):
    return ('<script type="module" src="' + url + '"' +
            (' data-fti-app-entry' if boot else '') + '></script>').encode()

def css_link(url):
    return ('<link rel="stylesheet" href="' + url + '">').encode()

def official_overlay(before):
    overlays = re.findall(rb'<script\b[^>]*\bsrc\s*=\s*["\'][^"\']*fti-official-channel-[^"\']*["\'][^>]*></script>',
                          before, flags=re.I)
    require(not overlays or (overlays == [script_tag(OFFICIAL_OVERLAY)] and
            before.count(script_tag(OFFICIAL_OVERLAY)) == 1), 'UNRECOGNIZED_OFFICIAL_OVERLAY')
    return bool(overlays)

def existing_asset(path, expected):
    data, info = regular(path)
    require(data == expected, 'IMMUTABLE_ASSET_MISMATCH')
    require(info.st_uid == 0 and not info.st_mode & 0o022, 'UNSAFE_ASSET_FILE')
    return info

def publish_asset(path, data):
    if not path.exists():
        fd, name = tempfile.mkstemp(prefix='.fti-professional-user-panel-', dir=path.parent)
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

import pwd
import grp
from types import SimpleNamespace
import time
import shutil
import ctypes
import errno

BACKUPS = Path('/var/backups/fti-panel-completion')
SUPPORT_ROOT = Path('/var/lib/fti-support')
ENTRY = 'scripts/server.mjs'
RUNTIME_FILES = ('scripts/member-history.mjs', 'scripts/support-tickets.mjs',
    'core/history-read-policy.mjs', 'scripts/history-cache.mjs', 'scripts/state-reader.mjs',
    'scripts/event-history-source.mjs', 'scripts/event-reader.mjs', 'scripts/market-reader.mjs',
    'scripts/content-security-policy.mjs', 'scripts/referral-placement-index.mjs', ENTRY)
SERVER_BASES = (
    '31b576910e1d7573d7efd34efa16ecbcc84eb236c72a00579d59acc173a34353',
    '287907263043ccc612d173031826e10add55c7f6d0ac1df121f50dfcc37f4c77',
    '04f18c27e9b2aceccf7625013b66f20ccc49f0911aa2ad9c57559ee170546a7a',
)
CACHE_BASES = ('b45b788405ad1d601d55fb2c16bb9feb1bba91acdea316b928102371043b21f3',)
IDENTITY_KEYS = ('WorkingDirectory', 'User', 'Group', 'FragmentPath')
DROP_FOLDER = Path('/etc/systemd/system/fti-continuity-web.service.d')
DROP_NAME = 'zzzzzz-fti-panel-completion.conf'
NEW_CONFIG_KEYS = ('supportTicketVersion', 'memberHistoryVersion', 'stateReaderVersion', 'eventHistoryVersion')
# BEGIN EMBEDDED RELEASE
RELEASE = None
# END EMBEDDED RELEASE


def normalize_exec_start(value):
    # Keep only command configuration. systemd changes live execution metadata
    # on restart even when the configured executable and arguments are identical.
    match = re.fullmatch(
        r'(\{ path=/[^;{}\r\n]+ ; argv\[\]=[^;{}\r\n]+ ; ignore_errors=(?:yes|no))'
        r' ; start_time=\[[^\]\r\n]*\] ; stop_time=\[[^\]\r\n]*\]'
        r' ; pid=[0-9]+ ; code=[^;{}\r\n]* ; status=[^;{}\r\n]* \}', value)
    require(match is not None, 'UNSUPPORTED_EXEC_START')
    return match[1] + ' }'


def unit_properties():
    keys = (*IDENTITY_KEYS, 'DropInPaths', 'ExecStart', 'MainPID', 'ActiveState', 'SubState')
    result = subprocess.run(['systemctl', 'show', UNIT, '--no-pager',
        *['--property=' + key for key in keys]], check=True, capture_output=True, timeout=15)
    values = dict(line.split('=', 1) for line in result.stdout.decode().splitlines() if '=' in line)
    values['ExecStart'] = normalize_exec_start(values.get('ExecStart', ''))
    return values


def unit_metadata(saved):
    files = [saved.get('FragmentPath', ''), *saved.get('DropInPaths', '').split()]
    require(files[0] and all(Path(p).is_absolute() for p in files), 'UNEXPECTED_UNIT_METADATA')
    result = {}
    for name in files:
        info = os.stat(name)
        result[name] = [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
                        info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)]
    return result


def active_service():
    saved = unit_properties()
    require(saved.get('User') == saved.get('Group') == 'fti-v3' and
            saved.get('ActiveState') == 'active' and saved.get('SubState') == 'running' and
            int(saved.get('MainPID', '0')) > 1, 'UNEXPECTED_FTI_SERVICE')
    root = safe_path(Path(saved['WorkingDirectory']))
    require(root.parent == Path('/opt/fti/releases') and root.is_dir() and
            Path('/proc/' + saved['MainPID'] + '/cwd').resolve() == root, 'UNEXPECTED_RELEASE')
    return saved, root


def same_identity(saved, root, metadata):
    now = unit_properties()
    require(all(now.get(key, '') == saved.get(key, '') for key in IDENTITY_KEYS) and
            now.get('WorkingDirectory') == str(root) and unit_metadata(now) == metadata,
            'SERVICE_CONFIGURATION_CHANGED')
    return now


def completion_payload(release):
    expected = {'schema', 'app', 'sdk', 'sdkLegal', 'css', 'image', 'runtime', 'required', 'professional', 'canonical'}
    require(isinstance(release, dict) and set(release) == expected and
            release['schema'] == 'FTI_PANEL_COMPLETION_V1', 'PACKAGED_INSTALLER_REQUIRED')
    app, sdk, sdk_legal, css, image = (unpack(release[key]) for key in ('app', 'sdk', 'sdkLegal', 'css', 'image'))
    require(all(marker in app for marker in (b'./vendor/ethers.js', b'./vendor/walletconnect.js',
        b'retry-pending-check', b'member-command-hero', b'member-support-form')),
        'UNEXPECTED_APPLICATION_BUNDLE')
    require(50_000 <= len(sdk) <= LIMIT and len(sdk_legal) <= 200_000,
            'UNEXPECTED_WALLET_BRIDGE')
    validate_image(image)
    require(sha(image) == IMAGE_SHA, 'REVIEWED_ARTWORK_REQUIRED')
    validate_css(css, image)
    require(isinstance(release['runtime'], dict) and set(release['runtime']) == set(RUNTIME_FILES),
            'UNEXPECTED_RUNTIME_MANIFEST')
    runtime = {name: unpack(item) for name, item in release['runtime'].items()}
    require(all(marker in runtime[ENTRY] for marker in (b"'./member-history.mjs'", b"'./support-tickets.mjs'")),
            'INCOMPLETE_SERVER_PAYLOAD')
    require(isinstance(release['required'], dict) and release['required'] and all(
        re.fullmatch(r'(?:scripts|core)/[A-Za-z0-9_.-]+\.mjs', name) and
        isinstance(value, list) and 1 <= len(value) <= 2 and len(set(value)) == len(value) and
        all(re.fullmatch(r'[0-9a-f]{64}', item) for item in value)
        for name, value in release['required'].items()) and
        not set(release['required']).intersection(RUNTIME_FILES), 'INVALID_REQUIRED_RUNTIME_PINS')
    pro = release['professional']
    require(isinstance(pro, dict) and set(pro) == {'app', 'css', 'image'}, 'INVALID_PROFESSIONAL_BASELINE')
    old_app, old_css, old_image = (unpack(pro[k]) for k in ('app', 'css', 'image'))
    require(sha(old_app) == '7837237848d2e527a05eca098a7f819c597b438f70b3a2fbb0c040ff9415e45d' and
            sha(old_css) == '4f2eb86ee5257736d127d9c8dbaf6bbfe459761062b6d71e1e288b58db55e380' and
            sha(old_image) == IMAGE_SHA, 'UNREVIEWED_PROFESSIONAL_BASELINE')
    canonical_payload(release)
    return app, sdk, sdk_legal, css, image, runtime, (old_app, old_css, old_image)


def completion_destinations(app, sdk, sdk_legal, css, image):
    prefix = '/fti-panel-completion-' + sha(app + sdk + css + image)[:20] + '/'
    sdk_url = prefix + 'walletconnect.js'
    # Absolute imports bind the new app to the reviewed installed ethers runtime
    # and this release's immutable patched bridge. Old SDK URLs remain untouched.
    new_app = app.replace(b'./vendor/ethers.js', ('/' + BASE + '/vendor/ethers.js').encode()).replace(
        b'./vendor/walletconnect.js', sdk_url.encode())
    require(b'./vendor/' not in new_app, 'UNREWRITTEN_VENDOR_IMPORT')
    app_url = prefix + 'app.js'
    entry_url = prefix + 'entry.js'
    css_url = prefix + 'theme.css'
    assets = {app_url: (new_app, 'js'), entry_url: (entry_code(app_url), 'js'),
              sdk_url: (sdk, 'js'), prefix + 'walletconnect.js.LEGAL.txt': (sdk_legal, 'text'),
              css_url: (css, 'css'), prefix + image_name(image): (image, 'webp')}
    return entry_url, css_url, assets


def completion_baselines(professional):
    result = {key: dict(item) for key, item in BASELINES.items()}
    app, css, image = professional
    app_url = '/' + BASE + '/app-professional-user-panel-' + sha(app)[:20] + '.js'
    entry = entry_code(app_url)
    theme = '/fti-professional-user-panel-theme-' + sha(css + image)[:20] + '/'
    pro = dict(BASELINES['panel-reliability'])
    pro.update({'app': app_url, 'appSHA': sha(app),
                'entry': '/fti-professional-user-panel-' + sha(entry)[:20] + '/entry.js',
                'css': theme + 'theme.css', 'cssSHA': sha(css),
                'image': theme + image_name(image), 'imageSHA': sha(image)})
    result['professional-user-panel'] = pro
    return result


def completion_plan(before, entry_url, css_url, professional):
    require(b'<base' not in before.lower() and before.count(b'</head>') == 1 and
            before.count(b'<div id="root">') == 1, 'UNRECOGNIZED_INSTALLED_ENTRY')
    overlay = official_overlay(before)
    candidates = []
    baselines = completion_baselines(professional)
    for key, baseline in baselines.items():
        boot = 'boot' in baseline
        old = script_tag(baseline['entry'], boot)
        new = script_tag(entry_url, boot)
        original = before.count(old) == before.count(css_link(baseline['css'])) == 1
        installed = before.count(new) == before.count(css_link(css_url)) == 1
        if original == installed:
            continue
        if installed:
            # A completion release retains the exact pre-existing bootstrap.
            # Distinguish otherwise identical candidates by its original style.
            if boot:
                if baseline['boot'].encode() not in before:
                    continue
            else:
                if b'data-fti-boot' in before:
                    continue
            # The professional predecessor shares the reliability bootstrap.
            if key == 'professional-user-panel':
                continue
        require(len(re.findall(rb'<script\b', before, flags=re.I)) == (2 if boot else 1) + int(overlay),
                'UNRECOGNIZED_INSTALLED_ENTRY')
        if boot:
            guard = ('<script defer src="' + baseline['boot'] + '" data-fti-boot-guard></script>').encode()
            require(before.count(guard) == 1 and before.count(b'data-fti-boot-guard') == 1,
                    'UNRECOGNIZED_BOOT_GUARD')
            style, shell = boot_fragments(before)
            require(sha(style) == baseline['styleSHA'] and sha(shell) == baseline['shellSHA'],
                    'BOOT_FALLBACK_BASELINE_MISMATCH')
        else:
            require(not re.search(rb'data-fti-boot|FTI_BOOT_FALLBACK', before), 'UNRECOGNIZED_BOOT_MARKUP')
        for other_key, other in baselines.items():
            if original and other_key == key:
                continue
            require(other['entry'].encode() not in before and other['css'].encode() not in before,
                    'AMBIGUOUS_PANEL_BASELINE')
        after = before.replace(old, new, 1).replace(css_link(baseline['css']), css_link(css_url), 1) if original else before
        candidates.append((key, baseline, after, original))
    require(len(candidates) == 1, 'UNRECOGNIZED_INSTALLED_ENTRY')
    return candidates[0]


def capture_protected(root, required, baseline, overlay):
    pins = {}
    server = sha(regular(root / ENTRY)[0])
    require(server in SERVER_BASES, 'UNREVIEWED_SERVER_BASELINE')
    pins[ENTRY] = server
    for name, expected in required.items():
        actual = sha(regular(root / name)[0])
        require(actual in expected, 'PROTECTED_RUNTIME_PIN_MISMATCH: ' + name)
        pins[name] = actual
    pins.update({'web/' + BASE + '/app.js': BASE_APP,
        'web/' + BASE + '/app.js.LEGAL.txt': LEGAL,
        **{'web' + baseline[k]: baseline[k + 'SHA'] for k in ('app', 'css', 'image')}})
    if 'boot' in baseline:
        pins['web' + baseline['boot']] = baseline['bootSHA']
    if overlay:
        pins['web' + OFFICIAL_OVERLAY] = OFFICIAL_OVERLAY_SHA
    for name, expected in pins.items():
        require(sha(regular(root / name)[0]) == expected, 'PROTECTED_RUNTIME_PIN_MISMATCH: ' + name)
    require(regular(root / ('web' + baseline['entry']))[0] == entry_code(baseline['app']),
            'BASELINE_ENTRY_MISMATCH')
    referral = regular(root / ('web' + REFERRAL + 'referral-context.js'))[0]
    require(hashlib.sha1(b'blob ' + str(len(referral)).encode() + b'\0' + referral).hexdigest() == REFERRAL_BLOB,
            'REFERRAL_MODULE_MISMATCH')
    paths = ['scripts/continuity-release.mjs', 'scripts/keeper.mjs',
        'web/app.js', 'web/vendor/ethers.js', 'web/vendor/walletconnect.js',
        'web/' + BASE + '/vendor/ethers.js', 'web/' + BASE + '/vendor/walletconnect.js',
        'web' + REFERRAL + 'referral-context.js', 'web' + REFERRAL + 'entry.js',
        'landing/dist/index.html']
    # Preserve every original shared stylesheet and local font referenced by HTML.
    html = regular(root / 'web/index.html')[0]
    for url in re.findall(rb'<link\b[^>]*href=["\']([^"\']+)["\']', html):
        name = url.decode()
        if name.startswith('/' + BASE + '/'):
            paths.append('web' + name)
    pins.update({name: sha(regular(root / name)[0]) for name in paths})
    return pins


def check_protected(root, pins):
    for name, digest in pins.items():
        require(sha(regular(root / name)[0]) == digest, 'PROTECTED_RUNTIME_CHANGED: ' + name)


def overlay_files(runtime):
    result = {}
    local_names = {Path(name).name for name in RUNTIME_FILES}
    for name in RUNTIME_FILES:
        code = runtime[name]
        if name == ENTRY:
            def resolve(match):
                quote, relative = match.group(1), match.group(2).decode()
                filename = Path(relative).name
                if relative.startswith('./'):
                    target = './' + filename if filename in local_names else '../scripts/' + relative[2:]
                elif relative == '../core/history-read-policy.mjs':
                    target = './history-read-policy.mjs'
                else:
                    target = relative
                return quote + target.encode() + quote
            code = re.sub(rb"([\"'])(\.\.?/[^\"']+\.mjs)\1", resolve, code)
        elif name == 'scripts/history-cache.mjs':
            code = code.replace(b'../core/history-read-policy.mjs', b'./history-read-policy.mjs')
        elif name == 'scripts/referral-placement-index.mjs':
            code = code.replace(b'./approved-genesis-layout.mjs', b'../scripts/approved-genesis-layout.mjs')
        result[Path(name).name] = code
    require(set(result) == local_names and b"'../scripts/operational-release.mjs'" in result['server.mjs'],
            'OVERLAY_IMPORT_REWRITE_FAILED')
    digest = sha(json.dumps({name: sha(value) for name, value in result.items()}, sort_keys=True).encode())[:20]
    return 'fti-panel-completion-runtime-' + digest, result


CANONICAL_REVISION = 'ba82373a83d63fba0643332371cfb6d62903c849'
FROZEN_DIRS = ('contracts', 'frontend', 'scripts', 'core', 'landing/src')
STAGE_COPY_DIRS = ('web', 'landing/dist', 'artifacts')


def canonical_payload(release):
    require(isinstance(release.get('canonical'), dict) and 100 <= len(release['canonical']) <= 250,
            'INVALID_CANONICAL_MANIFEST')
    result = {}
    for name, item in release['canonical'].items():
        require(not Path(name).is_absolute() and '..' not in Path(name).parts and
                (Path(name).parent.as_posix() in FROZEN_DIRS or name in (
                 'package.json', 'package-lock.json', 'config/mainnet-approved-input.REQUIRED.json',
                 'config/mainnet-council.json', 'config/mainnet-genesis-layout.json',
                 'config/mainnet-usdt-collateral.json', 'config/v3-wallets.json')), 'UNSAFE_CANONICAL_PATH')
        result[name] = unpack(item)
    require(sum(map(len, result.values())) <= 5_000_000, 'CANONICAL_SOURCE_TOO_LARGE')
    return result


def release_name(release):
    identity = {key: release[key]['sha256'] for key in ('app', 'sdk', 'css', 'image')}
    identity['runtime'] = {name: value['sha256'] for name, value in release['runtime'].items()}
    identity['canonical'] = {name: value['sha256'] for name, value in release['canonical'].items()}
    return 'panel-completion-' + sha(json.dumps(identity, sort_keys=True).encode())[:20]


def copy_public_tree(source, destination):
    safe_path(source)
    require(source.is_dir(), 'MISSING_PUBLIC_RUNTIME_DIRECTORY')
    destination.mkdir(mode=0o755, parents=True, exist_ok=False)
    os.chmod(destination, 0o755)
    total = count = 0
    for folder, directories, files in os.walk(source, followlinks=False):
        relative = Path(folder).relative_to(source)
        for name in directories:
            require(not name.startswith('.'), 'PRIVATE_PUBLIC_TREE_ENTRY_REJECTED')
            src = safe_path(Path(folder) / name)
            require(src.is_dir(), 'INVALID_PUBLIC_DIRECTORY')
            target = destination / relative / name
            target.mkdir(mode=0o755)
            os.chmod(target, 0o755)
        for name in files:
            require(not name.startswith('.') and Path(name).suffix.lower() in
                    ('.html', '.js', '.mjs', '.css', '.json', '.txt', '.woff', '.woff2',
                     '.webp', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.pdf'),
                    'PRIVATE_OR_UNKNOWN_PUBLIC_FILE_REJECTED')
            src = safe_path(Path(folder) / name)
            data, _ = regular(src)
            total += len(data)
            count += 1
            require(count <= 4000 and total <= 100_000_000, 'PUBLIC_RUNTIME_COPY_BUDGET_EXCEEDED')
            create(destination / relative / name, data, 0o644)
    return total, count


def stage_inventory(stage):
    result = {}
    for folder, directories, files in os.walk(stage, followlinks=False):
        base = Path(folder)
        if base == stage and 'node_modules' in directories:
            directories.remove('node_modules')
        for name in directories:
            safe_path(base / name)
        for name in files:
            file = base / name
            if file == stage / '.fti-panel-completion.json':
                continue
            relative = file.relative_to(stage).as_posix()
            result[relative] = sha(regular(file)[0])
    require(len(result) <= 13_000, 'STAGED_FILE_BUDGET_EXCEEDED')
    return result


def validate_stage(stage, source, name):
    marker, info = regular(stage / '.fti-panel-completion.json')
    require(info.st_uid == 0 and not info.st_mode & 0o022, 'UNSAFE_STAGED_MARKER')
    record = json.loads(marker)
    require(record.get('schema') == 'FTI_PANEL_COMPLETION_STAGE_V1' and
            record.get('originalRoot') == str(source) and record.get('release') == name and
            record.get('files') == stage_inventory(stage), 'STAGED_RELEASE_CHANGED_OR_INCOMPLETE')
    modules = stage / 'node_modules'
    require(modules.is_symlink() and os.readlink(modules) == str(source / 'node_modules'),
            'STAGED_DEPENDENCY_LINK_CHANGED')
    return record


def stage_release(source, stage, canonical, assets, overlay_name, overlay_content, before, after, release_id):
    require(stage.parent == source.parent and stage != source and stage.is_dir() and
            stage.stat().st_uid == 0 and not os.listdir(stage), 'UNSAFE_PRIVATE_STAGE')
    os.chmod(stage, 0o755)
    for name in STAGE_COPY_DIRS:
        copy_public_tree(source / name, stage / name)
    for name, data in canonical.items():
        target = stage / name
        target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        for parent in target.parents:
            if parent == stage.parent:
                break
            os.chmod(parent, 0o755)
        create(target, data, 0o644)
    modules = safe_path(source / 'node_modules')
    require(modules.is_dir() and modules.stat().st_uid == 0 and not modules.stat().st_mode & 0o022,
            'UNSAFE_EXISTING_NODE_MODULES')
    (stage / 'node_modules').symlink_to(modules, target_is_directory=True)
    # The single deliberate symlink shares only the existing read-only dependency
    # tree. No credentials, deployment file, private data or environment is copied.
    directories = {}
    for url, (data, kind) in assets.items():
        target = stage / ('web' + url)
        directories.setdefault(target.parent, {})[target.name] = data
    overlay = stage / overlay_name
    directories[overlay] = overlay_content
    for folder, expected in directories.items():
        ensure_public_directory(folder, expected)
    for url, (data, kind) in assets.items():
        publish_asset(stage / ('web' + url), data)
    for name, data in overlay_content.items():
        publish_asset(overlay / name, data)
    target = stage / 'web/index.html'
    current, info = regular(target)
    require(current == before, 'STAGED_HTML_BASELINE_MISMATCH')
    replace(target, before, after, info)
    record = {'schema': 'FTI_PANEL_COMPLETION_STAGE_V1', 'originalRoot': str(source),
              'release': release_id, 'files': stage_inventory(stage)}
    create(stage / '.fti-panel-completion.json', json.dumps(record, sort_keys=True).encode(), 0o644)
    sync_directory(stage)


def publish_stage(temporary, stage):
    # Linux renameat2 guarantees an atomic directory publication without ever
    # replacing an operator-created empty directory in the final-name race.
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, 'renameat2', None)
    require(rename is not None, 'ATOMIC_NO_REPLACE_RENAME_REQUIRED')
    rename.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(temporary), -100, os.fsencode(stage), 1) != 0:
        error = ctypes.get_errno()
        if error == errno.EEXIST:
            raise RuntimeError('STAGE_PUBLISH_COLLISION_PRESERVED')
        raise OSError(error, 'Atomic staged release publication failed')
    sync_directory(stage.parent)


def prepare_stage(source, stage, canonical, assets, overlay_name, overlay_content, before, after, release_id):
    temporary = Path(tempfile.mkdtemp(prefix='.fti-panel-completion-stage-', dir=source.parent))
    try:
        stage_release(source, temporary, canonical, assets, overlay_name, overlay_content,
                      before, after, release_id)
        validate_stage(temporary, source, release_id)
        publish_stage(temporary, stage)
    finally:
        # This random directory was created by this invocation and has never
        # been a live release. No existing release or private state is removed.
        if temporary.exists():
            shutil.rmtree(temporary)


def fingerprint_preflight(root, node, cfg, account):
    source = ("import {releaseManifest} from './scripts/continuity-release.mjs';"
              "process.stdout.write(JSON.stringify(releaseManifest()));")
    result = subprocess.run([node, '--input-type=module', '--eval', source], cwd=root,
        env={'PATH': str(Path(node).parent) + ':/usr/bin:/bin', 'NODE_ENV': 'production',
             'FTI_SOURCE_REVISION': cfg['sourceRevision']},
        user=account.pw_uid, group=account.pw_gid, extra_groups=[],
        capture_output=True, timeout=30)
    require(result.returncode == 0, 'SOURCE_MANIFEST_PREFLIGHT_FAILED_RECOVER_SOURCE_FIRST')
    manifest = json.loads(result.stdout)
    require(manifest.get('sourceFingerprint') == cfg.get('sourceFingerprint') and
            manifest.get('artifactHashes') == cfg.get('artifactHashes') and
            manifest.get('sourceRevision') == cfg.get('sourceRevision'),
            'SOURCE_MANIFEST_MISMATCH_RECOVER_SOURCE_FIRST')
    return manifest


def dropin_path():
    return safe_path(DROP_FOLDER / DROP_NAME)


def dropin_code(node, root, folder, support):
    require(all(re.fullmatch(r'/[A-Za-z0-9_./-]+', str(value)) for value in (node, root, folder, support)),
            'UNSAFE_SYSTEMD_PATH')
    return ('[Service]\nWorkingDirectory=' + str(root) + '\nExecStart=\nExecStart=' + str(node) + ' ' +
            str(folder / 'server.mjs') + '\nReadWritePaths=' + str(support) + '\n').encode()


def reload_units():
    subprocess.run(['systemctl', 'daemon-reload'], check=True, capture_output=True, timeout=25)


def verify_service_cutover(saved, root, original_metadata, drop_path, drop_bytes, overlay):
    now = unit_properties()
    require(all(now.get(key, '') == saved.get(key, '') for key in IDENTITY_KEYS if key != 'WorkingDirectory') and
            now.get('WorkingDirectory') == str(root), 'SERVICE_CONFIGURATION_CHANGED')
    require(str(drop_path) in now.get('DropInPaths', '').split() and
            str(overlay / 'server.mjs') in now.get('ExecStart', '') and
            regular(drop_path)[0] == drop_bytes, 'NEW_EXECSTART_NOT_EFFECTIVE')
    metadata = unit_metadata(now)
    require({key: value for key, value in metadata.items() if key != str(drop_path)} == original_metadata,
            'OTHER_SERVICE_CONFIGURATION_CHANGED')
    return now


def same_public_config(before, after):
    clean = lambda value: {key: item for key, item in value.items()
                           if key not in (*NEW_CONFIG_KEYS, 'eventHistoryTimeoutMs')}
    for value in (before, after):
        require('eventHistoryTimeoutMs' not in value or value['eventHistoryTimeoutMs'] == 18000,
                'UNREVIEWED_HISTORY_READ_TIMEOUT')
    require(clean(before) == clean(after), 'DEPLOYMENT_CONFIGURATION_CHANGED')


def api_probe(url, expected_status, method='GET', headers=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, data=b'{}' if method == 'POST' else None,
        method=method, headers={'Cache-Control': 'no-cache', 'Content-Type': 'application/json',
                                **(headers or {})})
    try:
        response = opener.open(request, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        data = response.read(65_537)
        require(response.status == expected_status and len(data) <= 65_536 and
                response.headers.get_content_type() == 'application/json', 'MEMBER_API_PROBE_FAILED')
        value = json.loads(data)
        require(isinstance(value, dict) and isinstance(value.get('error'), str) and value['error'],
                'MEMBER_API_ERROR_REQUIRED')


def probe_member_apis(base):
    # These probes contain no wallet, session or ticket data, trigger no chain
    # reads, and do not request a signature or create a support challenge.
    host = PUBLIC.split('://', 1)[1]
    headers = {'Host': host, 'Origin': PUBLIC}
    api_probe(base + '/api/support/tickets', 401, headers=headers)
    api_probe(base + '/api/member-history?wallet=invalid', 400)
    api_probe(base + '/api/support/challenge', 403, method='POST',
              headers={'Host': host, 'Origin': 'https://invalid.example'})


def check_new_web(before_cfg, after_html, assets):
    cfg = config()
    same_public_config(before_cfg, cfg)
    require(all(cfg.get(key) == 1 for key in NEW_CONFIG_KEYS), 'NEW_MEMBER_API_NOT_ACTIVE')
    for base in (LOCAL, PUBLIC):
        health = json.loads(fetch(base + '/health')[0])
        require(health.get('ok') is True and health.get('chainId') == 56 and
                type(health.get('block')) is int and health['block'] > 0, 'WEB_HEALTH_FAILED')
        for route in ROUTES:
            served(base + route, after_html)
        for url, (data, kind) in assets.items():
            completion_served(base + url, data, kind)
        probe_member_apis(base)
    return cfg


def completion_served(url, data, kind):
    if kind == 'text':
        actual, mime = fetch(url)
        require(actual == data and mime in ('application/octet-stream', 'text/plain'), 'LEGAL_NOTICE_HTTP_MISMATCH')
    else:
        served(url, data, kind)


def ensure_public_directory(folder, expected):
    safe_path(folder)
    folder.mkdir(mode=0o755, exist_ok=True)
    info = folder.stat()
    require(info.st_uid == 0 and stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o022 and
            set(os.listdir(folder)) <= set(expected), 'UNSAFE_ASSET_DIRECTORY')
    os.chmod(folder, 0o755)
    for name in os.listdir(folder):
        existing_asset(folder / name, expected[name])


def support_directory(cfg, uid, gid):
    require(cfg.get('chainId') == 56 and re.fullmatch(r'0x[0-9a-fA-F]{40}', cfg.get('binary', '')),
            'INVALID_SUPPORT_NAMESPACE')
    base = safe_path(SUPPORT_ROOT)
    base.mkdir(mode=0o755, exist_ok=True)
    info = base.stat()
    require(info.st_uid == 0 and not info.st_mode & 0o022, 'UNSAFE_SUPPORT_ROOT')
    os.chmod(base, 0o755)
    directory = safe_path(base / (str(cfg['chainId']) + '-' + cfg['binary'].lower()))
    if not directory.exists():
        directory.mkdir(mode=0o700)
        os.chown(directory, uid, gid)
    info = directory.stat()
    require(info.st_uid == uid and info.st_gid == gid and stat.S_IMODE(info.st_mode) == 0o700,
            'PRIVATE_SUPPORT_DIRECTORY_REQUIRED')
    return directory


def storage_namespace_check(saved, root, node, cfg, account):
    pid = saved.get('MainPID', '')
    require(re.fullmatch(r'[1-9][0-9]*', pid) is not None and
            Path('/proc/' + pid + '/cwd').resolve() == root and
            str(Path('/proc/' + pid + '/exe').resolve()) == node,
            'SERVICE_PROCESS_CHANGED_BEFORE_STORAGE_CHECK')
    nsenter, setpriv = shutil.which('nsenter'), shutil.which('setpriv')
    require(nsenter is not None and setpriv is not None, 'SERVICE_NAMESPACE_CHECK_TOOLS_REQUIRED')
    directory = safe_path(SUPPORT_ROOT / (str(cfg['chainId']) + '-' + cfg['binary'].lower()))
    program = ("import fs from 'node:fs';import path from 'node:path';import {randomBytes} from 'node:crypto';"
        "const file=path.join(process.argv[1],'.fti-write-probe-'+randomBytes(12).toString('hex'));"
        "let fd;try{fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);"
        "fs.writeSync(fd,'FTI_STORAGE_PROBE');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;"
        "fs.unlinkSync(file);process.stdout.write('FTI_STORAGE_WRITABLE');}"
        "finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(file);}}")
    result = subprocess.run([nsenter, '--target', pid, '--mount', '--', setpriv,
        '--reuid=' + str(account.pw_uid), '--regid=' + str(account.pw_gid), '--clear-groups',
        node, '--input-type=module', '--eval', program, str(directory)], cwd=root,
        env={'PATH': '/usr/bin:/bin'}, capture_output=True, timeout=20)
    require(result.returncode == 0 and result.stdout == b'FTI_STORAGE_WRITABLE',
            'SUPPORT_STORAGE_NOT_WRITABLE_IN_SERVICE_NAMESPACE')


def restart_web():
    subprocess.run(['systemctl', 'restart', UNIT], check=True, capture_output=True, timeout=45)


def wait_web(before_cfg, after_html, assets):
    deadline = time.monotonic() + 120
    while True:
        try:
            return check_new_web(before_cfg, after_html, assets)
        except Exception:
            require(time.monotonic() < deadline, 'NEW_WEB_VERIFICATION_FAILED')
            time.sleep(2)


def backup_record(root, stage, before_html, after_html, saved, metadata, cfg, protected, drop_bytes):
    safe_path(BACKUPS)
    BACKUPS.mkdir(mode=0o700, exist_ok=True)
    info = BACKUPS.stat()
    require(info.st_uid == 0 and not info.st_mode & 0o077, 'PRIVATE_BACKUP_REQUIRED')
    backup = Path(tempfile.mkdtemp(prefix='install-', dir=BACKUPS))
    record = {'schema': 'FTI_PANEL_COMPLETION_BACKUP_V3', 'root': str(root), 'stage': str(stage),
        'beforeHTML': sha(before_html), 'afterHTML': sha(after_html),
        'identity': {key: saved.get(key, '') for key in IDENTITY_KEYS},
        'previousExecStart': saved.get('ExecStart', ''), 'previousDropInPaths': saved.get('DropInPaths', ''),
        'unitMetadata': metadata, 'config': cfg, 'protected': protected,
        'dropPath': str(dropin_path()), 'dropSHA256': sha(drop_bytes)}
    create(backup / 'before.html', before_html, 0o600)
    create(backup / 'record.json', json.dumps(record, sort_keys=True).encode(), 0o600)
    create(backup / 'installer.py', regular(Path(__file__).resolve())[0], 0o600)
    return backup, record


def restore_completion(backup, automatic=False, restarted=True):
    backup = safe_path(backup)
    require(backup.parent == BACKUPS, 'UNEXPECTED_BACKUP_PATH')
    record = json.loads(regular(backup / 'record.json')[0])
    require(record.get('schema') == 'FTI_PANEL_COMPLETION_BACKUP_V3' and
            record.get('dropPath') == str(dropin_path()), 'INVALID_BACKUP_RECORD')
    root, stage = safe_path(Path(record['root'])), safe_path(Path(record['stage']))
    require(root.parent == stage.parent, 'UNEXPECTED_STAGED_RELEASE')
    now = unit_properties()
    require(all(now.get(key, '') == record['identity'].get(key, '') for key in IDENTITY_KEYS if key != 'WorkingDirectory') and
            now.get('WorkingDirectory') in (str(root), str(stage)), 'SERVICE_CONFIGURATION_CHANGED')
    metadata = unit_metadata(now)
    require({key: value for key, value in metadata.items() if key != record['dropPath']} == record['unitMetadata'],
            'OTHER_SERVICE_CONFIGURATION_CHANGED')
    require(sha(regular(backup / 'before.html')[0]) == record['beforeHTML'], 'BACKUP_HTML_HASH_MISMATCH')
    require(sha(regular(root / 'web/index.html')[0]) == record['beforeHTML'], 'CONCURRENT_ORIGINAL_HTML_EDIT_PRESERVED')
    check_protected(root, record['protected'])
    drop = dropin_path()
    if drop.exists():
        require(sha(regular(drop)[0]) == record['dropSHA256'], 'CONCURRENT_DROPIN_EDIT_PRESERVED')
        require(sha(regular(stage / 'web/index.html')[0]) == record['afterHTML'], 'CONCURRENT_STAGED_HTML_EDIT_PRESERVED')
        drop.unlink()
        sync_directory(drop.parent)
        reload_units()
    now = unit_properties()
    require(now.get('ExecStart', '') == record['previousExecStart'] and
            now.get('WorkingDirectory') == str(root) and
            now.get('DropInPaths', '') == record['previousDropInPaths'], 'PREVIOUS_EXECSTART_NOT_RESTORED')
    if restarted:
        restart_web()
        deadline = time.monotonic() + 120
        while True:
            try:
                active_service()
                same_public_config(record['config'], config())
                for base in (LOCAL, PUBLIC):
                    for route in ROUTES:
                        served(base + route, regular(root / 'web/index.html')[0])
                break
            except Exception:
                require(time.monotonic() < deadline, 'RESTORED_WEB_VERIFICATION_FAILED')
                time.sleep(2)
    check_protected(root, record['protected'])
    print('FTI_PANEL_COMPLETION_RESTORED', flush=True)


def install_completion(release, apply=False):
    app, sdk, sdk_legal, css, image, runtime, professional = completion_payload(release)
    canonical = canonical_payload(release)
    saved, root = active_service()
    metadata = unit_metadata(saved)
    cfg = config()
    before, _ = regular(root / 'web/index.html')
    entry, css_url, assets = completion_destinations(app, sdk, sdk_legal, css, image)
    baseline_key, baseline, after, original = completion_plan(before, entry, css_url, professional)
    protected = capture_protected(root, release['required'], baseline, official_overlay(before))
    node = node_executable(saved)
    user = pwd.getpwnam(saved['User'])
    account = SimpleNamespace(pw_uid=user.pw_uid, pw_gid=grp.getgrnam(saved['Group']).gr_gid)
    require(shutil.which('nsenter') and shutil.which('setpriv'), 'SERVICE_NAMESPACE_CHECK_TOOLS_REQUIRED')
    try:
        fingerprint_preflight(root, node, cfg, account)
    except Exception as error:
        raise RuntimeError('OLD_RELEASE_' + str(error) + '_SERVICE_UNCHANGED') from None
    folder_name, overlay_content = overlay_files(runtime)
    stage = safe_path(root.parent / release_name(release))
    overlay = stage / folder_name
    drop = dropin_path()
    support = safe_path(SUPPORT_ROOT / (str(cfg['chainId']) + '-' + cfg['binary'].lower()))
    drop_bytes = dropin_code(node, stage, overlay, support)
    already = root == stage and before == after and drop.exists() and regular(drop)[0] == drop_bytes
    for base in (LOCAL, PUBLIC):
        for route in ROUTES:
            served(base + route, before)
        for key, kind in (('app', 'js'), ('entry', 'js'), ('css', 'css'), ('image', 'webp')):
            url = baseline[key]
            served(base + url, regular(root / ('web' + url))[0], kind)
    for data in [*overlay_content.values(), *[data for data, kind in assets.values() if kind == 'js']]:
        subprocess.run([node, '--input-type=module', '--check'], input=data,
                       check=True, capture_output=True, timeout=25)
    require(unit_properties() == saved and unit_metadata(saved) == metadata, 'WEB_PROCESS_CHANGED_DURING_PREFLIGHT')
    check_protected(root, protected)
    if already:
        for name, data in overlay_content.items():
            require(regular(overlay / name)[0] == data, 'INSTALLED_OVERLAY_MISMATCH')
        fingerprint_preflight(stage, node, cfg, account)
        verify_service_cutover(saved, stage, {key: value for key, value in metadata.items() if key != str(drop)},
                               drop, drop_bytes, overlay)
        check_new_web(cfg, after, assets)
        if apply:
            storage_namespace_check(saved, stage, node, cfg, account)
        print('FTI_PANEL_COMPLETION_ALREADY_INSTALLED', flush=True)
        return
    require(original and not drop.exists(), 'MIXED_COMPLETION_INSTALLATION')
    if stage.exists():
        validate_stage(stage, root, release_name(release))
    require(all(Path(value).name < DROP_NAME for value in saved.get('DropInPaths', '').split()),
            'LATER_SERVICE_OVERRIDE_REQUIRES_REVIEW')
    print('FTI_PANEL_COMPLETION_PREFLIGHT_OK', flush=True)
    if not apply:
        return
    support_directory(cfg, account.pw_uid, account.pw_gid)
    # Public/runtime copy is bounded to <=300MB plus the small canonical/overlay
    # payload. No node_modules duplication, credentials or user data is required.
    space = os.statvfs(root)
    require(space.f_bavail * space.f_frsize > 350 * 1024 * 1024 and space.f_favail > 13_000,
            'INSUFFICIENT_FREE_SPACE_OR_INODES')
    backup, record = backup_record(root, stage, before, after, saved, metadata, cfg, protected, drop_bytes)
    print('ROLLBACK_COMMAND=python3 ' + str(backup / 'installer.py') + ' --restore ' + str(backup), flush=True)
    restarted = False
    try:
        if not stage.exists():
            prepare_stage(root, stage, canonical, assets, folder_name, overlay_content, before, after, release_name(release))
        validate_stage(stage, root, release_name(release))
        require(unit_properties() == saved and unit_metadata(saved) == metadata, 'WEB_PROCESS_CHANGED')
        check_protected(root, protected)
        require(regular(root / 'web/index.html')[0] == before, 'CONCURRENT_ORIGINAL_HTML_EDIT')
        subprocess.run([node, '--input-type=module', '--eval',
            'await import(' + json.dumps('./' + folder_name + '/server.mjs') + ')'],
            cwd=stage, check=True, capture_output=True, timeout=30)
        fingerprint_preflight(stage, node, cfg, account)
        require(unit_properties() == saved, 'WEB_PROCESS_CHANGED_BEFORE_SWITCH')
        check_protected(root, protected)
        safe_path(DROP_FOLDER)
        DROP_FOLDER.mkdir(mode=0o755, exist_ok=True)
        require(DROP_FOLDER.stat().st_uid == 0 and not DROP_FOLDER.stat().st_mode & 0o022,
                'UNSAFE_SYSTEMD_DROPIN_DIRECTORY')
        os.chmod(DROP_FOLDER, 0o755)
        create(drop, drop_bytes, 0o644)
        reload_units()
        verify_service_cutover(saved, stage, metadata, drop, drop_bytes, overlay)
        print('FTI_PANEL_COMPLETION_RESTARTING_WEB', flush=True)
        restarted = True
        restart_web()
        wait_web(cfg, after, assets)
        now = verify_service_cutover(saved, stage, metadata, drop, drop_bytes, overlay)
        require(now.get('MainPID') != saved['MainPID'], 'EXPECTED_NEW_WEB_PROCESS')
        storage_namespace_check(now, stage, node, cfg, account)
        check_protected(root, protected)
        fingerprint_preflight(stage, node, cfg, account)
    except BaseException:
        try:
            restore_completion(backup, automatic=True, restarted=restarted)
        except BaseException as rollback_error:
            print('FTI_PANEL_COMPLETION_ROLLBACK_STOPPED: ' + str(rollback_error), file=sys.stderr, flush=True)
        raise
    print('FTI_PANEL_COMPLETION_INSTALLED_WEB_RESTARTED', flush=True)
    print('REAL_WALLET_REGISTRATION_NOT_TESTED', flush=True)


def canonical_sources(root):
    import importlib.util
    spec = importlib.util.spec_from_file_location('canonical_recovery', root / 'tools/recover-mainnet-source.py')
    recovery = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(recovery)
    existing = root / 'tools/install-panel-completion-release.py'
    if existing.exists():
        # CI checks out one commit. Reuse independently hash-pinned canonical
        # source already carried in the committed self-contained release.
        spec = importlib.util.spec_from_file_location('canonical_committed_release', existing)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result = canonical_payload(module.RELEASE)
        require(set(result) == set(recovery.BASELINE), 'CANONICAL_SOURCE_MANIFEST_MISMATCH')
    else:
        result = {}
        for name in recovery.BASELINE:
            item = subprocess.run(['git', '-C', str(root), 'show', CANONICAL_REVISION + ':' + name],
                                   check=True, capture_output=True, timeout=20)
            result[name] = item.stdout
    for name, expected in recovery.BASELINE.items():
        require(sha(result[name]) == expected, 'CANONICAL_SOURCE_PIN_MISMATCH: ' + name)
    return result


def package_completion(root, output):
    app = regular(root / 'web/app.js')[0]
    require(sha(regular(root / 'web/app.js.LEGAL.txt')[0]) == LEGAL, 'LEGAL_NOTICE_CHANGED')
    sdk = regular(root / 'web/vendor/walletconnect.js')[0]
    sdk_legal = regular(root / 'web/vendor/walletconnect.js.LEGAL.txt')[0]
    css = regular(root / 'web/member-reserve-panel.css')[0]
    text = css.decode('utf8')
    urls = re.findall(r'url\(([^)]+)\)', text, flags=re.I)
    require(len(urls) == 1, 'EXPECTED_ONE_PANEL_IMAGE')
    image_url = urls[0].strip(' \t\r\n\"\'')
    require(re.fullmatch(r'(?:\./)?assets/[A-Za-z0-9_-]+\.webp', image_url), 'UNEXPECTED_PANEL_IMAGE')
    image = regular(root / 'web' / image_url)[0]
    css = re.sub(r'url\([^)]+\)', 'url("./' + image_name(image) + '")', text, count=1, flags=re.I).encode()
    runtime = {name: compressed(regular(root / name)[0]) for name in RUNTIME_FILES}
    # Current server dependencies stay byte-identical. This pins source/contract
    # validation, RPC resolution and the existing state/event/referral readers.
    names = ('scripts/mainnet-rpc.mjs', 'scripts/site-routing.mjs',
        'scripts/approved-genesis-layout.mjs', 'scripts/operational-release.mjs',
        'scripts/continuity-release.mjs', 'scripts/lib.mjs', 'core/deployment-network.mjs',
        'core/hourly-cap-policy.mjs', 'core/pool-distribution-policy.mjs', 'core/referral-placement.mjs')
    canonical_bytes = canonical_sources(root)
    required = {name: sorted({sha(regular(root / name)[0]), sha(canonical_bytes[name])}) for name in names}
    import importlib.util
    spec = importlib.util.spec_from_file_location('professional_predecessor', root / 'tools/install-professional-user-panel-release.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    old_app, old_css, old_image = module.payload(module.RELEASE)
    canonical = {name: compressed(data) for name, data in canonical_bytes.items()}
    release = {'schema': 'FTI_PANEL_COMPLETION_V1', 'app': compressed(app), 'sdk': compressed(sdk),
        'sdkLegal': compressed(sdk_legal), 'css': compressed(css), 'image': compressed(image),
        'runtime': runtime, 'required': required, 'canonical': canonical,
        'professional': {key: compressed(value) for key, value in
                         zip(('app', 'css', 'image'), (old_app, old_css, old_image))}}
    completion_payload(release)
    source = regular(Path(__file__).resolve())[0].decode()
    text, count = re.subn(r'(# BEGIN EMBEDDED RELEASE\n).*?(\n# END EMBEDDED RELEASE)',
        lambda m: m[1] + 'RELEASE = json.loads(' + repr(json.dumps(release, sort_keys=True)) + ')' + m[2],
        source, flags=re.S)
    require(count == 1, 'PACKAGE_MARKER_MISMATCH')
    create(output, text.encode(), 0o644)
    print(json.dumps({'installer': str(output), 'sha256': sha(text.encode()),
        'appSHA256': sha(app), 'sdkSHA256': sha(sdk),
        'runtime': {name: item['sha256'] for name, item in runtime.items()}}, sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--package', type=Path)
    actions.add_argument('--restore', type=Path)
    actions.add_argument('--apply', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.package:
        require(args.output is not None, 'PACKAGE_OUTPUT_REQUIRED')
        package_completion(args.package.resolve(), args.output.resolve())
        return
    require(args.output is None and os.geteuid() == 0, 'RUN_ON_FTI_VPS_AS_ROOT')
    os.umask(0o077)
    with open('/run/lock/fti-service-cutover.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def interrupted(*_):
            raise RuntimeError('INTERRUPTED')
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(signum, interrupted)
        if args.restore:
            restore_completion(args.restore)
        else:
            install_completion(RELEASE, args.apply)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('FTI_PANEL_COMPLETION_STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
