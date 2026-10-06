import {describe,test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {JsonRpcProvider,MaxUint256,ZeroHash,id,parseEther as E} from 'ethers';
import {artifact,deploySuite,settle} from '../scripts/lib.mjs';
import {startWeb} from '../scripts/server.mjs';

// Local fixtures only: all RPC/API connections bind to loopback, with no live
// deployment, credentials, account impersonation or production state setters.
const DELAY=72*60*60;
const tx=async promise=>(await promise).wait();

describe('current retirement API with fresh fixture ABI/config',()=>{
 let chain,p,web,base,s,signers,dir,saved,snapshot,salt=0;
 async function read(route){const r=await fetch(base+route);assert.equal(r.status,200,await r.clone().text());return r.json();}
 const state=(wallet=s.addresses[0])=>read('/api/state?wallet='+wallet);
 async function councilCall(target,data){
  const proposal=await s.council.count();
  await tx(s.council.connect(signers[31]).propose(target,data));
  for(let i=32;i<36;i++)await tx(s.council.connect(signers[i]).approve(proposal));
  await tx(s.council.connect(signers[41]).execute(proposal));
 }
 async function schedule(target,data){
  const op={target,data,salt:id('retirement-api-'+(++salt))};
  await councilCall(s.timelock.target,s.timelock.interface.encodeFunctionData('schedule',[target,0,data,ZeroHash,op.salt,DELAY]));
  return op;
 }
 async function execute(op){await tx(s.timelock.execute(op.target,0,op.data,ZeroHash,op.salt,{gasLimit:3000000}));}
 async function advance(){await p.send('evm_increaseTime',[DELAY+1]);await p.send('evm_mine',[]);}
 async function fund(){await tx(s.binary.addUnits(1));await tx(s.token.buy(E('100'),0,MaxUint256));}
 before(async()=>{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-retirement-api-'));
  saved=Object.fromEntries(['HOST','PORT','RPC_URL','EVENT_RPC_URL'].map(k=>[k,process.env[k]]));
  chain=ganache.server({logging:{quiet:true},wallet:{totalAccounts:42},chain:{chainId:31337,time:new Date('2026-01-02T00:00:00Z')},miner:{blockGasLimit:30000000}});
  await chain.listen(0,'127.0.0.1');const rpcUrl=`http://127.0.0.1:${chain.address().port}`;
  p=new JsonRpcProvider(rpcUrl,undefined,{cacheTimeout:-1});p.pollingInterval=10;
  signers=await Promise.all(Array.from({length:42},(_,i)=>p.getSigner(i)));
  s=await deploySuite(signers,{tokenContract:'FTIRetirementReviewToken',binaryContract:'BinaryPlan'});
  for(const i of [0,41]){await tx(s.usd.connect(signers[i]).faucet());await tx(s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256));await tx(s.usd.connect(signers[i]).approve(s.token.target,MaxUint256));}
  const config=path.join(dir,'local-retirement.json');
  fs.writeFileSync(config,JSON.stringify({mode:'local',chainId:31337,rpcUrl,tokenContract:'FTIRetirementReviewToken',binaryContract:'BinaryPlan',lockVersion:3,developmentFund:s.addresses[35],binary:s.binary.target,token:s.token.target,usd:s.usd.target,council:s.council.target,timelock:s.timelock.target}));
  process.env.HOST='127.0.0.1';process.env.PORT='0';delete process.env.RPC_URL;delete process.env.EVENT_RPC_URL;
  web=await startWeb(config);base=`http://127.0.0.1:${web.address().port}`;
  snapshot=await p.send('evm_snapshot',[]);
 });
 beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
 after(async()=>{
  if(web)await new Promise(r=>web.close(r));if(p)p.destroy();if(chain)await chain.close();
  for(const[k,v]of Object.entries(saved||{})){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  if(dir)fs.rmSync(dir,{recursive:true,force:true});
 });

 test('current model serves the exact new ABI and fresh initial state while retaining legacy ABI routes',async()=>{
  const cfg=await read('/api/config');assert.equal(cfg.tokenContract,'FTIRetirementReviewToken');assert.equal(cfg.binaryContract,'BinaryPlan');assert.equal(cfg.developmentFund,s.addresses[35]);assert(!Object.hasOwn(cfg,'rpcUrl'));
  const abi=await read('/abi/FTIRetirementReviewToken');assert.deepEqual(abi,artifact('FTIRetirementReviewToken').abi);
  assert.deepEqual(abi.find(x=>x.type==='constructor').inputs.map(x=>x.name),['stable','gov','emergency','development']);
  for(const name of ['developmentFeeClaim','developmentFund','permanentlyRetired','claimDevelopmentFees','retirePermanently','sellFeeQuote'])assert(abi.some(x=>x.type==='function'&&x.name===name));
  for(const name of ['FTIToken','FTIReserveToken','BinaryPlan','FundedBinaryPlan'])assert.deepEqual(await read('/abi/'+name),artifact(name).abi);
  assert.equal((await fetch(base+'/abi/UnknownToken')).status,400);
  const d=await state();assert.equal(d.pricingModel,'real-reserve-retirement-review');assert.equal(d.rewardModel,'global-pool-paid-points-v2');
  assert.equal(d.supply,'0');assert.equal(d.reserve,'0');assert.equal(d.price,E('0.1').toString());assert.equal(d.referencePrice,d.price);
  assert.equal(d.restartSupported,true);assert.equal(d.buysPermanentlyClosed,false);assert.equal(d.referenceReserve,await s.token.referenceReserve().then(String));assert.equal(d.referenceSupply,await s.token.referenceSupply().then(String));assert.equal(d.blockHash,(await p.getBlock(d.block)).hash);assert.equal(d.lifecycleClosed,false);assert.equal(d.permanentlyRetired,false);assert.equal(d.developmentFeeClaim,'0');assert.equal(d.developmentFund,await s.binary.development());
  assert.equal(d.sellPressureWad,'0');assert.equal(d.maxSingleSellBps,'0');assert.equal(d.maxHourlySellBps,'0');assert.equal(d.wallet.lockCount,'0');
 });

 test('ordinary terminal payout, fixed fee claim, permanent retirement and separate binary cash claims stay truthful through the API',async()=>{
  await fund();const half=(await s.token.totalSupply())/2n;await tx(s.token.sell(half,0,MaxUint256,{gasLimit:1000000}));
  let d=await state();assert.equal(d.reserve,E('51.5').toString());assert.equal(d.unallocatedReserve,E('5').toString());assert.equal(d.developmentFeeClaim,'0');
  const supply=await s.token.totalSupply(),historical=await s.token.price(),beforeSeller=await s.usd.balanceOf(s.addresses[0]),beforeFund=await s.usd.balanceOf(s.addresses[35]);
  const [fee,payout,gross]=await s.token.sellFeeQuote(supply);assert.equal(fee,E('1.545'));assert.equal(payout+fee,gross);
  await tx(s.token.sell(supply,payout,MaxUint256,{gasLimit:1000000}));
  assert.equal(await s.usd.balanceOf(s.addresses[0])-beforeSeller,payout);assert.equal(await s.usd.balanceOf(s.addresses[35]),beforeFund);
  d=await state();assert.equal(d.supply,'0');assert.equal(d.reserve,'0');assert.equal(d.lifecycleClosed,true);assert.equal(d.permanentlyRetired,false);
  assert.equal(d.price,historical.toString());assert.equal(d.referencePrice,historical.toString());assert.equal(d.developmentFeeClaim,fee.toString());assert.equal(d.unallocatedReserve,E('5').toString());
  assert.deepEqual(d.account2,[(E('5')+fee).toString(),(E('5')+fee).toString()]);
  await tx(s.token.connect(signers[41]).claimDevelopmentFees());
  assert.equal(await s.usd.balanceOf(s.addresses[35])-beforeFund,fee);
  d=await state();assert.equal(d.developmentFeeClaim,'0');assert.equal(d.unallocatedReserve,E('5').toString());assert.deepEqual(d.account2,[E('5').toString(),E('5').toString()]);
  await settle(s,p);await councilCall(s.binary.target,s.binary.interface.encodeFunctionData('pause'));
  const binaryBefore=await s.usd.balanceOf(s.binary.target),pendingBefore=await s.binary.totalPending(),devClaim=await s.binary.pendingReward(s.addresses[35]);
  assert(devClaim>0n);
  await councilCall(s.token.target,s.token.interface.encodeFunctionData('approveRetirementAction',[s.token.interface.getFunction('closeBuysPermanently').selector,await s.token.lifecycleNonce()]));
  const closure=await schedule(s.token.target,s.token.interface.encodeFunctionData('closeBuysPermanently'));await advance();await execute(closure);
  d=await state();assert.equal(d.buysPermanentlyClosed,true);assert.equal(d.permanentlyRetired,false);assert.equal(d.lifecycleClosed,true);
  await councilCall(s.token.target,s.token.interface.encodeFunctionData('approveRetirementAction',[s.token.interface.getFunction('retirePermanently').selector,await s.token.lifecycleNonce()]));
  const op=await schedule(s.token.target,s.token.interface.encodeFunctionData('retirePermanently'));
  await advance();await execute(op);
  d=await state(s.addresses[35]);assert.equal(d.permanentlyRetired,true);assert.equal(d.lifecycleClosed,true);assert.equal(d.tokenPaused,true);assert.equal(d.paused,true);
  assert.equal(d.supply,'0');assert.equal(d.reserve,'0');assert.equal(d.unallocatedReserve,'0');assert.equal(d.developmentFeeClaim,'0');assert.deepEqual(d.account2,['0','0']);assert.equal(d.price,historical.toString());
  assert.equal(d.wallet.claimable,devClaim.toString());assert.equal(d.pending,pendingBefore.toString());assert.equal(await s.usd.balanceOf(s.binary.target),binaryBefore);
  assert.equal(await s.usd.balanceOf(s.addresses[35])-beforeFund,fee+E('5'));
  await tx(s.binary.connect(signers[35]).claim());
  d=await state(s.addresses[35]);assert.equal(d.wallet.claimable,'0');assert.equal(d.permanentlyRetired,true);assert.equal(d.account1[0],d.account1[1]);
  // Existing binary governance can unpause it, but retired-token funding must
  // revert atomically. A UI must not invite either registration or addUnits.
  const unpause=await schedule(s.binary.target,s.binary.interface.encodeFunctionData('unpause'));await advance();await execute(unpause);await settle(s,p);
  const before=await state(s.addresses[41]),sponsor=Array.from(await s.binary.members(s.addresses[15])),binaryAccounting=Array.from(await s.binary.accounting());
  await assert.rejects(s.binary.connect(signers[41]).register.staticCall(s.addresses[15],1),{reason:'permanently retired'});
  await assert.rejects(s.binary.addUnits.staticCall(1),{reason:'permanently retired'});
  await assert.rejects(async()=>tx(s.binary.connect(signers[41]).register(s.addresses[15],1,{gasLimit:3000000})));
  await assert.rejects(async()=>tx(s.binary.addUnits(1,{gasLimit:3000000})));
  const after=await state(s.addresses[41]);
  for(const key of ['count','supply','reserve','developmentFeeClaim','permanentlyRetired','pending','auto','account1','account2','wallet'])assert.deepEqual(after[key],before[key],key+' must roll back');
  assert.deepEqual(Array.from(await s.binary.members(s.addresses[15])),sponsor);assert.deepEqual(Array.from(await s.binary.accounting()),binaryAccounting);
  const events=await read('/api/events');for(const name of ['TerminalDevelopmentFeeCredited','DevelopmentFeeClaimPaid','PermanentlyRetired'])assert(events.some(e=>e.name===name),name+' is exposed through the current ABI');
 });

 test('current emergency terminal redemption is fee-free and creates no development fee claim',async()=>{
  await fund();await councilCall(s.token.target,s.token.interface.encodeFunctionData('activateEmergencyExit'));
  const supply=await s.token.totalSupply(),reserve=await s.token.reserve(),before=await s.usd.balanceOf(s.addresses[0]);
  assert.deepEqual(Array.from(await s.token.sellFeeQuote(supply)),[0n,reserve,reserve]);
  await tx(s.token.sell(supply,reserve,MaxUint256,{gasLimit:1000000}));
  const d=await state();assert.equal(await s.usd.balanceOf(s.addresses[0])-before,reserve);assert.equal(d.emergencyExit,true);assert.equal(d.lifecycleClosed,true);assert.equal(d.permanentlyRetired,false);assert.equal(d.developmentFeeClaim,'0');assert.equal(d.unallocatedReserve,E('5').toString());assert.deepEqual(d.account2,[E('5').toString(),E('5').toString()]);
 });
});
