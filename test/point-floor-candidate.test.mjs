import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,MaxUint256} from 'ethers';
import {deployOne,settle,checkAccounting} from '../scripts/lib.mjs';

test('funded floor: per-wallet minimum, deferred carry, payouts, development 1%, rank boundary and no replay',{timeout:180000},async()=>{
 const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:50},miner:{blockGasLimit:30000000}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 try{
  const w=await Promise.all(Array.from({length:50},(_,i)=>p.getSigner(i))),a=await Promise.all(w.map(s=>s.getAddress()));
  const usd=await deployOne('MockUSD',[],w[0]),council=await deployOne('SevenGuardianCouncil',[a.slice(40,47)],w[0]);
  const token=await deployOne('FTIReserveTokenV3',[usd.target,a[48],council.target],w[0]);
  const binary=await deployOne('FundedBinaryPlanFloor',[usd.target,token.target,a[48],council.target,a[49],a.slice(0,31)],w[0]);
  await(await token.bind(binary.target)).wait();const suite={usd,token,binary};
  const send=async t=>{const r=await(await t).wait();assert.equal(r.status,1);return r;};
  for(const i of [0,1,2,15,31,32,33,34,35,36,37]){await send(usd.connect(w[i]).faucet());await send(usd.connect(w[i]).approve(binary.target,MaxUint256));}
  await send(binary.addUnits(1));await send(binary.connect(w[15]).addUnits(1));
  let parent=15;for(let i=31;i<=35;i++){await send(binary.connect(w[i]).register(a[parent],1));parent=i;}
  // Parent depth 9; each child's matched credit is $9/unit, below $20/pair.
  await send(binary.connect(w[36]).register(a[35],5));await send(binary.connect(w[37]).register(a[35],5));
  await send(binary.connect(w[1]).addUnits(99));await send(binary.connect(w[2]).addUnits(99));
  assert.equal(await binary.pendingReward(a[49]),E('215'));
  const epoch=await binary.epoch();await settle(suite,p,1);
  assert.equal(await binary.rankOf(a[0]),0n);
  assert.equal(await binary.paidPoints(epoch,a[35]),4n);assert.equal(await binary.pendingReward(a[35]),E('90'));
  const m=await binary.members(a[35]);assert.equal(m.carryL,1n);assert.equal(m.carryR,1n);
  assert.equal(await binary.creditL(a[35]),0n);assert.equal(await binary.creditR(a[35]),0n);
  for(const who of a.slice(0,38)){const points=await binary.paidPoints(epoch,who);if(points>0n)assert(await binary.pendingReward(who)>=points*E('20'));}
  assert(await binary.pointValue()>=E('20'));assert.equal(await binary.protectionLevel(),1n);
  const books=await binary.fundingAccounting();assert.equal(books[0],books[1]);assert.equal(books[2],books[3]);
  const before=await usd.balanceOf(a[35]),dev=await usd.balanceOf(a[49]);
  while(await binary.rewardAccountCount()>0n)await send(binary.payRewards(1));
  assert.equal(await usd.balanceOf(a[35]),before+E('90'));assert.equal(await usd.balanceOf(a[49]),dev+E('215'));
  await send(binary.payRewards(100));assert.equal(await usd.balanceOf(a[35]),before+E('90'));
  await settle(suite,p,1);assert.equal(await binary.pendingReward(a[35]),0n);assert.equal((await binary.members(a[35])).carryL,1n);
  await send(binary.connect(w[1]).addUnits(1));await send(binary.connect(w[2]).addUnits(1));await settle(suite,p,1);
  assert.equal(await binary.rankOf(a[0]),1n);await checkAccounting(suite);
 }finally{await engine.disconnect();}
});
