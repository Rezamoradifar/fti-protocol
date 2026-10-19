#!/usr/bin/env python3
"""Opt-in mainnet Keeper activation using existing server credentials."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import pwd
import shlex
import tempfile
import time

HERE = Path(__file__).resolve().parent

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

h = module('keeper_cutover', HERE / 'activate-fresh-testnet.py')
w = module('keeper_mainnet_target', HERE / 'activate-mainnet-web.py')
UNIT = h.UNITS['keeper']
PROBE = r'''
import fs from 'node:fs';
import {JsonRpcProvider,Wallet} from 'ethers';
import {verifyOperationalDeployment} from './scripts/operational-release.mjs';
const p=new JsonRpcProvider(process.env.RPC_URL,undefined,{batchMaxCount:1,cacheTimeout:-1});
try {
 const cfg=JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_FILE));
 if(cfg.chainId!==56||(await p.getNetwork()).chainId!==56n)throw Error('Wrong network');
 await verifyOperationalDeployment(cfg,p);
 const address=new Wallet(process.env.KEEPER_PRIVATE_KEY).address;
 if([cfg.owner,cfg.development,cfg.deployer,...cfg.daoPartners,...cfg.genesis].some(a=>a.toLowerCase()===address.toLowerCase()))throw Error('Keeper must be separate');
 const balance=await p.getBalance(address);
 if(balance===0n){console.log(JSON.stringify({ready:false,address,balanceWei:'0',reason:'Fund this Keeper with BNB on chain 56 first.'}));}
 else console.log(JSON.stringify({ready:true,address,balanceWei:String(balance)}));
} finally {p.destroy();}
'''

def restore(backup):
    record = h.load(backup / 'keeper-switch.json')
    drop = Path(record['drop'])
    h.require(drop.parent == Path('/etc/systemd/system') / (UNIT + '.d'), 'Invalid restore path')
    h.require(drop.read_text() == record['content'], 'Override changed; preserve concurrent edits')
    h.run(['systemctl', 'stop', UNIT])
    drop.unlink()
    h.run(['systemctl', 'daemon-reload'])
    h.run(['systemctl', 'start', UNIT])
    print('FTI_PREVIOUS_KEEPER_RESTORED; confirmed transactions are not reversed')

def activate(enabled):
    web, old = h.capture('web'), h.capture('keeper')
    cfg = h.load(Path(web['env']['DEPLOYMENT_FILE']))
    w.check_target(cfg)
    w.check_web(cfg, 'http://127.0.0.1:3110')
    release = Path(web['properties']['WorkingDirectory'])
    h.require(release.parent == Path('/opt/fti/releases') and release.resolve() == release, 'Unexpected release')
    env = {k: web['env'][k] for k in ('RPC_URL','DEPLOYMENT_FILE','FTI_SOURCE_REVISION','PATH')}
    env.update(KEEPER_PRIVATE_KEY=old['env']['KEEPER_PRIVATE_KEY'],KEEPER_INTERVAL_MS='5000',LANG='C.UTF-8',NODE_ENV='production')
    account = pwd.getpwnam('fti-v3')
    result = json.loads(h.run([str(web['node']), '--input-type=module'], input=PROBE.encode(),
        env=env,cwd=release,user=account.pw_uid,group=account.pw_gid,extra_groups=[],timeout=120))
    print(json.dumps(result),flush=True)
    h.require(result.get('ready'), 'Keeper not funded; no service changed')
    if not enabled:
        print('READ_ONLY; use --activate to start mainnet transactions')
        return
    h.require(h.properties('web') == web['properties'] and h.properties('keeper') == old['properties'], 'Services changed during preflight')
    base = Path('/var/backups/fti-mainnet-keeper')
    base.mkdir(mode=0o700,exist_ok=True)
    h.require(not base.is_symlink() and base.stat().st_uid == 0 and not base.stat().st_mode & 0o077, 'Unsafe backup directory')
    backup = Path(tempfile.mkdtemp(prefix='activation-',dir=base))
    # Keep the recovery script and its local dependencies together.
    for name in ('activate-mainnet-keeper.py','activate-mainnet-web.py','activate-fresh-testnet.py'):
        h.write(backup / name,(HERE / name).read_text())
    h.write(backup / 'keeper.env',h.env_text(env))
    paths = h.run(['systemctl','show',UNIT,'--property=DropInPaths','--value']).strip()
    drop = Path('/etc/systemd/system') / (UNIT + '.d') / w.choose_drop_name(paths)
    drop.parent.mkdir(exist_ok=True)
    h.require(not drop.exists(), 'Override already exists')
    content = h.dropin('keeper',release,backup,web['node'])
    h.write(backup / 'keeper-switch.json',json.dumps({'drop':str(drop),'content':content}))
    print('ROLLBACK_COMMAND=python3 '+shlex.quote(str(backup/'activate-mainnet-keeper.py'))+' --rollback '+shlex.quote(str(backup)),flush=True)
    h.write(drop,content,0o644)
    try:
        h.run(['systemctl','daemon-reload'])
        h.run(['systemctl','restart',UNIT])
        observed = False
        stable_pid = None
        stable_samples = 0
        for _ in range(9):
            time.sleep(5)
            current = h.capture('keeper')
            h.require(current['env'].get('DEPLOYMENT_FILE') == env['DEPLOYMENT_FILE'] and current['env'].get('RPC_URL') == env['RPC_URL'], 'Override superseded')
            state = h.http_json('http://127.0.0.1:3110/api/state')
            observed = deposit_window_open(state)
            pid = current['properties']['MainPID']
            stable_samples = stable_samples + 1 if pid == stable_pid else 1
            stable_pid = pid
            if observed and stable_samples >= 3: break
        h.require(stable_samples >= 3, 'Keeper process is restarting')
        print(json.dumps({'result':'FTI_MAINNET_KEEPER_ACTIVE','chainId':56,'address':result['address'],
            'depositWindowOpen':observed,'backup':str(backup)}))
    except BaseException:
        restore(backup)
        raise

def deposit_window_open(state):
    return int(state['phase']) == 0 and int(state['epochEnd']) > int(state['timestamp'])

def main():
    p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group()
    g.add_argument('--activate',action='store_true');g.add_argument('--rollback',type=Path)
    args=p.parse_args();h.require(os.geteuid()==0,'Run as root on the FTI VPS')
    with open('/run/lock/fti-service-cutover.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.rollback: restore(args.rollback)
        else: activate(args.activate)

if __name__=='__main__':
    try: main()
    except Exception:
        raise SystemExit('FTI_KEEPER_ACTIVATION_STOPPED; inspect the safe result above. No credentials are printed.')
