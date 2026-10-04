import test from 'node:test';
import assert from 'node:assert/strict';
import {ReserveModel,W,INITIAL_PRICE,buyQuote,sellQuote,baseFee,feeBps,pressureAfterSale,decayPressure,sellImpactBps} from '../core/reserve-reference.mjs';
import {simulateReserve} from '../scripts/simulate-reserve.mjs';

test('independent experimental arithmetic keeps backing across 300,000 wallets and unrestricted normal exits',()=>{
 const r=simulateReserve(300000);
 assert.equal(r.model,'real-reserve-v2-integrated-experiment');assert.equal(r.economics,'global-pressure-3-to-10-percent-partials-exact-final-redemption');
 assert.equal(r.wallets,300000);assert.equal(r.buys,300000);
 assert(r.sells>=300000);assert(r.transfers>50000);assert.equal(r.finalUserCirculatingSupply,'0');
 assert.equal(BigInt(r.finalUnallocatedReserveUSDWei),5n*W);assert.equal(BigInt(r.finalActualUSDWei),5n*W);
 assert.equal(BigInt(r.finalTotalSupply),0n);assert.equal(BigInt(r.finalReserveUSDWei),0n);assert.equal(r.lifecycleClosed,true);
 assert(BigInt(r.finalPriceWad)>=BigInt(r.priceBeforeFinalExitWad));assert(BigInt(r.finalPriceWad)>0n);
 assert.equal(BigInt(r.cashInUSDWei)-BigInt(r.cashOutUSDWei),BigInt(r.finalReserveUSDWei)+BigInt(r.finalUnallocatedReserveUSDWei));
 assert(BigInt(r.largestBuyUSDWei)>=100000n*W);
 console.log('RESERVE_V2_MODEL_300K',JSON.stringify(r));
});

test('zero start uses $0.10 reference; buys and transfers conserve cash and mint only user shares',()=>{
 const m=new ReserveModel();assert.equal(m.price(),INITIAL_PRICE);assert.equal(m.reserve,0n);assert.equal(m.supply,0n);
 m.register(0);assert.equal(m.price(),W/10n);assert.equal(m.supply,0n);assert.equal(m.reserve,0n);assert.equal(m.unallocatedReserve,5n*W);
 const first=m.buy(0,100n*W);assert.deepEqual(first,{userMint:970n*W});
 assert.equal(m.supply,970n*W);assert.equal(m.userHeld,m.supply);assert.equal(m.reserve,100n*W);assert.equal(m.unallocatedReserve,5n*W);assert(m.price()>INITIAL_PRICE);
 let p=m.price();m.register(1);assert(m.price()>p);
 p=m.price();const reserve=m.reserve,cashIn=m.cashIn,cashOut=m.cashOut;
 assert.deepEqual(m.transfer(0,1,W),{burned:3n*W/100n,received:97n*W/100n});
 assert.equal(m.wallets.get(1).balance,97n*W/100n);assert.equal(m.supply,970n*W-3n*W/100n);
 assert.equal(m.reserve,reserve);assert.equal(m.cashIn,cashIn);assert.equal(m.cashOut,cashOut);assert(m.price()>p);
 const q=m.sell(0,W,{emergency:true});assert.equal(q.payout,q.gross);assert.equal(q.baseFee,0n);assert.equal(q.impactFee,0n);
});

test('integer quote formulas cover large magnitudes, global quadratic pressure and one combined fee ceiling',()=>{
 const scale=[1n,10n,100n,10000n,10n**18n,10n**25n];let checked=0;
 for(const r of scale)for(const s of scale)for(const a of [34n,100n,100000n,10n**24n]){
  const p=r*W/s,u=buyQuote(a,r,s);
  assert.equal(u,p>0n?(a-baseFee(a))*W/p:0n);
  for(const t of [s/100n,s/4n,s/2n])for(const pressure of [0n,W/2n,W])if(t){
   const next=W-(W-pressure)*(s-t)/s,impact=700n*(next*next/W)/W;
   const normal=sellQuote(t,r,s,{pressure}),emergency=sellQuote(t,r,s,{emergency:true,pressure});
   assert.equal(normal.gross,t*r/s);assert.equal(normal.impactBps,impact);assert.equal(normal.feeBps,300n+impact);
   assert.equal(normal.baseFee,baseFee(normal.gross));assert.equal(normal.pressure,next);
   assert.equal(normal.impactFee,feeBps(normal.gross,300n+impact)-baseFee(normal.gross));
   assert.equal(normal.payout,normal.gross>feeBps(normal.gross,300n+impact)?normal.gross-feeBps(normal.gross,300n+impact):0n);
   assert.equal(emergency.payout,emergency.gross);assert.equal(emergency.baseFee,0n);assert.equal(emergency.impactFee,0n);
   assert.equal(emergency.pressure,pressure);
   if(normal.payout){assert((r-normal.payout)*s>r*(s-t));checked++;}
   if(emergency.payout){assert((r-emergency.payout)*s>=r*(s-t));checked++;}
  }
 }
 assert(checked>1000);
 // Rounding combined fees once is observable: separate ceilings would charge two wei.
 const dust=sellQuote(1n,3n,2n);assert.equal(dust.baseFee+dust.impactFee,1n);
});

