#!/usr/bin/env python3
"""Safely stage the FTI website and customer services beside its frozen deployment.

Default: read-only preflight. --apply changes only the web service's owned
drop-in after staging. --restore reselects the intact previous release. Existing
contracts, artifacts, environment files, keeper and private data are preserved.
Build/package in an isolated checkout; the generated installer needs Python 3
only and performs no npm, git checkout or blockchain transaction on the VPS.
"""
import argparse
import base64
import contextlib
import fcntl
import gzip
import grp
import hashlib
import importlib.util
import json
import lzma
import os
from pathlib import Path, PurePosixPath
import posixpath
import pwd
import re
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import types
import urllib.error
import urllib.request

UNIT = 'fti-continuity-web.service'
PUBLIC = 'https://ftiprotocol.com'
RELEASES = Path('/opt/fti/releases')
BACKUPS = Path('/var/backups/fti-site-refresh')
DROP = Path('/etc/systemd/system/fti-continuity-web.service.d/zzzzzzz-fti-site-refresh.conf')
MARKER = '.fti-site-refresh.json'
SCHEMA = 'FTI_SITE_REFRESH_V1'
STAGE_SCHEMA = 'FTI_SITE_REFRESH_STAGE_V1'
BACKUP_SCHEMA = 'FTI_SITE_REFRESH_BACKUP_V1'
MAX_FILES = 5000
MAX_BYTES = 100_000_000
MAX_FILE = 4_000_000
MAINNET_REVISION = 'ba82373a83d63fba0643332371cfb6d62903c849'
EXPECTED = {
    'chainId': 56, 'mode': 'bnb-mainnet', 'release': 'FTI_CONTINUITY_MAINNET_20261013',
    'token': '0x43755B1E813b2d41F669ea08bcf859De07195eA1',
    'binary': '0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9',
    'usd': '0x55d398326f99059fF775485246999027B3197955',
    'sourceRevision': MAINNET_REVISION,
    'sourceFingerprint': 'eaf50289e56998959303757f443b80d38caa7002427f4a5b126f5b00dee3e934',
    'mainnetPlanDigest': '0ec3a7d93f5e1225cbd4f5671f4ee6b92423718898f1734c42390337467f7480',
}
RUNTIME_FILES = (
    'scripts/server.mjs', 'scripts/site-routing.mjs', 'scripts/static-response.mjs', 'scripts/member-history.mjs',
    'scripts/support-tickets.mjs', 'core/history-read-policy.mjs',
    'scripts/history-cache.mjs', 'scripts/state-reader.mjs',
    'scripts/event-history-source.mjs', 'scripts/event-reader.mjs',
    'scripts/market-reader.mjs', 'scripts/content-security-policy.mjs',
    'scripts/referral-placement-index.mjs', 'scripts/customer-services.mjs',
    'scripts/customer-knowledge.mjs', 'scripts/customer-leads.mjs',
    'scripts/customer-vpn.mjs', 'scripts/customer-ai.mjs',
)
CAPABILITIES = ('supportTicketVersion', 'memberHistoryVersion', 'stateReaderVersion',
                'eventHistoryVersion', 'eventHistoryTimeoutMs', 'customerServicesVersion')
PUBLIC_ROUTES = ('/', '/token-site/', '/whitepaper/', '/roadmap/', '/support/', '/vpn/')
MEMBER_ROUTES = ('/app/', '/token/', '/admin/')
ALLOWED_EXTENSIONS = {'.html', '.js', '.css', '.json', '.txt', '.woff', '.woff2',
                      '.webp', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.pdf', '.br', '.gz'}

def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def packed(data):
    return {'sha256': sha(data), 'size': len(data),
            'gzipBase64': base64.b64encode(gzip.compress(data, mtime=0)).decode()}


def unpacked(item):
    require(isinstance(item, dict) and set(item) == {'sha256', 'size', 'gzipBase64'} and
            type(item['size']) is int and 0 <= item['size'] <= MAX_FILE and
            re.fullmatch('[0-9a-f]{64}', item['sha256'] or ''), 'INVALID_PACKAGED_FILE')
    # Bound decompression before trusting the declared size or checksum.
    import io
    raw = base64.b64decode(item['gzipBase64'], validate=True)
    require(len(raw) <= MAX_FILE, 'COMPRESSED_FILE_TOO_LARGE')
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
        result = stream.read(MAX_FILE + 1)
    require(len(result) == item['size'] and sha(result) == item['sha256'], 'PACKAGE_HASH_MISMATCH')
    return result


def release_bundle(value):
    # A single XZ envelope saves repeated public font/asset bytes while the inner
    # manifest retains each file's independent size and SHA-256 checks.
    require(isinstance(value, str) and len(value) <= 100_000_000, 'BUNDLE_SIZE_LIMIT')
    raw = base64.b64decode(value, validate=True)
    decoder = lzma.LZMADecompressor(memlimit=128 * 1024 * 1024)
    decoded = decoder.decompress(raw, max_length=100_000_001)
    require(decoder.eof and not decoder.unused_data and len(decoded) <= 100_000_000,
            'BUNDLE_DECOMPRESSION_LIMIT')
    return json.loads(decoded)


# BEGIN SITE REFRESH PAYLOAD
RELEASE = None
HELPER = None
# END SITE REFRESH PAYLOAD


def load_helper(source=None):
    if source is None and HELPER is not None:
        code = unpacked(HELPER)
    else:
        source = source or Path(__file__).resolve().with_name('install-panel-completion.py')
        require(source.is_file() and not source.is_symlink(), 'REVIEWED_HELPER_REQUIRED')
        code = source.read_bytes()
    module = types.ModuleType('_fti_site_refresh_helpers')
    module.__file__ = str(Path(__file__).resolve())
    exec(compile(code, module.__file__, 'exec'), module.__dict__)
    return module


def relative_name(name, public=False):
    require(isinstance(name, str) and len(name) <= 240 and '\\' not in name,
            'UNSAFE_PACKAGE_PATH')
    path = PurePosixPath(name)
    require(not path.is_absolute() and str(path) == name and len(path.parts) > 0 and
            all(re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]*', part) and part not in ('.', '..')
                for part in path.parts), 'UNSAFE_PACKAGE_PATH')
    if public:
        require(path.suffix.lower() in ALLOWED_EXTENSIONS, 'PRIVATE_OR_UNKNOWN_PACKAGE_FILE')
        if path.suffix.lower() in ('.br', '.gz'):
            require(PurePosixPath(path.stem).suffix.lower() in ('.html', '.js', '.css', '.json', '.svg'),
                    'UNEXPECTED_COMPRESSED_PUBLIC_FILE')
    return path


