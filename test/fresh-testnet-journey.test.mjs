import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {BrowserProvider,Contract,Wallet,parseEther as E} from 'ethers';
import {artifact,deployOne} from '../scripts/lib.mjs';
import {runJourney,reserveCost,checkTarget,TARGET,REVISION} from '../tools/fresh-testnet-journey.mjs';
test('live journey pins chain, deployment and approved budget before spending',()=>{
 const cfg={chainId:97,sourceRevision:REVISION,deploymentKind:'fresh-testnet',...TARGET};checkTarget(cfg);
 for(const change of [{chainId:56},{chainId:31337},{sourceRevision:'0'.repeat(40)},{binary:TARGET.token},{deploymentKind:'migration'}])assert.throws(()=>checkTarget({...cfg,...change}));
 const j={done:{},reserved:'100'},limits={budget:1000n,price:10n};
 assert.equal(reserveCost(j,{gasLimit:10n,gasPrice:5n,value:25n},limits),175n);
 for(const v of [{gasLimit:10n,gasPrice:11n},{gasLimit:3000001n,gasPrice:1n},{gasLimit:10n,gasPrice:5n,value:900n}])assert.throws(()=>reserveCost(j,v,limits));
});
test('same journey executes registration, repeat purchase, burn, sale and exact cash payout, then resumes without duplicate spending',{timeout:240000},async()=>{
 const engine=ganache.provider({logging:{quiet:true},chain:{chainId:31337,time:new Date('2026-10-15T00:01:00Z')},wallet:{totalAccounts:40},miner:{blockGasLimit:30000000,defaultGasPrice:1000000000}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-small-journey-'));
 const sent=async promise=>{const r=await(await promise).wait();assert.equal(r.status,1);};
 try{
  const w=await Promise.all(Array.from({length:40},(_,i)=>p.getSigner(i))),a=await Promise.all(w.map(x=>x.getAddress()));
  const usd=await deployOne('MockUSD',[],w[0]),council=await deployOne('SevenGuardianCouncil',[a.slice(31,38)],w[0]),tl=await deployOne('FTITimelock',[council.target],w[0]);
  const ti=await deployOne('FTIReserveTokenUpgradeable',[],w[0]),bi=await deployOne('FundedBinaryPlanUpgradeable',[],w[0]);
  const tp=await deployOne('FTIProxy',[ti.target,ti.interface.encodeFunctionData('initialize',[usd.target,tl.target,council.target])],w[0]);
  const bp=await deployOne('FTIProxy',[bi.target,bi.interface.encodeFunctionData('initialize',[usd.target,tp.target,tl.target,council.target,a[0],a.slice(0,31)])],w[0]);
  const token=new Contract(tp.target,artifact('FTIReserveTokenUpgradeable').abi,w[0]),binary=new Contract(bp.target,artifact('FundedBinaryPlanUpgradeable').abi,w[0]);await sent(token.bind(binary.target));
  // Existing funded testnet state, including an older unallocated global pool.
  await sent(usd.faucet());await sent(usd.approve(binary.target,E('100000')));await sent(binary.addUnits(1000));
  await sent(usd.approve(token.target,E('100')));await sent(token.buy(E('50'),0,2n**64n-1n));
  const cfg={chainId:31337,sourceRevision:REVISION,usd:usd.target,token:token.target,binary:binary.target};
  const owner=new Wallet(engine.getInitialAccounts()[a[39].toLowerCase()].secretKey,p);
  const tick=async()=>{
   if(await binary.phase()===0n&&await binary.jobCursor()<await binary.jobCount()){await sent(binary.processVolume(100,{gasLimit:3000000}));return;}
   if(await binary.phase()===0n&&await binary.rewardAccountCount()>0n){await sent(binary.payRewards(100,{gasLimit:3000000}));return;}
   if(await binary.phase()===0n){const now=(await p.getBlock('latest')).timestamp;await p.send('evm_increaseTime',[Math.max(0,Number(await binary.epochEnd())-now+1)]);await p.send('evm_mine',[]);await sent(binary.beginEpochClose());}
   while(await binary.phase()>0n)await sent(binary.processEpoch(100,{gasLimit:3000000}));
  };
  const args={cfg,p,owner,dir,limits:{budget:E('0.03'),price:10000000000n},verify:false,tick,log:(kind,label)=>console.log('LOCAL_JOURNEY',kind,label)};
  const getLogs=p.getLogs.bind(p),nonce=await p.getTransactionCount(owner.address);
  p.getLogs=async()=>{throw Error('simulated history outage');};
  await assert.rejects(()=>runJourney(args),/History RPC unavailable before test funding/);
  assert.equal(await p.getTransactionCount(owner.address),nonce);assert(!fs.existsSync(path.join(dir,'journal.json')));
  p.getLogs=getLogs;
  // Interrupt after a signed transaction has been persisted and before broadcast.
  const broadcast=p.broadcastTransaction.bind(p);let injected=false;
  p.broadcastTransaction=async raw=>{if(!injected){injected=true;throw Error('simulated lost network');}return broadcast(raw);};
  await assert.rejects(()=>runJourney(args),/Broadcast unresolved/);
  const pending=JSON.parse(fs.readFileSync(path.join(dir,'journal.json'))).pending;assert(pending.raw&&pending.hash);
  p.broadcastTransaction=broadcast;
  const report=await runJourney(args);assert.equal(report.scope,'LOCAL_EVM_ONLY');assert.equal(report.result,'FTI_TESTNET_JOURNEY_PASS');
  assert.equal(report.checks.registrations,4);assert(BigInt(report.binary.cashPaid)>=E('90000'));assert(report.hourlyClosures.some(x=>x.checked&&BigInt(x.points)>0n));
  assert(report.transactions.some(x=>x.hash===pending.hash));assert.equal(report.transactions.filter(x=>x.label==='fund-0').length,1);
  const before=await p.getTransactionCount(owner.address);const again=await runJourney(args);assert.equal(again.result,report.result);assert.equal(await p.getTransactionCount(owner.address),before);
  const publicText=fs.readFileSync(path.join(dir,'report.json'),'utf8'),privateState=JSON.parse(fs.readFileSync(path.join(dir,'journal.json')));
  for(const key of privateState.keys)assert(!publicText.includes(key));assert(!publicText.includes(pending.raw));
  assert.equal(fs.statSync(path.join(dir,'journal.json')).mode&0o777,0o600);
 }finally{p.destroy();await engine.disconnect();fs.rmSync(dir,{recursive:true,force:true});}
});
