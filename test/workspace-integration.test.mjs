import {describe,test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {JsonRpcProvider,MaxUint256,ZeroHash,id,parseEther as E} from 'ethers';
import {confirmedTransactionDelta,formatRatio,readRatioSnapshot} from '../frontend/exact-price.mjs';
import {deploySuite} from '../scripts/lib.mjs';
import {startWeb} from '../scripts/server.mjs';
import {settlementReadiness,actionAvailability,proposalAvailability,timelockPresentation} from '../frontend/workspace-state.mjs';
// Fresh ephemeral local contracts and HTTP, not a browser-render or live-wallet test.
const tx=async promise=>(await promise).wait();
describe('workspace readiness against current retirement contracts and API',()=>{
 let chain,p,web,base,s,signers,dir,saved,snapshot;
 const read=async route=>{const r=await fetch(base+route);assert.equal(r.status,200,await r.clone().text());return r.json();};
 const state=async(wallet=s.addresses[38])=>{const d=await read('/api/state?wallet='+wallet);d.lastClosedAt=await s.binary.lastClosedAt();return d;};
 before(async()=>{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-workspace-'));
  saved=Object.fromEntries(['HOST','PORT','RPC_URL','EVENT_RPC_URL'].map(k=>[k,process.env[k]]));
  chain=ganache.server({logging:{quiet:true},wallet:{totalAccounts:42},chain:{chainId:31337,time:new Date('2026-01-02T00:00:00Z')},miner:{blockGasLimit:30000000}});await chain.listen(0,'127.0.0.1');
  const rpcUrl=`http://127.0.0.1:${chain.address().port}`;p=new JsonRpcProvider(rpcUrl,undefined,{cacheTimeout:-1});p.pollingInterval=10;signers=await Promise.all(Array.from({length:42},(_,i)=>p.getSigner(i)));s=await deploySuite(signers,{tokenContract:'FTIRetirementReviewToken',binaryContract:'BinaryPlan'});
  for(const i of [0,38]){await tx(s.usd.connect(signers[i]).faucet());await tx(s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256));await tx(s.usd.connect(signers[i]).approve(s.token.target,MaxUint256));}
  const config=path.join(dir,'workspace.json');fs.writeFileSync(config,JSON.stringify({mode:'local',chainId:31337,rpcUrl,tokenContract:'FTIRetirementReviewToken',binaryContract:'BinaryPlan',lockVersion:3,accounts:s.addresses,genesis:s.addresses.slice(0,31),councilOwners:s.addresses.slice(31,38),binary:s.binary.target,token:s.token.target,usd:s.usd.target,council:s.council.target,timelock:s.timelock.target}));
  process.env.HOST='127.0.0.1';process.env.PORT='0';delete process.env.RPC_URL;delete process.env.EVENT_RPC_URL;web=await startWeb(config);base=`http://127.0.0.1:${web.address().port}`;snapshot=await p.send('evm_snapshot',[]);
 });
 beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
 after(async()=>{if(web)await new Promise(r=>web.close(r));if(p)p.destroy();if(chain)await chain.close();for(const[k,v]of Object.entries(saved||{})){if(v===undefined)delete process.env[k];else process.env[k]=v;}if(dir)fs.rmSync(dir,{recursive:true,force:true});});
 test('all workspace assets, config and current ABI resolve without granting a wallet role',async()=>{
  for(const route of ['/app/','/token/','/admin/','/app/app.js','/token/app.js','/admin/app.js','/app/style.css','/token/style.css','/admin/style.css'])assert.equal((await fetch(base+route)).status,200,route);
  const cfg=await read('/api/config');assert.equal(cfg.tokenContract,'FTIRetirementReviewToken');assert(!cfg.rpcUrl);assert.equal(await s.council.isOwner(cfg.accounts[36]),true);assert.equal(await s.council.isOwner(cfg.accounts[38]),false);
  const d=await state();const a=actionAvailability({data:d,wallet:d.wallet,connected:false,fresh:true});assert(Object.values(a).every(x=>!x));
  const abi=await read('/abi/FTIRetirementReviewToken');for(const name of ['buyFeeQuote','sellFeeQuote','permanentlyRetired'])assert(abi.some(x=>x.name===name));
 });
 test('same-hour five-unit registration, queue readiness and funded rank remain separate facts',async()=>{
  await tx(s.binary.connect(signers[38]).register(s.addresses[15],5));const d=await state();assert.equal(d.wallet.units,'5');assert.equal(d.wallet.cumulativePaidRankPoints,'0');assert.equal(d.wallet.rank,'0');
  const r=settlementReadiness(d);assert.equal(r.volume.ready,true);assert.equal(r['close-epoch'].ready,false);await assert.rejects(s.binary.beginEpochClose.staticCall());
  await tx(s.binary.connect(signers[38]).processVolume(50));assert.equal(settlementReadiness(await state()).volume.ready,false);
 });
 test('auto API reflects next wall-clock boundary and permits changes during overdue settlement',async()=>{
  const cfg=await read('/api/config');assert.equal(cfg.autoBuyPolicy,'immediate-current-quote-v1');
  const abi=await read('/abi/BinaryPlan');assert.deepEqual(abi.find(x=>x.name==='setAutoBuy').inputs.map(x=>x.type),['bool']);
  let d=await state(s.addresses[0]);assert.equal(d.autoBuyPolicy,cfg.autoBuyPolicy);assert.equal(d.wallet.autoEnabled,false);assert.equal(d.wallet.autoStoredEnabled,false);assert.equal(d.wallet.maxAutoPrice,'0');assert.deepEqual(d.wallet.nextAutoSetting,{enabled:false,effectiveAt:'0'});
  await tx(s.binary.addUnits(5));await tx(s.binary.setAutoBuy(true));d=await state(s.addresses[0]);assert.equal(d.wallet.autoEnabled,false);assert.deepEqual(d.wallet.nextAutoSetting,{enabled:true,effectiveAt:d.epochEnd});
  // Repeated enable before activation does not postpone the next boundary.
  await tx(s.binary.setAutoBuy(true));assert.deepEqual((await state(s.addresses[0])).wallet.nextAutoSetting,d.wallet.nextAutoSetting);
  await p.send('evm_increaseTime',[Number(d.epochEnd)-Number(d.timestamp)]);await p.send('evm_mine',[]);
  d=await state(s.addresses[0]);assert.equal(d.wallet.autoEnabled,true);assert.equal(d.wallet.autoStoredEnabled,false);assert.equal(d.wallet.maxAutoPrice,'0');
  await tx(s.binary.setAutoBuy(true));d=await state(s.addresses[0]);assert.equal(d.wallet.autoEnabled,true);assert.equal(d.wallet.autoStoredEnabled,true);assert.deepEqual(d.wallet.nextAutoSetting,{enabled:false,effectiveAt:'0'},'re-enabling an active request does not postpone it');
  await tx(s.binary.beginEpochClose());d=await state(s.addresses[0]);assert.equal(d.phase,'1');
  assert.equal(actionAvailability({data:d,wallet:d.wallet,connected:true,fresh:true}).member,true,'UI must permit immediate opt-out during matching');
  await tx(s.binary.setAutoBuy(false));d=await state(s.addresses[0]);assert.equal(d.wallet.autoEnabled,false);assert.equal(d.wallet.autoStoredEnabled,false);assert.deepEqual(d.wallet.nextAutoSetting,{enabled:false,effectiveAt:'0'});
  await tx(s.binary.setAutoBuy(true));d=await state(s.addresses[0]);assert.equal(d.phase,'1');assert.equal(d.wallet.autoEnabled,false);assert.equal(d.wallet.nextAutoSetting.enabled,true);assert.equal(Number(d.wallet.nextAutoSetting.effectiveAt),(Math.floor(d.timestamp/3600)+1)*3600);assert(Number(d.wallet.nextAutoSetting.effectiveAt)>Number(d.epochEnd),'overdue hour cannot supply the next activation time');
 });
 test('hourly boundary blocks funding and exposes real settlement phases to any public caller',async()=>{
  await tx(s.binary.addUnits(5));const d=await state();await p.send('evm_increaseTime',[Number(d.epochEnd)-Number(d.timestamp)+1]);await p.send('evm_mine',[]);
  let current=await state();assert.equal(settlementReadiness(current)['close-epoch'].ready,true);assert.equal(actionAvailability({data:current,wallet:current.wallet,connected:true,fresh:true}).funder,false);await assert.rejects(s.binary.addUnits.staticCall(1));
  await tx(s.binary.connect(signers[38]).beginEpochClose());current=await state();assert.equal(current.phase,'1');assert.equal(settlementReadiness(current)['process-epoch'].ready,true);await tx(s.binary.connect(signers[38]).processEpoch(100));
 });
 test('current token has immediately available purchased tokens and exact terminal fee accounting',async()=>{
  await tx(s.binary.addUnits(1));await tx(s.token.buy(E('100'),1,MaxUint256));let d=await state(s.addresses[0]);assert.equal(d.wallet.unlocked,d.wallet.ftiBalance);assert.equal(d.wallet.lockCount,'0');
  const amount=BigInt(d.wallet.ftiBalance),[fee,payout,gross]=await s.token.sellFeeQuote(amount);assert(fee>0n);assert.equal(payout+fee,gross);
  await tx(s.token.sell(amount,payout,MaxUint256,{gasLimit:1000000}));d=await state(s.addresses[0]);assert.equal(d.lifecycleClosed,true);assert.equal(d.supply,'0');assert.equal(d.reserve,'0');assert.equal(d.developmentFeeClaim,fee.toString());assert(BigInt(d.unallocatedReserve)>0n);
  assert.equal(d.restartSupported,true);assert.equal(d.buysPermanentlyClosed,false);assert.equal(d.referenceReserve,await s.token.referenceReserve().then(String));assert.equal(d.referenceSupply,await s.token.referenceSupply().then(String));assert.equal(d.blockHash,(await p.getBlock(d.block)).hash);
  const a=actionAvailability({data:d,wallet:d.wallet,connected:true,fresh:true,lifecycle:{fundingBlocked:false,buyingBlocked:false}});assert(a.buyer);assert(a.funder);assert(!a.transfer,'zero token balance remains non-transferable');
  const support=d.unallocatedReserve,claim=d.developmentFeeClaim;await tx(s.token.buy(E('1'),1,MaxUint256));d=await state(s.addresses[0]);assert.equal(d.lifecycleClosed,false);assert.equal(d.buysPermanentlyClosed,false);assert.equal(d.reserve,E('1').toString());assert.equal(d.unallocatedReserve,support);assert.equal(d.developmentFeeClaim,claim);
 });
 test('confirmed real buy and terminal sale snapshots separate exact growth from reference prices',async()=>{
  await tx(s.binary.addUnits(1));
  const bootstrap=await tx(s.token.buy(E('100'),1,MaxUint256));
  assert.equal((await confirmedTransactionDelta(p,s.token,bootstrap)).delta,null,'bootstrap has no live pre-ratio');
  const buy=await tx(s.token.buy(E('1'),1,MaxUint256));
  const growth=await confirmedTransactionDelta(p,s.token,buy);assert(growth.delta.numerator>0n);assert(formatRatio(growth.delta,{sign:true}).startsWith('+'));
  const snapshot=await readRatioSnapshot(p,s.token);assert.equal(snapshot.reserve,await s.token.reserve());
  const balance=await s.token.balanceOf(s.addresses[0]);const sale=await tx(s.token.sell(balance,1,MaxUint256,{gasLimit:1000000}));
  assert.equal((await confirmedTransactionDelta(p,s.token,sale)).delta,null,'terminal zero-supply state has no live post-ratio');
 });
 test('proposal gates match actual council ownership, existing approval and five-of-seven execution',async()=>{
  const data=s.binary.interface.encodeFunctionData('pause');await assert.rejects(s.council.connect(signers[38]).propose.staticCall(s.binary.target,data));
  await tx(s.council.connect(signers[31]).propose(s.binary.target,data));let proposal=await s.council.proposal(0);assert.equal(await s.council.approved(0,s.addresses[31]),true);
  assert.equal(proposalAvailability({executed:proposal[3],approvals:proposal[2],approved:true,owner:true,connected:true}).approve,false);await assert.rejects(s.council.connect(signers[38]).execute.staticCall(0));
  for(let i=32;i<36;i++)await tx(s.council.connect(signers[i]).approve(0));proposal=await s.council.proposal(0);assert.equal(proposalAvailability({executed:proposal[3],approvals:proposal[2],owner:false,connected:true}).execute,true);
  await tx(s.council.connect(signers[38]).execute(0));assert.equal((await state()).paused,true);
 });
 test('timelock readiness remains false until the fixed 72-hour delay expires, then public execution works',async()=>{
  const inner=s.token.interface.encodeFunctionData('advancePriceMilestone'),salt=id('workspace-timelock'),schedule=s.timelock.interface.encodeFunctionData('schedule',[s.token.target,0,inner,ZeroHash,salt,259200]);
  await tx(s.council.connect(signers[31]).propose(s.timelock.target,schedule));for(let i=32;i<36;i++)await tx(s.council.connect(signers[i]).approve(0));await tx(s.council.connect(signers[38]).execute(0));
  const operation=await s.timelock.hashOperation(s.token.target,0,inner,ZeroHash,salt),timestamp=await s.timelock.getTimestamp(operation);
  assert.equal(timelockPresentation({scheduled:timestamp>0n,done:await s.timelock.isOperationDone(operation),ready:await s.timelock.isOperationReady(operation),timestamp}).ready,false);
  await assert.rejects(s.timelock.execute.staticCall(s.token.target,0,inner,ZeroHash,salt));await p.send('evm_increaseTime',[259201]);await p.send('evm_mine',[]);
  assert.equal(await s.timelock.isOperationReady(operation),true);await tx(s.timelock.connect(signers[38]).execute(s.token.target,0,inner,ZeroHash,salt));assert.equal(await s.timelock.isOperationDone(operation),true);
 });
 test('API rejects reorg snapshots, verifies deployed getters and preserves RPC failures',async()=>{
  let rejectSnapshot=false,missingViews=false,rpcFailure=false,secondary;
  const absentSelectors=[s.token.interface.getFunction('buysPermanentlyClosed').selector,s.binary.interface.getFunction('effectiveAutoEnabled').selector];
  const proxy=http.createServer(async(req,res)=>{
   try{
    let raw='';for await(const chunk of req)raw+=chunk;
    const query=JSON.parse(raw),upstream=await fetch(`http://127.0.0.1:${chain.address().port}`,{method:'POST',headers:{'Content-Type':'application/json'},body:raw});
    const answer=await upstream.json();
    if(query.method==='eth_call'&&absentSelectors.some(selector=>query.params[0].data.startsWith(selector))){if(missingViews)answer.result='0x';if(rpcFailure){delete answer.result;answer.error={code:-32000,message:'fixture RPC unavailable'};}}
    if(rejectSnapshot&&query.method==='eth_getBlockByNumber'&&query.params[0]!=='latest'&&answer.result)answer.result.hash='0x'+'ab'.repeat(32);
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(answer));
   }catch(error){res.writeHead(500);res.end(String(error));}
  });
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
  const previous=process.env.RPC_URL;
  try{
   process.env.RPC_URL=`http://127.0.0.1:${proxy.address().port}`;secondary=await startWeb(path.join(dir,'workspace.json'));
   const route=`http://127.0.0.1:${secondary.address().port}/api/state?wallet=${s.addresses[0]}`;
   let response=await fetch(route);assert.equal(response.status,200);const current=await response.json();assert.equal(current.blockHash,(await p.getBlock(current.block)).hash);
   rejectSnapshot=true;response=await fetch(route);assert.equal(response.status,400);assert.match((await response.json()).error,/Chain changed while reading state/);
   rejectSnapshot=false;missingViews=true;response=await fetch(route);assert.equal(response.status,200);let legacy=await response.json();assert.equal(legacy.restartSupported,false);assert.equal(legacy.autoBuyPolicy,'historical-price-cap');assert.equal(legacy.buysPermanentlyClosed,undefined);assert.equal(legacy.wallet.nextAutoSetting,null);
   const configRoute=`http://127.0.0.1:${secondary.address().port}/api/config`;response=await fetch(configRoute);assert.equal(response.status,200);legacy=await response.json();assert.equal(legacy.restartSupported,false);assert.equal(legacy.autoBuyPolicy,'historical-price-cap');
   missingViews=false;rpcFailure=true;for(const url of [route,configRoute]){response=await fetch(url);assert.equal(response.status,400,'RPC failure must not become a historical capability flag');assert((await response.json()).error);} 
  }finally{
   if(previous===undefined)delete process.env.RPC_URL;else process.env.RPC_URL=previous;
   if(secondary)await new Promise(r=>secondary.close(r));await new Promise(r=>proxy.close(r));
  }
 });
});
