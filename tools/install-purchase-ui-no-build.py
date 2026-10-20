#!/usr/bin/env python3
"""Resume the pinned purchase UI install using verified existing assets; no npm."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time
import urllib.request

REVISION = '1db6becda3a8fde8d672afae4db8a366309ca731'
PINNED = {
    'config/mainnet-ui-release.json': 'fe0b2583f62701123aca51d015a721a297b0123ee3f35132f221f7b2fae52257',
    'tools/apply-mainnet-ui.py': '597ea06e180a6de084489d9553249fd2eec3dcc612cce20d09f3c195a20b2acb',
    'tools/install-global-frontend.py': 'a0a9a48d33e1dbb383dd80b20fe535a0f0ccbfd610da217504f067f9103b892a',
    'tools/activate-mainnet-web.py': '2592afc4232237577edbf85eedf27b72faf87fdba48d6e39320a6c4602a2b9a3',
    'tools/activate-fresh-testnet.py': 'ffcbb719039101c44f5a693ad5731d608c4c38ee6e2b2311ab601832921784bd',
}
SERVICE = 'fti-continuity-web.service'


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def child(root, name):
    relative = Path(name)
    require(not relative.is_absolute() and '..' not in relative.parts, 'Unsafe asset path')
    target = root
    for part in relative.parts:
        target /= part
        require(not target.is_symlink(), 'Symlink rejected: ' + name)
    return target


def read(file):
    info = file.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_size < 32_000_000,
            'Expected a bounded regular file: ' + str(file))
    return file.read_bytes()


def service_properties():
    text = subprocess.check_output(['systemctl', 'show', SERVICE,
        '--property=LoadState,ActiveState,SubState,User,Group,WorkingDirectory'], text=True)
    return dict(line.split('=', 1) for line in text.splitlines() if '=' in line)


def find_source():
    matches = []
    for source in Path('/opt/fti').glob('ui-collateral-fix.*'):
        if source.is_symlink() or not source.is_dir():
            continue
        revision = subprocess.run(['git', '-C', str(source), 'rev-parse', 'HEAD'],
                                  capture_output=True, text=True)
        if revision.returncode == 0 and revision.stdout.strip() == REVISION:
            matches.append(source)
    require(len(matches) == 1, 'Expected one existing pinned ui-collateral-fix checkout')
    source = matches[0]
    for name, expected in PINNED.items():
        require(digest(read(child(source, name))) == expected, 'Installer source mismatch: ' + name)
    return source


def prepare_assets(source, live, files):
    html = read(child(live, 'web/index.html')).decode()
    match = re.search(r'src="/(fti-mainnet-ui-[a-f0-9]{16})/app\.js"', html)
    require(match is not None, 'Current versioned UI path not recognized')
    pending = []
    for name, expected in files.items():
        target = child(source, name)
        if target.is_file() and digest(read(target)) == expected:
            continue
        require(name.startswith('web/'), 'Purchase source mismatch: ' + name)
        existing = child(live, 'web/' + match[1] + '/' + name[4:])
        data = read(existing)
        require(digest(data) == expected, 'Installed asset differs: ' + name)
        pending.append((target, data))
    return pending


def remove_failed_dependencies(source, live):
    require(source.parent == Path('/opt/fti') and
            re.fullmatch(r'ui-collateral-fix\.[A-Za-z0-9]+', source.name) and
            source.resolve() == source and source != live, 'Unsafe cleanup target')
    deps = child(source, 'node_modules')
    if deps.exists():
        require(deps.is_dir() and not deps.is_mount(), 'Unsafe dependencies directory')
        shutil.rmtree(deps)
        print('FTI_FAILED_INSTALL_DEPENDENCIES_REMOVED', flush=True)


def ensure_web():
    properties = service_properties()
    if properties['ActiveState'] in ('inactive', 'failed'):
        if properties['ActiveState'] == 'failed':
            subprocess.run(['systemctl', 'reset-failed', SERVICE], check=True, timeout=10)
        subprocess.run(['systemctl', 'start', SERVICE], check=True, timeout=30)
        print('FTI_WEB_SERVICE_STARTED', flush=True)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for attempt in range(5):
        try:
            with opener.open('http://127.0.0.1:3110/health', timeout=4) as response:
                health = json.load(response)
            require(health.get('ok') is True and health.get('chainId') == 56,
                    'Web is not healthy on chain 56')
            return
        except Exception:
            if attempt < 4:
                time.sleep(1)
    state = service_properties()
    raise RuntimeError('Web health unavailable; service=' + state['ActiveState'] +
                       ', substate=' + state['SubState'] + '. No UI switch performed.')


def main():
    require(os.geteuid() == 0, 'Run on the FTI VPS as root')
    os.umask(0o077)
    source = find_source()
    properties = service_properties()
    require(properties.get('LoadState') == 'loaded' and
            properties.get('User') == properties.get('Group') == 'fti-v3',
            'Unexpected FTI web service identity')
    live = Path(properties['WorkingDirectory'])
    require(live.parent == Path('/opt/fti/releases') and live.resolve() == live,
            'Unexpected running release path')
    files = json.loads(read(source / 'config/mainnet-ui-release.json'))['files']
    # Verify every source and every reusable byte BEFORE deleting failed dependencies.
    pending = prepare_assets(source, live, files)
    remove_failed_dependencies(source, live)
    space = os.statvfs(source)
    needed = sum(len(data) for _, data in pending) * 2 + 32 * 1024 * 1024
    require(space.f_bavail * space.f_frsize >= needed and space.f_favail > len(files) * 3 + 100,
            'Still insufficient free space/inodes. No UI switch performed.')
    for target, data in pending:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    for name, expected in files.items():
        require(digest(read(child(source, name))) == expected, 'Prepared file mismatch: ' + name)
    print('FTI_PURCHASE_UI_ASSETS_VERIFIED', len(files), flush=True)
    ensure_web()
    # Existing installer retains all deployment checks, backups and atomic rollback.
    subprocess.run([sys.executable, '-I', '-B', str(source / 'tools/apply-mainnet-ui.py'),
                    '--source', str(source)], check=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('FTI_PURCHASE_UI_STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
