#!/usr/bin/env python3
"""Install a pinned web API repair; preserve UI, service configuration and credentials."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
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
BACKUPS = Path('/var/backups/fti-web-api-repair')
BASE_FILES = {'scripts/server.mjs': '31b576910e1d7573d7efd34efa16ecbcc84eb236c72a00579d59acc173a34353',
              'scripts/event-reader.mjs': '14fe424f4f1008f7f873b7a5c32fc13f960f73ac033d099eb15bb9199ad7b008',
              'scripts/market-reader.mjs': '0ddf1d9cf6e6dd48d854c1bf51b2e0e7b5884e984401f32b79f30a56b5c43e36',
              'scripts/state-reader.mjs': None, 'scripts/history-cache.mjs': None,
              'scripts/event-history-source.mjs': None, 'scripts/content-security-policy.mjs': None}
BASE_ALTERNATES = {
    'scripts/server.mjs': ('24acf84c4b74703c47228184b999dc5007a983e7df13ded5814739a400cc957d',),
    'scripts/content-security-policy.mjs': ('30fefc98d19a95e424433ef9d0b5538b15599c52d02311f3bd2ba42fa49961ad',)}
ENTRY = 'scripts/server.mjs'
KNOWN_WALLET = '0xD6492377C2C33047aFE61768930b2aedFF2B2704'
EXPECTED_CONFIG = {'chainId': 56, 'mode': 'bnb-mainnet', 'sourceRevision': 'ba82373a83d63fba0643332371cfb6d62903c849', 'sourceFingerprint': 'eaf50289e56998959303757f443b80d38caa7002427f4a5b126f5b00dee3e934', 'mainnetPlanDigest': '0ec3a7d93f5e1225cbd4f5671f4ee6b92423718898f1734c42390337467f7480', 'binary': '0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9', 'token': '0x43755B1E813b2d41F669ea08bcf859De07195eA1', 'usd': '0x55d398326f99059fF775485246999027B3197955', 'council': '0x85F567C2c59e766847D9dC18328C3B54cDf80DE4', 'timelock': '0xcf3eCA1E96db99E478e81C79f2Ae03dEec80CA86'}
UI_APPS = {'fti-mainnet-ui-f52f5261b5b036f9': '2557e14510a1f017e8b3b6ad3f8957b8c56e85a55d1fdd3ee66e1ef4c0eadef2',
           'fti-mainnet-ui-2c0130354c3b16c3': 'ccea7812f67c925f7ffebc8c5d935e9651cc55fdef4ff40ea170a1b58bda14e1'}
UI_ROUTES = {'/app/': 'web/index.html', '/token/': 'web/index.html', '/admin/': 'web/index.html',
             '/': 'landing/dist/index.html', '/token-site/': 'landing/dist/token-site/index.html',
             '/whitepaper/': 'landing/dist/whitepaper/index.html', '/roadmap/': 'landing/dist/roadmap/index.html'}
IDENTITY_KEYS = ('LoadState', 'User', 'Group', 'WorkingDirectory', 'FragmentPath', 'DropInPaths')
READER_VERSIONS = ('stateReaderVersion', 'eventHistoryVersion')
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
    fd, temporary = tempfile.mkstemp(prefix='.fti-web-api-', dir=file.parent)
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
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'FTI-Web-API-Repair/1'})
    with opener.open(request, timeout=20) as response:
        require(response.status == 200, 'Unexpected HTTP status')
        data = response.read(limit + 1)
        require(len(data) <= limit, 'HTTP response too large')
        return data


def check_web(base, marker=False):
    health = json.loads(fetch(base + '/health'))
    require(health.get('ok') is True and health.get('chainId') == 56 and
            type(health.get('block')) is int and health['block'] > 0, 'Mainnet web health unavailable')
    cfg = json.loads(fetch(base + '/api/config'))
    for key, expected in EXPECTED_CONFIG.items():
        require(cfg.get(key) == expected, 'Wrong mainnet deployment: ' + key)
    require(cfg.get('poolDistributionVersion') == 1 and cfg.get('hourlyCapFlushVersion') == 1,
            'Wrong mainnet pool configuration')
    if marker:
        for key in READER_VERSIONS:
            require(type(cfg.get(key)) is int and cfg[key] == 1, 'New state reader is not active: ' + key)
    return cfg


def capture_ui(root):
    files, routes = {}, dict(UI_ROUTES)
    html = regular(child(root, 'web/index.html'))[0]
    match = re.search(rb'src="/(fti-mainnet-ui-[a-f0-9]{16})/app\.js"', html)
    require(match is not None and match[1].decode() in UI_APPS, 'Unreviewed current workspace UI')
    prefix = match[1].decode()
    require(sha(regular(child(root, 'web/' + prefix + '/app.js'))[0]) == UI_APPS[prefix],
            'Current workspace app checksum mismatch')
    for path in set(UI_ROUTES.values()):
        data = regular(child(root, path))[0]
        files[path] = sha(data)
        for asset in re.findall(rb'(?:src|href)=[\"\'](/(?:assets|fti-mainnet-ui-[a-f0-9]{16})/[^\"\']+\.(?:js|css))[\"\']', data):
            route = asset.decode()
            name = ('landing/dist' if route.startswith('/assets/') else 'web') + route
            routes[route] = name
    for path in set(routes.values()):
        files[path] = sha(regular(child(root, path))[0])
    result = {'files': files, 'routes': {route: files[path] for route, path in routes.items()}}
    check_ui(root, result)
    return result


def check_ui(root, ui):
    for name, digest in ui['files'].items():
        require(sha(regular(child(root, name))[0]) == digest, 'Protected UI changed: ' + name)
    for base in (LOCAL, PUBLIC):
        for route, digest in ui['routes'].items():
            require(sha(fetch(base + route)) == digest, 'Served UI changed: ' + route)


def validate_state(data, wallet=None):
    numeric = ('price supply reserve bb floor ath clock count epoch epochEnd phase level pointPool pending auto '
               'jobCursor jobCount cursor monthPhase nextMonth builderMultiplier cycle cycleStartPrice '
               'calculatedPointValue candidatePoints pointValue totalPaidPoints rewardQueue pointRetained '
               'builderRetained pointAssigned dirtyMembers').split()
    number = lambda value: (type(value) is int and value >= 0) or (isinstance(value, str) and
                            re.fullmatch(r'0|[1-9][0-9]*', value) is not None)
    require(isinstance(data, dict) and all(number(data.get(k)) for k in numeric), 'Incomplete state numeric fields')
    require(all(type(data.get(k)) is bool for k in
                ('paused', 'tokenPaused', 'emergencyUnwind', 'binaryRecoveryFrozen', 'tokenRecoveryFrozen')),
            'Incomplete state pause flags')
    require(all(type(data.get(k)) is int and data[k] > 0 for k in ('block', 'timestamp')) and
            data.get('rewardModel') == 'hourly-global-pool-v2' and
            data.get('pricingModel') == 'zero-start-reserve-v3', 'Incomplete mainnet state identity')
    block_hash = data.get('blockHash')
    require(isinstance(block_hash, str) and re.fullmatch(r'0x[a-fA-F0-9]{64}', block_hash) and
            int(block_hash, 16) > 0, 'Invalid canonical state block hash')
    if 'development' in data:
        value = data['development']
        require(isinstance(value, str) and re.fullmatch(r'0x[a-fA-F0-9]{40}', value) and int(value, 16) > 0,
                'Invalid development address')
    for key in ('account1', 'account2'):
        require(isinstance(data.get(key), list) and len(data[key]) == 2 and all(number(x) for x in data[key]),
                'Incomplete accounting state')
    if wallet:
        row = data.get('wallet', {})
        require(isinstance(row, dict) and str(row.get('address', '')).lower() == wallet.lower() and
                type(row.get('exists')) is bool and all(number(row.get(k)) for k in
                ('units', 'usdBalance', 'ftiBalance', 'unlocked', 'remaining', 'claimable', 'autoPending')),
                'Incomplete requested wallet state')


def same_config(before, after):
    return {k: v for k, v in before.items() if k not in READER_VERSIONS} == {
            k: v for k, v in after.items() if k not in READER_VERSIONS}


def history_response(url):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_):
            raise RuntimeError('Unexpected history HTTP redirect')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache', 'User-Agent': 'FTI-Web-API-Repair/1'})
    try:
        response = opener.open(request, timeout=25)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        data = response.read(8_000_001)
        require(len(data) <= 8_000_000, 'History response too large')
        return {'status': response.status, 'headers': {k.lower(): v for k, v in response.headers.items()},
                'body': data}


def check_history(url, kind):
    response = history_response(url)
    status_code = response['status']
    require(status_code in (200, 503), 'Unexpected history HTTP status: ' + str(status_code))
    data = json.loads(response['body'])
    if status_code == 503:
        require(response['headers'].get('retry-after') == '15', 'History retry interval must be 15 seconds')
        require(isinstance(data, dict) and isinstance(data.get('error'), str) and data['error'].strip() and
                'trades' not in data and 'events' not in data, 'Unavailable history must report an honest error')
        return {'status': 503, 'available': False, 'retryAfter': 15}
    if kind == 'market':
        require(isinstance(data, dict) and 'error' not in data and
                all(type(data.get(k)) is int and data[k] >= 0 for k in ('fromBlock', 'toBlock')) and
                data['fromBlock'] <= data['toBlock'] and isinstance(data.get('trades'), list),
                'Invalid market history response')
    else:
        require(kind == 'events' and isinstance(data, list), 'Invalid activity history response')
    return {'status': 200, 'available': True}


def probe_histories():
    jobs = [(origin, base, kind) for origin, base in (('local', LOCAL), ('public', PUBLIC))
            for kind in ('market', 'events')]
    result = {'local': {}, 'public': {}}
    # Both origins share the server's single-flight work. Each HTTP call has a
    # 25-second bound, and no retry manufactures an empty successful history.
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [(origin, kind, pool.submit(check_history, base + '/api/' + kind, kind))
                   for origin, base, kind in jobs]
        for origin, kind, future in futures:
            result[origin][kind] = future.result()
    return result


def wait_ready(root, before_cfg, ui):
    deadline = time.monotonic() + 180
    while True:
        try:
            cfg = check_web(LOCAL, marker=True)
            require(same_config(before_cfg, cfg), 'Public deployment configuration changed')
            break
        except Exception:
            require(time.monotonic() < deadline, 'Repaired web did not become healthy')
            time.sleep(2)
    for base in (LOCAL, PUBLIC):
        cfg = check_web(base, marker=True)
        require(same_config(before_cfg, cfg), 'Public deployment configuration changed')
        validate_state(json.loads(fetch(base + '/api/state')))
        if KNOWN_WALLET.lower() in [str(x).lower() for x in cfg.get('genesis', [])]:
            validate_state(json.loads(fetch(base + '/api/state?wallet=' + KNOWN_WALLET)), KNOWN_WALLET)
    check_ui(root, ui)
    return probe_histories()


def restart_web():
    run(['systemctl', 'restart', SERVICE], timeout=45)


def run_syntax(root, node, content):
    for data in content.values():
        run([node, '--check', '--input-type=module'], input=data, cwd=root, timeout=20)


def run_import(root, node):
    run([node, '--input-type=module', '--eval', 'await import("./scripts/server.mjs")'], cwd=root, timeout=25)


def check_backend(root, files):
    for name, digest in files.items():
        require(sha(regular(child(root, name))[0]) == digest, 'Backend changed during installation: ' + name)


def release_files(release):
    require(isinstance(release, dict) and release.get('schema') == 'FTI_WEB_API_REPAIR_V1',
            'This source template must be packaged before installation')
    files = release.get('files', {})
    require(set(files) == set(BASE_FILES) and set(release.get('payloads', {})) == set(files),
            'Unexpected backend payload set')
    content, total = {}, 0
    for name, digest in files.items():
        require(re.fullmatch(r'scripts/[A-Za-z0-9_.-]+\.mjs', name) and
                re.fullmatch(r'[a-f0-9]{64}', str(digest)), 'Unsafe backend manifest')
        require(digest != BASE_FILES[name], 'Backend payload must differ from its base')
        compressed = base64.b64decode(release['payloads'][name], validate=True)
        require(len(compressed) <= 4_000_000, 'Compressed backend file too large')
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
            data = stream.read(4_000_001)
        total += len(data)
        require(len(data) <= 4_000_000 and total <= 8_000_000 and sha(data) == digest,
                'Packaged backend checksum mismatch: ' + name)
        content[name] = data
    release_id = sha(json.dumps(files, sort_keys=True).encode())[:16]
    require(release.get('releaseId') == release_id, 'Backend release fingerprint mismatch')
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
    require(record.get('schema') == 'FTI_WEB_API_REPAIR_BACKUP_V1' and
            set(record.get('before', {})) == set(BASE_FILES) and set(record.get('after', {})) == set(BASE_FILES),
            'Invalid backend backup record')
    root = compatible_service(record)
    original = {}
    for name, digest in record['before'].items():
        if digest is not None:
            original[name] = regular(child(backup, 'before/' + name))[0]
            require(sha(original[name]) == digest, 'Backend backup checksum mismatch: ' + name)
    if not automatic:
        for name, after in record['after'].items():
            file = child(root, name)
            if record['before'][name] is None and not os.path.lexists(file):
                continue
            require(sha(regular(file)[0]) in (record['before'][name], after),
                    'Backend changed concurrently; preserve operator edit: ' + name)
    conflicts = []
    # Restore the entrypoint first. Never remove modules needed by a foreign entrypoint.
    for name in [ENTRY, *[n for n in BASE_FILES if n != ENTRY and record['before'][n] is not None]]:
        try:
            file = child(root, name)
            data, info = regular(file)
            if sha(data) == record['before'][name]:
                continue
            require(sha(data) == record['after'][name], 'Foreign backend bytes')
            replace(file, original[name], info)
        except BaseException:
            conflicts.append(name)
            if name == ENTRY:
                break
    try:
        entry_restored = sha(regular(child(root, ENTRY))[0]) == record['before'][ENTRY]
    except Exception:
        entry_restored = False
    existing_conflicts = [name for name in conflicts if record['before'][name] is not None]
    if entry_restored and not existing_conflicts:
        for name in [n for n in BASE_FILES if record['before'][n] is None]:
            try:
                file = child(root, name)
                if not os.path.lexists(file):
                    continue
                require(sha(regular(file)[0]) == record['after'][name], 'Foreign reader bytes')
                file.unlink()
            except BaseException:
                conflicts.append(name)
    if restart_required and entry_restored and not existing_conflicts:
        compatible_service(record)
        restart_web()
        deadline = time.monotonic() + 180
        while True:
            try:
                check_service(properties())
                for base in (LOCAL, PUBLIC):
                    require(same_config(record['config'], check_web(base)), 'Restored deployment configuration changed')
                break
            except Exception:
                require(time.monotonic() < deadline, 'Restored web did not become healthy')
                time.sleep(2)
    require(not conflicts, 'Backend rollback incomplete; operator changes preserved: ' + ', '.join(conflicts))
    print('FTI_WEB_API_REPAIR_RESTORED', flush=True)


def apply(release):
    files, content, release_id = release_files(release)
    saved = properties()
    root = check_service(saved)
    runtime = capture_runtime(saved, root)
    cfg = check_web(LOCAL)
    require(same_config(cfg, check_web(PUBLIC)), 'Origin and public configuration differ')
    ui = capture_ui(root)
    current, infos = {}, {}
    for name, expected in BASE_FILES.items():
        file = child(root, name)
        if not os.path.lexists(file):
            current[name] = None
        else:
            data, infos[name] = regular(file)
            current[name] = sha(data)
    if current == files:
        history = wait_ready(root, cfg, ui)
        print(json.dumps({'result': 'FTI_WEB_API_REPAIR_ALREADY_INSTALLED',
                          'historyAvailable': history}), flush=True)
        return
    for name, expected in BASE_FILES.items():
        require(current[name] in (expected, *BASE_ALTERNATES.get(name, ())),
                'Backend base mismatch: ' + name + '; actualSHA256=' + (current[name] or 'ABSENT'))
    run_syntax(root, runtime['node'], content)
    space = os.statvfs(root)
    require(space.f_bavail * space.f_frsize >= sum(map(len, content.values())) * 3 + 16 * 1024 * 1024 and
            space.f_favail > len(content) + 32, 'Insufficient free space or inodes')
    private_backups()
    backup = Path(tempfile.mkdtemp(prefix='install-', dir=BACKUPS))
    record = {'schema': 'FTI_WEB_API_REPAIR_BACKUP_V1', 'root': str(root), 'before': current,
              'after': files, 'releaseId': release_id, 'config': cfg, 'runtime': runtime,
              'identity': {k: saved.get(k, '') for k in IDENTITY_KEYS},
              'metadata': {name: {'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}
                           for name, info in infos.items()}}
    for name, digest in current.items():
        if digest is not None:
            file = child(backup, 'before/' + name)
            file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            save_new(file, regular(child(root, name))[0])
    save_new(backup / 'record.json', json.dumps(record, sort_keys=True).encode())
    save_new(backup / 'installer.py', regular(Path(__file__).resolve())[0])
    print('ROLLBACK_COMMAND=python3 ' + str(backup / 'installer.py') + ' --restore ' + str(backup), flush=True)
    restart_attempted = False
    try:
        require(properties() == saved and unit_metadata(saved) == runtime['unitMeta'], 'Web process changed during preparation')
        check_ui(root, ui)
        for name, expected in current.items():
            file = child(root, name)
            actual = sha(regular(file)[0]) if os.path.lexists(file) else None
            require(actual == expected, 'Concurrent backend edit: ' + name)
        entry_info = infos[ENTRY]
        for name in [n for n in content if current[n] is None]:
            save_new(child(root, name), content[name], stat.S_IMODE(entry_info.st_mode),
                     (entry_info.st_uid, entry_info.st_gid))
        for name in [n for n in content if current[n] is not None and n != ENTRY and current[n] != files[n]] + [ENTRY]:
            file = child(root, name)
            require(sha(regular(file)[0]) == current[name], 'Concurrent backend edit: ' + name)
            replace(file, content[name], infos[name])
        require(properties() == saved and unit_metadata(saved) == runtime['unitMeta'], 'Web process changed before restart')
        check_backend(root, files)
        run_import(root, runtime['node'])
        require(properties() == saved and unit_metadata(saved) == runtime['unitMeta'],
                'Web process changed during import verification')
        check_ui(root, ui)
        check_backend(root, files)
        print('FTI_WEB_API_REPAIR_RESTARTING_WEB', flush=True)
        restart_attempted = True
        restart_web()
        history = wait_ready(root, cfg, ui)
        after = properties()
        require(check_service(after) == root and after['MainPID'] != saved['MainPID'], 'Expected a new healthy web process')
        require(capture_runtime(after, root) == runtime, 'Web runtime identity changed')
        for name, digest in files.items():
            require(sha(regular(child(root, name))[0]) == digest, 'Backend changed after restart: ' + name)
    except BaseException:
        try:
            restore(backup, automatic=True, restart_required=restart_attempted)
        except BaseException as error:
            print('FTI_WEB_API_REPAIR_ROLLBACK: ' + str(error), file=sys.stderr, flush=True)
        raise
    print(json.dumps({'result': 'FTI_WEB_API_REPAIR_INSTALLED', 'chainId': 56, 'backup': str(backup),
        'releaseId': release_id, 'serviceRestarted': True, 'stateReaderVersion': 1,
        'eventHistoryVersion': 1, 'historyAvailable': history,
        'contractsChanged': False, 'keeperActivated': False, 'uiChanged': False}), flush=True)


def package(root, output):
    content = {name: regular(child(root, name), 4_000_000)[0] for name in BASE_FILES}
    files = {name: sha(data) for name, data in content.items()}
    release = {'schema': 'FTI_WEB_API_REPAIR_V1', 'files': files,
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
        print('FTI_WEB_API_REPAIR_STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
