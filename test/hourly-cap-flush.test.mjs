import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,Contract,parseEther as E,MaxUint256} from 'ethers';
import {deployOne,artifact,settle,drainVolume,checkAccounting} from '../scripts/lib.mjs';

const send=async tx=>{const receipt=await(await tx).wait();assert.equal(receipt.status,1);return receipt;};
const min=(a,b)=>a<b?a:b;
// Independent allocation oracle: split each matched budget into payable and
// forfeited portions, then debit the legs. All amounts are atomic integers.
function expected(L,R,AL,AR,cap){
 const raw=min(L,R),candidate=min(raw,cap),flushed=raw-candidate;
 const left=raw?AL*raw/L:0n,right=raw?AR*raw/R:0n,total=left+right;
 const budget=raw?total*candidate/raw:0n,paid=min(candidate,budget/E('20'));
 const reward=paid?budget:0n,keepBudgetL=total?budget*left/total:0n;
 const debitL=paid?keepBudgetL:0n,debitR=reward-debitL;
 const forfeitL=flushed?left-keepBudgetL:0n,forfeitR=flushed?right-(budget-keepBudgetL):0n;
 return {raw,candidate,flushed,paid,reward,forfeited:forfeitL+forfeitR,
  L:L-paid-flushed,R:R-paid-flushed,AL:AL-debitL-forfeitL,AR:AR-debitR-forfeitR};
}

