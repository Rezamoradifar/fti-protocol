import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import os from 'node:os';
import test from 'node:test';
import ganache from 'ganache';
import {JsonRpcProvider,Contract,MaxUint256,parseEther as E,keccak256} from 'ethers';
import {deployOne,artifact,settle} from '../scripts/lib.mjs';
test('read-only snapshots preserve both source models and survive private archive roundtrip',{timeout:600000},async()=>{
const root=process.cwd(),kit=fs.mkdtempSync(path.join(os.tmpdir(),'fti-recovery-test-'));
fs.writeFileSync(path.join(kit,'capture.mjs'),execFileSync('python3',['-I','-c',"import runpy; print(runpy.run_path('tools/backup-users-state.py')['NODE_READER'])"]));
const engine=ganache.server({chain:{chainId:31337},logging:{quiet:true},wallet:{totalAccounts:45},miner:{blockGasLimit:30000000}});
await engine.listen(0,'127.0.0.1');
const url='http://127.0.0.1:'+engine.address().port;
const p=new JsonRpcProvider(url,undefined,{cacheTimeout:-1});p.pollingInterval=10;
const send=async t=>{await(await t).wait()};
const w=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i))),a=await Promise.all(w.map(x=>x.getAddress()));
try{
 for(const kind of ['upgradeable','legacy']){
  const usd=await deployOne('MockUSD',[],w[0]),council=await deployOne('SevenGuardianCouncil',[a.slice(31,38)],w[0]),tl=await deployOne('FTITimelock',[council.target],w[0]);
  let binary,token,bi,ti;
  const bn=kind==='upgradeable'?'FundedBinaryPlanUpgradeable':'FundedBinaryPlan',tn=kind==='upgradeable'?'FTIReserveTokenUpgradeable':'FTIReserveTokenV3';
  if(kind==='upgradeable'){
   ti=await deployOne(tn,[],w[0]);const tp=await deployOne('FTIProxy',[ti.target,ti.interface.encodeFunctionData('initialize',[usd.target,tl.target,council.target])],w[0]);token=new Contract(tp.target,artifact(tn).abi,w[0]);
   bi=await deployOne(bn,[],w[0]);const bp=await deployOne('FTIProxy',[bi.target,bi.interface.encodeFunctionData('initialize',[usd.target,tp.target,tl.target,council.target,a[44],a.slice(0,31)])],w[0]);binary=new Contract(bp.target,artifact(bn).abi,w[0]);
  }else{token=await deployOne(tn,[usd.target,tl.target,council.target],w[0]);binary=await deployOne(bn,[usd.target,token.target,tl.target,council.target,a[44],a.slice(0,31)],w[0]);}
  const bind=await(await token.bind(binary.target)).wait();
  for(const i of [0,1,2]){await send(usd.connect(w[i]).faucet());await send(usd.connect(w[i]).approve(binary.target,MaxUint256));}
  await send(binary.setAutoBuy(true,MaxUint256));await send(binary.addUnits(2));await send(binary.connect(w[1]).addUnits(100));await send(binary.connect(w[2]).addUnits(100));await settle({usd,binary,token},p);
  await send(usd.approve(token.target,MaxUint256));await send(token.buy(E('100'),0,MaxUint256));await send(token.transfer(a[40],E('1')));
  const cfg={chainId:31337,sourceRevision:'2afdc682b2eb4961b30e856b415f09d29fcda92d',binaryContract:bn,tokenContract:tn,
   binary:binary.target,token:token.target,usd:usd.target,council:council.target,timelock:tl.target,deployedBlock:bind.blockNumber,codeHashes:{}};
  for(const key of ['binary','token','usd','council','timelock'])cfg.codeHashes[key]=keccak256(await p.getCode(cfg[key]));
  if(bi){cfg.binaryImplementation=bi.target;cfg.tokenImplementation=ti.target;cfg.implementationCodeHashes={binary:keccak256(await p.getCode(bi.target)),token:keccak256(await p.getCode(ti.target))};}
  const dir=path.join(kit,'evm-final-'+kind);fs.mkdirSync(path.join(dir,'tooling'),{recursive:true});fs.mkdirSync(path.join(dir,'artifacts'));
  fs.writeFileSync(path.join(dir,'deployment-public.json'),JSON.stringify(cfg));
  fs.mkdirSync(path.join(dir,'contracts')); for(const f of fs.readdirSync('contracts').filter(n=>n.endsWith('.sol')))fs.copyFileSync(path.join(root,'contracts',f),path.join(dir,'contracts',f));
  for(const n of [bn,tn,'MockUSD'])fs.copyFileSync('artifacts/'+n+'.json',path.join(dir,'artifacts',n+'.json'));
  fs.copyFileSync(path.join(root,'scripts/migration-inventory.mjs'),path.join(dir,'tooling/migration-inventory.mjs'));
  fs.copyFileSync('scripts/migration-complete-export.mjs',path.join(dir,'tooling/migration-complete-export.mjs'));
  fs.copyFileSync(path.join(kit,'capture.mjs'),path.join(dir,'tooling/capture.mjs'));
  fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'tooling/node_modules'),'dir');
  const block=await p.getBlock('latest');
  const rc=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(dir,'tooling/capture.mjs'),root,dir,url,String(block.number),block.hash],{stdio:'inherit'});child.on('error',reject);child.on('exit',resolve)});
  if(rc!==0)throw Error('SNAPSHOT_SMOKE_FAILED '+kind);
  const report=JSON.parse(fs.readFileSync(path.join(dir,'snapshot.json')));
  if(report.users.length!==31||report.ledger.holders.length!==32)throw Error('Missing fixture users or non-member holder');
  console.log('SNAPSHOT_EVM_READ_PASS',JSON.stringify({kind,members:report.users.length,holders:report.ledger.holders.length,scope:'LOCAL_FIXTURE_NOT_USER_SERVER'}));
  fs.unlinkSync(path.join(dir,'tooling/node_modules'));
  const check=execFileSync('python3',['-I','-c',"import runpy,pathlib,json,sys; m=runpy.run_path('tools/backup-users-state.py'); p=pathlib.Path(sys.argv[1]); m['validate_snapshot'](json.loads((p/'snapshot.json').read_text())); print(m['make_archive'](p,p.parent/(p.name+'.tar.gz')))",dir],{encoding:'utf8'});if(!/^[a-f0-9]{64}/.test(check))throw Error('Archive roundtrip failed');
 }
}finally{p.destroy();await engine.close();fs.rmSync(kit,{recursive:true,force:true});}
});