def decode_files(items, public=False):
    require(isinstance(items, dict) and 1 <= len(items) <= MAX_FILES, 'INVALID_FILE_MANIFEST')
    result = {}
    for name, item in items.items():
        relative_name(name, public)
        result[name] = unpacked(item)
    if public:
        require(all(name.rsplit('.', 1)[0] in result for name in result if name.endswith(('.br', '.gz'))),
                'COMPRESSED_ASSET_WITHOUT_ORIGINAL')
        import io
        for name, data in result.items():
            if name.endswith('.gz'):
                with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
                    actual = stream.read(MAX_FILE + 1)
                require(actual == result[name[:-3]], 'STALE_GZIP_ASSET: ' + name)
    require(sum(map(len, result.values())) <= MAX_BYTES, 'PACKAGE_SIZE_LIMIT')
    return result


def validate_release(release):
    require(isinstance(release, dict) and set(release) ==
            {'schema', 'sourceRevision', 'web', 'landing', 'runtime', 'canonical'} and
            release['schema'] == SCHEMA and release['sourceRevision'] == MAINNET_REVISION,
            'PACKAGED_INSTALLER_REQUIRED')
    web = decode_files(release['web'], True)
    landing = decode_files(release['landing'], True)
    runtime = decode_files(release['runtime'])
    canonical = decode_files(release['canonical'])
    require(set(runtime) == set(RUNTIME_FILES), 'INCOMPLETE_RUNTIME_MANIFEST')
    require({'index.html', 'app.js', 'app.css', 'boot-guard.js', 'style.css',
             'member-landing-theme.css', 'global-interface.css', 'panel-identity.css',
             'member-reserve-panel.css', 'vendor/ethers.js', 'vendor/walletconnect.js',
             'customer-widget.js', 'customer-widget.css'} <= set(web),
            'INCOMPLETE_WORKSPACE_BUILD')
    require(all((route.strip('/') + '/index.html' if route != '/' else 'index.html') in landing
                for route in PUBLIC_ROUTES), 'INCOMPLETE_PUBLIC_ROUTES')
    manifest = json.loads(landing.get('release.json', b'{}'))
    require(set(manifest) == {'files'} and isinstance(manifest['files'], dict) and
            manifest['files'] == {name: sha(data) for name, data in landing.items()
                                  if name != 'release.json'}, 'LANDING_MANIFEST_MISMATCH')
    require(b'customer-services.mjs' in runtime['scripts/server.mjs'] and
            b'./operational-release.mjs' in runtime['scripts/server.mjs'], 'SERVER_WIRING_REQUIRED')
    require('scripts/operational-release.mjs' in canonical and
            'scripts/continuity-release.mjs' in canonical, 'FROZEN_VERIFIER_REQUIRED')
    require(100 <= len(canonical) <= 250 and all(
        PurePosixPath(name).parent.as_posix() in ('contracts', 'frontend', 'scripts', 'core', 'landing/src')
        or name in ('package.json', 'package-lock.json', 'config/mainnet-approved-input.REQUIRED.json',
                    'config/mainnet-council.json', 'config/mainnet-genesis-layout.json',
                    'config/mainnet-usdt-collateral.json', 'config/v3-wallets.json')
        for name in canonical), 'INVALID_CANONICAL_MANIFEST')
    identity = {group: {name: sha(data) for name, data in files.items()}
                for group, files in (('web', web), ('landing', landing), ('runtime', runtime),
                                     ('canonical', canonical))}
    release_id = sha(json.dumps(identity, sort_keys=True, separators=(',', ':')).encode())[:24]
    return {'web': web, 'landing': landing, 'runtime': runtime, 'canonical': canonical,
            'id': release_id, 'name': 'site-refresh-' + release_id}


def overlay_files(runtime, canonical):
    basenames = {PurePosixPath(name).name for name in runtime}
    require(len(basenames) == len(runtime), 'RUNTIME_NAME_COLLISION')
    result = {}
    for name, code in runtime.items():
        def rewrite(match):
            quote, value = match.group(1), match.group(2).decode()
            target = posixpath.normpath(posixpath.join(posixpath.dirname(name), value))
            if target in runtime:
                value = './' + PurePosixPath(target).name
            else:
                require(target in canonical, 'UNPACKAGED_RUNTIME_IMPORT: ' + target)
                value = '../' + target
            return quote + value.encode() + quote
        result[PurePosixPath(name).name] = re.sub(
            rb"([\"'])(\.\.?/[^\"'\r\n]+\.mjs)\1", rewrite, code)
    require(b"'../scripts/operational-release.mjs'" in result['server.mjs'] or
            b'"../scripts/operational-release.mjs"' in result['server.mjs'],
            'CANONICAL_VERIFIER_IMPORT_REQUIRED')
    return result


def rewrite_html(data, prefix, web, landing=False):
    def replace(match):
        head, quote, value = match.group(1), match.group(2), match.group(3).decode()
        name = value[2:] if value.startswith('./') else value[1:] if value.startswith('/') else value
        if name in web and name != 'index.html' and not (landing and name.startswith(('assets/', 'fonts/'))):
            return head + quote + (prefix + name).encode() + quote
        return match.group(0)
    html = re.sub(rb'((?:src|href)=)(["\'])([^"\']+)\2', replace, data)
    require(b'<html' in html and b'<body' in html, 'INVALID_BUILT_HTML')
    return html


def candidate_content(payload):
    prefix = '/fti-site-refresh-' + payload['id'] + '/'
    web = {prefix + name: data for name, data in payload['web'].items()
           if name not in ('index.html', 'index.html.br', 'index.html.gz')}
    index = rewrite_html(payload['web']['index.html'], prefix, payload['web'])
    require((prefix + 'app.js').encode() in index and (prefix + 'app.css').encode() in index,
            'IMMUTABLE_WORKSPACE_ENTRY_REQUIRED')
    landing = dict(payload['landing'])
    for name in list(landing):
        if name.endswith('.html'):
            landing[name] = rewrite_html(landing[name], prefix, payload['web'], landing=True)
            # HTML changed to reference immutable shared widgets. Remove stale
            # compression variants; the server will serve the exact identity.
            landing.pop(name + '.br', None)
            landing.pop(name + '.gz', None)
    landing.pop('release.json.br', None)
    landing.pop('release.json.gz', None)
    landing['release.json'] = (json.dumps({'files': {name: sha(data) for name, data in landing.items()
        if name != 'release.json'}}, sort_keys=True, indent=2) + '\n').encode()
    return index, web, landing


def unit_info(h):
    saved = h.unit_properties()
    # Environment values are intentionally not requested or logged.
    proc = subprocess.run(['systemctl', 'show', UNIT, '--no-pager', '--property=EnvironmentFiles'],
                          check=True, capture_output=True, timeout=15)
    files = []
    for line in proc.stdout.decode().splitlines():
        if not line:
            continue
        require(line.startswith('EnvironmentFiles='), 'UNSUPPORTED_ENVIRONMENT_FILES')
        value = line.split('=', 1)[1]
        if not value:
            continue
        entries = re.findall(r'(/[^\s()]+) \(ignore_errors=(?:yes|no)\)', value)
        require(entries and re.sub(r'(/[^\s()]+) \(ignore_errors=(?:yes|no)\)', '', value).strip() == '',
                'UNSUPPORTED_ENVIRONMENT_FILES')
        files.extend(entries)
    saved['EnvironmentFiles'] = files
    return saved


