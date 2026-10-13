#!/usr/bin/env python3
"""Private, one-shot fixed-block FTI user export. No signing or service changes.

Runs on the existing server, through its loopback read-only RPC. Archive roundtrip
and accounting checks are NOT an EVM restore or a guarantee of asset recovery.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

REV = 'fe7cebf28e4f9e3af579be7b4259a980e41a7820'
BASE = 'https://raw.githubusercontent.com/Rezamoradifar/fti-protocol/' + REV + '/'
PINS = {
    'scripts/migration-inventory.mjs': '4b03423d880176f5c214acf68362fc905fb15a3e',
    'scripts/migration-complete-export.mjs': '5c5779b2b2dfef370c6f289ed02a7c5602364158',
}
SERVER_PINS = {'a3bfcf8b3973fb3cad0ce03c5cff2ce560d71859',
               '66ab3d1dc1ecf757c37904f6077ed4fa155af0b9',
               'dc94752062e023d29d998e41f823dcbe1ea73804'}
CONFIG_KEYS = ('chainId', 'sourceRevision', 'release', 'binaryContract', 'tokenContract',
               'binary', 'token', 'usd', 'council', 'timelock', 'development',
               'binaryImplementation', 'tokenImplementation', 'codeHashes',
               'implementationCodeHashes', 'deployedBlock', 'transactions',
               'constructorArgs', 'daoPartners', 'genesis', 'artifactHashes',
               'sourceFingerprint', 'deployer')


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()


def regular(file, maximum=32_000_000):
    fd = os.open(str(file), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_size <= maximum, 'INVALID_FILE')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            data = stream.read(maximum + 1)
        need(len(data) <= maximum, 'FILE_TOO_LARGE')
        return data
    finally:
        os.close(fd)


def save(file, data):
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(str(file), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def dump(file, value):
    save(file, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode())


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('REDIRECT_REFUSED')


def fetch(url, payload=None, maximum=2_000_000):
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    with client.open(request, timeout=35) as response:
        need(response.status == 200, 'HTTP_STATUS')
        data = response.read(maximum + 1)
    need(len(data) <= maximum, 'RESPONSE_TOO_LARGE')
    return data


def rpc(port, method, params):
    need(method in ('eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber'), 'RPC_NOT_READONLY')
    data = json.loads(fetch(f'http://127.0.0.1:{port}/rpc',
        {'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}))
    need(data.get('id') == 1 and 'result' in data and 'error' not in data, 'RPC_READ_FAILED')
    return data['result']


def read_config(port):
    original = json.loads(fetch(f'http://127.0.0.1:{port}/api/config'))
    need(isinstance(original, dict), 'INVALID_CONFIG')
    cfg = {k: original[k] for k in CONFIG_KEYS if k in original}
    need(cfg.get('chainId') == 97, 'ONLY_EXISTING_TESTNET_SUPPORTED')
    need((cfg.get('binaryContract'), cfg.get('tokenContract')) in (
        ('FundedBinaryPlanUpgradeable', 'FTIReserveTokenUpgradeable'),
        ('FundedBinaryPlan', 'FTIReserveTokenV3')), 'UNKNOWN_MODELS')
    need(re.fullmatch('[0-9a-f]{40}', str(cfg.get('sourceRevision', ''))), 'UNKNOWN_REVISION')
    for k in ('binary', 'token', 'usd', 'council', 'timelock'):
        need(re.fullmatch('0x[0-9a-fA-F]{40}', str(cfg.get(k, ''))) and int(cfg[k], 16), 'BAD_ADDRESS')
        need(re.fullmatch('0x[0-9a-fA-F]{64}', str(cfg.get('codeHashes', {}).get(k, ''))), 'MISSING_CODE_HASH')
    need(type(cfg.get('deployedBlock')) is int and cfg['deployedBlock'] > 0, 'MISSING_CREATION_BLOCK')
    return cfg


def resolve(port):
    out = subprocess.run(['ss', '-H', '-ltnp', 'sport = :' + str(port)],
                         check=True, capture_output=True, text=True, timeout=15)
    pids = set(re.findall(r'pid=(\d+)', out.stdout))
    need(len(pids) == 1, 'PORT_PROCESS_AMBIGUOUS')
    pid = pids.pop()
    proc = Path('/proc') / pid
    cwd = (proc / 'cwd').resolve(strict=True)
    entries = [os.fsdecode(a) for a in (proc / 'cmdline').read_bytes().split(b'\0')
               if a == b'scripts/server.mjs' or a.endswith(b'/scripts/server.mjs')]
    need(len(entries) == 1, 'DIRECT_SERVER_PROCESS_REQUIRED')
    entry = (cwd / entries[0]).resolve(strict=True)
    need(blob(regular(entry)) in SERVER_PINS, 'UNREVIEWED_SERVER_CODE')
    node = (proc / 'exe').resolve(strict=True)
    need(node.name == 'node' and os.access(node, os.X_OK), 'NODE_EXECUTABLE_MISSING')
    return entry.parent.parent, str(node), pid


def unsigned(value):
    need(isinstance(value, str) and re.fullmatch('0|[1-9][0-9]*', value), 'INVALID_RAW_UINT')
    return int(value)


def validate_snapshot(report):
    need(report.get('schema') == 'FTI_COMPLETE_EXPORT_V1' and report.get('migrationReady') is False,
         'NOT_COMPLETE_EXPORT')
    users = report['users']
    need(isinstance(users, list) and users, 'NO_USER_DATA')
    by = {u['wallet'].lower(): u for u in users}
    need(len(by) == len(users), 'DUPLICATE_MEMBERS')
    zero = '0x' + '0' * 40
    for u in users:
        m = u['member']
        need(m['exists'] is True, 'INACTIVE_MEMBER')
        parent = m['parent'].lower()
        if parent != zero:
            need(parent in by, 'MISSING_PARENT')
            pm = by[parent]['member']
            need(u['wallet'].lower() in (pm['left'].lower(), pm['right'].lower()), 'BAD_PARENT_LINK')
            need(unsigned(u['depth']) == unsigned(by[parent]['depth']) + 1, 'BAD_DEPTH')
        else:
            need(unsigned(u['depth']) == 0, 'BAD_ROOT')
        for side in ('left', 'right'):
            child = m[side].lower()
            if child != zero:
                need(child in by and by[child]['member']['parent'].lower() == u['wallet'].lower(), 'BAD_CHILD_LINK')
    b, t, ledger = report['global']['binary'], report['global']['token'], report['ledger']
    holders = ledger['holders']
    need(len({h['wallet'].lower() for h in holders}) == len(holders), 'DUPLICATE_HOLDERS')
    need(sum(unsigned(h['balance']) for h in holders) == unsigned(t['totalSupply']), 'SUPPLY_MISMATCH')
    need(sum(unsigned(u['pendingAuto']) for u in users) == unsigned(b['totalAuto']), 'AUTO_MISMATCH')
    need(sum(unsigned(u['creditL']) + unsigned(u['creditR']) for u in users) == unsigned(b['assignedPointCredit']), 'POINT_CREDIT_MISMATCH')
    need(sum(sum(unsigned(v) for v in c['amounts']) for m in ledger['months'] for c in m['credits']) == unsigned(b['assignedBuilderCredit']), 'BUILDER_CREDIT_MISMATCH')
    cash = ledger['cashQueue']
    need(len({c['wallet'].lower() for c in cash}) == len(cash), 'DUPLICATE_CASH_QUEUE')
    need(sum(unsigned(c['amount']) for c in cash) == unsigned(b['totalPending']), 'CASH_MISMATCH')
    for key in ('binary', 'token'):
        actual, book = report['accounting'][key]
        need(unsigned(actual) == unsigned(book), 'ACCOUNTING_MISMATCH')
    return {'members': len(users), 'holderLedgerEntries': len(holders), 'block': report['block']['number'],
            'blockHash': report['block']['hash'], 'binaryRaw': report['accounting']['binary'][0],
            'tokenRaw': report['accounting']['token'][0]}


NODE_READER = r'''
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const [root,dir,url,blockText,expectedHash]=process.argv.slice(2);
const require=createRequire(path.join(root,'package.json'));
const {JsonRpcProvider,FetchRequest,Contract,keccak256}=require('ethers');
const {collectInventory}=await import(pathToFileURL(path.join(dir,'tooling/migration-inventory.mjs')));
const {completeExport}=await import(pathToFileURL(path.join(dir,'tooling/migration-complete-export.mjs')));
const cfg=JSON.parse(fs.readFileSync(path.join(dir,'deployment-public.json')));
const blockTag=Number(blockText),tag='0x'+blockTag.toString(16);
let reads=0;
function check(ok,msg){if(!ok)throw Error(msg);}
class ReadOnly extends JsonRpcProvider {
 async _send(payload){
  for(const r of Array.isArray(payload)?payload:[payload]){
   check(['eth_chainId','eth_getBlockByNumber','eth_call','eth_getCode','eth_getStorageAt','eth_getLogs','eth_getBalance'].includes(r.method),'WRITE_OR_UNEXPECTED_RPC_BLOCKED');
   if(['eth_call','eth_getCode','eth_getBalance'].includes(r.method))check(r.params[1]===tag,'NON_SNAPSHOT_READ');
   if(r.method==='eth_getStorageAt')check(r.params[2]===tag,'NON_SNAPSHOT_STORAGE');
   if(r.method==='eth_getBlockByNumber')check(/^0x[0-9a-f]+$/i.test(r.params[0])&&BigInt(r.params[0])<=BigInt(blockTag),'DYNAMIC_BLOCK_REFUSED');
   if(r.method==='eth_getLogs')check(BigInt(r.params[0].fromBlock)>=BigInt(cfg.deployedBlock)&&BigInt(r.params[0].toBlock)<=BigInt(blockTag),'LOG_RANGE_REFUSED');
   reads++;check(reads<=2000000,'READ_BUDGET_EXCEEDED');
   if(reads%500===0)console.log(JSON.stringify({stage:'reading',requests:reads}));
  }
  return super._send(payload);
 }
}
let provider;
const save=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value,(_,x)=>typeof x==='bigint'?String(x):x,2)+'\n',{flag:'wx',mode:0o600});
try{
 check(Number.isSafeInteger(blockTag)&&blockTag>=cfg.deployedBlock,'BAD_SNAPSHOT_BLOCK');
 // Reproduce the binary bytecode before trusting its storage layout. Only
 // snapshot files are written; installed artifacts/contracts stay untouched.
 console.log(JSON.stringify({stage:'reproducing-storage-layout'}));
 const solc=require('solc');
 const binaryArtifact=JSON.parse(fs.readFileSync(path.join(dir,'artifacts',cfg.binaryContract+'.json')));
 check(solc.version()===binaryArtifact.compiler,'COMPILER_VERSION_MISMATCH');
 const sources=Object.fromEntries(fs.readdirSync(path.join(dir,'contracts')).filter(n=>n.endsWith('.sol')).map(n=>[n,{content:fs.readFileSync(path.join(dir,'contracts',n),'utf8')}]));
 const selection={'*':{'*':['storageLayout']}};
 selection[binaryArtifact.source]={[cfg.binaryContract]:['storageLayout','evm.bytecode.object']};
 const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:selection}};
 const compiled=JSON.parse(solc.compile(JSON.stringify(input),{import:n=>{
  const resolved=path.resolve(root,'node_modules',n),base=path.resolve(root,'node_modules')+path.sep;
  if(!resolved.startsWith(base)||!resolved.endsWith('.sol'))return {error:'IMPORT_REFUSED'};
  try{return {contents:fs.readFileSync(resolved,'utf8')}}catch{return {error:'MISSING_IMPORT'}}
 }}));
 check(!(compiled.errors||[]).some(e=>e.severity==='error'),'STORAGE_COMPILE_FAILED');
 const compiledBinary=compiled.contracts?.[binaryArtifact.source]?.[cfg.binaryContract];
 check(compiledBinary&&('0x'+compiledBinary.evm.bytecode.object).toLowerCase()===binaryArtifact.bytecode.toLowerCase(),'SOURCE_ARTIFACT_MISMATCH');
 cfg.binaryStorageLayout=compiledBinary.storageLayout;
 save('binary-storage-layout.json',cfg.binaryStorageLayout);
 // solc.compile blocks this process for long enough to expire idle HTTP
 // connections. Open RPC only after compilation, so no stale keep-alive socket
 // or request timer survives that pause. The fixed block is still verified.
 const request=new FetchRequest(url);request.timeout=30000;
 provider=new ReadOnly(request,undefined,{cacheTimeout:-1,batchMaxCount:20,batchStallTime:10});
 check((await provider.getNetwork()).chainId===BigInt(cfg.chainId),'WRONG_CHAIN');
 const first=await provider.getBlock(blockTag);check(first?.hash===expectedHash,'BLOCK_IDENTITY_CHANGED');
 const abi=n=>JSON.parse(fs.readFileSync(path.join(dir,'artifacts',n+'.json'))).abi;
 const binary=new Contract(cfg.binary,abi(cfg.binaryContract),provider),token=new Contract(cfg.token,abi(cfg.tokenContract),provider),usd=new Contract(cfg.usd,abi('MockUSD'),provider);
 const bytecode={},nativeBalances={};
 for(const key of ['binary','token','usd','council','timelock']){
  const code=await provider.getCode(cfg[key],blockTag);
  check(code!=='0x'&&keccak256(code).toLowerCase()===cfg.codeHashes[key].toLowerCase(),'CODE_HASH_MISMATCH');bytecode[key]=code;nativeBalances[key]=await provider.getBalance(cfg[key],blockTag);
 }
 console.log(JSON.stringify({stage:'users',block:blockTag}));
 const inv=await collectInventory({provider,binary,token,usd,cfg,blockTag});
 for(const key of ['binary','token'])if(inv.implementations[key]){
  check(inv.implementations[key].address.toLowerCase()===cfg[key+'Implementation'].toLowerCase(),'IMPLEMENTATION_ADDRESS_CHANGED');
  bytecode[key+'Implementation']=await provider.getCode(inv.implementations[key].address,blockTag);
 }
 save('inventory-partial.json',inv);
 console.log(JSON.stringify({stage:'full-ledger',members:inv.users.length}));
 // Fail rather than invent missing history, addresses, balances, or storage.
 const complete=await completeExport(inv,{provider,binary,token,cfg});
 const again=await provider.getBlock(blockTag);check(again?.hash===expectedHash,'SNAPSHOT_REORGANIZED');
 save('snapshot.json',complete);save('onchain-code.json',bytecode);save('native-balances.json',nativeBalances);
 console.log(JSON.stringify({result:'FIXED_BLOCK_EXPORT_SAVED',members:complete.users.length,requests:reads}));
}catch(e){console.error('FTI_SNAPSHOT_READ_FAILED: '+(/^[A-Z0-9_]{3,80}$/.test(e?.message||'')?e.message:e?.code||'EXPORT_OR_HISTORY_CHECK'));process.exitCode=1;}
finally{provider?.destroy();}
'''


def make_archive(folder, destination):
    files = {str(p.relative_to(folder)): sha(regular(p, 512_000_000))
             for p in sorted(folder.rglob('*')) if p.is_file() and not p.is_symlink()}
    dump(folder / 'MANIFEST.json', {'schema': 'FTI_PRIVATE_EXPORT_ARCHIVE_V1', 'files': files})
    with destination.open('xb') as out:
        with tarfile.open(fileobj=out, mode='w:gz') as tar:
            for name in [*files, 'MANIFEST.json']:
                tar.add(folder / name, arcname=name, recursive=False)
        out.flush()
        os.fsync(out.fileno())
    os.chmod(destination, 0o600)
    # Extract only expected regular files; never use a generic extractall.
    with tempfile.TemporaryDirectory(prefix='restore-check-', dir=str(destination.parent)) as tmp:
        restored = Path(tmp)
        with tarfile.open(destination, 'r:gz') as tar:
            members = tar.getmembers()
            need({m.name for m in members} == set(files) | {'MANIFEST.json'} and
                 len(members) == len(files)+1, 'ARCHIVE_MEMBER_MISMATCH')
            for m in members:
                rel = Path(m.name)
                need(m.isfile() and not rel.is_absolute() and '..' not in rel.parts and m.size <= 512_000_000, 'UNSAFE_ARCHIVE')
                with tar.extractfile(m) as stream:
                    data = stream.read(512_000_001)
                if m.name in files:
                    need(sha(data) == files[m.name], 'ARCHIVE_HASH_MISMATCH')
                save(restored / rel, data)
        for snap in restored.glob('port-*/snapshot.json'):
            validate_snapshot(json.loads(regular(snap, 512_000_000)))
    with destination.open('rb') as stream:
        h = hashlib.sha256()
        for part in iter(lambda: stream.read(1024*1024), b''):
            h.update(part)
    save(Path(str(destination)+'.sha256'), (h.hexdigest()+'  '+destination.name+'\n').encode())
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ports', nargs='+', type=int, choices=(3110, 3108), default=[3110,3108])
    parser.add_argument('--output-root', type=Path, default=Path('/var/backups/fti-users'))
    args = parser.parse_args()
    need(os.geteuid()==0, 'RUN_ON_FTI_SERVER_AS_ROOT')
    need(len(set(args.ports))==len(args.ports), 'DUPLICATE_PORT')
    os.umask(0o077)
    base = args.output_root
    need(base.is_absolute(), 'ABSOLUTE_BACKUP_PATH_REQUIRED')
    base.mkdir(mode=0o700, parents=True, exist_ok=True)
    need(not base.is_symlink() and base.stat().st_mode & 0o077 == 0, 'PRIVATE_BACKUP_DIRECTORY_REQUIRED')
    work = Path(tempfile.mkdtemp(prefix='capture-', dir=str(base)))
    data = work / 'data'
    data.mkdir(mode=0o700)
    print('FTI_PRIVATE_BACKUP_DIR='+str(work), flush=True)
    try:
        targets=[]
        for port in args.ports:
            root,node,pid=resolve(port);cfg=read_config(port)
            need(int(rpc(port,'eth_chainId',[]),16)==97,'WRONG_RPC_CHAIN')
            latest=int(rpc(port,'eth_blockNumber',[]),16)
            targets.append((port,root,node,pid,cfg,latest))
        for t in targets:
            need(base.resolve()!=t[1] and t[1] not in base.resolve().parents,'BACKUP_MUST_BE_OUTSIDE_PROJECT')
        block=min(t[5] for t in targets)-20
        need(block>0,'CHAIN_TOO_SHORT')
        hashes=[rpc(t[0],'eth_getBlockByNumber',[hex(block),False])['hash'] for t in targets]
        need(len(set(hashes))==1,'RPCS_DISAGREE_ON_BLOCK')
        sources={}
        for path,pin in PINS.items():
            source=fetch(BASE+path,maximum=100_000)
            need(blob(source)==pin,'EXPORTER_HASH_MISMATCH')
            sources[Path(path).name]=source
        summaries=[]
        for port,root,node,pid,cfg,latest in targets:
            need(block>=cfg['deployedBlock'],'DEPLOYMENT_NOT_AT_SNAPSHOT')
            folder=data/('port-'+str(port));folder.mkdir(mode=0o700)
            dump(folder/'deployment-public.json',cfg)
            for name in (cfg['binaryContract'],cfg['tokenContract'],'MockUSD'):
                save(folder/'artifacts'/(name+'.json'),regular(root/'artifacts'/(name+'.json')))
            for contract in (root/'contracts').glob('*.sol'):
                save(folder/'contracts'/contract.name,regular(contract))
            save(folder/'package-lock.json',regular(root/'package-lock.json'))
            for name,source in sources.items():save(folder/'tooling'/name,source)
            save(folder/'tooling/capture.mjs',NODE_READER.encode())
            # Only dependency resolution; never copy private keys or start a worker.
            dependency_link=folder/'tooling/node_modules'
            dependency_link.symlink_to(root/'node_modules',target_is_directory=True)
            env={'HOME':str(work),'PATH':str(Path(node).parent)+':/usr/bin:/bin','LANG':'C.UTF-8','CI':'1'}
            print('FTI_EXPORTING_PORT='+str(port),flush=True)
            print('FTI_CAPTURE_LOG='+str(folder/'capture.log'),flush=True)
            transport_port=3110 if 3110 in args.ports else port
            try:
                with (folder/'capture.log').open('xb') as log:
                    child=subprocess.run([node,str(folder/'tooling/capture.mjs'),str(root),str(folder),
                                          f'http://127.0.0.1:{transport_port}/rpc',str(block),hashes[0]],
                                         cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=7200)
                need(child.returncode==0,'EXPORT_FAILED_SEE_PRIVATE_LOG')
            finally:
                dependency_link.unlink(missing_ok=True)
            need(resolve(port)==(root,node,pid) and read_config(port)==cfg,'SOURCE_CHANGED_DURING_EXPORT')
            summary=validate_snapshot(json.loads(regular(folder/'snapshot.json',512_000_000)))
            summaries.append({'port':port,**summary})
            print(json.dumps({'result':'PORT_EXPORT_CHECKED','port':port,'members':summary['members']}),flush=True)
        for port in args.ports:
            need(rpc(port,'eth_getBlockByNumber',[hex(block),False])['hash']==hashes[0],'SNAPSHOT_REORGANIZED')
        dump(data/'CAPTURE.json',{'schema':'FTI_USER_SAFETY_CAPTURE_V1','exports':summaries,
              'fixedBlock':block,'hash':hashes[0],'blockSelection':'minimum RPC head minus 20; not an assertion of finality',
              'sourceFrozen':False,'newTransactionsIncluded':False,'fundsMoved':False,
              'evmRestoreTested':False,'containsPrivateKeys':False,
              'scope':'On-chain user/accounting export only. Not an off-chain database or wallet-key backup.'})
        archive=work/'fti-users-snapshot.tar.gz'
        digest=make_archive(data,archive)
        result={'result':'FTI_USERS_BACKUP_SAVED','archive':str(archive),'sha256':digest,
                'exports':summaries,'archiveRestoreCheck':'PASS','evmRestoreTested':False,
                'fundsMoved':False,'sourceFrozen':False,'servicesRestarted':False,'offServerCopy':False}
        dump(work/'result.json',result)
        print(json.dumps(result,ensure_ascii=False,indent=2),flush=True)
    except Exception as e:
        code=str(e) if isinstance(e,RuntimeError) else type(e).__name__
        dump(work/'FAILED.json',{'result':'FAILED','reason':code,'completeBackup':False})
        print('FTI_USERS_BACKUP_FAILED: '+code+'; '+str(work/'FAILED.json'),file=sys.stderr)
        return 1
    return 0


if __name__=='__main__':
    raise SystemExit(main())
