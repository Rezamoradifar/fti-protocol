#!/usr/bin/env python3
"""Resume the pinned purchase UI install using verified existing assets; no npm."""
import hashlib
import fcntl
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat
import subprocess
import sys
import tempfile
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
FALLBACK_RPC = 'https://bsc-dataseed.binance.org/'
PROBE = r'''
import fs from 'node:fs';
import {FetchRequest,JsonRpcProvider} from 'ethers';
import {operationalRpcUrl} from './scripts/mainnet-rpc.mjs';
import {verifyOperationalDeployment} from './scripts/operational-release.mjs';
const providers=[];
const provider=url=>{const request=new FetchRequest(url);request.timeout=15000;const p=new JsonRpcProvider(request,undefined,{cacheTimeout:-1,batchMaxCount:1});providers.push(p);return p;};
const emit=data=>console.log('FTI_RUNTIME_PROBE='+JSON.stringify(data));
try{
 const cfg=JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_FILE));
 if(cfg.chainId!==56||cfg.sourceRevision!=='ba82373a83d63fba0643332371cfb6d62903c849'||cfg.mainnetPlanDigest!=='0ec3a7d93f5e1225cbd4f5671f4ee6b92423718898f1734c42390337467f7480')throw Error('UNEXPECTED_DEPLOYMENT');
 let currentPassed=false;
 try{await verifyOperationalDeployment(cfg,provider(operationalRpcUrl(cfg)));currentPassed=true;}
 catch(error){if(error.message!=='Creation input mismatch: council')throw Error('CURRENT_CHECK_FAILED');}
 if(currentPassed)emit({action:'restart_current'});
 else{await verifyOperationalDeployment(cfg,provider('https://bsc-dataseed.binance.org/'));emit({action:'use_verified_fallback'});}
}catch{emit({action:'blocked'});}finally{for(const p of providers)p.destroy();}
'''


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
        '--property=LoadState,ActiveState,SubState,User,Group,WorkingDirectory,MainPID,DropInPaths'], text=True)
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


def capture_runtime(live):
    uid = pwd.getpwnam('fti-v3').pw_uid
    for _ in range(60):
        try:
            p = service_properties()
            pid = int(p.get('MainPID', '0'))
            require(pid > 1 and Path(p['WorkingDirectory']) == live, 'Web process unavailable')
            proc = Path('/proc') / str(pid)
            require(proc.stat().st_uid == uid and (proc / 'cwd').resolve() == live,
                    'Unexpected web process identity')
            node = (proc / 'exe').resolve()
            require(str(node).startswith('/opt/fti/runtime/node-v22.') and node.name == 'node',
                    'Unexpected web runtime')
            env = dict(item.decode().split('=', 1) for item in (proc / 'environ').read_bytes().split(b'\0') if item and b'=' in item)
            require(service_properties().get('MainPID') == str(pid), 'Web process changed')
            return node, env
        except (OSError, ValueError, RuntimeError):
            time.sleep(0.2)
    raise RuntimeError('Cannot capture the known web process; no RPC changes made')


def wait_health():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(40):
        try:
            with opener.open('http://127.0.0.1:3110/health', timeout=3) as response:
                data = json.load(response)
            if data.get('ok') is True and data.get('chainId') == 56:
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


def write_exclusive(file, data, mode=0o600):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def rollback_rpc(dropin, expected, envfile=None, env_hash=None):
    require(digest(read(dropin)) == expected, 'RPC override changed concurrently; preserve operator edit')
    if envfile is not None:
        require(digest(read(envfile)) == env_hash, 'RPC environment changed concurrently; preserve operator edit')
    dropin.unlink()
    subprocess.run(['systemctl', 'daemon-reload'], check=True, timeout=20)
    subprocess.run(['systemctl', 'restart', SERVICE], check=True, timeout=30)
    print('FTI_WEB_RPC_CONFIGURATION_RESTORED', flush=True)