def file_record(h, path):
    data, info = h.regular(path)
    return {'sha256': sha(data), 'uid': info.st_uid, 'gid': info.st_gid,
            'mode': stat.S_IMODE(info.st_mode), 'size': info.st_size,
            'inode': info.st_ino, 'device': info.st_dev, 'mtime': info.st_mtime_ns}


def configuration_pins(h, saved):
    paths = [saved.get('FragmentPath', ''), *saved.get('DropInPaths', '').split(),
             *saved['EnvironmentFiles']]
    require(paths[0] and len(paths) <= 40, 'UNEXPECTED_UNIT_CONFIGURATION')
    return {path: file_record(h, h.safe_path(path)) for path in paths}


def unchanged_pins(h, pins):
    require(all(file_record(h, Path(name)) == expected for name, expected in pins.items()),
            'CONCURRENT_CONFIGURATION_CHANGE')


def process_settings(h, saved, root):
    pid = saved.get('MainPID', '')
    require(re.fullmatch('[1-9][0-9]*', pid) and
            Path('/proc/' + pid + '/cwd').resolve() == root, 'WEB_PROCESS_CHANGED')
    # Read only the deployment/path/port values needed to preserve semantics.
    raw = Path('/proc/' + pid + '/environ').read_bytes()
    require(len(raw) <= 1_000_000, 'PROCESS_ENVIRONMENT_TOO_LARGE')
    allowed = {'DEPLOYMENT_FILE', 'FTI_SOURCE_REVISION', 'FTI_SUPPORT_DATA_DIR',
               'FTI_CUSTOMER_DATA_DIR', 'HOST', 'PORT'}
    values = {}
    for entry in raw.split(b'\0'):
        key, sep, value = entry.partition(b'=')
        if sep and key.decode('ascii', 'ignore') in allowed:
            values[key.decode('ascii')] = value.decode('utf8')
    node = str(Path('/proc/' + pid + '/exe').resolve(strict=True))
    command = re.fullmatch(r'\{ path=([^;]+) ; argv\[\]=(.*?) ; ignore_errors=(yes|no) \}',
                           saved.get('ExecStart', ''))
    require(command and command[3] == 'no', 'UNSUPPORTED_WEB_EXECSTART')
    argv = shlex.split(command[2])
    require(len(argv) == 2 and Path(argv[0]).is_absolute() and
            Path(argv[0]).resolve() == Path(node) and Path(command[1]).resolve() == Path(node),
            'UNREVIEWED_WEB_NODE_ARGUMENTS')
    entry = h.safe_path(root / argv[1] if not Path(argv[1]).is_absolute() else Path(argv[1]))
    require(entry.is_relative_to(root) and entry.name == 'server.mjs' and entry.is_file(),
            'UNEXPECTED_WEB_ENTRYPOINT')
    require(values.get('FTI_SOURCE_REVISION', MAINNET_REVISION) == MAINNET_REVISION,
            'SOURCE_REVISION_ENVIRONMENT_MISMATCH')
    require(values.get('HOST', '127.0.0.1') == '127.0.0.1', 'EXPECTED_LOOPBACK_WEB_BIND')
    port = values.get('PORT', '3000')
    require(re.fullmatch('[0-9]{1,5}', port) and 1 <= int(port) <= 65535, 'INVALID_WEB_PORT')
    deployment = Path(values.get('DEPLOYMENT_FILE', 'deployments/local.json'))
    # systemd EnvironmentFile entries can override Environment= directives.
    # Refuse a relative deployment path instead of silently changing its meaning
    # when WorkingDirectory moves to the new release.
    require(deployment.is_absolute(), 'ABSOLUTE_DEPLOYMENT_FILE_REQUIRED')
    deployment = h.safe_path(deployment)
    suffix = '56-' + EXPECTED['binary'].lower()
    support = h.safe_path(values.get('FTI_SUPPORT_DATA_DIR', '/var/lib/fti-support/' + suffix))
    customer = h.safe_path(values.get('FTI_CUSTOMER_DATA_DIR', '/var/lib/fti-customer-services/' + suffix))
    require(support != customer and not support.is_relative_to(RELEASES) and
            not customer.is_relative_to(RELEASES) and
            support.is_relative_to(Path('/var/lib')) and customer.is_relative_to(Path('/var/lib')),
            'PRIVATE_DATA_MUST_BE_OUTSIDE_RELEASE')
    return {'node': node, 'entry': str(entry), 'local': 'http://127.0.0.1:' + port,
            'deployment': str(deployment), 'support': str(support), 'customer': str(customer)}


def fetch(h, url, expected=200, method='GET', headers=None, timeout=10, deadline=None, metadata=None):
    if deadline is not None:
        remaining = deadline - time.monotonic()
        require(remaining > 0, 'HTTP_PROBE_DEADLINE')
        timeout = min(timeout, remaining)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), h.NoRedirect())
    req = urllib.request.Request(url, method=method, headers={
        'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity',
        'User-Agent': 'FTI-Site-Refresh/1', **(headers or {})})
    try:
        response = opener.open(req, timeout=timeout)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        data = response.read(MAX_FILE + 1)
        require(response.code == expected and len(data) <= MAX_FILE, 'HTTP_PROBE_FAILED: ' + url)
        if metadata is not None:
            metadata.update({name: response.headers.get(name, '') for name in
                             ('Content-Encoding', 'Cache-Control', 'Vary')})
        return data, response.headers.get_content_type()


def config(h, local, deadline=None):
    values = []
    for origin in (local, PUBLIC):
        data, mime = fetch(h, origin + '/api/config', deadline=deadline)
        value = json.loads(data)
        require(mime == 'application/json' and isinstance(value, dict) and
                all(value.get(key) == expected for key, expected in EXPECTED.items()),
                'UNKNOWN_DEPLOYMENT_REFUSED')
        values.append(value)
    require(values[0] == values[1], 'PUBLIC_LOCAL_DEPLOYMENT_MISMATCH')
    return values[0]


def same_config(before, after):
    strip = lambda data: {key: value for key, value in data.items() if key not in CAPABILITIES}
    require(strip(before) == strip(after), 'FINANCIAL_CONFIG_CHANGED')
    for key in ('supportTicketVersion', 'stateReaderVersion', 'eventHistoryVersion', 'memberHistoryVersion'):
        require(after.get(key, 0) >= before.get(key, 0), 'EXISTING_CAPABILITY_REMOVED')


def route_origin_preflight(h, settings, root):
    # A matching /api/config alone does not prove that the public reverse proxy
    # serves this process's static tree. Reject a stale/different public document
    # before creating data, a backup or a staged release.
    for route, file in (('/', 'landing/dist/index.html'), ('/app/', 'web/index.html')):
        expected = h.regular(root / file)[0]
        for origin in (settings['local'], PUBLIC):
            data, mime = fetch(h, origin + route)
            require(data == expected and mime == 'text/html',
                    'ACTIVE_PUBLIC_ROUTE_MISMATCH: ' + origin + route)


