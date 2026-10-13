import test from 'node:test';
import assert from 'node:assert/strict';
import {readHourlyCapFlushVersion} from '../core/hourly-cap-policy.mjs';
test('cap-flush capability requires successful on-chain confirmation, not an ABI or a config flag',async()=>{
 const binary={interface:{hasFunction:()=>true},hourlyCapFlushVersion:async()=>1n};
 assert.equal(await readHourlyCapFlushVersion(binary),1);
 assert.equal(await readHourlyCapFlushVersion({...binary,hourlyCapFlushVersion:async()=>2n}),null);
 assert.equal(await readHourlyCapFlushVersion({...binary,hourlyCapFlushVersion:async()=>{throw Error('old implementation or RPC unavailable');}}),null);
 assert.equal(await readHourlyCapFlushVersion({interface:{hasFunction:()=>false}}),null);
});
