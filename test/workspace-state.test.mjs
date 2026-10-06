import test from 'node:test';
import assert from 'node:assert/strict';
import {dataFreshness,STALE_AFTER_MS,settlementReadiness,actionAvailability,proposalAvailability,timelockPresentation,transactionStage} from '../frontend/workspace-state.mjs';
const base={phase:0,monthPhase:0,jobCount:'2',jobCursor:'2',timestamp:100,epochEnd:200,nextMonth:2026*12,lastClosedAt:0,paused:false};
const member={exists:true,units:'1',unlocked:'100',claimable:'100',autoPending:'100',autoEnabled:true};
const access=(data=base,extra={})=>actionAvailability({data,wallet:member,connected:true,councilOwner:false,fresh:true,lifecycle:{},...extra});
test('initial, failed and aged data are stale; successful recent data is actionable',()=>{
 assert.equal(dataFreshness(0,100).stale,true);assert.equal(dataFreshness(10,11).stale,false);
 assert.equal(dataFreshness(10,10+STALE_AFTER_MS).stale,true);assert.equal(dataFreshness(10,11,true).stale,true);
});
test('disconnected and stale states disable every write capability',()=>{
 for(const extra of [{connected:false},{fresh:false}])assert(Object.values(access(base,extra)).every(value=>!value));
 assert(Object.values(access(null)).every(value=>!value));
});
test('public callers are not council owners and membership does not grant governance',()=>{
 assert.equal(access().wallet,true);assert.equal(access().council,false);assert.equal(access(base,{councilOwner:true}).council,true);
 assert.equal(access(base,{wallet:null}).buyer,false);assert.equal(access(base,{wallet:null}).reward,false);
});
test('funding waits for an open phase and unexpired epoch while cash claims remain accessible',()=>{
 for(const data of [{...base,phase:1},{...base,timestamp:200},{...base,paused:true}]){assert.equal(access(data).funder,false);assert.equal(access(data).reward,true);}
 assert.equal(access().funder,true);
});
test('retired and paused lifecycle gating separates holder sales, transfers and new funding',()=>{
 const closed=access({...base,lifecycleClosed:true},{lifecycle:{fundingBlocked:true,buyingBlocked:true}});
 assert.equal(closed.buyer,false);assert.equal(closed.funder,false);assert.equal(closed.transfer,false);assert.equal(closed.reward,true);assert.equal(closed.auto,true);
 for(const data of [{...base,tokenPaused:true},{...base,emergencyExit:true}]){const a=access(data,{lifecycle:{buyingBlocked:true}});assert.equal(a.buyer,false);assert.equal(a.transfer,false);assert.equal(a.unlocked,true);}
 assert.equal(access(base,{wallet:{...member,autoEnabled:false}}).autoBuyer,false);
});
test('volume, hourly matching and allocation readiness reflect all exposed contract prerequisites',()=>{
 assert(Object.values(settlementReadiness(null)).every(r=>!r.ready));
 const queued=settlementReadiness({...base,jobCursor:'0',timestamp:201});assert(queued.volume.ready);assert(!queued['close-epoch'].ready);
 assert(!settlementReadiness(base)['close-epoch'].ready);
 assert(settlementReadiness({...base,timestamp:200})['close-epoch'].ready);
 for(const phase of [1,2]){const r=settlementReadiness({...base,phase});assert(!r.volume.ready);assert(!r['close-epoch'].ready);assert(r['process-epoch'].ready);}
});
test('monthly readiness requires calendar boundary and completed boundary-hour settlement',()=>{
 const end=Date.UTC(2026,1,1)/1000;
 assert(!settlementReadiness({...base,timestamp:end-1,lastClosedAt:end})['begin-month'].ready);
 assert(!settlementReadiness({...base,timestamp:end,lastClosedAt:end-1})['begin-month'].ready);
 assert(!settlementReadiness({...base,timestamp:end,lastClosedAt:undefined})['begin-month'].ready);
 assert(settlementReadiness({...base,timestamp:end,lastClosedAt:end})['begin-month'].ready);
 const running=settlementReadiness({...base,timestamp:end,lastClosedAt:end,monthPhase:1});assert(!running['begin-month'].ready);assert(running['process-month'].ready);
});
test('proposal readiness prevents repeat approval and keeps execution permissionless at threshold',()=>{
 assert.deepEqual(proposalAvailability({executed:false,approvals:4,approved:false,owner:false,connected:true}),{approve:false,execute:false});
 assert.deepEqual(proposalAvailability({executed:false,approvals:5,approved:false,owner:false,connected:true}),{approve:false,execute:true});
 assert.equal(proposalAvailability({executed:false,approvals:1,approved:true,owner:true,connected:true}).approve,false);
 assert.deepEqual(proposalAvailability({executed:true,approvals:5,owner:true,connected:true}),{approve:false,execute:false});
});
test('timelock and wallet error states never infer a successful execution',()=>{
 assert.equal(timelockPresentation({scheduled:false}).ready,false);
 assert.match(timelockPresentation({scheduled:true,timestamp:200}).label,/Waiting until/);
 assert.equal(timelockPresentation({scheduled:true,ready:true}).ready,true);
 assert.equal(timelockPresentation({scheduled:true,done:true,ready:true}).ready,false);
 assert.equal(transactionStage({code:4001}),'rejected');assert.equal(transactionStage({code:'ACTION_REJECTED'}),'rejected');assert.equal(transactionStage({code:'WRONG_CHAIN'}),'wrong-chain');assert.equal(transactionStage(Error('RPC failed')),'error');
});