def root_dependencies(h, root, seen=None):
    seen = seen or set()
    require(root not in seen and len(seen) < 8, 'DEPENDENCY_LINK_CYCLE')
    seen.add(root)
    modules = root / 'node_modules'
    if modules.is_symlink():
        marker_path = root / MARKER
        if marker_path.exists():
            record = read_stage(h, root)
            origin = h.safe_path(record['dependencyRoot'])
            require(os.readlink(modules) == str(origin / 'node_modules'), 'DEPENDENCY_LINK_CHANGED')
        else:
            marker, info = h.regular(root / '.fti-panel-completion.json')
            record = json.loads(marker)
            require(info.st_uid == 0 and not info.st_mode & 0o022 and
                    record.get('schema') == 'FTI_PANEL_COMPLETION_STAGE_V1', 'UNSAFE_PREVIOUS_STAGE')
            origin = h.safe_path(record['originalRoot'])
            h.validate_stage(root, origin, root.name)
        require(origin.parent == RELEASES and origin != root, 'UNREVIEWED_DEPENDENCY_ROOT')
        return root_dependencies(h, origin, seen)
    h.safe_path(modules)
    require(modules.is_dir() and modules.stat().st_uid == 0 and not modules.stat().st_mode & 0o022,
            'UNSAFE_NODE_MODULES')
    require(sha(h.regular(modules / 'ethers/dist/ethers.min.js')[0]) == h.ETHERS_SHA,
            'UNREVIEWED_ETHERS_RUNTIME')
    return root


def inventory(h, root):
    result = {}
    total = 0
    for folder, directories, files in os.walk(root, followlinks=False):
        base = Path(folder)
        if base == root and 'node_modules' in directories:
            directories.remove('node_modules')
        for name in directories:
            h.safe_path(base / name)
        for name in files:
            file = base / name
            if base == root and name == MARKER:
                continue
            data, _ = h.regular(file)
            total += len(data)
            result[file.relative_to(root).as_posix()] = sha(data)
            require(len(result) <= 13_000 and total <= 320_000_000, 'STAGED_COPY_LIMIT')
    return result


def read_stage(h, root):
    data, info = h.regular(root / MARKER)
    record = json.loads(data)
    require(info.st_uid == 0 and not info.st_mode & 0o022 and
            record.get('schema') == STAGE_SCHEMA and record.get('files') == inventory(h, root),
            'STAGED_RELEASE_CHANGED')
    require(re.fullmatch('site-refresh-[0-9a-f]{24}', record.get('release', '')) and
            Path(record['originalRoot']).parent == RELEASES and
            Path(record['dependencyRoot']).parent == RELEASES and
            (root / 'node_modules').is_symlink() and
            os.readlink(root / 'node_modules') == str(Path(record['dependencyRoot']) / 'node_modules'),
            'INVALID_STAGED_IDENTITY')
    return record


def immutable_write(h, path, data):
    h.safe_path(path)
    if path.exists():
        require(h.regular(path)[0] == data, 'IMMUTABLE_ASSET_COLLISION: ' + path.name)
        return
    path.parent.mkdir(parents=True, mode=0o755, exist_ok=True)
    for parent in path.parents:
        if parent == RELEASES:
            break
        os.chmod(parent, 0o755)
    h.create(path, data, 0o644)


def stage_release(h, source, stage, dependency_root, payload, index, assets, landing, overlay):
    require(stage.parent == RELEASES and stage != source and stage.is_dir() and not os.listdir(stage),
            'UNSAFE_STAGE')
    os.chmod(stage, 0o755)
    for name in ('web', 'landing/dist', 'artifacts'):
        for child, data in public_build_files(h, source / name).items():
            immutable_write(h, stage / name / child, data)
    for name, data in payload['canonical'].items():
        immutable_write(h, stage / name, data)
    (stage / 'node_modules').symlink_to(dependency_root / 'node_modules', target_is_directory=True)
    for url, data in assets.items():
        immutable_write(h, stage / ('web' + url), data)
    for name, data in overlay.items():
        immutable_write(h, stage / ('site-refresh-runtime-' + payload['id']) / name, data)
    target = stage / 'web/index.html'
    before, info = h.regular(target)
    h.replace(target, before, index, info)
    # An old precompressed entry may never shadow the new HTML.
    for name in ('web/index.html.br', 'web/index.html.gz'):
        target = stage / name
        if target.exists():
            h.regular(target)
            target.unlink()
    for name, data in landing.items():
        target = stage / 'landing/dist' / name
        if name.endswith('.html') or name == 'release.json':
            for extension in ('.br', '.gz'):
                variant = Path(str(target) + extension)
                if variant.exists():
                    h.regular(variant)
                    variant.unlink()
            if target.exists():
                before, info = h.regular(target)
                h.replace(target, before, data, info)
            else:
                immutable_write(h, target, data)
        else:
            immutable_write(h, target, data)
    marker = {'schema': STAGE_SCHEMA, 'originalRoot': str(source),
              'dependencyRoot': str(dependency_root), 'release': payload['name'],
              'files': inventory(h, stage)}
    h.create(stage / MARKER, (json.dumps(marker, sort_keys=True) + '\n').encode(), 0o644)
    h.sync_directory(stage)
    read_stage(h, stage)


def dropin_code(settings, stage, overlay):
    paths = [settings[key] for key in ('node', 'deployment', 'support', 'customer')]
    paths += [str(stage), str(overlay / 'server.mjs')]
    require(all(re.fullmatch('/[A-Za-z0-9_./-]+', value) for value in paths), 'UNSAFE_SYSTEMD_PATH')
    return ('[Service]\nWorkingDirectory=' + str(stage) + '\nExecStart=\nExecStart=' +
        settings['node'] + ' ' + str(overlay / 'server.mjs') + '\n' +
        'Environment=DEPLOYMENT_FILE=' + settings['deployment'] + '\n' +
        'Environment=FTI_SOURCE_REVISION=' + MAINNET_REVISION + '\n' +
        'Environment=FTI_SUPPORT_DATA_DIR=' + settings['support'] + '\n' +
        'Environment=FTI_CUSTOMER_DATA_DIR=' + settings['customer'] + '\n' +
        'ReadWritePaths=' + settings['support'] + ' ' + settings['customer'] + '\n').encode()