test('hourly cap flush uses funded accounting, preserves only unmatched/underfunded carry and cannot replay',{timeout:600000},async t=>{
 const engine=ganache.provider({chain:{chainId:31337,time:new Date('2026-01-05T00:01:00Z')},logging:{quiet:true},wallet:{totalAccounts:90},miner:{blockGasLimit:30000000}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 try{
  const w=await Promise.all(Array.from({length:90},(_,i)=>p.getSigner(i))),a=await Promise.all(w.map(s=>s.getAddress()));
  const usd=await deployOne('MockUSD',[],w[0]),council=await deployOne('SevenGuardianCouncil',[a.slice(31,38)],w[0]);
  const tl=await deployOne('FTITimelock',[council.target],w[0]);
  const ti=await deployOne('FTIReserveTokenUpgradeable',[],w[0]),bi=await deployOne('FundedBinaryPlanUpgradeable',[],w[0]);
  const tp=await deployOne('FTIProxy',[ti.target,ti.interface.encodeFunctionData('initialize',[usd.target,tl.target,council.target])],w[0]);
  const bp=await deployOne('FTIProxy',[bi.target,bi.interface.encodeFunctionData('initialize',[usd.target,tp.target,tl.target,council.target,a[89],a.slice(0,31)])],w[0]);
  const token=new Contract(tp.target,artifact('FTIReserveTokenUpgradeable').abi,w[0]);
  const binary=new Contract(bp.target,artifact('FundedBinaryPlanUpgradeable').abi,w[0]),suite={usd,token,binary};
  await send(token.bind(binary.target));assert.equal(await binary.hourlyCapFlushVersion(),1n);
  for(const i of [0,1,2,3,4,15]){
   await send(usd.connect(w[i]).faucet());await send(usd.connect(w[i]).approve(binary.target,MaxUint256));
  }
  await send(binary.addUnits(20));
  const books=async()=>{const x=await binary.fundingAccounting();assert.equal(x[0],x[1]);assert.equal(x[2],x[3]);await checkAccounting(suite);};
  const add=async(i,n)=>{if(n)await send(binary.connect(w[i]).addUnits(n));};
  const isolated=async fn=>{const snapshot=await p.send('evm_snapshot',[]);try{await fn();}finally{await p.send('evm_revert',[snapshot]);}};
  const close=async(who=a[0],batch=100)=>{
   await drainVolume(suite,batch);
   const m=await binary.members(who),beforeReward=await binary.pendingReward(who),beforeAuto=await binary.pendingAuto(who);
   const beforeRetained=await binary.retainedPointReserve(),AL=await binary.creditL(who),AR=await binary.creditR(who);
   const cap=await binary.cap(m.rank,await binary.protectionLevel());
   const ex=expected(m.carryL,m.carryR,AL,AR,cap),epoch=await binary.epoch();
   await settle(suite,p,batch);
   const after=await binary.members(who);
   assert.equal(after.carryL,ex.L);assert.equal(after.carryR,ex.R);
   assert.equal(await binary.creditL(who),ex.AL);assert.equal(await binary.creditR(who),ex.AR);
   assert.equal(await binary.paidPoints(epoch,who),ex.paid);
   assert.equal((await binary.pendingReward(who))-beforeReward+(await binary.pendingAuto(who))-beforeAuto,ex.reward);
   const logs=await binary.queryFilter(binary.filters.HourlyCapFlushed(epoch,who));
   assert.equal(logs.length,ex.flushed?1:0);
   if(ex.flushed){assert.equal(logs[0].args.points,ex.flushed);assert.equal(logs[0].args.retainedCredit,ex.forfeited);}
   assert((await binary.retainedPointReserve())>=beforeRetained+ex.forfeited);
   assert.equal(after.lifetimeL,m.lifetimeL);assert.equal(after.lifetimeR,m.lifetimeR);
   await books();return ex;
  };
  for(const [L,R] of [[15,20],[20,15],[20,20],[3,5],[5,5],[0,20],[20,0]]){
   await t.test(`real membership: left ${L}, right ${R}, Member cap 5`,()=>isolated(async()=>{
    await add(1,L);await add(2,R);const ex=await close(a[0],1);
    if(L===15&&R===20){assert.equal(ex.paid,5n);assert.equal(ex.flushed,10n);assert.equal(ex.L,0n);assert.equal(ex.R,5n);assert.equal(ex.reward,E('900'));assert.equal(ex.forfeited,E('1800'));assert.equal(ex.AR,E('450'));}
   }));
  }
  await t.test('forfeited credits cannot pay again; later opposite volume matches the saved stronger leg',()=>isolated(async()=>{
   await add(1,15);await add(2,20);await close();const retained=await binary.retainedPointReserve(),pending=await binary.pendingReward(a[0]);
   for(let i=0;i<3;i++){await close();assert.equal(await binary.pendingReward(a[0]),pending);assert.equal(await binary.retainedPointReserve(),retained);}
   await add(1,5);const ex=await close();assert.equal(ex.reward,E('900'));assert.equal(ex.flushed,0n);assert.equal(ex.L+ex.R,0n);
   const before=await usd.balanceOf(a[0]),due=await binary.pendingReward(a[0]);await send(binary.payRewards(100));
   assert.equal(await usd.balanceOf(a[0]),before+due);await send(binary.payRewards(100));assert.equal(await usd.balanceOf(a[0]),before+due);
   await assert.rejects(()=>binary.claim.staticCall());await assert.rejects(()=>binary.connect(w[54]).claim.staticCall());await books();
  }));
  for(const [rank,threshold,cap] of [[1,100,10],[2,200,15],[3,500,20],[4,1000,25]]){
   await t.test(`Builder ${rank}: rank advances after settlement and its hourly cap flushes excess`,()=>isolated(async()=>{
    await add(1,threshold);await add(2,threshold);const prior=await close();assert.equal(prior.paid,5n);
    assert.equal(await binary.rankOf(a[0]),BigInt(rank));assert.equal((await binary.members(a[0])).carryL,0n);
    await add(1,cap+10);await add(2,cap+15);const ex=await close();assert.equal(ex.paid,BigInt(cap));assert.equal(ex.flushed,10n);assert.equal(ex.L,0n);assert.equal(ex.R,5n);
   }));
  }
  await t.test('100% auto-buy reserves only paid rewards, never forfeited funding',()=>isolated(async()=>{
   await add(1,100);await add(2,100);await close();await send(binary.setAutoBuyPercent(true,100));
   const cash=await binary.pendingReward(a[0]),beforeAuto=await binary.pendingAuto(a[0]);await add(1,15);await add(2,20);
   const ex=await close();assert.equal(ex.paid,10n);assert.equal(ex.flushed,5n);assert.equal(await binary.pendingReward(a[0]),cash);
   const automatic=(await binary.pendingAuto(a[0]))-beforeAuto;assert.equal(automatic,ex.reward);
   await send(binary.executeAuto(a[0],automatic));assert.equal(await binary.pendingAuto(a[0]),0n);
   await assert.rejects(()=>binary.executeAuto.staticCall(a[0],automatic));await books();
  }));
  const deep=async(d,L,R)=>{
   let parent=15;
   for(let i=39;i<=39+d-4;i++){await send(usd.connect(w[i]).faucet());await send(usd.connect(w[i]).approve(binary.target,MaxUint256));}
   for(let i=39;i<39+d-5;i++){await send(binary.connect(w[i]).register(a[parent],1));parent=i;}
   const left=39+d-5,right=left+1;
   await send(binary.connect(w[left]).register(a[parent],L));await send(binary.connect(w[right]).register(a[parent],R));
   return a[parent];
  };
  for(const [d,L,R] of [[10,5,5],[10,15,20],[13,15,20]]){
   await t.test(`depth ${d} funded floor and atomic rounding with ${L}/${R} volume`,()=>isolated(async()=>{
    const who=await deep(d,L,R),ex=await close(who,1);
    if(d===10&&L===5){assert.equal(ex.paid,4n);assert.equal(ex.flushed,0n);assert.equal(ex.L,1n);assert.equal(ex.R,1n);}
    if(d===10&&L===15){assert.equal(ex.paid,4n);assert.equal(ex.flushed,10n);assert.equal(ex.L,1n);assert.equal(ex.R,6n);}
    assert(ex.reward>=ex.paid*E('20'));const before=await binary.pendingReward(who);await close(who,1);assert.equal(await binary.pendingReward(who),before);
   }));
  }
  await t.test('zero-funded cap overflow preserves the within-cap amount; no new reward is invented',()=>isolated(async()=>{
   const who=await deep(46,15,20); // 900/46 < 20: not even one point can be funded.
   const ex=await close(who,100);assert.equal(ex.paid,0n);assert.equal(ex.flushed,10n);
   assert.equal(ex.L,5n);assert.equal(ex.R,10n);assert(ex.AL+ex.AR>0n);
   await close(who,100);assert.equal(await binary.pendingReward(who),0n);await books();
  }));
  console.log('FTI_CAP_FLUSH_LOCAL_PASS',JSON.stringify({scope:'LOCAL_EVM_NOT_LIVE_NETWORK',example:{right:20,left:15,paidPoints:5,flushedPoints:10,rightCarry:5,leftCarry:0},protectedRetainedFunding:true,noReplay:true,storageFieldsAdded:0}));
 }finally{await engine.disconnect();}
});
