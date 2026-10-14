import test from 'node:test';
import assert from 'node:assert/strict';
import {readPoolDistributionVersion} from '../core/pool-distribution-policy.mjs';
test('pool capability is established by a successful activated proxy read',async()=>{
 const b={interface:{hasFunction:()=>true},poolDistributionVersion:async()=>1n};assert.equal(await readPoolDistributionVersion(b),1);
 for(const v of [0n,2n])assert.equal(await readPoolDistributionVersion({...b,poolDistributionVersion:async()=>v}),null);
 assert.equal(await readPoolDistributionVersion({...b,poolDistributionVersion:async()=>{throw Error('unavailable');}}),null);
 assert.equal(await readPoolDistributionVersion({interface:{hasFunction:()=>false}}),null);
});
