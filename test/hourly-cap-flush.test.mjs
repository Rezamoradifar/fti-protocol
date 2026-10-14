import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,parseEther as E,MaxUint256,AbiCoder,keccak256,toBeHex} from 'ethers';
import {artifact,deployOne,settle,drainVolume,checkAccounting} from '../scripts/lib.mjs';
const send=async tx=>{const r=await(await tx).wait();assert.equal(r.status,1);return r;};
const min=(a,b)=>a<b?a:b;
const caps=[[5,10,15,20,25],[5,10,12,16,20],[5,10,10,12,15],[5,10,10,10,10]];

test('pooled hourly settlement and reusable monthly pools conserve funded liabilities',{timeout:1200000},async t=>{
 const engine=ganache.provider({chain:{chainId:31337,time:new Date('2026-01-05T00:01:00Z')},logging:{quiet:true},wallet:{totalAccounts:80},miner:{blockGasLimit:30000000}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 try{
  const w=await Promise.all(Array.from({length:80},(_,i)=>p.getSigner(i))),a=await Promise.all(w.map(s=>s.getAddress()));
  const usd=await deployOne('MockUSD',[],w[0]),council=await deployOne('SevenGuardianCouncil',[a.slice(31,38)],w[0]),tl=await deployOne('FTITimelock',[council.target],w[0]);
  const ti=await deployOne('FTIReserveTokenUpgradeable',[],w[0]),bi=await deployOne('FundedBinaryPlanUpgradeable',[],w[0]);
  const tp=await deployOne('FTIProxy',[ti.target,ti.interface.encodeFunctionData('initialize',[usd.target,tl.target,council.target])],w[0]);
  const bp=await deployOne('FTIProxy',[bi.target,bi.interface.encodeFunctionData('initialize',[usd.target,tp.target,tl.target,council.target,a[79],a.slice(0,31)])],w[0]);
  const token=new Contract(tp.target,artifact('FTIReserveTokenUpgradeable').abi,w[0]),binary=new Contract(bp.target,artifact('FundedBinaryPlanUpgradeable').abi,w[0]),suite={usd,token,binary};
  await send(token.bind(binary.target));assert.equal(await binary.poolDistributionVersion(),1n);assert.equal(await binary.hourlyCapFlushVersion(),1n);
  for(const i of [0,1,2,3,4,5,6,15]){await send(usd.connect(w[i]).faucet());await send(usd.connect(w[i]).approve(binary.target,MaxUint256));}
  await send(binary.addUnits(20));
  const books=async()=>{const x=await binary.fundingAccounting();assert.equal(x[0],x[1]);assert.equal(x[2],x[3]);await checkAccounting(suite);};
  const add=async(i,n)=>{if(n)await send(binary.connect(w[i]).addUnits(n));};
  const isolated=async fn=>{const s=await p.send('evm_snapshot',[]);try{await fn();}finally{await p.send('evm_revert',[s]);}};
  const warp=async date=>{await p.send('evm_setTime',[Date.parse(date)]);await p.send('evm_mine',[]);};
  // Synthetic boundary cases seed only eligibility/volume, never collateral or
  // balance books. Ordinary purchase paths below exercise real attribution.
  const layout=JSON.parse(fs.readFileSync('artifacts/storage-layout/FundedBinaryPlanUpgradeable.json'));
  const field=name=>layout.storage.find(s=>s.label===name),abi=AbiCoder.defaultAbiCoder();
  const mapSlot=(name,key)=>BigInt(keccak256(abi.encode(['address','uint256'],[key,field(name).slot])));
  const setWord=async(slot,value)=>p.send('evm_setAccountStorageAt',[binary.target,toBeHex(slot,32),toBeHex(value,32)]);
  const set=async(name,value)=>{const f=field(name),offset=BigInt(f.offset*8),bits=BigInt(Number(layout.types[f.type].numberOfBytes)*8),mask=((1n<<bits)-1n)<<offset;const raw=await p.getStorage(binary.target,BigInt(f.slot));const old=BigInt(raw==='0x'?0:raw);await setWord(BigInt(f.slot),(old&~mask)|(BigInt(value)<<offset));};
  const memberSet=async(i,name,value)=>{const f=field('members'),type=layout.types[layout.types[f.type].value],m=type.members.find(s=>s.label===name),slot=mapSlot('members',a[i])+BigInt(m.slot),bits=BigInt(Number(layout.types[m.type].numberOfBytes)*8),offset=BigInt(m.offset*8),mask=((1n<<bits)-1n)<<offset;const raw=await p.getStorage(binary.target,slot);await setWord(slot,(BigInt(raw==='0x'?0:raw)&~mask)|(BigInt(value)<<offset));};
  const eligible=async(rows,level=0)=>{await set('protectionLevel',level);await set('dirtyCount',rows.length);for(let j=0;j<rows.length;j++){const {i,L,R,rank=0}=rows[j];await memberSet(i,'units',1);await memberSet(i,'rank',rank);await memberSet(i,'carryL',L);await memberSet(i,'carryR',R);await setWord(BigInt(keccak256(abi.encode(['uint256','uint256'],[j,field('dirtyMembers').slot]))),BigInt(a[i]));}};
  const rankAt=async(i,tier,time)=>{const slot=mapSlot('rankReachedAt',a[i]),raw=await p.getStorage(binary.target,slot),old=BigInt(raw==='0x'?'0x0':raw);await setWord(slot,(old&~(((1n<<64n)-1n)<<BigInt(tier*64)))|(BigInt(time)<<BigInt(tier*64)));};
  const close=async(batch=100)=>{
   await drainVolume(suite,batch);const pool=await binary.pointPool(),epoch=await binary.epoch(),level=Number(await binary.protectionLevel()),rows=[];
   for(let j=0;j<Number(await binary.dirtyCount());j++){const who=await binary.dirtyMembers(j),m=await binary.members(who),raw=min(m.carryL,m.carryR),points=min(raw,BigInt(caps[level][Number(m.rank)]));rows.push({who,m,raw,points,cash:await binary.pendingReward(who),auto:await binary.pendingAuto(who),pct:await binary.autoBuyPercent(who)});}
   const total=rows.reduce((n,r)=>n+r.points,0n);await settle(suite,p,batch);let allocated=0n;
   for(const r of rows){const reward=total?pool*r.points/total:0n,automatic=r.m.autoEnabled&&r.m.rank>0n?reward*r.pct/100n:0n,after=await binary.members(r.who);allocated+=reward;
    assert.equal(await binary.paidPoints(epoch,r.who),r.points);assert.equal(await binary.pendingReward(r.who),r.cash+reward-automatic);assert.equal(await binary.pendingAuto(r.who),r.auto+automatic);
    assert.equal(after.carryL,r.m.carryL-r.raw);assert.equal(after.carryR,r.m.carryR-r.raw);
    const logs=await binary.queryFilter(binary.filters.HourlyCapFlushed(epoch,r.who));assert.equal(logs.length,r.raw>r.points?1:0);if(logs.length){assert.equal(logs[0].args.points,r.raw-r.points);assert.equal(logs[0].args.retainedCredit,0n);}
   }
   assert.equal(await binary.totalPaidPoints(),total);assert.equal(await binary.pointValue(),total?pool/total:0n);assert.equal(await binary.calculatedPointValue(),total?pool/total:0n);assert.equal(await binary.pointPool(),pool-allocated);
   if(total)assert(pool-allocated<BigInt(rows.filter(r=>r.points>0n).length));else assert.equal(await binary.pointPool(),pool);
   await books();return{pool,total,allocated,rows,epoch};
  };
  for(const [L,R] of [[15,20],[20,15],[20,20],[3,5],[5,5],[0,20],[20,0]])await t.test(`purchases ${L}/${R}: capped points receive the entire hourly pool`,()=>isolated(async()=>{
   await add(1,L);await add(2,R);const r=await close(1);if(L&&R){assert.equal(r.total,BigInt(Math.min(L,R,5)));assert.equal(r.allocated,E(String((20+L+R)*90)));}
   if(L===15&&R===20){assert.equal(r.total,5n);assert.equal(await binary.pendingReward(a[0]),E('4950'));assert.equal((await binary.members(a[0])).carryR,5n);}
  }));
  await t.test('unmatched/no-eligible pool carries, next funded match distributes it; neither rewards nor excess matches replay',()=>isolated(async()=>{
   await add(1,15);await close();assert.equal(await binary.pointPool(),E('3150'));
   await add(2,20);await close();const due=await binary.pendingReward(a[0]);assert.equal(due,E('4950'));
   await close();assert.equal(await binary.pendingReward(a[0]),due);await add(1,5);await close();assert.equal(await binary.pendingReward(a[0]),due+E('450'));
   const before=await usd.balanceOf(a[0]);await send(binary.payRewards(100));assert.equal(await usd.balanceOf(a[0]),before+due+E('450'));await send(binary.payRewards(100));assert.equal(await usd.balanceOf(a[0]),before+due+E('450'));await assert.rejects(()=>binary.claim.staticCall());await books();
  }));
  for(const [rank,threshold,cap] of [[1,100,10],[2,200,15],[3,500,20],[4,1000,25]])await t.test(`actual Builder ${rank} keeps its rank threshold and ${cap}-point cap`,()=>isolated(async()=>{
   await add(1,threshold);await add(2,threshold);await close();assert.equal(await binary.rankOf(a[0]),BigInt(rank));await add(1,cap+10);await add(2,cap+15);const r=await close();assert.equal(r.total,BigInt(cap));
  }));
  for(let level=0;level<4;level++)await t.test(`all five ranks use the unchanged protection level ${level} caps`,()=>isolated(async()=>{
   await eligible(Array.from({length:5},(_,i)=>({i,L:40,R:45,rank:i})),level);const r=await close(1);assert.deepEqual(r.rows.map(x=>Number(x.points)),caps[level]);
  }));
  await t.test('below $20 and below $16: all eligible points are paid; protection changes only next-hour caps',()=>isolated(async()=>{
   await eligible(Array.from({length:31},(_,i)=>({i,L:30,R:30,rank:4})));const r=await close(7);assert.equal(r.total,775n);assert.equal(r.pool,E('1800'));assert((await binary.pointValue())<E('16'));assert.equal(await binary.protectionLevel(),1n);
   assert(r.rows.every(x=>x.points===25n));await eligible([{i:0,L:25,R:25,rank:4}],1);const r2=await close();assert.equal(r2.total,20n);assert.equal(await binary.protectionLevel(),2n);
  }));
  await t.test('rounding is less than one atomic unit per eligible wallet and is reused next hour',()=>isolated(async()=>{
   await eligible([{i:0,L:1,R:1},{i:1,L:2,R:2},{i:2,L:4,R:4}]);const r=await close(1);const dust=r.pool-r.allocated;assert(dust>0n&&dust<3n);
   await eligible([{i:0,L:1,R:1}]);const next=await close();assert.equal(next.pool,dust);assert.equal(next.allocated,dust);assert.equal(await binary.pointPool(),0n);
  }));
  await t.test('zero pool creates no money, and no-eligible hours do not advance protection',()=>isolated(async()=>{
   await eligible([{i:0,L:1,R:1}]);await close();assert.equal(await binary.pointPool(),0n);await eligible([{i:0,L:5,R:5}]);const r=await close();assert.equal(r.total,5n);assert.equal(r.allocated,0n);const level=await binary.protectionLevel();await close();assert.equal(await binary.protectionLevel(),level);
  }));
  for(const pct of [5,37,100])await t.test(`hourly auto-buy ${pct}% preserves exact ownership of pooled rewards`,()=>isolated(async()=>{
   await add(1,100);await add(2,100);await close();await send(binary.setAutoBuyPercent(true,pct));await add(1,15);await add(2,20);const r=await close();const automatic=r.allocated*BigInt(pct)/100n;assert.equal(await binary.pendingAuto(a[0]),automatic);await send(binary.executeAuto(a[0],automatic));assert.equal(await binary.pendingAuto(a[0]),0n);await assert.rejects(()=>binary.executeAuto.staticCall(a[0],automatic));await books();
  }));
  await t.test('batched matching fixes denominator before payout and rejects reentrant/restarted funding or preferences',()=>isolated(async()=>{
   await eligible([{i:0,L:2,R:2},{i:1,L:3,R:3}]);await warp('2026-01-05T01:00:00Z');await send(binary.beginEpochClose());await send(binary.processEpoch(1));assert.equal(await binary.totalPending(),E('20'));assert.equal(await binary.phase(),1n);
   await assert.rejects(()=>binary.addUnits.staticCall(1));await assert.rejects(()=>binary.setAutoBuyPercent.staticCall(true,100));await assert.rejects(()=>binary.beginEpochClose.staticCall());await assert.rejects(()=>binary.payRewards.staticCall(100));
   await send(binary.processEpoch(1));assert.equal(await binary.phase(),2n);assert.equal(await binary.totalPaidPoints(),5n);await send(binary.processEpoch(1));await books();await send(binary.processEpoch(1));assert.equal(await binary.phase(),0n);assert.equal(await binary.pointPool(),0n);await assert.rejects(()=>binary.processEpoch.staticCall(1));await books();
  }));
  const closeMonth=async(date,batch=100)=>{await warp(date);await settle(suite,p,batch);await send(binary.beginBuilderMonth());while(await binary.monthPhase()>0n)await send(binary.processBuilderMonth(batch,{gasLimit:6_000_000}));await books();};
  for(const n of [0,1,4,5,6,31])await t.test(`all four monthly tiers: ${n} eligible wallets, 20% ceiling, exact carry`,()=>isolated(async()=>{
   for(let i=0;i<n;i++)for(let tier=0;tier<4;tier++)await rankAt(i,tier,Date.parse('2026-01-10T00:00:00Z')/1000);
   const pools=await Promise.all([0,1,2,3].map(i=>binary.monthFunding(2026*12,i)));await closeMonth('2026-02-01T00:00:00Z',n===6?7:100);
   let total=0n;for(let tier=0;tier<4;tier++){const each=pools[tier]/BigInt(Math.max(n,5)),paid=each*BigInt(n);total+=paid;assert.equal(await binary.monthEligible(tier),BigInt(n));assert.equal(await binary.monthPaid(tier),paid);assert.equal(await binary.builderCarry(tier),pools[tier]-paid);if(n>=5)assert(pools[tier]-paid<BigInt(n));}
   assert.equal(await binary.builderAccounted(),E('80')-total);assert.equal(await binary.totalPending(),E('20')+total);
   const before=await binary.totalPending(),carry=await Promise.all([0,1,2,3].map(i=>binary.builderCarry(i)));await closeMonth('2026-03-01T00:00:00Z');assert.equal(await binary.totalPending(),before);assert.deepEqual(await Promise.all([0,1,2,3].map(i=>binary.builderCarry(i))),carry);
  }));
  await t.test('real rank qualification: old monthly remainder funds later new qualifiers without repeated rank awards',()=>isolated(async()=>{
   await add(1,1);await add(3,100);await add(4,100);await add(2,200);await close();assert.equal(await binary.rankOf(a[0]),2n);assert.equal(await binary.rankOf(a[1]),1n);
   const jan=await binary.monthFunding(2026*12,0);await closeMonth('2026-02-01T00:00:00Z');assert.equal(await binary.monthEligible(0),2n);assert.equal(await binary.builderCarry(0),jan-2n*(jan/5n));
   const carried=await binary.builderCarry(0);await closeMonth('2026-03-01T00:00:00Z');assert.equal(await binary.builderCarry(0),carried);
   await add(5,100);await add(6,100);await close();assert.equal(await binary.rankOf(a[2]),1n);const before=await binary.pendingReward(a[2]),fresh=await binary.monthFunding(2026*12+2,0);
   await closeMonth('2026-04-01T00:00:00Z');const each=(carried+fresh)/5n;assert.equal(await binary.pendingReward(a[2]),before+each);assert.equal(await binary.builderCarry(0),carried+fresh-each);assert.equal(await binary.monthEligible(0),1n);
  }));
  await t.test('rank reached after month cutoff waits; no new monthly purchase is required to receive carry',()=>isolated(async()=>{
   await closeMonth('2026-02-01T00:00:00Z');const carry=await binary.builderCarry(0);assert(carry>0n);
   await rankAt(0,0,Date.parse('2026-03-01T00:00:01Z')/1000);await closeMonth('2026-03-01T00:00:00Z');assert.equal(await binary.monthEligible(0),0n);assert.equal(await binary.builderCarry(0),carry);
   await closeMonth('2026-04-01T00:00:00Z');assert.equal(await binary.monthEligible(0),1n);assert.equal(await binary.pendingReward(a[0]),carry/5n);assert.equal(await binary.builderCarry(0),carry-carry/5n);
  }));
  console.log('POOLED_DISTRIBUTION_VERIFIED_LOCAL_ONLY');
 }finally{await engine.disconnect();}
});
