#!/usr/bin/env python3
"""Install one pinned read-only registration placement module; preserve UI and configuration."""
import argparse
import base64
import fcntl
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import pwd
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error

SERVICE = 'fti-continuity-web.service'
LOCAL = 'http://127.0.0.1:3110'
PUBLIC = 'https://ftiprotocol.com'
RELEASES = Path('/opt/fti/releases')
BACKUPS = Path('/var/backups/fti-registration-placement')
ENTRY = 'scripts/referral-placement-index.mjs'
BASE_FILES = {ENTRY: '48e58fa81d5381262c0f7cf5d4aa9870d86af9f0dca90058c0c49cbac3da4572'}
REQUIRED_FILES = {
    'core/referral-placement.mjs': 'e8802d486c0e1ca8474e715a74613af21ef9e28536cd3b02965d5d24495dc95b',
    'scripts/approved-genesis-layout.mjs': '5c0ba15c023a6d0a0dd08ea1aa109f6129e2d9a5b86294d679ea4d38ad1723fe',
    'config/mainnet-genesis-layout.json': '10296ed628e90ed7322009d2943f9510ff01cac570650f6a5278e28d44921efd',
}
REVIEWED_SERVERS = (
    '31b576910e1d7573d7efd34efa16ecbcc84eb236c72a00579d59acc173a34353',
    '24acf84c4b74703c47228184b999dc5007a983e7df13ded5814739a400cc957d',
    '287907263043ccc612d173031826e10add55c7f6d0ac1df121f50dfcc37f4c77',
)
OPTIONAL_BACKEND = (
    'scripts/event-reader.mjs', 'scripts/market-reader.mjs', 'scripts/state-reader.mjs',
    'scripts/history-cache.mjs', 'scripts/event-history-source.mjs', 'scripts/content-security-policy.mjs',
    'scripts/mainnet-rpc.mjs', 'scripts/site-routing.mjs', 'scripts/operational-release.mjs',
    'scripts/v3-release.mjs', 'scripts/continuity-release.mjs', 'scripts/lib.mjs', 'core/deployment-network.mjs',
)
SPONSOR = '0x87aC0Bd5daD51FEE1bFd813271d171C994620bFF'
EXPECTED_CONFIG = {'chainId': 56, 'mode': 'bnb-mainnet', 'sourceRevision': 'ba82373a83d63fba0643332371cfb6d62903c849', 'sourceFingerprint': 'eaf50289e56998959303757f443b80d38caa7002427f4a5b126f5b00dee3e934', 'mainnetPlanDigest': '0ec3a7d93f5e1225cbd4f5671f4ee6b92423718898f1734c42390337467f7480', 'binary': '0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9', 'token': '0x43755B1E813b2d41F669ea08bcf859De07195eA1', 'usd': '0x55d398326f99059fF775485246999027B3197955', 'council': '0x85F567C2c59e766847D9dC18328C3B54cDf80DE4', 'timelock': '0xcf3eCA1E96db99E478e81C79f2Ae03dEec80CA86'}
UI_ROUTES = {'/app/': 'web/index.html', '/token/': 'web/index.html', '/admin/': 'web/index.html',
             '/': 'landing/dist/index.html', '/token-site/': 'landing/dist/token-site/index.html',
             '/whitepaper/': 'landing/dist/whitepaper/index.html', '/roadmap/': 'landing/dist/roadmap/index.html'}
IDENTITY_KEYS = ('LoadState', 'User', 'Group', 'WorkingDirectory', 'FragmentPath', 'DropInPaths')
# BEGIN EMBEDDED RELEASE
RELEASE = None
# END EMBEDDED RELEASE


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def child(root, name):
    require(name and not Path(name).is_absolute() and '..' not in Path(name).parts, 'Unsafe file path')
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


def save_new(file, data, mode=0o600, owner=None):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        os.fchmod(stream.fileno(), mode)
        if owner is not None and os.geteuid() == 0:
            os.fchown(stream.fileno(), *owner)
        stream.flush()
        os.fsync(stream.fileno())


