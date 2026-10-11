import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,parseEther as E,MaxUint256,ZeroHash,id} from 'ethers';
import {artifact,deployOne,settle,drainVolume,checkAccounting} from '../scripts/lib.mjs';
import {assertStorageCompatible} from '../scripts/check-upgrade-layout.mjs';
import {keeperStep} from '../scripts/keeper.mjs';

const send=async tx=>{const r=await(await tx).wait();assert.equal(r.status,1);return r;};
const unix=s=>Date.parse(s)/1000;

test('Builder controls use hourly funded income, retain liabilities and close at Gregorian UTC boundaries',{timeout:240000},async t=>{
 const engine=ganache.provider({chain:{chainId:31337,time:new Date('2026-01-05T00:00:00Z')},logging:{quiet:true},wallet:{totalAccounts:46},miner:{blockGasLimit:30000000}});
 const provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 try {
  const signers=await Promise.all(Array.from({length:46},(_,i)=>provider.getSigner(i))),a=await Promise.all(signers.map(s=>s.getAddress()));
  const usd=await deployOne('MockUSD',[],signers[0]),council=await deployOne('SevenGuardianCouncil',[a.slice(31,38)],signers[0]);
  const tl=await deployOne('FTITimelock',[council.target],signers[0]);
  const ti=await deployOne('FTIReserveTokenUpgradeable',[],signers[0]),bi=await deployOne('FundedBinaryPlanUpgradeable',[],signers[0]);
  const tp=await deployOne('FTIProxy',[ti.target,ti.interface.encodeFunctionData('initialize',[usd.target,tl.target,council.target])],signers[0]);
  const bp=await deployOne('FTIProxy',[bi.target,bi.interface.encodeFunctionData('initialize',[usd.target,tp.target,tl.target,council.target,a[45],a.slice(0,31)])],signers[0]);
  const token=new Contract(tp.target,artifact('FTIReserveTokenUpgradeable').abi,signers[0]);
  const binary=new Contract(bp.target,artifact('FundedBinaryPlanUpgradeable').abi,signers[0]);
  const suite={usd,token,binary};await send(token.bind(bp.target));
  for(const i of [0,1,2]){await send(usd.connect(signers[i]).faucet());await send(usd.connect(signers[i]).approve(bp.target,MaxUint256));}
  await send(binary.addUnits(100));await send(binary.connect(signers[1]).addUnits(100));await send(binary.connect(signers[2]).addUnits(100));
  await settle(suite,provider);
  assert.equal(await binary.rankOf(a[0]),1n);
  await send(usd.approve(tp.target,MaxUint256));await send(token.buy(E('10'),0,MaxUint256));
  const snapshot=async fn=>{const s=await provider.send('evm_snapshot',[]);try{await fn();}finally{await provider.send('evm_revert',[s]);}};
  const warp=async timestamp=>{await provider.send('evm_setTime',[timestamp*1000]);await provider.send('evm_mine',[]);};
  for(const percent of [5,37,100])await t.test(`${percent}% applies only to new hourly binary rewards`,()=>snapshot(async()=>{
   await send(binary.setAutoBuyPercent(true,percent));
   const priorCash=await binary.pendingReward(a[0]),priorAuto=await binary.pendingAuto(a[0]);
   const builderBook=await binary.builderAccounted(),beforeUSD=await usd.balanceOf(bp.target);
   const epoch=await binary.epoch();await settle(suite,provider);
   const events=await binary.queryFilter(binary.filters.RewardAllocated(epoch,a[0]));assert.equal(events.length,1);
   const {cash,automatic}=events[0].args,gross=cash+automatic;assert(gross>0n);
   assert.equal(automatic,gross*BigInt(percent)/100n);assert.equal(cash,gross-automatic);
   assert.equal(await binary.pendingReward(a[0]),priorCash+cash);assert.equal(await binary.pendingAuto(a[0]),priorAuto+automatic);
   assert.equal(await binary.builderAccounted(),builderBook);assert.equal(await usd.balanceOf(bp.target),beforeUSD);
   if(percent===100)assert.equal(cash,0n);
   await checkAccounting(suite);
  }));
  await t.test('invalid percentages and nonmembers are rejected; defaults stay 5%',()=>snapshot(async()=>{
   assert.equal(await binary.autoBuyPercent(a[0]),5n);
   for(const percent of [0,1,4,101,255])await assert.rejects(()=>binary.setAutoBuyPercent.staticCall(true,percent));
   await assert.rejects(()=>binary.connect(signers[40]).setAutoBuyPercent.staticCall(true,25));
   await send(binary.setAutoBuyPercent(false,5));assert.equal((await binary.members(a[0])).autoEnabled,false);
  }));
  await t.test('preference cannot change during hourly allocation and cannot rewrite already reserved rewards',()=>snapshot(async()=>{
   await send(binary.setAutoBuyPercent(true,37));await settle(suite,provider);
   const pending=await binary.pendingAuto(a[0]);assert(pending>0n);
   await send(binary.setAutoBuyPercent(true,100));assert.equal(await binary.pendingAuto(a[0]),pending);
   await drainVolume(suite);await warp(Number(await binary.epochEnd()));await send(binary.beginEpochClose());
   assert(await binary.phase()>0n);await assert.rejects(()=>binary.setAutoBuyPercent.staticCall(true,5));
   await assert.rejects(()=>binary.setAutoBuy.staticCall(false,1));
  }));
  await t.test('legacy maximum-price input does not veto a buy; one-time cash release preserves ownership',()=>snapshot(async()=>{
   await send(binary.setAutoBuy(true,1)); // 1 wei was an impossibly low legacy maximum.
   await settle(suite,provider);const pending=await binary.pendingAuto(a[0]);assert(pending>0n);
   assert(await token.price()>1n);
   await assert.rejects(()=>binary.connect(signers[40]).executeAuto.staticCall(a[0],1n));
   const before=await token.balanceOf(a[0]);await send(binary.connect(signers[40]).executeAuto(a[0],pending));
   assert(await token.balanceOf(a[0])>before);assert.equal(await binary.pendingAuto(a[0]),0n);
   await assert.rejects(()=>binary.executeAuto.staticCall(a[0],pending));
   await settle(suite,provider);const carry=await binary.pendingAuto(a[0]);assert(carry>0n);
   await send(binary.setAutoBuyPercent(false,100));await assert.rejects(()=>binary.executeAuto.staticCall(a[0],carry));
   const cash=await binary.pendingReward(a[0]);await send(binary.releaseAutoToCash());await send(binary.releaseAutoToCash());
   assert.equal(await binary.pendingReward(a[0]),cash+carry);await checkAccounting(suite);
  }));
  await t.test('early month-close requests leave all four pools unchanged until February 1 UTC',()=>snapshot(async()=>{
   await send(binary.setAutoBuyPercent(true,100));
   const key=2026*12,cutoff=unix('2026-02-01T00:00:00Z');
   assert.equal(await binary.nextBuilderMonth(),BigInt(key));
   const pools=await Promise.all([0,1,2,3].map(i=>binary.monthFunding(key,i))),book=await binary.builderAccounted(),cash=await binary.totalPending();
   for(const time of ['2026-01-10T12:00:00Z','2026-01-20T12:00:00Z','2026-01-31T23:59:59Z']){
    await warp(unix(time));const receipt=await send(binary.connect(signers[40]).beginBuilderMonth());
    const scheduled=receipt.logs.map(l=>{try{return binary.interface.parseLog(l)}catch{return null}}).find(e=>e?.name==='BuilderMonthCloseRequested');
    assert.equal(scheduled.args.effectiveAt,BigInt(cutoff));
    assert.deepEqual(await Promise.all([0,1,2,3].map(i=>binary.monthFunding(key,i))),pools);
    assert.equal(await binary.monthPhase(),0n);assert.equal(await binary.builderAccounted(),book);assert.equal(await binary.totalPending(),cash);
    await assert.rejects(()=>binary.processBuilderMonth.staticCall(25));
   }
   await warp(cutoff);await send(binary.beginBuilderMonth());assert.equal(await binary.monthPhase(),0n); // Hourly boundary not processed yet.
   await send(binary.beginEpochClose());while(await binary.phase()>0n)await send(binary.processEpoch(25));
   await send(binary.beginBuilderMonth());assert.equal(await binary.monthPhase(),1n);
   for(let i=0;i<4;i++){assert.equal(await binary.monthBalances(i),pools[i]);assert.equal(await binary.monthFunding(key,i),0n);}
   const pendingAuto=await binary.totalAuto(),beforeMonthlyCash=await binary.totalPending();while(await binary.monthPhase()>0n)await send(binary.processBuilderMonth(25));
   assert(await binary.totalPending()>beforeMonthlyCash); // Nonzero monthly award is paid as cash even with 100% hourly auto enabled.
   assert.equal(await binary.totalAuto(),pendingAuto); // Monthly Builder payouts are never auto-buy funding.
   assert.equal(await binary.nextBuilderMonth(),BigInt(key+1));await checkAccounting(suite);
  }));
  await t.test('month lengths include leap February and December rollover, never a rolling 30-day timer',()=>snapshot(async()=>{
   // Exercise the compiled Calendar library through real business calls, advancing sequentially.
   const boundaries=[['2026-02-01T00:00:00Z',2026*12],['2026-03-01T00:00:00Z',2026*12+1],['2027-01-01T00:00:00Z',2026*12+11],['2028-03-01T00:00:00Z',2028*12+1]];
   for(const [timestamp,lastMonth]of boundaries){
    await warp(unix(timestamp));await send(binary.beginEpochClose());while(await binary.phase()>0n)await send(binary.processEpoch(25));
    while(await binary.nextBuilderMonth()<=BigInt(lastMonth)){await send(binary.beginBuilderMonth());while(await binary.monthPhase()>0n)await send(binary.processBuilderMonth(25));}
    const next=await binary.nextBuilderMonth();await send(binary.beginBuilderMonth());assert.equal(await binary.nextBuilderMonth(),next);assert.equal(await binary.monthPhase(),0n);
   }
   await checkAccounting(suite);
  }));
  console.log('FTI_BUILDER_CONTROLS_LOCAL_PASS',JSON.stringify({scope:'LOCAL_EVM_NOT_PUBLIC_NETWORK',percentages:[5,37,100],legacyMaxIgnored:true,monthlyIncomeExcluded:true,earlyRequestsDeferred:true,sourceUsersUntouched:true}));
 }finally{await engine.disconnect();}
});

test('all existing storage fields retain their position and representation',()=>{
 const old=JSON.parse(fs.readFileSync('docs/storage-layout/FundedBinaryPlanUpgradeable-20261009.json'));
 const next=JSON.parse(fs.readFileSync('artifacts/storage-layout/FundedBinaryPlanUpgradeable.json'));
 assertStorageCompatible(old,next);assert.equal(next.storage.at(-1).label,'_autoBuyPercent');
});

test('Keeper gives ready monthly settlement precedence over a replenished payout queue',async()=>{
 let closed=false;const timestamp=unix('2026-02-01T00:00:00Z');
 const b={interface:{hasFunction:()=>true},recoveryFrozen:async()=>false,phase:async()=>0n,monthPhase:async()=>0n,nextBuilderMonth:async()=>BigInt(2026*12),lastClosedAt:async()=>BigInt(timestamp),
  beginBuilderMonth:async()=>({wait:async()=>{closed=true}}),rewardAccountCount:async()=>100n,payRewards:async()=>{throw Error('Monthly work starved');}};
 assert.equal(await keeperStep(b,{getBlock:async()=>({timestamp})}),'builder close');assert(closed);
});