def private_directory(h, directory, uid, gid, create=True):
    directory = h.safe_path(directory)
    require(directory.is_relative_to(Path('/var/lib')) and not directory.is_relative_to(RELEASES),
            'UNSAFE_PRIVATE_DATA_PATH')
    parent = directory.parent
    require(parent.parent == Path('/var/lib'), 'UNREVIEWED_PRIVATE_DATA_PARENT')
    if not parent.exists() and create:
        parent.mkdir(mode=0o755)
    if parent.exists():
        require(parent.stat().st_uid == 0 and not parent.stat().st_mode & 0o022, 'UNSAFE_PRIVATE_DATA_PARENT')
    if not directory.exists() and create:
        directory.mkdir(mode=0o700)
        os.chown(directory, uid, gid)
    if directory.exists():
        info = directory.stat()
        require(info.st_uid == uid and info.st_gid == gid and stat.S_IMODE(info.st_mode) == 0o700,
                'PRIVATE_DATA_PERMISSIONS_REQUIRED')


def syntax_and_import(h, settings, overlay, stage=None):
    for data in overlay.values():
        proc = subprocess.run([settings['node'], '--input-type=module', '--check'], input=data,
                              capture_output=True, timeout=20)
        require(proc.returncode == 0, 'RUNTIME_SYNTAX_FAILED')
    if stage is not None:
        folder = next(x.name for x in stage.iterdir() if x.name.startswith('site-refresh-runtime-'))
        proc = subprocess.run([settings['node'], '--input-type=module', '--eval',
            'await import(' + json.dumps('./' + folder + '/server.mjs') + ')'], cwd=stage,
            env={'PATH': str(Path(settings['node']).parent) + ':/usr/bin:/bin', 'NODE_ENV': 'production'},
            capture_output=True, timeout=30)
        require(proc.returncode == 0, 'STAGED_SERVER_IMPORT_FAILED')


def compressed_assets_check(node, files):
    pairs = [[base64.b64encode(data).decode(), sha(files[name[:-3]])]
             for name, data in files.items() if name.endswith('.br')]
    if not pairs:
        return
    program = ("import fs from 'node:fs';import {brotliDecompressSync} from 'node:zlib';"
        "import {createHash} from 'node:crypto';const pairs=JSON.parse(fs.readFileSync(0,'utf8'));"
        "for(const [data,expected] of pairs){const decoded=brotliDecompressSync(Buffer.from(data,'base64'),"
        "{maxOutputLength:4000001});if(createHash('sha256').update(decoded).digest('hex')!==expected)"
        "throw Error('Stale compressed asset');}process.stdout.write('FTI_COMPRESSION_OK');")
    result = subprocess.run([node, '--input-type=module', '--eval', program],
                            input=json.dumps(pairs).encode(), capture_output=True, timeout=30)
    require(result.returncode == 0 and result.stdout == b'FTI_COMPRESSION_OK', 'STALE_BROTLI_ASSET')


def delivery_observation(h, settings, url, expected, deadline):
    metadata = {}
    data, mime = fetch(h, PUBLIC + url, deadline=deadline, metadata=metadata,
        headers={'Accept-Encoding': 'br, gzip;q=0.9, identity;q=0.1'})
    encoding = metadata.get('Content-Encoding', '').strip().lower()
    if encoding == 'br':
        compressed_assets_check(settings['node'], {'asset.js': expected, 'asset.js.br': data})
    elif encoding == 'gzip':
        import io
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
            require(stream.read(MAX_FILE + 1) == expected, 'PUBLIC_GZIP_BYTES_MISMATCH')
    else:
        require(encoding in ('', 'identity') and data == expected, 'PUBLIC_ENCODING_BYTES_MISMATCH')
    cache = metadata.get('Cache-Control', '').lower()
    return {'url': url, 'contentEncoding': encoding or 'identity',
            'immutableCacheObserved': 'immutable' in {v.strip() for v in cache.split(',')} and
                 re.search(r'(?:^|,)\s*max-age=31536000(?:\s*,|\s*$)', cache) is not None,
            'varyAcceptEncodingObserved': 'accept-encoding' in
                {v.strip().lower() for v in metadata.get('Vary', '').split(',')}}


def verify_candidate(h, settings, before_config, index, assets, landing, deadline=None, probe_customer=True):
    deadline = deadline or time.monotonic() + 90
    def get(url, **options):
        return fetch(h, url, deadline=deadline, **options)
    same_config(before_config, config(h, settings['local'], deadline=deadline))
    for origin in (settings['local'], PUBLIC):
        health = json.loads(get(origin + '/health')[0])
        require(health.get('ok') is True and health.get('chainId') == 56 and
                type(health.get('block')) is int and health['block'] > 0, 'FINANCIAL_HEALTH_FAILED')
        if probe_customer:
            customer = json.loads(get(origin + '/api/customer-services/config',
                headers={'Host': 'ftiprotocol.com', 'Origin': PUBLIC})[0])
            require(customer.get('version') == 1 and customer.get('assistant', {}).get('automated') is True and
                    customer.get('assistant', {}).get('mode') in ('guided', 'ai-available') and
                    customer.get('intake', {}).get('available') is True and
                    customer.get('intake', {}).get('retentionDays') == 30 and
                    customer.get('vpn', {}).get('state') in ('not-configured', 'unavailable', 'ready'),
                    'CUSTOMER_SERVICES_HEALTH_FAILED')
        # Read-only unauthenticated probes must not create tickets/leads/signatures.
        get(origin + '/api/support/tickets', expected=401, headers={'Host': 'ftiprotocol.com', 'Origin': PUBLIC})
        for route in MEMBER_ROUTES:
            data, mime = get(origin + route)
            require(data == index and mime == 'text/html', 'MEMBER_HTML_MISMATCH')
        for route in PUBLIC_ROUTES:
            name = route.strip('/') + '/index.html' if route != '/' else 'index.html'
            data, mime = get(origin + route)
            require(data == landing[name] and mime == 'text/html', 'PUBLIC_HTML_MISMATCH')
        # Every immutable JS/CSS referenced by the HTML, plus the main workspace entry.
        urls = {url for url in assets if url.endswith(('.js', '.css'))}
        for name in landing:
            if name.endswith(('.js', '.css')):
                urls.add('/' + name)
        require(len(urls) <= 180, 'HTTP_ASSET_PROBE_LIMIT')
        for url in sorted(urls):
            expected = assets[url] if url in assets else landing[url.lstrip('/')]
            data, mime = get(origin + url)
            allowed = ('text/css',) if url.endswith('.css') else ('text/javascript', 'application/javascript')
            require(data == expected and mime in allowed, 'SERVED_ASSET_MISMATCH: ' + url)
    observed = []
    main = next(url for url in assets if url.endswith('/app.js'))
    observed.append(delivery_observation(h, settings, main, assets[main], deadline))
    public_asset = next((name for name in landing if name.startswith('assets/') and name.endswith('.js')), None)
    if public_asset is not None:
        observed.append(delivery_observation(h, settings, '/' + public_asset, landing[public_asset], deadline))
    return observed


def wait_candidate(h, settings, before_config, index, assets, landing):
    deadline = time.monotonic() + 90
    while True:
        try:
            return verify_candidate(h, settings, before_config, index, assets, landing, deadline=deadline)
        except Exception:
            require(time.monotonic() < deadline, 'NEW_WEB_HEALTH_TIMEOUT')
            time.sleep(2)