def replace(file, data, info):
    fd, temporary = tempfile.mkstemp(prefix='.fti-registration-placement-', dir=file.parent)
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


def run(argv, **kwargs):
    result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=kwargs.pop('timeout', 30), **kwargs)
    require(result.returncode == 0, 'Command failed: ' + Path(argv[0]).name)
    return result.stdout.decode()


def properties():
    text = run(['systemctl', 'show', SERVICE,
        '--property=LoadState,ActiveState,SubState,User,Group,WorkingDirectory,MainPID,FragmentPath,DropInPaths'])
    return dict(line.split('=', 1) for line in text.splitlines() if '=' in line)


def check_service(saved, active=True):
    require(saved.get('LoadState') == 'loaded' and saved.get('User') == saved.get('Group') == 'fti-v3',
            'Unexpected FTI web service identity')
    root = Path(saved.get('WorkingDirectory', ''))
    require(root.parent == RELEASES and root.resolve() == root and root.is_dir(), 'Unexpected web release')
    if active:
        require(saved.get('ActiveState') == 'active' and saved.get('SubState') == 'running' and
                int(saved.get('MainPID', '0')) > 1, 'Expected an active FTI web process')
    return root


def unit_metadata(saved):
    # Record metadata only: never read unit contents, environment or RPC credentials.
    paths = [saved.get('FragmentPath', ''), *saved.get('DropInPaths', '').split()]
    require(paths[0] and all(Path(x).is_absolute() for x in paths), 'Unexpected unit paths')
    result = {}
    for path in paths:
        info = os.stat(path)
        result[path] = [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
                        info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)]
    return result


def capture_runtime(saved, root):
    proc = Path('/proc') / saved['MainPID']
    require(proc.stat().st_uid == pwd.getpwnam('fti-v3').pw_uid and (proc / 'cwd').resolve() == root,
            'Unexpected web process ownership or directory')
    node = (proc / 'exe').resolve(strict=True)
    require(str(node).startswith('/opt/fti/runtime/node-v22.') and node.name == 'node',
            'Expected the existing FTI Node 22 runtime')
    require(properties() == saved, 'Web process changed during inspection')
    return {'node': str(node), 'unitMeta': unit_metadata(saved)}


def fetch(url, limit=8_000_000):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_):
            raise RuntimeError('Unexpected HTTP redirect')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'FTI-Registration-Placement/1'})
    with opener.open(request, timeout=20) as response:
        require(response.status == 200, 'Unexpected HTTP status')
        data = response.read(limit + 1)
        require(len(data) <= limit, 'HTTP response too large')
        return data


def check_web(base):
    health = json.loads(fetch(base + '/health'))
    require(health.get('ok') is True and health.get('chainId') == 56 and
            type(health.get('block')) is int and health['block'] > 0, 'Mainnet web health unavailable')
    cfg = json.loads(fetch(base + '/api/config'))
    for key, expected in EXPECTED_CONFIG.items():
        require(cfg.get(key) == expected, 'Wrong mainnet deployment: ' + key)
    require(cfg.get('poolDistributionVersion') == 1 and cfg.get('hourlyCapFlushVersion') == 1,
            'Wrong mainnet pool configuration')
    require(cfg.get('referralPlacementEnabled') is True, 'Referral placement is not enabled')
    return cfg


def capture_ui(root):
    files, routes = {}, dict(UI_ROUTES)
    html = regular(child(root, 'web/index.html'))[0]
    match = re.search(rb'src="/(fti-mainnet-ui-[a-f0-9]{16})/app\.js"', html)
    require(match is not None, 'Expected a versioned workspace UI')
    prefix = match[1].decode()
    for path in set(UI_ROUTES.values()):
        data = regular(child(root, path))[0]
        files[path] = sha(data)
        for asset in re.findall(rb'(?:src|href)=[\"\'](/(?:assets|fti-mainnet-ui-[a-f0-9]{16})/[^\"\']+\.(?:js|css))[\"\']', data):
            route = asset.decode()
            routes[route] = ('landing/dist' if route.startswith('/assets/') else 'web') + route
    # Preserve the active app's complete immutable tree, including its existing
    # fonts and wallet SDK, without restricting the UI to older release IDs.
    for folder in ('web/' + prefix, 'landing/dist/assets'):
        directory = child(root, folder)
        require(directory.is_dir(), 'Missing protected UI assets')
        for file in directory.rglob('*'):
            name = file.relative_to(root).as_posix()
            child(root, name)
            if file.is_dir():
                continue
            files[name] = sha(regular(file)[0])
            require(len(files) <= 2048, 'Unexpected protected UI size')
    for path in set(routes.values()):
        files[path] = sha(regular(child(root, path))[0])
    result = {'files': files, 'routes': {route: files[path] for route, path in routes.items()}}
    check_ui(root, result)
    return result


