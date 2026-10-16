#!/usr/bin/env python3
"""Reversible image-only CSP compatibility overlay for the existing mainnet web."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import time
import urllib.request

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('mainnet', HERE / 'activate-mainnet-web.py')
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
h = w.h

def policy(base):
    request = urllib.request.Request(base + '/app/?wallet_image_check=' + str(time.time_ns()))
    with urllib.request.urlopen(request, timeout=25) as response:
        values = response.headers.get_all('Content-Security-Policy') or []
    h.require(len(values) == 1, 'Expected exactly one CSP header; inspect proxy headers.')
    return values[0]

def repaired(value):
    parts = value.split(';')
    for i, part in enumerate(parts):
        words = part.split()
        if words and words[0] == 'img-src' and 'https://api.web3modal.org' in words and 'blob:' not in words:
            parts[i] = re.sub(r'(img-src\s+)', r'\1blob: ', part, count=1)
    return ';'.join(parts)

def install():
    saved = h.capture('web')
    cfg = h.http_json('http://127.0.0.1:3110/api/config')
    w.check_target(cfg)
    w.check_web(cfg, 'https://ftiprotocol.com')
    before = policy('http://127.0.0.1:3110')
    h.require(policy('https://ftiprotocol.com') == before, 'Origin/public CSP differs.')
    after = repaired(before)
    if after == before:
        h.require('blob:' in next((p.split() for p in before.split(';') if p.strip().startswith('img-src ')), []), 'Unsupported CSP.')
        print('FTI_WALLET_IMAGES_POLICY_ALREADY_ACTIVE')
        return
    root = Path(saved['properties']['WorkingDirectory'])
    h.require(root.parent == Path('/opt/fti/releases') and root.resolve() == root, 'Unexpected active release.')
    argv = (Path('/proc') / saved['properties']['MainPID'] / 'cmdline').read_bytes().split(b'\0')
    args = [a.decode() for a in argv if a]
    h.require(args == [str(saved['node']), str(root / 'scripts/server.mjs')], 'Unexpected web startup command; preserve it.')
    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + str(os.getpid())
    backup = Path('/var/lib/fti-continuity/cutover-backups/wallet-images-' + stamp)
    backup.mkdir(mode=0o700)
    os.chmod(backup, 0o700)
    for name in ('activate-mainnet-web.py', 'activate-fresh-testnet.py'):
        shutil.copyfile(HERE / name, backup / name)
    h.write(backup / 'web.unit.txt', h.run(['systemctl', 'cat', h.UNITS['web']]))
    overlay = Path('/opt/fti/wallet-image-fixes') / stamp
    overlay.mkdir(parents=True, mode=0o755)
    os.chmod(overlay.parent, 0o755)
    os.chmod(overlay, 0o755)
    preload = overlay / 'preload.mjs'
    h.write(preload, (HERE / 'wallet-image-fix/preload.mjs').read_text(), 0o644)
    os.chmod(preload, 0o644)
    paths = h.run(['systemctl', 'show', h.UNITS['web'], '--property=DropInPaths', '--value']).strip()
    h.DROP_NAME = w.choose_drop_name(paths)
    text = '[Service]\nExecStart=\nExecStart=' + str(saved['node']) + ' --import ' + str(preload) + ' ' + str(root / 'scripts/server.mjs') + '\n'
    h.write(backup / 'switch.json', json.dumps({'dropName': h.DROP_NAME, 'dropHashes': {'web': hashlib.sha256(text.encode()).hexdigest()}}))
    print('ROLLBACK_COMMAND=python3 ' + str(backup / 'activate-mainnet-web.py') + ' --rollback ' + str(backup), flush=True)
    h.require(h.properties('web') == saved['properties'], 'Service changed during preparation.')
    h.require(not os.path.lexists(h.drop_path('web')), 'Override already exists.')
    try:
        h.write(h.drop_path('web'), text, 0o644)
        os.chmod(h.drop_path('web'), 0o644)
        h.run(['systemctl', 'daemon-reload'])
        h.run(['systemctl', 'restart', h.UNITS['web']])
        deadline = time.monotonic() + 150
        while True:
            try:
                w.check_web(cfg, 'http://127.0.0.1:3110')
                break
            except (OSError, ValueError, h.CutoverError):
                h.require(time.monotonic() < deadline, 'Web health timeout.')
                time.sleep(2)
        for base in ('http://127.0.0.1:3110', 'https://ftiprotocol.com'):
            w.check_web(cfg, base)
            h.require(policy(base) == after, 'CSP verification failed.')
    except BaseException:
        w.rollback(backup)
        raise
    print(json.dumps({'result': 'FTI_WALLET_IMAGES_POLICY_ACTIVE', 'chainId': 56, 'browserVerified': False, 'backup': str(backup)}))

if __name__ == '__main__':
    try:
        h.require(os.geteuid() == 0, 'Run as root.')
        os.umask(0o077)
        def interrupted(signum, frame):
            raise RuntimeError('Interrupted')
        signal.signal(signal.SIGTERM, interrupted)
        with open('/run/lock/fti-service-cutover.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            install()
    except Exception:
        print('FTI_WALLET_IMAGES_STOPPED: installation or verification failed; inspect rollback result above.', file=sys.stderr)
        sys.exit(1)