def check_before(h, saved, pins, root, canonical, deployment_pin):
    require(unit_info(h) == saved, 'WEB_PROCESS_OR_CONFIGURATION_CHANGED')
    unchanged_pins(h, pins)
    unchanged_pins(h, deployment_pin)
    require(all(sha(h.regular(root / name)[0]) == sha(data) for name, data in canonical.items()),
            'FROZEN_SOURCE_CHANGED')


def atomic_create(h, path, data):
    descriptor, temporary_name = tempfile.mkstemp(prefix='.fti-refresh-drop-', dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            os.fchmod(stream.fileno(), 0o644)
            stream.flush()
            os.fsync(stream.fileno())
        h.publish_stage(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def storage_probe(h, saved, settings, stage, account):
    pid = saved.get('MainPID', '')
    require(Path('/proc/' + pid + '/cwd').resolve() == stage and
            str(Path('/proc/' + pid + '/exe').resolve()) == settings['node'], 'STORAGE_PROBE_PROCESS_CHANGED')
    program = ("import fs from 'node:fs';import path from 'node:path';import {randomBytes} from 'node:crypto';"
        "const file=path.join(process.argv[1],'.fti-refresh-probe-'+randomBytes(12).toString('hex'));"
        "let fd;try{fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);"
        "fs.writeSync(fd,'FTI_STORAGE_PROBE');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.unlinkSync(file);"
        "process.stdout.write('FTI_STORAGE_OK');}finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(file);}}")
    for key in ('support', 'customer'):
        proc = subprocess.run([shutil.which('nsenter'), '--target', pid, '--mount', '--',
            shutil.which('setpriv'), '--reuid=' + str(account.pw_uid), '--regid=' + str(account.pw_gid),
            '--clear-groups', settings['node'], '--input-type=module', '--eval', program, settings[key]],
            cwd=stage, env={'PATH': '/usr/bin:/bin'}, capture_output=True, timeout=20)
        require(proc.returncode == 0 and proc.stdout == b'FTI_STORAGE_OK',
                'PRIVATE_STORAGE_NOT_WRITABLE_IN_SERVICE_NAMESPACE: ' + key)


def backup(h, root, stage, saved, pins, settings, cfg, new_drop):
    h.safe_path(BACKUPS)
    BACKUPS.mkdir(mode=0o700, exist_ok=True)
    require(BACKUPS.stat().st_uid == 0 and stat.S_IMODE(BACKUPS.stat().st_mode) == 0o700,
            'PRIVATE_BACKUP_REQUIRED')
    directory = Path(tempfile.mkdtemp(prefix='refresh-', dir=BACKUPS))
    previous = h.regular(DROP)[0] if DROP.exists() else None
    record = {'schema': BACKUP_SCHEMA, 'root': str(root), 'stage': str(stage),
              'savedUnit': saved, 'unitPins': pins, 'settings': settings, 'config': cfg,
              'newDropHash': sha(new_drop), 'previousDrop': packed(previous) if previous is not None else None,
              'deploymentPin': file_record(h, Path(settings['deployment'])),
              'previousWebHash': sha(h.regular(root / 'web/index.html')[0]),
              'previousLandingHash': sha(h.regular(root / 'landing/dist/index.html')[0])}
    h.create(directory / 'record.json', (json.dumps(record, sort_keys=True) + '\n').encode(), 0o600)
    h.create(directory / 'installer.py', Path(__file__).resolve().read_bytes(), 0o600)
    h.create(directory / 'before-workspace.html', h.regular(root / 'web/index.html')[0], 0o600)
    h.create(directory / 'before-homepage.html', h.regular(root / 'landing/dist/index.html')[0], 0o600)
    h.sync_directory(directory)
    return directory


def verify_switch(h, saved, pins, stage, drop_bytes):
    now = unit_info(h)
    require(all(now.get(key) == saved.get(key) for key in ('User', 'Group', 'FragmentPath', 'EnvironmentFiles')) and
            now.get('WorkingDirectory') == str(stage) and str(DROP) in now.get('DropInPaths', '').split() and
            str(stage / ('site-refresh-runtime-' + stage.name.removeprefix('site-refresh-')) / 'server.mjs')
                in now.get('ExecStart', '') and h.regular(DROP)[0] == drop_bytes,
            'WEB_CUTOVER_CONFIGURATION_MISMATCH')
    unchanged_pins(h, {name: value for name, value in pins.items() if name != str(DROP)})
    expected_paths = set(saved.get('DropInPaths', '').split()) | {str(DROP)}
    require(set(now.get('DropInPaths', '').split()) == expected_paths, 'UNEXPECTED_NEW_SERVICE_OVERRIDE')
    return now


def restore(h, directory, restart=True):
    directory = h.safe_path(directory)
    require(directory.parent == BACKUPS, 'UNEXPECTED_BACKUP_PATH')
    record, info = h.regular(directory / 'record.json')
    require(info.st_uid == 0 and not info.st_mode & 0o077, 'UNSAFE_BACKUP_RECORD')
    record = json.loads(record)
    require(record.get('schema') == BACKUP_SCHEMA, 'UNSUPPORTED_BACKUP_SCHEMA')
    require(sha(h.regular(directory / 'before-workspace.html')[0]) == record['previousWebHash'] and
            sha(h.regular(directory / 'before-homepage.html')[0]) == record['previousLandingHash'],
            'BACKUP_HTML_HASH_MISMATCH')
    root, stage = h.safe_path(record['root']), h.safe_path(record['stage'])
    require(root.parent == stage.parent == RELEASES and root != stage, 'UNSAFE_RESTORE_ROOTS')
    now = unit_info(h)
    saved = record['savedUnit']
    require(all(now.get(key) == saved.get(key) for key in ('User', 'Group', 'FragmentPath', 'EnvironmentFiles')) and
            now.get('WorkingDirectory') in (str(root), str(stage)), 'CONCURRENT_SERVICE_EDIT_PRESERVED')
    unchanged_pins(h, {name: value for name, value in record['unitPins'].items() if name != str(DROP)})
    require(file_record(h, Path(record['settings']['deployment'])) == record['deploymentPin'] and
            sha(h.regular(root / 'web/index.html')[0]) == record['previousWebHash'] and
            sha(h.regular(root / 'landing/dist/index.html')[0]) == record['previousLandingHash'],
            'CONCURRENT_ORIGINAL_EDIT_PRESERVED')
    user = pwd.getpwnam(saved['User'])
    account = types.SimpleNamespace(pw_uid=user.pw_uid, pw_gid=grp.getgrnam(saved['Group']).gr_gid)
    h.fingerprint_preflight(root, record['settings']['node'], record['config'], account)
    previous = unpacked(record['previousDrop']) if record['previousDrop'] is not None else None
    expected = set(saved.get('DropInPaths', '').split()) | ({str(DROP)} if DROP.exists() else set())
    require(set(now.get('DropInPaths', '').split()) <= expected, 'CONCURRENT_DROPIN_SET_PRESERVED')
    if DROP.exists():
        current, mode = h.regular(DROP)
        if sha(current) == record['newDropHash']:
            read_stage(h, stage)
            if previous is None:
                DROP.unlink()
            else:
                h.replace(DROP, current, previous, mode)
            h.sync_directory(DROP.parent)
            h.reload_units()
        else:
            require(previous is not None and current == previous and now.get('WorkingDirectory') == str(root),
                    'CONCURRENT_DROPIN_EDIT_PRESERVED')
    else:
        require(previous is None and now.get('WorkingDirectory') == str(root), 'PREVIOUS_DROPIN_MISSING')
    now = unit_info(h)
    require(all(now.get(key) == saved.get(key) for key in
                ('WorkingDirectory', 'ExecStart', 'DropInPaths', 'EnvironmentFiles')),
            'PREVIOUS_WEB_CONFIGURATION_NOT_RESTORED')
    if restart:
        h.restart_web()
        deadline = time.monotonic() + 90
        while True:
            try:
                h.active_service()
                same_config(record['config'], config(h, record['settings']['local']))
                for origin in (record['settings']['local'], PUBLIC):
                    require(sha(fetch(h, origin + '/app/')[0]) == record['previousWebHash'] and
                            sha(fetch(h, origin + '/')[0]) == record['previousLandingHash'],
                            'RESTORED_HTML_MISMATCH')
                break
            except Exception:
                require(time.monotonic() < deadline, 'PREVIOUS_WEB_HEALTH_TIMEOUT')
                time.sleep(2)
    print('FTI_SITE_REFRESH_RESTORED; private data and all releases retained', flush=True)


def install(h, release, apply=False):
    payload = validate_release(release)
    saved = unit_info(h)
    _, root = h.active_service()
    require(root.parent == RELEASES, 'UNEXPECTED_RELEASE_ROOT')
    pins = configuration_pins(h, saved)
    settings = process_settings(h, saved, root)
    cfg = config(h, settings['local'])
    route_origin_preflight(h, settings, root)
    deployment_data = json.loads(h.regular(Path(settings['deployment']))[0])
    require(all(deployment_data.get(key) == value for key, value in EXPECTED.items()),
            'DEPLOYMENT_FILE_IDENTITY_MISMATCH')
    deployment_pin = {settings['deployment']: file_record(h, Path(settings['deployment']))}
    user = pwd.getpwnam(saved['User'])
    account = types.SimpleNamespace(pw_uid=user.pw_uid, pw_gid=grp.getgrnam(saved['Group']).gr_gid)
    require(shutil.which('nsenter') and shutil.which('setpriv'), 'STORAGE_NAMESPACE_TOOLS_REQUIRED')
    for key in ('support', 'customer'):
        private_directory(h, Path(settings[key]), account.pw_uid, account.pw_gid, create=False)
    # The original verifier must pass BEFORE any directory, data or service mutation.
    h.fingerprint_preflight(root, settings['node'], cfg, account)
    require(all(h.regular(root / name)[0] == data for name, data in payload['canonical'].items()),
            'CANONICAL_SOURCE_BASELINE_MISMATCH')
    dependencies = root_dependencies(h, root)
    index, assets, landing = candidate_content(payload)
    overlay = overlay_files(payload['runtime'], payload['canonical'])
    stage = h.safe_path(RELEASES / payload['name'])
    overlay_root = stage / ('site-refresh-runtime-' + payload['id'])
    new_drop = dropin_code(settings, stage, overlay_root)
    existing_own_drop = DROP.exists()
    if existing_own_drop:
        marker = read_stage(h, root)
        require(root.name == marker['release'] and str(DROP) in saved.get('DropInPaths', '').split(),
                'UNKNOWN_EXISTING_SITE_REFRESH_OVERRIDE')
    require(all(Path(name).name <= DROP.name for name in saved.get('DropInPaths', '').split()),
            'LATER_SERVICE_OVERRIDE_REQUIRES_REVIEW')
    if root == stage:
        require(existing_own_drop and h.regular(DROP)[0] == new_drop, 'MIXED_SITE_REFRESH_STATE')
        delivery = verify_candidate(h, settings, cfg, index, assets, landing, probe_customer=apply)
        print(json.dumps({'publicDeliveryObserved': delivery}, sort_keys=True), flush=True)
        print('FTI_SITE_REFRESH_ALREADY_INSTALLED_AND_HTTP_VERIFIED', flush=True)
        return
    copy_bytes = 0
    for folder in ('web', 'landing/dist', 'artifacts'):
        current = public_build_files(h, root / folder)
        copy_bytes += sum(map(len, current.values()))
        if folder == 'landing/dist':
            for name, data in landing.items():
                if name in current and not name.endswith('.html') and name != 'release.json':
                    require(current[name] == data, 'IMMUTABLE_ASSET_COLLISION: ' + name)
    copy_bytes += sum(map(len, payload['canonical'].values())) + sum(map(len, assets.values()))
    copy_bytes += sum(map(len, landing.values())) + sum(map(len, overlay.values()))
    require(copy_bytes <= 320_000_000, 'STAGED_COPY_ESTIMATE_LIMIT')
    syntax_and_import(h, settings, overlay)
    compressed_assets_check(settings['node'], payload['web'])
    compressed_assets_check(settings['node'], payload['landing'])
    check_before(h, saved, pins, root, payload['canonical'], deployment_pin)
    print(json.dumps({'status': 'FTI_SITE_REFRESH_PREFLIGHT_OK', 'apply': apply,
        'activeRoot': str(root), 'candidateRoot': str(stage), 'publicOrigin': PUBLIC,
        'localOrigin': settings['local'], 'deploymentRevision': cfg['sourceRevision'],
        'workspaceFiles': len(payload['web']), 'landingFiles': len(payload['landing']),
        'runtimeModules': len(overlay), 'webServiceRestarts': 1,
        'maximumStagedBytes': copy_bytes,
        'contractsChanged': False, 'keeperChanged': False, 'providerEnabledByInstaller': False},
        sort_keys=True), flush=True)
    if not apply:
        return
    space = os.statvfs(root)
    require(space.f_bavail * space.f_frsize >= max(400 * 1024 * 1024, copy_bytes + 100 * 1024 * 1024) and space.f_favail >= 14_000,
            'INSUFFICIENT_SPACE_OR_INODES')
    for key in ('support', 'customer'):
        private_directory(h, Path(settings[key]), account.pw_uid, account.pw_gid)
    directory = backup(h, root, stage, saved, pins, settings, cfg, new_drop)
    print('ROLLBACK_COMMAND=python3 ' + str(directory / 'installer.py') + ' --restore ' + str(directory),
          flush=True)
    restarted = False
    switched = False
    temporary = None
    try:
        if stage.exists():
            marker = read_stage(h, stage)
            require(marker['originalRoot'] == str(root) and marker['release'] == payload['name'],
                    'PREEXISTING_STAGE_REQUIRES_REVIEW')
        else:
            temporary = Path(tempfile.mkdtemp(prefix='.site-refresh-', dir=RELEASES))
            stage_release(h, root, temporary, dependencies, payload, index, assets, landing, overlay)
            h.publish_stage(temporary, stage)
            temporary = None
        read_stage(h, stage)
        syntax_and_import(h, settings, overlay, stage)
        h.fingerprint_preflight(stage, settings['node'], cfg, account)
        h.fingerprint_preflight(root, settings['node'], cfg, account)
        check_before(h, saved, pins, root, payload['canonical'], deployment_pin)
        h.safe_path(DROP.parent)
        DROP.parent.mkdir(mode=0o755, exist_ok=True)
        require(DROP.parent.stat().st_uid == 0 and not DROP.parent.stat().st_mode & 0o022,
                'UNSAFE_DROPIN_DIRECTORY')
        if existing_own_drop:
            current, info = h.regular(DROP)
            require(file_record(h, DROP) == pins[str(DROP)], 'CONCURRENT_DROPIN_EDIT')
            h.replace(DROP, current, new_drop, info)
        else:
            atomic_create(h, DROP, new_drop)
        switched = True
        h.sync_directory(DROP.parent)
        h.reload_units()
        verify_switch(h, saved, pins, stage, new_drop)
        print('FTI_SITE_REFRESH_RESTARTING_WEB', flush=True)
        restarted = True
        h.restart_web()
        delivery = wait_candidate(h, settings, cfg, index, assets, landing)
        now = verify_switch(h, saved, pins, stage, new_drop)
        require(now.get('MainPID') != saved.get('MainPID'), 'NEW_WEB_PROCESS_REQUIRED')
        storage_probe(h, now, settings, stage, account)
        read_stage(h, stage)
        h.fingerprint_preflight(stage, settings['node'], cfg, account)
        unchanged_pins(h, deployment_pin)
    except BaseException:
        if switched or DROP.exists() and sha(h.regular(DROP)[0]) == sha(new_drop):
            try:
                with finish_rollback():
                    restore(h, directory, restart=restarted)
            except BaseException as error:
                print('FTI_SITE_REFRESH_ROLLBACK_STOPPED: ' + str(error), file=sys.stderr, flush=True)
        raise
    finally:
        if temporary is not None and temporary.exists():
            require(temporary.parent == RELEASES and temporary.name.startswith('.site-refresh-'),
                    'UNSAFE_TEMP_CLEANUP')
            shutil.rmtree(temporary)
    print('FTI_SITE_REFRESH_INSTALLED_AND_HTTP_VERIFIED', flush=True)
    print(json.dumps({'publicDeliveryObserved': delivery}, sort_keys=True), flush=True)
    print('REAL_WALLET_TRANSACTIONS_AND_EXTERNAL_PROVIDER_ACTIVATION_NOT_TESTED', flush=True)


def public_build_files(h, directory):
    h.safe_path(directory)
    require(directory.is_dir(), 'BUILD_DIRECTORY_MISSING')
    result = {}
    for folder, directories, files in os.walk(directory, followlinks=False):
        for child in directories:
            h.safe_path(Path(folder) / child)
            require(not child.startswith('.'), 'PRIVATE_BUILD_DIRECTORY')
        for child in files:
            file = Path(folder) / child
            name = file.relative_to(directory).as_posix()
            relative_name(name, True)
            result[name] = h.regular(file)[0]
    require(len(result) <= MAX_FILES and sum(map(len, result.values())) <= MAX_BYTES, 'BUILD_SIZE_LIMIT')
    return result


def package(root, output):
    h = load_helper(root / 'tools/install-panel-completion.py')
    # Existing helper pins these canonical files to recover-mainnet-source.py.
    canonical = h.canonical_sources(root)
    release = {'schema': SCHEMA, 'sourceRevision': MAINNET_REVISION,
        'canonical': {name: packed(data) for name, data in canonical.items()},
        'runtime': {name: packed(h.regular(root / name)[0]) for name in RUNTIME_FILES},
        'web': {name: packed(data) for name, data in public_build_files(h, root / 'web').items()},
        'landing': {name: packed(data) for name, data in public_build_files(h, root / 'landing/dist').items()}}
    payload = validate_release(release)
    candidate_content(payload)
    overlay_files(payload['runtime'], payload['canonical'])
    node = shutil.which('node')
    require(node is not None, 'NODE_REQUIRED_FOR_BUILD_PACKAGE_CHECK')
    compressed_assets_check(node, payload['web'])
    compressed_assets_check(node, payload['landing'])
    helper = packed(h.regular(root / 'tools/install-panel-completion.py')[0])
    source = Path(__file__).resolve().read_text()
    blob = lzma.compress(json.dumps(release, sort_keys=True, separators=(',', ':')).encode(), preset=7)
    block = 'RELEASE = release_bundle(' + repr(base64.b64encode(blob).decode()) + ')\n'
    block += 'HELPER = json.loads(' + repr(json.dumps(helper, sort_keys=True)) + ')'
    source, count = re.subn(r'(# BEGIN SITE REFRESH PAYLOAD\n).*?(\n# END SITE REFRESH PAYLOAD)',
                           lambda match: match[1] + block + match[2], source, flags=re.S)
    require(count == 1, 'PACKAGE_MARKER_MISMATCH')
    h.create(output, source.encode(), 0o644)
    print(json.dumps({'installer': str(output), 'sha256': sha(source.encode()),
                      'release': payload['name'], 'bytes': len(source.encode())}, sort_keys=True))


@contextlib.contextmanager
def finish_rollback():
    previous = {number: signal.getsignal(number) for number in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
    try:
        for number in previous:
            signal.signal(number, signal.SIG_IGN)
        yield
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


@contextlib.contextmanager
def mutation_lock():
    path = '/run/lock/fti-service-cutover.lock'
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1,
                'UNSAFE_SERVICE_LOCK')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--package', type=Path)
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--restore', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.package:
        require(args.output is not None, 'PACKAGE_OUTPUT_REQUIRED')
        package(args.package.resolve(), args.output.absolute())
        return
    require(args.output is None and os.geteuid() == 0, 'RUN_ON_FTI_VPS_AS_ROOT')
    require(RELEASE is not None and HELPER is not None, 'USE_SELF_CONTAINED_RELEASE_INSTALLER')
    h = load_helper()
    os.umask(0o077)
    def interrupted(*_):
        raise RuntimeError('INTERRUPTED')
    for number in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(number, interrupted)
    if args.apply or args.restore:
        with mutation_lock():
            if args.restore:
                with finish_rollback():
                    restore(h, args.restore)
            else:
                install(h, RELEASE, True)
    else:
        install(h, RELEASE, False)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('FTI_SITE_REFRESH_STOPPED: ' + str(error), file=sys.stderr, flush=True)
        sys.exit(1)