def repair_rpc(live):
    with open('/run/lock/fti-service-cutover.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = service_properties()
        node, env = capture_runtime(live)
        print('FTI_VERIFYING_CURRENT_AND_FALLBACK_RPC', flush=True)
        probe = subprocess.run([str(node), '--input-type=module'], input=PROBE, text=True,
                               capture_output=True, cwd=live, env=env, timeout=180)
        results = [line.split('=', 1)[1] for line in probe.stdout.splitlines() if line.startswith('FTI_RUNTIME_PROBE=')]
        require(probe.returncode == 0 and len(results) == 1, 'RPC verification could not complete; no override written')
        action = json.loads(results[0]).get('action')
        require(action in ('restart_current', 'use_verified_fallback'),
                'Full contract verification failed; no override written')
        if action == 'restart_current':
            subprocess.run(['systemctl', 'restart', SERVICE], check=True, timeout=30)
            require(wait_health(), 'Current RPC verified, but web health is still unavailable')
            print('FTI_WEB_RECOVERED_WITH_CURRENT_RPC', flush=True)
            return
        after = service_properties()
        require(all(after.get(k) == before.get(k) for k in ('WorkingDirectory', 'User', 'Group', 'DropInPaths')),
                'Web configuration changed during verification; no override written')
        latest_node, latest_env = capture_runtime(live)
        keys = ('RPC_URL', 'FTI_MAINNET_RPC_URL', 'FTI_MAINNET_RPC_FILE',
                'DEPLOYMENT_FILE', 'FTI_SOURCE_REVISION', 'EVENT_RPC_URL', 'NODE_OPTIONS')
        require(latest_node == node and all(latest_env.get(k) == env.get(k) for k in keys),
                'Web runtime environment changed during verification; no override written')
        folder = Path('/etc/systemd/system') / (SERVICE + '.d')
        require(not folder.is_symlink(), 'Unexpected systemd override directory')
        folder.mkdir(mode=0o755, exist_ok=True)
        names = []
        for value in before.get('DropInPaths', '').split():
            name = Path(value).name
            require(re.fullmatch(r'[A-Za-z0-9_.-]+\.conf', name), 'Unexpected override name')
            names.append(name)
        name = max(['zzz-fti-purchase-rpc.conf', *names]) + '.fti-purchase-rpc.conf'
        require(len(name.encode()) < 240, 'RPC override name too long')
        dropin = folder / name
        base = Path('/var/backups/fti-web-rpc')
        require(not base.is_symlink(), 'Unexpected backup directory')
        base.mkdir(mode=0o700, exist_ok=True)
        require(base.stat().st_uid == 0 and not base.stat().st_mode & 0o077, 'Private backup directory required')
        backup = Path(tempfile.mkdtemp(prefix='repair-', dir=base))
        envfile = backup / 'rpc.env'
        env_data = ('RPC_URL=' + FALLBACK_RPC + '\nFTI_MAINNET_RPC_URL=\nFTI_MAINNET_RPC_FILE=\n').encode()
        write_exclusive(envfile, env_data)
        content = ('[Service]\nEnvironmentFile=' + str(envfile) + '\n').encode()
        record = {'dropin': str(dropin), 'sha256': digest(content), 'envSHA256': digest(env_data), 'originalDropInPaths': before.get('DropInPaths', ''), 'rpc': FALLBACK_RPC}
        write_exclusive(backup / 'record.json', json.dumps(record).encode())
        write_exclusive(dropin, content, 0o644)
        print('FTI_VERIFIED_WEB_RPC_BACKUP=' + str(backup), flush=True)
        try:
            subprocess.run(['systemctl', 'daemon-reload'], check=True, timeout=20)
            subprocess.run(['systemctl', 'reset-failed', SERVICE], check=True, timeout=10)
            subprocess.run(['systemctl', 'restart', SERVICE], check=True, timeout=30)
            require(wait_health(), 'Verified fallback did not restore web health')
        except BaseException:
            rollback_rpc(dropin, record['sha256'], envfile, record['envSHA256'])
            raise
        print('FTI_WEB_RPC_RECOVERED_WITH_FULL_VERIFICATION', flush=True)


def ensure_web(live=None):
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
    if live is not None:
        repair_rpc(live)
        return
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
    ensure_web(live)
    # Existing installer retains all deployment checks, backups and atomic rollback.
    subprocess.run([sys.executable, '-I', '-B', str(source / 'tools/apply-mainnet-ui.py'),
                    '--source', str(source)], check=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('FTI_PURCHASE_UI_STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
