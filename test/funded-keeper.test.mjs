import test from 'node:test';
import assert from 'node:assert/strict';
import {keeperStep,startKeeper} from '../scripts/keeper.mjs';
const provider={getBlock:async()=>({timestamp:100})};
function stub(){return {target:'stub-'+Math.random(),interface:{hasFunction:name=>name==='autoAccountCount'},phase:async()=>0n,jobCursor:async()=>0n,jobCount:async()=>0n,epochEnd:async()=>1000n,monthPhase:async()=>0n,nextBuilderMonth:async()=>24000n,autoAccountCount:async()=>0n,memberCount:async()=>{throw Error('Must not scan full member list');}};}
test('funded keeper scans only eligible pending auto accounts',async()=>{
 const b=stub();let calls=0;b.autoAccountCount=async()=>2n;b.autoAccounts=async i=>'wallet-'+i;b.pendingAuto=async()=>5n;b.executeAuto=async who=>{calls++;assert.equal(who,'wallet-0');return {wait:async()=>({status:1})};};assert.equal(await keeperStep(b,provider),'auto-buy executed');assert.equal(calls,1);
});
test('funded keeper uses bounded 25-item batches and waits for receipt',async()=>{
 const b=stub();b.phase=async()=>1n;let receipt=false;b.processEpoch=async batch=>{assert.equal(batch,25);return {wait:async()=>{receipt=true;}};};assert.equal(await keeperStep(b,provider),'epoch batch');assert(receipt);
});
test('keeper drains work without interval delays, never overlaps writes, and stops scheduling cleanly',async()=>{
 const b=stub();let remaining=3,active=0,maxActive=0,done;const finished=new Promise(r=>{done=r;});b.phase=async()=>remaining?1n:0n;b.processEpoch=async()=>{active++;maxActive=Math.max(maxActive,active);return {wait:async()=>{await new Promise(r=>setTimeout(r,5));active--;remaining--;if(!remaining)done();}};};
 const start=Date.now(),stop=startKeeper(b,provider,1000);const timeout=setTimeout(()=>done(),500);await finished;stop();clearTimeout(timeout);assert.equal(remaining,0);assert.equal(maxActive,1);assert(Date.now()-start<500);await new Promise(r=>setTimeout(r,30));assert.equal(active,0);assert.throws(()=>startKeeper(b,provider,0));
});

test('keeper pays a bounded finalized reward batch before optional auto buys',async()=>{
 const b=stub();b.interface.hasFunction=()=>true;b.rewardAccountCount=async()=>120n;
 let waited=false;b.payRewards=async size=>{assert.equal(size,100);return{wait:async()=>{waited=true;}};};
 assert.equal(await keeperStep(b,provider),'reward payout batch');assert(waited);
});

test('keeper backs off a fully deferred queue and still attempts auto-buy work',async()=>{
 const b=stub();b.interface.hasFunction=()=>true;b.rewardAccountCount=async()=>1n;
 let payouts=0,buys=0;b.interface.parseLog=()=>({name:'RewardBatchPaid',args:{accounts:0n}});
 b.payRewards=async()=>{payouts++;return{wait:async()=>({logs:[{}]})};};
 b.autoAccountCount=async()=>1n;b.autoAccounts=async()=> 'auto-wallet';b.pendingAuto=async()=>5n;
 b.executeAuto=async()=>{buys++;return{wait:async()=>({status:1})};};
 assert.equal(await keeperStep(b,provider),'auto-buy executed');
 assert.equal(await keeperStep(b,provider),'auto-buy executed');
 assert.equal(payouts,1);assert.equal(buys,2);
});

test('keeper restart resumes a durable payout queue without paying twice or overlapping receipts',async()=>{
 const b=stub();b.interface.hasFunction=()=>true;let queue=205,paid=0;
 b.rewardAccountCount=async()=>BigInt(queue);
 b.payRewards=async batch=>({wait:async()=>{const size=Math.min(batch,queue);queue-=size;paid+=size;return{logs:[]};}});
 assert.equal(await keeperStep(b,provider),'reward payout batch');assert.equal(queue,105);
 let stop,finish;const done=new Promise(r=>{finish=r;});const original=b.payRewards;
 b.payRewards=async batch=>{const tx=await original(batch);return{wait:async()=>{const receipt=await tx.wait();if(!queue){stop();finish();}return receipt;}};};
 stop=startKeeper(b,provider,100);await done;assert.equal(paid,205);assert.equal(queue,0);
});
