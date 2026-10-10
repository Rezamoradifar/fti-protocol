import test from 'node:test';import assert from 'node:assert/strict';import {candles} from '../frontend/candles.js';
test('OHLC comes from ordered observations and gaps stay empty',()=>{assert.deepEqual(candles([{time:125,price:3},{time:61,price:2},{time:65,price:1},{time:70,price:4},{time:310,price:5}]),[{time:60,open:2,high:4,low:1,close:4,samples:3,volume:0},{time:120,open:3,high:3,low:3,close:3,samples:1,volume:0},{time:300,open:5,high:5,low:5,close:5,samples:1,volume:0}]);});
test('interval switching reaggregates observations without inventing trades',()=>{assert.equal(candles([{time:60,price:1},{time:299,price:2}],300).length,1);assert.deepEqual(candles([]),[]);assert.throws(()=>candles([{time:1,price:NaN}]));assert.throws(()=>candles([],10));});

test('volume aggregates actual trade notional per candle',()=>{const [c]=candles([{time:61,price:2,volume:100},{time:62,price:3,volume:50}]);assert.equal(c.volume,150);assert.equal(c.close,3);});
