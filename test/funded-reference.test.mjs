import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,MaxUint256} from 'ethers';
import {FundedLedger} from '../core/funded-reference.mjs';
import {deploySuite,settle} from '../scripts/lib.mjs';

test('independent attributed ledger agrees with EVM across activation, two epochs and unmatched credit',async()=>{
 const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:36},chain:{chainId:31337,time:new Date('2026-09-15T12:00:00Z')}});
 try{
  const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
  const signers=await Promise.all(Array.from({length:36},(_,i)=>p.getSigner(i)));
  const s=await deploySuite(signers,{tokenContract:'FTIReserveToken',binaryContract:'FundedBinaryPlan'}),model=new FundedLedger();
  for(let i=0;i<7;i++){await(await s.usd.connect(signers[i]).faucet()).wait();await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();}
  for(const steps of [[[3,2],[0,1],[1,1],[2,1],[3,30],[4,12],[5,11],[6,17]],[[3,2],[4,10],[5,8],[6,2]]]){
   for(const[i,n]of steps){await(await s.binary.connect(signers[i]).addUnits(n)).wait();model.fund(i,n);}
   await settle(s,p,25);model.closeEpoch();model.check(true);
   for(let i=0;i<31;i++){
    const a=s.addresses[i],actual=await s.binary.members(a),u=model.users[i];
    assert.deepEqual([actual.carryL,actual.carryR,actual.rank],[BigInt(u.left),BigInt(u.right),BigInt(u.rank)]);
    assert.equal(await s.binary.creditL(a),u.creditLeft);assert.equal(await s.binary.creditR(a),u.creditRight);
    assert.equal(await s.binary.pendingReward(a),u.reward);
   }
   assert.equal(await s.binary.pointPool(),model.pointBook);assert.equal(await s.binary.retainedPointReserve(),model.pointRetained);
   assert.equal(await s.binary.protectionLevel(),BigInt(model.level));
  }
 }finally{await engine.disconnect();}
});

test('funded reference reconciles current-month builder funding and rejects a depth beyond 64',()=>{
 const m=new FundedLedger();m.fund(0,1);m.fund(1,100);m.fund(2,100);m.closeEpoch();m.closeMonth();m.check(true);
 assert.equal(m.users[0].builderReward,6432n*10n**16n);
 let parent=15;while(m.users[parent].depth<64)parent=m.place(parent);
 assert.throws(()=>m.place(parent));
});
