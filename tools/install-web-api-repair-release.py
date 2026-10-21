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
RELEASE = json.loads('{"files": {"scripts/content-security-policy.mjs": "30fefc98d19a95e424433ef9d0b5538b15599c52d02311f3bd2ba42fa49961ad", "scripts/event-history-source.mjs": "ca89f0ec0dbab0dd23e28a07bc4f32b415f7eba0938551eb8e7db019de54aea4", "scripts/event-reader.mjs": "69c85004d5cfd002240c350191167821bb329feb4f3ae380514fed1bd069f39d", "scripts/history-cache.mjs": "b45b788405ad1d601d55fb2c16bb9feb1bba91acdea316b928102371043b21f3", "scripts/market-reader.mjs": "36c990571c3a4fe5b7f78d06ed3c88b1a7fd1ce03a6a19ddafbbb7f28991097e", "scripts/server.mjs": "287907263043ccc612d173031826e10add55c7f6d0ac1df121f50dfcc37f4c77", "scripts/state-reader.mjs": "405eca8bc7e0bebf3aeb36ae06066511ffd5653f594dba16ce49d00a83c4f6c3"}, "payloads": {"scripts/content-security-policy.mjs": "H4sIAAAAAAACA51SQU7DMBC85xUrhGRANDlwaw8IcUIgUYEQVxxn0xg562i9IUQVfyeGoLaoraBHj2dmZ+zNMnjWzqGArfUCA2hGKFFMhQXkPVw1za0V0FRAYUPjdD/gUrFvFxU8PdylhlEL3uevaCSekyyDOXI9iHLn88gJ4Mn1UHoeh5x/+X2BXYU0Jrj2RIMJ2ABIOndYpAm+N54FypaMWE9gPAmSPKJp2Uo/986a/qRb18/Zxyw3xSksE2CUlgleCix162QS2IAK6Eo1g2DYNr8g6R2uIXC83G5+eaRaCrrEiSVnCdXRVKmPWQwYeX+zqESaMM2ys/SbMYpT42vYded5AV3Ypdp+EzUrP0bf0cYM3di0w/yi9oV2kT2WsfVivUihRU/31In/PYVDSx0SsBzW4U9PrX6coiKsJqjRh3WN/zN6Q7Zlv6fjVsIQfWOkJoNBPAdQ5IctmkGuA06G5R6Bl1nykXwCxIyf+aUDAAA=", "scripts/event-history-source.mjs": "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", "scripts/event-reader.mjs": "H4sIAAAAAAACA31Vy47bNhTd+yuYlcVYIztdNTbkQRIEaIFJ2qbdTWdBSVcSE4lUScqPWv73HpL25IHpAIMReXl5H+ecSy+X7M+hk45p1R2ZUIwO2JYwGKEaurHyX2KGPlPppFYZ+2PUTsCvYg4OdtDGsVrIbjRkWaVnyyVT2jHZD0bviO1bUsy1xKzoif0zkjkyaRFwIOGoYrU2DJ4Nblu5I5Rge9F1ZGJ6m83qUYXU0fCX1nfCNJSQMdrw04yVWlnHetwX8M/vw8FtdjGkl61tUeiH721Pe0pV6x/PHrJado5Mcsi37jiQrtkhz/O5dUaqZs6zz1qqZM6wcvpO78m8E5YSvpmhUzcaxZbJ7brodPnlb/syNDKF/zx7iYNO9tJNTmvmN769aS8r4hMdSqKKh6NeqGM4142dANfYOcuniGhMAjh7bQhwCzVFT+Y9ByBEjHsmv0l3ib3MHFmXXPFDyWfP4Vs9qgoBfYxBNFKJSP9H2nluKPDu1dIPDpyNZYkAke1Pv7/zBRlJO9EFbVCVzSCrcMUeVcm+ckqier8j5Wzi9YKmTQpCIa3S2bQ2uk+dTntx+ETo1Dqb/7xKT1Y2SnTn/HT2AujIsRKasflqE8VgqNSmghYeQMCPGT3syTVHqiDLtNNpK30oFiPfZq41ev9r/aZAzVQFIpmsk8UiJNp+UxAPruy910syf4MkOwlEIgjBhRVj1aDGCDhVm4DOkXUYADMPoX0LntcN7Ce/yMVeYASvmGS4fwdzchJV5UdlfW0gc14uLkD11usLrAOyuGzlmW/OiF8KV7bXkfnfHtFgpyHrVk7Ti6em7ZleRyV2YFoUHTGBln1+Nl+gmFMpRkvrEAHlXMZVVvkH4dqs7jRiIe8CDCx/4pvY+FMs4c7ilSfqGR/kgxvfxIEIvT9HKV6fJBbkdY6p9tjzk6djEMaCK09IXOaPkEsF4mpRUhZOQAzqb4B0gPnk/aQaaXMGoC/iZf5ovGgzG0bbJidf9Dq6ZKGBa5J12BUXRpssrD6OfYEBkZjMQ7CGVdoK24ZteJFF0PkvsKWgzl6j10Y0PQYNd4bR2awXQ5KEdSp5vr2UEgyxEgzv+Fibj3QvH86cR0Xhz2PngSJV5U5v8NnmXoV+dZO/Wq34KUJrIVEX2cbcJGGovc/r13zzlYD72P4DSPit8L82GYrFG2IfGbacf0d8ZDxE9/GCfq/odqQa125DGQUemS++6MtTfPWxEEKSiLRA+0UE+EbE7zQVEVsYwpdnFj+KlKxSH9G/kf8BWdxQEjgHAAA=", "scripts/history-cache.mjs": "H4sIAAAAAAACA2VUTW/bMAy951dol1YGXKfDMGBYpgJDt6E9bCjW3opiUGQ69qZIgSQnDVL/95GSHPcjh8SUzPfI9xjO5+y2lQ7Y0vamhpo5kPWZNXrP2s4H6/ZsZ92/iv2QnYZ6rmWA+I5nBrbg2BKUXQOThsF6E/az+Zz5XinwvsTDmkkWujUgZB9Yv/EBc9dMSa3ZuveB1U52BkEa6wjEhhYxFaL5IF2oZvC4sS6wpjcqdNaMRV1K1QLXVtblIQT904sP5/gpG6yyd3AXj95/pCOiR3KKP1Fs7E58wy4qfBjEYSgOM9Y1POw3YBtGkO+EOB0JT5+e8g2+/uri3X2kfkE60T1UpM+eG3Hxq18vwVWdv5UNXJsAK3DcFCcn5uK8KELr7I59d846fnpttlJ39VF8RY0yZU3TrXonI3OxmDENId3VI30psa4t4J2D0DszaUZ2cWqT+kxJSG13vDhLUSXDl9hKkVNvnF13HioH3uot5KQKS+uB2Ako045IOSSo53q8RfwLKozJFVDXI2JqYMxIEZWwscZTXyQDjgx+B2e1BicM7NjXJQ7I5fGMFyXg8x6dnVKc3InXPRUVzprhvBAXZDqfYCvfrYzURayLhCZP3YRWo566MxDpMyznf8rUG+IdYoLwEO7SNESWQ8qOLYts91W2+ffN5RGWwaMCwP8iGv2sKEl98ixYljFHwzR1GMSyowZH8abmpQJ+j3KUI9tD1iF6i0VibhyT12okfqjzuL69xynz1hB3HkxxkOFzHI4ygg+L7LqgTdMgd73IXsd7Sh2KSsmg2tQZljOmTFjxZlikMmKALVcIhztlH4VWGqQblY9WJCvTRIkozTM3aQNhtdGi4xQKkd4rcjiVHMcKt9wVbjdNezO0DIloC3q260JLm06hGqEzK9qLvWnjq7RbyTU6zuWebbIvCImmJCdyQWX+jaVnnV66ihdYzDD7D9l+fYXEBQAA", "scripts/market-reader.mjs": "H4sIAAAAAAACA41UXWvbMBR996/QniJRV+22vjSuUtZRWGHZxjrYQ8iDYl/HIo4UJLlNcfPfdyU5aSjrGBisj/tx7rlH9+yM/IQStCewhbLzymiysaoER6SuiCx9J1uiTbiQbYErUssFGkgPFSnRpkVTY8mHi4Z442XreFYa7Tzxag3Oy/XmsywbcELDI/kNcjWVG8qKDLYbYz2R7kmXpO50GXNbkNVU2hV4urHmQVVgc29WoPPamjUu896pJULZiX7H+oykXNY8OjGbFxmpjaUtYDm6Et4U+JuI4BpWp+L9+XlwIinGNfcNet7VnxYIBaoAiwwRW7N0Qj5K5ckeCF+C/4rHtJdVZcG5cUTGvbR4EwHetKZcjafSN3wttzRiDokvLxliT7e4x/VGlW48m6UISnuwtSwhpLh9wHbQ0Y3plo0fMR5tv0jX5G8b35u2Ojadz3exln/VGZg61EpMHUtmfToC8TrZRloHWD5FM1YEwvmmcw3tIUAYA9dyDfkilogmPK6+desFdlDpCrbxNK7yBiHGrbdSOxlbHyvsXDW+91bpJU0BhRB7Jq6BI9GOo82dHr9svneeJWrcf/iC/ZVMh5PkeKcZErbLCH5BPRG8E68kHAg/yJIVqqbvkiHrB4eg8aTv167uWNGDV0iY6F4r5xC4mHHOQ4x7tI4UrzGYFROb6GRszmvVYkuoFpMhOUc2qWbsSPxKnBfqagjKW9BL3xTqRFyw/k1FJK3/QMUqh9y0Ld37uxbnAVW5OrlgEVB6s4hgEMviLw8lah1hFW8mjPSxeExurUXoo2nKSFAWFaQmjFgxlBkY1PmCH5hF/tgRh/giu9aLSJvDJJTKfMHERCbuThfp//wskwrxIP7ZnmTaI/s4bjD+eMgZGr7nfnegOOXT4c0Mdit4cpQxLElfhUd/+hEHzXBXAbYEAhUZYvSd1aR/mRXDWEsbHG+xdDdOxeyKLNtlfwBXGVp8pAUAAA==", "scripts/server.mjs": "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", "scripts/state-reader.mjs": "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"}, "releaseId": "a0056f18f4a43782", "schema": "FTI_WEB_API_REPAIR_V1"}')
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
