import test from 'node:test';
import assert from 'node:assert/strict';
import {ReserveModel,W,buyQuote,sellQuote} from '../core/reserve-reference.mjs';
import {simulateReserve} from '../scripts/simulate-reserve.mjs';
test('independent reserve arithmetic keeps price increasing across 300,000 wallets and a complete exit',()=>{
 const r=simulateReserve(300000);assert.equal(r.wallets,300000);assert.equal(r.buys,300000);assert(r.sells>=300000);assert(r.transfers>50000);assert.equal(r.finalCirculatingSupply,'0');assert(BigInt(r.finalPriceWad)>=BigInt(r.priceBeforeFinalExitWad));assert.equal(BigInt(r.cashInUSDWei)-BigInt(r.cashOutUSDWei),BigInt(r.finalReserveUSDWei));assert(BigInt(r.largestBuyUSDWei)>=100000n*W);console.log('RESERVE_MODEL_300K',JSON.stringify(r));
});
test('integer rounding and share-price proofs cover small and very large magnitudes',()=>{
 const scale=[1n,10n,100n,10000n,10n**18n,10n**25n,10n**30n];let checked=0;
 for(const r of scale)for(const s of scale)for(const a of [1n,2n,33n,34n,100n,100000n,10n**24n]){const m=buyQuote(a,r,s);if(m){assert((r+a)*s>r*(s+m));checked++;}const t=s/2n;if(t){const q=sellQuote(t,r,s);if(q.payout){assert(q.payout<=r);assert((r-q.payout)*s>r*(s-t));checked++;}}}assert(checked>100);
 const m=new ReserveModel();m.register(0);assert.throws(()=>m.buy(0,1n));assert.equal(m.price(),W/10n);
});
