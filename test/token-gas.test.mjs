import test from 'node:test';
import assert from 'node:assert/strict';
import {bufferedTokenSellGas} from '../frontend/token-gas.mjs';

test('token sell gas padding adds a rounded-up quarter plus 30k without Number precision loss',()=>{
 assert.equal(bufferedTokenSellGas(100000n),155000n);
 assert.equal(bufferedTokenSellGas(105834n),162293n);
 assert.equal(bufferedTokenSellGas(1n),30002n);
 const huge=9007199254740993n;
 assert.equal(bufferedTokenSellGas(huge),huge+(huge+3n)/4n+30000n);
});
test('token sell gas padding rejects malformed, zero and negative estimates',()=>{
 for(const value of [undefined,null,0n,-1n,100000,'100000',NaN])assert.throws(()=>bufferedTokenSellGas(value),TypeError);
});
