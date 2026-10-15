import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectContinuity} from '../scripts/continuity-monitor.mjs';
const E=n=>BigInt(n)*10n**18n;
function fixture(){const iface={hasFunction:()=>true,encodeFunctionData:()=> '0x1234'},b={target:'binary',interface:iface,accounting:async()=>[E(100),E(100)],fundingAccounting:async()=>[E(80),E(80),E(4),E(4)],phase:async()=>0n,totalPaidPoints:async()=>4n,pointValue:async()=>E(20),totalPending:async()=>E(16),rewardAccountCount:async()=>1n,recoveryFrozen:async()=>false},t={target:'token',interface:iface,accounting:async()=>[E(10),E(10)],supportReserve:async()=>E(1),price:async()=>E(1),ath:async()=>E(1),recoveryFrozen:async()=>false};return{binary:b,token:t,blockTag:123};}
test('healthy monitor is read-only and prepares unsigned freeze data',async()=>{const r=await inspectContinuity(fixture());assert.equal(r.critical,false);assert.equal(r.submitted,false);assert.equal(r.unsignedFreezeProposals.length,2);});
test('monitor catches deficits, broken books, underpaid points and missing queue',async()=>{const f=fixture();f.binary.accounting=async()=>[0n,E(100)];f.token.accounting=async()=>[0n,E(10)];f.binary.fundingAccounting=async()=>[0n,1n,0n,1n];f.binary.pointValue=async()=>E(16);f.binary.rewardAccountCount=async()=>0n;const r=await inspectContinuity(f);assert(r.critical);assert.equal(r.alerts.length,5);});
test('monitor does not judge an unfinished hourly allocation as final',async()=>{const f=fixture();f.binary.phase=async()=>1n;f.binary.pointValue=async()=>0n;f.token.recoveryFrozen=async()=>true;const r=await inspectContinuity(f);assert.equal(r.critical,false);assert.equal(r.unsignedFreezeProposals.length,1);});
test('activated pooled version accepts sub-$20 points and verifies full-pool allocation',async()=>{
 const f=fixture();f.binary.poolDistributionVersion=async()=>1n;f.binary.pointValue=async()=>E(5);f.binary.frozenPool=async()=>E(20);f.binary.allocated=async()=>E(20);
 assert.equal((await inspectContinuity(f)).critical,false);
 f.binary.allocated=async()=>E(10);assert((await inspectContinuity(f)).alerts.some(a=>a.code==='HOURLY_POOL_DISTRIBUTION_MISMATCH'));
});
test('version in ABI cannot turn off legacy floor protection without successful on-chain activation',async()=>{
 const f=fixture();f.binary.pointValue=async()=>E(5);f.binary.poolDistributionVersion=async()=>0n;
 assert((await inspectContinuity(f)).alerts.some(a=>a.code==='SETTLED_POINT_BELOW_20'));
 f.binary.poolDistributionVersion=async()=>{throw Error('old proxy');};assert((await inspectContinuity(f)).critical);
});
