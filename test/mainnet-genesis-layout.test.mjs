// Local EVM only: no public RPC, council keys or mainnet transactions.
import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,Contract,MaxUint256,parseEther as E} from 'ethers';
import {deployOne,artifact,checkAccounting,drainVolume} from '../scripts/lib.mjs';
import {approvedGenesisLayout,assertFreshGenesisLayout} from '../scripts/approved-genesis-layout.mjs';
import {genesisPlacementIndex,detectGenesisPlacementLayout,LEGACY_GENESIS_LAYOUT} from '../scripts/referral-placement-index.mjs';
import {assertStorageCompatible} from '../scripts/check-upgrade-layout.mjs';
import fs from 'node:fs';

const parents=[null,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23];
test('approved drawing pins all 30 edges, six rows and left/right singleton chains',()=>{
 const layout=approvedGenesisLayout();assert.deepEqual(layout.positions.map(p=>p.parent),parents);
 assert.deepEqual(layout.levels,[1,2,4,8,8,8]);
 for(const n of [16,18,20,22,24,26,28,30])assert.equal(layout.positions[n-1].side,'left');
 for(const n of [17,19,21,23,25,27,29,31])assert.equal(layout.positions[n-1].side,'right');
 for(const name of ['FundedBinaryPlanUpgradeable','FTIReserveTokenUpgradeable'])assertStorageCompatible(JSON.parse(fs.readFileSync('docs/storage-layout/'+name+(name==='FundedBinaryPlanUpgradeable'?'-20261009':'')+'.json')),JSON.parse(fs.readFileSync('artifacts/storage-layout/'+name+'.json')));
});
test('index distinguishes legacy complete trees and the approved six-row tree',async()=>{
 const g=Array.from({length:31},(_,i)=>'0x'+(i+1).toString(16).padStart(40,'0')),layout=approvedGenesisLayout();
 const next=genesisPlacementIndex(g,layout.id),old=genesisPlacementIndex(g);
 assert.equal((await next.getMember(g[16])).parent,g[8]);assert.equal((await old.getMember(g[16])).parent,g[7]);
 assert.equal(await detectGenesisPlacementLayout(g,{members:a=>next.getMember(a)}),layout.id);
 assert.equal(await detectGenesisPlacementLayout(g,{members:a=>old.getMember(a)}),LEGACY_GENESIS_LAYOUT);
 for(const [n,side]of [[8,'right'],[9,'left'],[10,'right'],[14,'right'],[17,'left']]){const r=await next.choose(g[n-1]);assert.equal(r.placementParent,g[n-1]);assert.equal(r.side,side);}
 assert.throws(()=>genesisPlacementIndex(g,'unreviewed-layout'),/UNSUPPORTED/);
});
test('production proxy initializes the exact drawing and fills either free side without rewriting genesis',{timeout:240000},async t=>{
 // The production deposit window closes at each UTC hour. A wall-clock-backed
 // fixture can cross that boundary between placement cases, even after an EVM
 // snapshot revert. Advance this local chain only through deterministic blocks
 // or an explicit time change; hourly settlement itself remains enforced below.
 const engine=ganache.provider({chain:{chainId:31337,time:new Date('2026-10-01T12:15:00Z')},logging:{quiet:true},wallet:{totalAccounts:46},miner:{blockGasLimit:30000000,timestampIncrement:1}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 try{
  const w=await Promise.all(Array.from({length:46},(_,i)=>p.getSigner(i))),a=await Promise.all(w.map(s=>s.getAddress()));
  const send=async tx=>{const r=await(await tx).wait();assert.equal(r.status,1);return r;};
  const usd=await deployOne('MockUSD',[],w[0]),council=await deployOne('SevenGuardianCouncil',[a.slice(31,38)],w[0]),lock=await deployOne('FTITimelock',[council.target],w[0]);
  const ti=await deployOne('FTIReserveTokenUpgradeable',[],w[0]),bi=await deployOne('FundedBinaryPlanUpgradeable',[],w[0]);
  const tp=await deployOne('FTIProxy',[ti.target,ti.interface.encodeFunctionData('initialize',[usd.target,lock.target,council.target])],w[0]);
  const bp=await deployOne('FTIProxy',[bi.target,bi.interface.encodeFunctionData('initialize',[usd.target,tp.target,lock.target,council.target,a[45],a.slice(0,31)])],w[0]);
  const token=new Contract(tp.target,artifact('FTIReserveTokenUpgradeable').abi,w[0]),binary=new Contract(bp.target,artifact('FundedBinaryPlanUpgradeable').abi,w[0]),suite={usd,token,binary};
  await send(token.bind(binary.target));const layout=approvedGenesisLayout();
  const isolated=async fn=>{const s=await p.send('evm_snapshot',[]);try{await fn();}finally{assert.equal(await p.send('evm_revert',[s]),true);}};
  await t.test('all 31 wallets keep order, correct parent/side/depth, zero units and no council positions',async()=>{
   assert.equal(await assertFreshGenesisLayout(binary,a.slice(0,31)),layout.id);
   assert.equal(await binary.memberCount(),31n);
   for(let i=0;i<31;i++){
    assert.equal(await binary.memberList(i),a[i]);assert.equal(await binary.unitsOf(a[i]),0n);assert.equal(await binary.activatedAtSerial(a[i]),0n);
    assert.equal(await binary.rankOf(a[i]),0n);assert.equal(await binary.pendingReward(a[i]),0n);
   }
   for(const role of a.slice(31,38).concat(a[45]))assert.equal(await binary.registered(role),false);
   const corrupt={members:async(who,at)=>{const m=await binary.members(who,at);return {exists:m.exists,parent:who===a[16]?a[7]:m.parent,left:m.left,right:m.right};},depth:(...args)=>binary.depth(...args)};
   await assert.rejects(()=>assertFreshGenesisLayout(corrupt,a.slice(0,31)),/position 17/);
   await checkAccounting(suite);
  });
  for(const [parentNumber,side,existing]of [[8,'right',16],[9,'left',17],[17,'left',25]])await t.test(`new ordinary registration fills ${side} under ${parentNumber} and preserves child ${existing}`,()=>isolated(async()=>{
   const idx=genesisPlacementIndex(a.slice(0,31),layout.id),placement=await idx.choose(a[parentNumber-1]);
   assert.equal(placement.side,side);assert.equal(placement.placementParent,a[parentNumber-1]);
   for(const i of [39,40]){await send(usd.connect(w[i]).faucet());await send(usd.connect(w[i]).approve(binary.target,MaxUint256));}
   const before=await usd.balanceOf(a[39]);
   await send(binary.connect(w[39]).registerWithPlacement(a[parentNumber-1],placement.placementParent,1));
   const m=await binary.members(a[parentNumber-1]);assert.equal(m[side],a[39]);assert.equal(m[side==='left'?'right':'left'],a[existing-1]);
   assert.equal(await binary.unitsOf(a[39]),1n);assert.equal(before-await usd.balanceOf(a[39]),E('100'));
   assert.equal((await binary.members(a[39])).parent,a[parentNumber-1]);
   await assert.rejects(()=>binary.connect(w[40]).register.staticCall(a[parentNumber-1],1));
   await checkAccounting(suite);
  }));
  await t.test('paid volume on a previously empty left slot reaches only the correct active ancestors',()=>isolated(async()=>{
   for(const i of [0,1,3,8,39]){await send(usd.connect(w[i]).faucet());await send(usd.connect(w[i]).approve(binary.target,MaxUint256));}
   for(const i of [0,1,3,8])await send(binary.connect(w[i]).addUnits(1));await drainVolume(suite);
   const before=await binary.members(a[8]),root=await binary.members(a[0]),pool=await binary.pointPool();
   await send(binary.connect(w[39]).register(a[8],1));await drainVolume(suite);
   const after=await binary.members(a[8]),rootAfter=await binary.members(a[0]);
   assert.equal(after.carryL,before.carryL+1n);assert.equal(after.carryR,before.carryR);
   assert.equal(rootAfter.carryL,root.carryL+1n);assert.equal(rootAfter.carryR,root.carryR);
   assert.equal(await binary.pointPool(),pool+E('90'));assert.equal((await binary.members(a[39])).parent,a[8]);
   assert.equal(await binary.unitsOf(a[16]),0n);await checkAccounting(suite);
  }));
  await t.test('expired hourly window rejects deposits without moving funds or positions and reopens after settlement',()=>isolated(async()=>{
   for(const i of [0,39]){await send(usd.connect(w[i]).faucet());await send(usd.connect(w[i]).approve(binary.target,MaxUint256));}
   const before=await usd.balanceOf(a[39]),rootBefore=await usd.balanceOf(a[0]),parentBefore=await binary.members(a[8]);
   const latest=await p.getBlock('latest'),end=Number(await binary.epochEnd());
   await p.send('evm_increaseTime',[end-latest.timestamp]);await p.send('evm_mine',[]);
   assert((await p.getBlock('latest')).timestamp>=end);
   const closedWindow=error=>error.code==='CALL_EXCEPTION'&&error.data===binary.interface.getError('InvalidOperation').selector;
   await assert.rejects(()=>binary.connect(w[39]).registerWithPlacement.staticCall(a[8],a[8],1),closedWindow);
   await assert.rejects(()=>binary.addUnits.staticCall(1),closedWindow);
   assert.equal(await binary.registered(a[39]),false);assert.equal(await binary.memberCount(),31n);
   assert.equal(await usd.balanceOf(a[39]),before);assert.equal(await usd.balanceOf(a[0]),rootBefore);
   assert.equal(await binary.unitsOf(a[0]),0n);assert.deepEqual(Array.from(await binary.members(a[8])),Array.from(parentBefore));
   await send(binary.beginEpochClose());assert.equal(await binary.phase(),0n);
   assert(Number(await binary.epochEnd())>(await p.getBlock('latest')).timestamp);
   await send(binary.connect(w[39]).registerWithPlacement(a[8],a[8],1));
   const parentAfter=await binary.members(a[8]);assert.equal(parentAfter.left,a[39]);assert.equal(parentAfter.right,a[16]);
   assert.equal(await binary.unitsOf(a[39]),1n);assert.equal(before-await usd.balanceOf(a[39]),E('100'));
   await checkAccounting(suite);
  }));
 }finally{await engine.disconnect();}
});
