import test from 'node:test';
import assert from 'node:assert/strict';
import {ReserveModel,W,buyQuote,animalBuyQuote,sellQuote} from '../core/reserve-reference.mjs';
import {simulateReserve} from '../scripts/simulate-reserve.mjs';

test('independent V2 arithmetic keeps backing and nondecreasing price across 300,000 wallets and emergency user exit',()=>{
 const r=simulateReserve(300000);
 assert.equal(r.model,'real-reserve-v2-zero-start');assert.equal(r.wallets,300000);assert.equal(r.buys,300000);
 assert(r.sells>=300000);assert(r.transfers>50000);assert.equal(r.finalUserCirculatingSupply,'0');
 assert(BigInt(r.animalSupportSupplyBeforeDrain)>0n);assert.equal(BigInt(r.finalAnimalSupportSupply),0n);assert.equal(BigInt(r.finalReserveUSDWei),0n);
 assert.equal(BigInt(r.cashInUSDWei)-BigInt(r.cashOutUSDWei),BigInt(r.finalReserveUSDWei));
 assert(BigInt(r.largestBuyUSDWei)>=100000n*W);
 console.log('RESERVE_V2_MODEL_300K',JSON.stringify(r));
});

test('zero start and integer share-price proofs cover first buy, support injection and large magnitudes',()=>{
 const m=new ReserveModel();m.register(0);assert.equal(m.price(),0n);assert.equal(m.supply,0n);
 const first=m.buy(0,100n*W);assert.equal(first.userMint,97n*W);assert.equal(first.animalMint,1n*W);assert(m.price()>W);
 const p=m.price();m.register(1);assert(m.price()>p);
 m.transfer(0,1,1n*W);assert.equal(m.price(),m.reserve*W/m.supply);
 const beforeAnimal=m.animalSupply;const q=m.sell(0,1n*W,{emergency:true});assert(q.payout>0n);assert.equal(m.animalSupply,beforeAnimal);

 const scale=[1n,10n,100n,10000n,10n**18n,10n**25n];let checked=0;
 for(const r of scale)for(const s of scale)for(const a of [34n,100n,100000n,10n**24n]){
  const u=buyQuote(a,r,s),animal=animalBuyQuote(a,r,s);
  if(s>0n&&u){assert((r+a)*s>r*(s+u+animal));checked++;}
  const t=s/100n;if(t){const x=sellQuote(t,r,s,{emergency:true});if(x.payout){assert.equal(x.payout,x.gross);assert((r-x.payout)*s>=r*(s-t));checked++;}}
 }
 assert(checked>30);
});