def check_ui_files(root, ui):
    for name, digest in ui['files'].items():
        require(sha(regular(child(root, name))[0]) == digest, 'Protected UI changed: ' + name)


def check_ui(root, ui):
    check_ui_files(root, ui)
    for base in (LOCAL, PUBLIC):
        for route, digest in ui['routes'].items():
            require(sha(fetch(base + route)) == digest, 'Served UI changed: ' + route)


def capture_dependencies(root):
    result = {}
    for name, expected in REQUIRED_FILES.items():
        result[name] = sha(regular(child(root, name))[0])
        require(result[name] == expected, 'Required dependency differs: ' + name + '; actualSHA256=' + result[name])
    server = 'scripts/server.mjs'
    result[server] = sha(regular(child(root, server))[0])
    require(result[server] in REVIEWED_SERVERS,
            'Unreviewed web server; actualSHA256=' + result[server])
    for name in OPTIONAL_BACKEND:
        file = child(root, name)
        result[name] = sha(regular(file)[0]) if os.path.lexists(file) else None
    return result


def check_dependencies(root, expected):
    require(capture_dependencies(root) == expected, 'Protected backend changed during installation')


def rpc_anchor(base, block):
    body = json.dumps([
        {'jsonrpc': '2.0', 'id': 1, 'method': 'eth_chainId', 'params': []},
        {'jsonrpc': '2.0', 'id': 2, 'method': 'eth_getBlockByNumber', 'params': [hex(block), False]},
    ]).encode()
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_):
            raise RuntimeError('Unexpected placement RPC redirect')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(base + '/rpc', data=body, method='POST', headers={
        'Content-Type': 'application/json', 'Cache-Control': 'no-cache',
        'User-Agent': 'FTI-Registration-Placement/1'})
    with opener.open(request, timeout=20) as response:
        require(response.status == 200, 'Canonical placement RPC unavailable')
        raw = response.read(1_000_001)
        require(len(raw) <= 1_000_000, 'Canonical placement RPC response too large')
    rows = json.loads(raw)
    require(isinstance(rows, list) and len(rows) == 2 and all(isinstance(x, dict) for x in rows),
            'Invalid canonical placement RPC response')
    values = {row.get('id'): row.get('result') for row in rows if 'error' not in row}
    require(set(values) == {1, 2} and values[1] == '0x38' and isinstance(values[2], dict),
            'Wrong canonical placement network or block')
    return values[2]