test('normal final redemption pays all live reserve, freezes reference and blocks restart',()=>{
 const m=new ReserveModel();m.register(0);m.buy(0,100n*W);
 m.sell(0,m.supply/4n);m.advance(12);
 const r=m.reserve,p=m.price(),pressure=m.pressureWad,last=m.lastPartialSellAt,q=m.sell(0,m.supply);
 assert.equal(q.gross,r);assert.equal(q.baseFee,0n);assert.equal(q.impactFee,0n);assert.equal(q.feeBps,0n);assert.equal(q.payout,r);
 assert.equal(m.reserve,0n);assert.equal(m.supply,0n);assert.equal(m.userHeld,0n);
 assert.equal(m.price(),p);assert.equal(m.lifecycleClosed,true);
 assert.equal(m.pressureWad,pressure);assert.equal(m.lastPartialSellAt,last);
 assert.throws(()=>m.buy(0,W),/restart policy pending/);
 assert.equal(m.cashIn-m.cashOut,m.unallocatedReserve);assert.equal(m.unallocatedReserve,5n*W);
});

test('global pressure accumulates across wallets, decays in five minutes, and buys or registrations never reset it',()=>{
 const m=new ReserveModel();m.register('a');m.register('b');m.buy('a',100n*W);m.buy('b',100n*W);
 m.advance(10);const first=m.sell('a',m.supply/5n);
 assert.equal(first.pressure,W/5n);assert.equal(first.impactBps,28n);
 const stored=m.pressureWad,last=m.lastPartialSellAt;
 m.register('c');m.buy('b',W);m.transfer('a','c',W);
 assert.equal(m.pressureWad,stored);assert.equal(m.lastPartialSellAt,last);assert.equal(m.currentSellPressure(),stored);
 const supply=m.supply,tokens=m.wallets.get('c').balance,expected=pressureAfterSale(tokens,supply,stored);
 m.sell('c',tokens);assert.equal(m.pressureWad,expected);assert(m.pressureWad>stored);
 const peak=m.pressureWad;m.advance(300);const half=m.currentSellPressure();
 assert(half<=peak/2n);assert(peak/2n-half<1000n);assert.equal(half,decayPressure(peak,300n));
 const snapshot=m.pressureWad,time=m.lastPartialSellAt;m.sell('b',W,{emergency:true});
 assert.equal(m.pressureWad,snapshot);assert.equal(m.lastPartialSellAt,time);
 m.advance(64n*300n);assert.equal(m.currentSellPressure(),0n);
 assert.equal(sellImpactBps(1n,2n,W),700n);
});

test('model dust rejection is atomic and zero transfer leaves state unchanged',()=>{
 const m=new ReserveModel();m.register(0,2000n);m.register(1);m.buy(0,500000n*W);
 const state=()=>[m.reserve,m.supply,m.userHeld,m.price(),m.cashIn,m.cashOut,m.pressureWad,m.lastPartialSellAt,...m.wallets.values()].map(x=>typeof x==='object'?{...x}:x);
 const before=state();
 for(const action of [()=>m.buy(0,2000000n),()=>m.sell(0,1000000n),()=>m.transfer(0,1,1000000n)]){
  assert.throws(action,/price step too small/);assert.deepEqual(state(),before);
 }
 assert.deepEqual(m.transfer(0,1,0n),{burned:0n,received:0n});assert.deepEqual(state(),before);
});


test('independent model: $500 pre-mint support stays protected after a sole buyer redeems only their $100',()=>{
 const m=new ReserveModel();for(let i=0;i<100;i++)m.register(i);
 assert.equal(m.reserve,0n);assert.equal(m.unallocatedReserve,500n*W);assert.equal(m.supply,0n);
 assert.deepEqual(m.buy(0,100n*W),{userMint:970n*W});
 assert.equal(m.reserve,100n*W);assert.equal(m.unallocatedReserve,500n*W);
 const final=m.sell(0,m.supply);assert.equal(final.payout,100n*W);
 assert.equal(m.reserve,0n);assert.equal(m.supply,0n);assert.equal(m.cashIn-m.cashOut,500n*W);
 assert.equal(m.unallocatedReserve,500n*W);assert(m.lifecycleClosed);
 assert.throws(()=>m.buy(1,W),/restart policy pending/);
});
