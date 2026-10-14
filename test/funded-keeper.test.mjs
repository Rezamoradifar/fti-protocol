import test from 'node:test';
import assert from 'node:assert/strict';
import {keeperStep,startKeeper} from '../scripts/keeper.mjs';
const provider={getBlock:async()=>({timestamp:100})};
function stub(){return {target:'stub-'+Math.random(),interface:{hasFunction:name=>name==='autoAccountCount'},recoveryFrozen:async()=>false,phase:async()=>0n,jobCursor:async()=>0n,jobCount:async()=>0n,epochEnd:async()=>1000n,monthPhase:async()=>0n,nextBuilderMonth:async()=>24000n,autoAccountCount:async()=>0n,memberCount:async()=>{throw Error('Must not scan full member list');}};}
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

 test('legacy deployment disables reward ABI calls while retaining keeper settlement',async()=>{
 const b=stub();b.interface.hasFunction=()=>true;b.rewardAccountCount=async()=>{throw Error('Old bytecode has no reward queue');};
 assert.equal(await keeperStep(b,provider,{batchedRewards:false}),'idle');
 });

test('finalized rewards are paid even while new volume jobs keep arriving',async()=>{
 const b=stub();b.interface.hasFunction=()=>true;b.rewardAccountCount=async()=>1n;b.jobCount=async()=>1000n;
 b.processVolume=async()=>{throw Error('Rewards must not starve behind volume');};
 let paid=false;b.payRewards=async()=>({wait:async()=>{paid=true;}});
 assert.equal(await keeperStep(b,provider),'reward payout batch');assert(paid);
});

test('keeper does not write during recovery freeze',async()=>{
 const b=stub();b.interface.hasFunction=()=>true;b.recoveryFrozen=async()=>true;b.phase=async()=>{throw Error('Must stop before any settlement');};
 assert.equal(await keeperStep(b,provider),'idle');
});

test('keeper splits oversized auto balances into bounded batches without losing remainder',async()=>{
 const b=stub();let pending=130n;const amounts=[];b.autoAccountCount=async()=>1n;b.autoAccounts=async()=> 'wallet';b.pendingAuto=async()=>pending;
 b.executeAuto=async(who,amount)=>{amounts.push(amount);return{wait:async()=>{pending-=amount;}};};
 for(let i=0;i<3;i++)assert.equal(await keeperStep(b,provider,{maxAutoAmount:64n}),'auto-buy executed');
 assert.deepEqual(amounts,[64n,64n,2n]);assert.equal(pending,0n);
});

test('due month drains bounded new-month volume before closing, then pays queued cash',async()=>{
 const b=stub(),timestamp=Date.UTC(2026,1,1)/1000,p={getBlock:async()=>({timestamp})};
 let cursor=0n,month=2026n*12n,phase=0n,queuedCash=true;const actions=[];
 b.interface.hasFunction=()=>true;b.lastClosedAt=async()=>BigInt(timestamp);
 b.nextBuilderMonth=async()=>month;b.monthPhase=async()=>phase;
 b.jobCursor=async()=>cursor;b.jobCount=async()=>30n;b.epochEnd=async()=>BigInt(timestamp+3600);
 b.rewardAccountCount=async()=>queuedCash?1n:0n;
 b.processVolume=async size=>{assert.equal(size,25);return{wait:async()=>{cursor=cursor+25n>30n?30n:cursor+25n;actions.push('volume');}};};
 b.beginBuilderMonth=async()=>{assert.equal(cursor,30n,'contract requires volume drained');return{wait:async()=>{phase=1n;actions.push('month');}};};
 b.processBuilderMonth=async size=>{assert.equal(size,25);return{wait:async()=>{phase=0n;month++;actions.push('settle');}};};
 b.payRewards=async size=>{assert.equal(size,100);assert.equal(month,2026n*12n+1n);return{wait:async()=>{queuedCash=false;actions.push('cash');}};};
 const observed=[];for(let i=0;i<5;i++)observed.push(await keeperStep(b,p));
 assert.deepEqual(observed,['volume batch','volume batch','builder close','builder batch','reward payout batch']);
 assert.deepEqual(actions,['volume','volume','month','settle','cash']);assert.equal(await keeperStep(b,p),'idle');
});