def check_placement(base):
    data = json.loads(fetch(base + '/api/placement?referrer=' + SPONSOR))
    address = lambda value: isinstance(value, str) and re.fullmatch(r'0x[a-fA-F0-9]{40}', value) and int(value, 16) > 0
    integer = lambda value, low, high: type(value) is int and low <= value <= high
    require(isinstance(data, dict) and address(data.get('referrer')) and
            data['referrer'].lower() == SPONSOR.lower() and address(data.get('placementParent')),
            'Invalid placement referrer or parent')
    require(data.get('side') in ('left', 'right') and data.get('source') == 'canonical-state' and
            type(data.get('chainId')) is int and data['chainId'] == 56, 'Invalid canonical placement identity')
    require(integer(data.get('depth'), 1, 64) and integer(data.get('placementParentDepth'), 0, 63) and
            integer(data.get('visited'), 1, 4096) and integer(data.get('block'), 1, 2 ** 53 - 1),
            'Invalid placement bounds')
    same_parent = data['placementParent'].lower() == SPONSOR.lower()
    require(same_parent == (data['depth'] == 1) and data['depth'] <= data['placementParentDepth'] + 1 and
            data['visited'] >= data['depth'],
            'Inconsistent placement ancestry metadata')
    block_hash = data.get('blockHash')
    require(isinstance(block_hash, str) and re.fullmatch(r'0x[a-fA-F0-9]{64}', block_hash) and
            int(block_hash, 16) > 0, 'Invalid canonical placement block hash')
    header = rpc_anchor(base, data['block'])
    require(header.get('number') == hex(data['block']) and
            isinstance(header.get('hash'), str) and header['hash'].lower() == block_hash.lower(),
            'Placement block is not canonical')
    health = json.loads(fetch(base + '/health'))
    require(health.get('ok') is True and health.get('chainId') == 56 and
            type(health.get('block')) is int and 0 <= health['block'] - data['block'] <= 64,
            'Placement block is not current')
    return {key: data[key] for key in ('referrer', 'placementParent', 'side', 'depth', 'visited',
        'source', 'chainId', 'block', 'blockHash', 'placementParentDepth')}


def transient_placement_error(error):
    return ((isinstance(error, urllib.error.HTTPError) and error.code in (429, 503)) or
            isinstance(error, TimeoutError) or
            (isinstance(error, urllib.error.URLError) and isinstance(error.reason, TimeoutError)))


def wait_ready(root, before_cfg, ui, protected=None):
    deadline = time.monotonic() + 180
    protected = capture_dependencies(root) if protected is None else protected
    installed = {ENTRY: sha(regular(child(root, ENTRY))[0])}
    while True:
        try:
            require(check_service(properties()) == root, 'Web release changed')
            require(check_web(LOCAL) == before_cfg, 'Public deployment configuration changed')
            break
        except Exception:
            require(time.monotonic() < deadline, 'Repaired web did not become healthy')
            time.sleep(2)
    result = {}
    for name, base in (('local', LOCAL), ('public', PUBLIC)):
        require(check_web(base) == before_cfg, 'Public deployment configuration changed')
        while True:
            require(time.monotonic() < deadline, 'Placement postflight deadline exceeded')
            require(check_service(properties()) == root, 'Web release changed during placement verification')
            check_dependencies(root, protected)
            check_backend(root, installed)
            check_ui_files(root, ui)
            try:
                result[name] = check_placement(base)
                break
            except Exception as error:
                if not transient_placement_error(error):
                    raise
                require(time.monotonic() < deadline, 'Placement service remained temporarily unavailable')
                time.sleep(2)
    check_ui(root, ui)
    return result


def restart_web():
    run(['systemctl', 'restart', SERVICE], timeout=45)


def run_syntax(root, node, content):
    for data in content.values():
        run([node, '--check', '--input-type=module'], input=data, cwd=root, timeout=20)


def run_import(root, node):
    run([node, '--input-type=module', '--eval', 'await import("./scripts/referral-placement-index.mjs")'],
        cwd=root, timeout=25)


def check_backend(root, files):
    for name, digest in files.items():
        require(sha(regular(child(root, name))[0]) == digest, 'Placement module changed during installation: ' + name)


def release_files(release):
    require(isinstance(release, dict) and release.get('schema') == 'FTI_REGISTRATION_PLACEMENT_V1',
            'This source template must be packaged before installation')
    require(set(release) == {'schema', 'files', 'payloads', 'releaseId'}, 'Unexpected release fields')
    files = release.get('files', {})
    require(set(files) == set(BASE_FILES) and set(release.get('payloads', {})) == set(files),
            'Unexpected placement payload set')
    content = {}
    for name, digest in files.items():
        require(name == ENTRY and re.fullmatch(r'[a-f0-9]{64}', str(digest)), 'Unsafe placement manifest')
        require(digest != BASE_FILES[name], 'Placement payload must differ from its base')
        compressed = base64.b64decode(release['payloads'][name], validate=True)
        require(len(compressed) <= 4_000_000, 'Compressed placement file too large')
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
            data = stream.read(4_000_001)
        require(len(data) <= 4_000_000 and sha(data) == digest, 'Packaged placement checksum mismatch')
        content[name] = data
    release_id = sha(json.dumps(files, sort_keys=True).encode())[:16]
    require(release.get('releaseId') == release_id, 'Placement release fingerprint mismatch')
    return files, content, release_id


