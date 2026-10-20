#!/usr/bin/env python3
"""Read-only FTI sender/nonce recovery. Never changes services or sends transactions."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import stat
import subprocess
import sys
import tempfile
import urllib.request
from urllib.parse import urlencode, urlsplit

SERVICE = 'fti-continuity-web.service'
DEFAULT_WALLET = '0xd6492377c2c33047afe61768930b2aedff2b2704'
IDENTITY = {
    'chainId': 56,
    'sourceRevision': 'ba82373a83d63fba0643332371cfb6d62903c849',
    'sourceFingerprint': 'eaf50289e56998959303757f443b80d38caa7002427f4a5b126f5b00dee3e934',
    'mainnetPlanDigest': '0ec3a7d93f5e1225cbd4f5671f4ee6b92423718898f1734c42390337467f7480',
    'usd': '0x55d398326f99059fF775485246999027B3197955',
    'binary': '0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9',
    'token': '0x43755B1E813b2d41F669ea08bcf859De07195eA1',
    'council': '0x85F567C2c59e766847D9dC18328C3B54cDf80DE4',
    'timelock': '0xcf3eCA1E96db99E478e81C79f2Ae03dEec80CA86',
    'binaryImplementation': '0x03c9A6CDF9bf4103C3AdA0c3E8Ea3a6F0A30D91e',
    'tokenImplementation': '0x714aE4497DdA3e8BFB5440D5777a2d60f9f7b1c1',
    'codeHashes': {
        'usd': '0x97a48aa4c129657440dafdacd4c836389734d28cc4a0ca7403e68da660a74a59',
        'council': '0x48badc51f5fa5efa1913c2271c908dbe4667b3355fcd2225e2fa70b8330cf3a5',
        'timelock': '0x23cfa4d1941f48e21ca333fe2092ae9f9e87d0d8a6a54130c7fe82490abd1892',
        'binary': '0xe6ef40a5eda18ff38b348e20557c824146411b23667bb6d75b39c3a1107ec627',
        'token': '0xe6ef40a5eda18ff38b348e20557c824146411b23667bb6d75b39c3a1107ec627'},
    'implementationCodeHashes': {
        'binary': '0x20496d01da8355e7110b45a15c9709ba0361fcc8a473375fd682301394255b21',
        'token': '0xa9ca4612140d49f9c247afb8887f90e6df6338d3e4675b8a64d66171d5a05d88'}}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def private_read(path, limit=65536):
    path = Path(path)
    require(path.is_absolute() and path.resolve() == path, 'Unsafe private file path')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022
                and info.st_size <= limit, 'Unsafe private file')
        return stream.read(limit + 1)


def env_text(env):
    # Same canonical EnvironmentFile encoding as activate-fresh-testnet.env_text.
    lines = []
    for key, value in sorted(env.items()):
        require(re.fullmatch(r'[A-Z][A-Z0-9_]*', key) and isinstance(value, str), 'Invalid saved environment')
        require(not any(ord(c) < 32 or ord(c) == 127 for c in value), 'Invalid saved environment')
        lines.append(key + '="' + value.replace('\\', '\\\\').replace('"', '\\"') + '"\n')
    return ''.join(lines)


def parse_saved_env(text):
    # Matches activate-mainnet-web.read_saved_env, without importing mutable code.
    env = {}
    for line in text.splitlines():
        key, value = line.split('=', 1)
        fields = shlex.split(value)
        require(len(fields) == 1 and key not in env, 'Invalid saved environment')
        env[key] = fields[0]
    require(env_text(env) == text, 'Saved environment format changed')
    return env


def rpc_url(env):
    require(not (env.get('FTI_MAINNET_RPC_URL') and env.get('FTI_MAINNET_RPC_FILE')), 'Ambiguous RPC configuration')
    value = env.get('FTI_MAINNET_RPC_URL')
    if env.get('FTI_MAINNET_RPC_FILE'):
        path = Path(env['FTI_MAINNET_RPC_FILE'])
        require(not path.stat().st_mode & 0o077, 'RPC file must be private')
        value = private_read(path, 4096).decode().strip()
    value = value or env.get('RPC_URL')
    parsed = urlsplit(value or '')
    require(parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password
            and not parsed.fragment and not any(ord(c) < 32 for c in value or ''), 'Invalid HTTPS RPC configuration')
    return value


def properties():
    result = subprocess.run(['systemctl', 'show', SERVICE,
        '--property=MainPID,User,Group,WorkingDirectory,ActiveState'], capture_output=True, text=True, timeout=10)
    require(result.returncode == 0, 'Cannot inspect web service')
    return dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)


def capture():
    before = properties()
    require(before.get('ActiveState') == 'active' and before.get('User') == 'fti-v3'
            and before.get('Group') == 'fti-v3', 'Unexpected web service identity')
    pid = int(before['MainPID']);require(pid > 1, 'Missing web process')
    proc = Path('/proc') / str(pid)
    require(proc.stat().st_uid == pwd.getpwnam('fti-v3').pw_uid, 'Unexpected web process owner')
    live = Path(before['WorkingDirectory'])
    require(live.parent == Path('/opt/fti/releases') and live.resolve() == live
            and (proc / 'cwd').resolve() == live, 'Unexpected web release')
    node = (proc / 'exe').resolve()
    require(str(node).startswith('/opt/fti/runtime/node-v22.') and node.name == 'node', 'Unexpected Node runtime')
    raw = (proc / 'environ').read_bytes()
    require(len(raw) < 1024 * 1024, 'Unexpected process environment')
    env = dict(item.decode().split('=', 1) for item in raw.split(b'\0') if item and b'=' in item)
    config = Path(env.get('DEPLOYMENT_FILE', ''))
    require(config.name == 'deployment.json' and config.parent.parent == Path('/var/lib/fti-continuity')
            and re.fullmatch(r'mainnet-web-\d{8}T\d{6}Z-\d+', config.parent.name), 'Unexpected deployment state path')
    cfg = json.loads(private_read(config))
    require(all(cfg.get(key) == value for key, value in IDENTITY.items()), 'Unexpected pinned deployment')
    candidates = [{'label': 'current', 'url': rpc_url(env)}]
    try:
        original = parse_saved_env(private_read(config.parent / 'web.env').decode())
        candidate = rpc_url(original)
        if candidate != candidates[0]['url']:
            candidates.append({'label': 'original', 'url': candidate})
    except (OSError, ValueError, RuntimeError):
        pass
    require(properties() == before, 'Web process changed during inspection')
    return node, live, env, candidates, before


PROBE = r'''
import {FetchRequest,JsonRpcProvider,keccak256} from 'ethers';
const input=JSON.parse(process.env.FTI_RECOVERY_DIAGNOSTIC),cfg=input.identity,address=input.wallet;
const slot='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const emit=row=>console.log('FTI_RECOVERY_REPORT='+JSON.stringify(row));
const hashOk=value=>/^0x[0-9a-f]{64}$/i.test(value||'');
const failure=error=>{const message=[error?.shortMessage,error?.message,error?.error?.message,error?.info?.error?.message,error?.cause?.message].filter(value=>typeof value==='string').join(' ');return /missing trie|historical state|pruned/i.test(message)?'HISTORICAL_STATE_UNAVAILABLE':/limit exceeded|rate limit/i.test(message)?'RPC_RATE_LIMITED':/READ_LIMIT/.test(message)?'READ_LIMIT':'RECOVERY_READ_FAILED';};
for(const candidate of input.candidates){
 const request=new FetchRequest(candidate.url);request.timeout=8000;
 const p=new JsonRpcProvider(request,undefined,{cacheTimeout:-1,batchMaxCount:1});
 const deadline=Date.now()+75000;let reads=0;
 const read=async(method,...args)=>{const remaining=deadline-Date.now();if(remaining<=0||++reads>160)throw Error('READ_LIMIT');let timer;try{return await Promise.race([p[method](...args),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('READ_LIMIT')),remaining);})]);}finally{clearTimeout(timer);}};
 const row={endpoint:candidate.label,status:'IDENTITY_UNVERIFIED',transactions:[]};
 try{
  if(Number((await read('getNetwork')).chainId)!==56)throw Error('WRONG_CHAIN');
  await Promise.all(Object.entries(cfg.codeHashes).map(async([key,expected])=>{if(keccak256(await read('getCode',cfg[key]))!==expected)throw Error('CODE_MISMATCH');}));
  await Promise.all(Object.entries(cfg.implementationCodeHashes).map(async([key,expected])=>{const active=await read('getStorage',cfg[key],slot);if(active.slice(-40).toLowerCase()!==cfg[key+'Implementation'].slice(2).toLowerCase()||keccak256(await read('getCode',cfg[key+'Implementation']))!==expected)throw Error('IMPLEMENTATION_MISMATCH');}));
  row.status='IDENTITY_VERIFIED';
  const [head,latest,pending]=await Promise.all([read('getBlockNumber'),read('getTransactionCount',address,'latest'),read('getTransactionCount',address,'pending')]);
  const safe=Math.max(0,head-12);row.latestNonce=latest;row.pendingNonce=pending;row.safeBlock=safe;
  const nonces=input.nonces.length?input.nonces:Array.from({length:Math.min(16,latest)},(_,i)=>latest-Math.min(16,latest)+i);
  const counts=new Map(),blocks=new Map();
  const count=block=>{if(!counts.has(block))counts.set(block,read('getTransactionCount',address,block));return counts.get(block);};
  const fullBlock=number=>{if(!blocks.has(number))blocks.set(number,read('getBlock',number,true));return blocks.get(number);};
  const safeCount=await count(safe);row.historicalState='SAFE_NONCE_READ_ONLY';
  await Promise.all(nonces.map(async nonce=>{
   const found={nonce,status:'NOT_RECOVERED'};
   try{
    if(safeCount<=nonce){found.status='NO_SAFE_RECEIPT_FOR_NONCE';return;}
    let high=safe,low=Math.max(0,high-1024),distance=1024;
    for(let step=0;low>0&&step<32;step++){if(await count(low)<=nonce)break;high=low;distance*=2;low=Math.max(0,safe-distance);}
    for(let step=0;low<high&&step<32;step++){const mid=Math.floor((low+high)/2);if(await count(mid)>nonce)high=mid;else low=mid+1;}
    if(low!==high)return;
    const block=await fullBlock(low);if(block?.number!==low||!hashOk(block.hash))return;let txs;try{txs=block.prefetchedTransactions;}catch{return;}
    const tx=txs?.find(tx=>tx.from?.toLowerCase()===address&&tx.nonce===nonce&&hashOk(tx.hash));
    if(!tx||Number(tx.chainId)!==56||tx.blockNumber!==low||tx.blockHash!==block.hash)return;
    const receipt=await read('getTransactionReceipt',tx.hash);
    if(!receipt||receipt.hash?.toLowerCase()!==tx.hash.toLowerCase()||!hashOk(receipt.blockHash)||receipt.blockHash!==block.hash||receipt.blockNumber!==low||low>safe||![0,1].includes(Number(receipt.status)))return;
    const canonical=await read('getBlock',low);
    if(canonical?.number!==low||canonical.hash!==block.hash)return;
    found.status='CANONICAL_CONFIRMED';found.hash=tx.hash;found.block=low;found.receiptStatus=Number(receipt.status);found.to=tx.to;found.selector=tx.data?.slice(0,10)||'0x';
    found.kind=tx.to?.toLowerCase()===cfg.usd.toLowerCase()&&found.selector==='0x095ea7b3'?'USDT_APPROVAL':tx.to?.toLowerCase()===address&&tx.value===0n&&tx.data==='0x'?'ZERO_VALUE_SELF_TRANSACTION':tx.to?.toLowerCase()===cfg.binary.toLowerCase()?'BINARY_CONTRACT_CALL':'OTHER_TRANSACTION';
   }catch(error){found.status=failure(error);}
   finally{row.transactions.push(found);}
  }));
  row.transactions.sort((a,b)=>a.nonce-b.nonce);
  if(row.transactions.some(tx=>tx.status==='HISTORICAL_STATE_UNAVAILABLE'))row.historicalState='PRUNED_OR_UNAVAILABLE';
  else if(row.transactions.some(tx=>tx.status==='CANONICAL_CONFIRMED'))row.historicalState='CONFIRMED_HISTORY_VERIFIED';
 }catch(error){const message=String(error?.shortMessage||error?.message||'');row.status=['WRONG_CHAIN','CODE_MISMATCH','IMPLEMENTATION_MISMATCH','READ_LIMIT'].find(code=>message.includes(code))||failure(error);}
 finally{row.reads=reads;p.destroy();emit(row);}
}
'''


def verified_hashes(reports):
    hashes = []
    for report in reports:
        if report.get('status') != 'IDENTITY_VERIFIED':
            continue
        for row in report.get('transactions', []):
            value = row.get('hash', '')
            if row.get('status') == 'CANONICAL_CONFIRMED' and re.fullmatch(r'0x[0-9a-fA-F]{64}', value) and value not in hashes:
                hashes.append(value)
    return hashes[:16]


def recovery_url(reports):
    hashes = verified_hashes(reports)
    if not hashes:
        return None
    return 'https://ftiprotocol.com/token/?' + urlencode([('lang', 'fa'), *[('recover', value) for value in hashes]]) + '#trade'



def hint_manifest(data, wallet):
    require(isinstance(data, dict) and set(data) == {'schema', 'chainId', 'address', 'hashes'}
            and data['schema'] == 'FTI_RECOVERY_HINTS_V1' and data['chainId'] == 56
            and data['address'] == wallet and isinstance(data['hashes'], list)
            and len(data['hashes']) <= 16
            and all(isinstance(value, str) and re.fullmatch(r'0x[0-9a-fA-F]{64}', value)
                    for value in data['hashes']), 'Existing recovery hints are invalid; preserved unchanged')
    return data


def safe_directory(path, create=False):
    path = Path(path)
    require(path.is_absolute() and path.resolve() == path, 'Unsafe public hint directory')
    if create:
        try:
            path.mkdir(mode=0o755)
        except FileExistsError:
            pass
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
            'Public hint directory must be owned by root and not writable by others')


def publish_hints(live, wallet, reports):
    hashes = verified_hashes(reports)
    require(hashes and re.fullmatch(r'0x[0-9a-f]{40}', wallet), 'No canonical verified hashes to publish')
    live = Path(live)
    require(live.parent == Path('/opt/fti/releases') and live.resolve() == live, 'Unexpected release for public hints')
    web = live / 'web'
    for path in [Path('/opt'), Path('/opt/fti'), Path('/opt/fti/releases'), live, web]:
        safe_directory(path)
    return write_public_hints(web, wallet, hashes, Path('/run/lock/fti-recovery-hints.lock'))


def write_public_hints(web, wallet, hashes, lock_path):
    require(hashes and len(hashes) <= 16 and re.fullmatch(r'0x[0-9a-f]{40}', wallet)
            and all(re.fullmatch(r'0x[0-9a-fA-F]{64}', value) for value in hashes), 'Invalid canonical recovery hints')
    safe_directory(web)
    folder = web / 'recovery'
    safe_directory(folder, create=True)
    folder /= '56'
    safe_directory(folder, create=True)
    target = folder / (wallet + '.json')
    lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'a') as lock:
        info = os.fstat(lock.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'Unsafe recovery hint lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = private_read(target) if os.path.lexists(target) else None
        old = hint_manifest(json.loads(before), wallet)['hashes'] if before is not None else []
        # Bounded merge retains previous valid candidates after the newly proved
        # hashes. Every browser independently verifies these public hints again.
        merged = list(dict.fromkeys([*hashes, *old]))[:16]
        data = json.dumps({'schema': 'FTI_RECOVERY_HINTS_V1', 'chainId': 56,
                           'address': wallet, 'hashes': merged}, sort_keys=True).encode() + b'\n'
        if before == data:
            return target
        fd, name = tempfile.mkstemp(prefix='.' + wallet + '.', suffix='.tmp', dir=folder)
        temporary = Path(name)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
                stream.flush()
                os.fchown(stream.fileno(), 0, 0)
                os.fchmod(stream.fileno(), 0o644)
                os.fsync(stream.fileno())
            safe_directory(folder)
            current = private_read(target) if os.path.lexists(target) else None
            require(current == before, 'Recovery hints changed concurrently; preserve operator edit')
            if before is None:
                # An exclusive link also protects the create case from races.
                os.link(temporary, target, follow_symlinks=False)
            else:
                os.replace(temporary, target)
            directory_fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            temporary.unlink(missing_ok=True)
    return target


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify_published_hints(target, wallet):
    expected = private_read(target)
    hint_manifest(json.loads(expected), wallet)
    suffix = '/recovery/56/' + wallet + '.json'
    version = '?fti_recovery_check=' + hashlib.sha256(expected).hexdigest()[:16]
    urls = ['http://127.0.0.1:3110' + suffix + version,
            'https://ftiprotocol.com/token' + suffix + version]
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for url in urls:
        try:
            with opener.open(url, timeout=8) as response:
                if response.status != 200 or response.read(len(expected) + 1) != expected:
                    return False
        except (OSError, ValueError):
            return False
    return True

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wallet', default=DEFAULT_WALLET)
    parser.add_argument('--nonce', action='append', type=int, default=[])
    parser.add_argument('--publish', action='store_true', help='Publish only canonical verified hashes as public recovery hints; no service or RPC changes')
    args = parser.parse_args(argv)
    require(os.geteuid() == 0, 'Run this read-only diagnostic as root')
    require(re.fullmatch(r'0x[0-9a-fA-F]{40}', args.wallet), 'Invalid public wallet address')
    require(len(args.nonce) <= 16 and all(0 <= value <= 2**53-1 for value in args.nonce), 'Use up to sixteen valid nonces')
    node, live, env, candidates, snapshot = capture()
    env['FTI_RECOVERY_DIAGNOSTIC'] = json.dumps({'identity': IDENTITY, 'wallet': args.wallet.lower(),
                                               'nonces': args.nonce, 'candidates': candidates})
    result = subprocess.run([str(node), '--input-type=module'], input=PROBE, capture_output=True,
                            text=True, cwd=live, env=env, timeout=170)
    require(result.returncode == 0, 'Read-only probe could not complete')
    reports = [json.loads(line.split('=', 1)[1]) for line in result.stdout.splitlines()
               if line.startswith('FTI_RECOVERY_REPORT=')]
    require(len(reports) == len(candidates), 'Incomplete read-only probe')
    print('FTI_READ_ONLY_RECOVERY_DIAGNOSTIC; TRANSACTIONS_SENT=0; SERVICE_CHANGES=0')
    print('WALLET=' + args.wallet.lower())
    for report in reports:
        print('ENDPOINT=' + report['endpoint'] + ' STATUS=' + report['status'])
        if 'latestNonce' in report:
            print('NONCE_LATEST=' + str(report['latestNonce']) + ' NONCE_PENDING=' + str(report['pendingNonce']))
        if 'historicalState' in report:
            print('HISTORICAL_STATE=' + report['historicalState'])
        for row in report.get('transactions', []):
            print(json.dumps(row, sort_keys=True))
    if args.publish and verified_hashes(reports):
        require(properties() == snapshot, 'Web service changed during verification; no hints published')
        target = publish_hints(live, args.wallet.lower(), reports)
        available = verify_published_hints(target, args.wallet.lower())
        print('RECOVERY_HINTS_PUBLISHED' if available else 'RECOVERY_HINTS_SAVED_PUBLIC_UNAVAILABLE')
    link = recovery_url(reports)
    print('RECOVERY_URL=' + link if link else 'NO_VERIFIED_HASH_RECOVERED; KEEP_THE_BROWSER_REQUEST_RECORDED')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError):
        print('FTI_RECOVERY_STOPPED; PRIVATE_ENDPOINTS_NOT_DISPLAYED; NO_SERVICE_OR_TRANSACTION_CHANGES', file=sys.stderr)
        raise SystemExit(1)
