import test from 'node:test';
import assert from 'node:assert/strict';
import {N,amounts,scenario,sellAmount} from '../tools/testnet-continuity-mixed.mjs';
test('mixed range respects purchase allowance and two-transaction maximum target',()=>{
 assert.equal(N,amounts.length);assert.equal(amounts[0],1);assert.equal(amounts.at(-1),100000);
 for(let i=0;i<N;i++){const s=scenario(i);assert(s.units*500>=s.buy);assert.equal(s.sell,s.buy);assert(Math.ceil(s.buy/64000)<=2);}
});
test('sales and transfers never debit above available holdings',()=>{
 assert.equal(sellAmount(100000n,10n,100n,100n),10n);
 assert.equal(sellAmount(1n,10n,100n,100n),1n);
 assert.equal(sellAmount(1n,0n,100n,100n),0n);
});