def private_backups():
    require(not BACKUPS.is_symlink(), 'Unexpected backup directory')
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = BACKUPS.stat()
    require(info.st_uid == 0 and not info.st_mode & 0o077, 'Private root-owned backup directory required')


def compatible_service(record):
    saved = properties()
    root = check_service(saved, active=False)
    require(str(root) == record['root'] and all(saved.get(k, '') == record['identity'].get(k, '')
            for k in IDENTITY_KEYS) and unit_metadata(saved) == record['runtime']['unitMeta'],
            'Web service configuration changed; preserve concurrent deployment')
    return root


def restore(backup, automatic=False, restart_required=True):
    require(backup.parent == BACKUPS and backup.resolve() == backup and backup.is_dir(), 'Unexpected backup path')
    record = json.loads(regular(child(backup, 'record.json'))[0])
    require(record.get('schema') == 'FTI_REGISTRATION_PLACEMENT_BACKUP_V1' and
            set(record.get('before', {})) == {ENTRY} and set(record.get('after', {})) == {ENTRY},
            'Invalid placement backup record')
    root = compatible_service(record)
    original = regular(child(backup, 'before/' + ENTRY))[0]
    require(sha(original) == record['before'][ENTRY], 'Placement backup checksum mismatch')
    file = child(root, ENTRY)
    data, info = regular(file)
    require(sha(data) in (record['before'][ENTRY], record['after'][ENTRY]),
            'Placement module changed concurrently; preserve operator edit')
    if sha(data) == record['after'][ENTRY]:
        replace(file, original, info)
    require(sha(regular(file)[0]) == record['before'][ENTRY], 'Placement module rollback verification failed')
    if restart_required:
        compatible_service(record)
        check_dependencies(root, record['protected'])
        restart_web()
        deadline = time.monotonic() + 180
        while True:
            try:
                require(check_service(properties()) == root, 'Restored web release changed')
                for base in (LOCAL, PUBLIC):
                    require(check_web(base) == record['config'], 'Restored deployment configuration changed')
                break
            except Exception:
                require(time.monotonic() < deadline, 'Restored web did not become healthy')
                time.sleep(2)
    print('FTI_REGISTRATION_PLACEMENT_RESTORED', flush=True)


def apply(release):
    files, content, release_id = release_files(release)
    saved = properties()
    root = check_service(saved)
    runtime = capture_runtime(saved, root)
    protected = capture_dependencies(root)
    cfg = check_web(LOCAL)
    require(cfg == check_web(PUBLIC), 'Origin and public configuration differ')
    ui = capture_ui(root)
    data, info = regular(child(root, ENTRY))
    current = {ENTRY: sha(data)}
    if current == files:
        placement = wait_ready(root, cfg, ui, protected)
        check_dependencies(root, protected)
        check_backend(root, files)
        require(properties() == saved, 'Web process changed during verification')
        print(json.dumps({'result': 'FTI_REGISTRATION_PLACEMENT_ALREADY_INSTALLED',
                          'placementChecks': placement, 'serviceRestarted': False}), flush=True)
        return
    require(current == BASE_FILES, 'Placement base mismatch; actualSHA256=' + current[ENTRY])
    run_syntax(root, runtime['node'], content)
    space = os.statvfs(root)
    require(space.f_bavail * space.f_frsize >= sum(map(len, content.values())) * 3 + 16 * 1024 * 1024 and
            space.f_favail > 33, 'Insufficient free space or inodes')
    private_backups()
    backup = Path(tempfile.mkdtemp(prefix='install-', dir=BACKUPS))
    record = {'schema': 'FTI_REGISTRATION_PLACEMENT_BACKUP_V1', 'root': str(root), 'before': current,
              'after': files, 'releaseId': release_id, 'config': cfg, 'runtime': runtime,
              'protected': protected, 'identity': {key: saved.get(key, '') for key in IDENTITY_KEYS}}
    original = child(backup, 'before/' + ENTRY)
    original.parent.mkdir(mode=0o700, parents=True)
    save_new(original, data)
    save_new(backup / 'record.json', json.dumps(record, sort_keys=True).encode())
    save_new(backup / 'installer.py', regular(Path(__file__).resolve())[0])
    print('ROLLBACK_COMMAND=python3 ' + str(backup / 'installer.py') + ' --restore ' + str(backup), flush=True)
    restart_attempted = False
    try:
        require(properties() == saved and unit_metadata(saved) == runtime['unitMeta'], 'Web process changed during preparation')
        check_ui(root, ui)
        check_dependencies(root, protected)
        check_backend(root, current)
        replace(child(root, ENTRY), content[ENTRY], info)
        require(properties() == saved and unit_metadata(saved) == runtime['unitMeta'], 'Web process changed before restart')
        check_dependencies(root, protected)
        check_backend(root, files)
        run_import(root, runtime['node'])
        require(properties() == saved and unit_metadata(saved) == runtime['unitMeta'], 'Web process changed during import verification')
        check_ui(root, ui)
        check_dependencies(root, protected)
        check_backend(root, files)
        print('FTI_REGISTRATION_PLACEMENT_RESTARTING_WEB', flush=True)
        restart_attempted = True
        restart_web()
        placement = wait_ready(root, cfg, ui, protected)
        after = properties()
        require(check_service(after) == root and after['MainPID'] != saved['MainPID'], 'Expected a new healthy web process')
        require(capture_runtime(after, root) == runtime, 'Web runtime identity changed')
        check_dependencies(root, protected)
        check_backend(root, files)
    except BaseException:
        try:
            restore(backup, automatic=True, restart_required=restart_attempted)
        except BaseException as error:
            print('FTI_REGISTRATION_PLACEMENT_ROLLBACK: ' + str(error), file=sys.stderr, flush=True)
        raise
    print(json.dumps({'result': 'FTI_REGISTRATION_PLACEMENT_INSTALLED', 'chainId': 56,
        'backup': str(backup), 'releaseId': release_id, 'serviceRestarted': True,
        'placementChecks': placement, 'contractsChanged': False, 'keeperActivated': False,
        'uiChanged': False, 'serverChanged': False, 'rpcChanged': False}), flush=True)


def package(root, output):
    content = {name: regular(child(root, name), 4_000_000)[0] for name in BASE_FILES}
    files = {name: sha(data) for name, data in content.items()}
    release = {'schema': 'FTI_REGISTRATION_PLACEMENT_V1', 'files': files,
        'payloads': {name: base64.b64encode(gzip.compress(data, mtime=0)).decode() for name, data in content.items()},
        'releaseId': sha(json.dumps(files, sort_keys=True).encode())[:16]}
    release_files(release)
    source = regular(Path(__file__).resolve())[0].decode()
    text, count = re.subn(r'(# BEGIN EMBEDDED RELEASE\n).*?(\n# END EMBEDDED RELEASE)',
        lambda match: match[1] + 'RELEASE = json.loads(' + repr(json.dumps(release, sort_keys=True)) + ')' + match[2], source, flags=re.S)
    require(count == 1, 'Package marker mismatch')
    save_new(output, text.encode(), 0o644)
    print(json.dumps({'installer': str(output), 'sha256': sha(text.encode()), 'releaseId': release['releaseId'],
                      'files': files}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--package', type=Path)
    action.add_argument('--restore', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.package:
        require(args.output is not None, '--package requires --output')
        package(args.package.resolve(), args.output)
        return
    require(args.output is None, '--output requires --package')
    require(os.geteuid() == 0, 'Run this packaged installer on the FTI VPS as root')
    os.umask(0o077)
    with open('/run/lock/fti-service-cutover.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def interrupted(*_):
            raise RuntimeError('Interrupted')
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(signum, interrupted)
        if args.restore:
            restore(args.restore)
        else:
            apply(RELEASE)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('FTI_REGISTRATION_PLACEMENT_STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
