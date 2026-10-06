import test from 'node:test';
import assert from 'node:assert/strict';
import {ReserveModel,W,INITIAL_PRICE,buyQuote,sellQuote,baseFee,tradeFee,sellImpactBps} from '../core/reserve-reference.mjs';
import {simulateReserve} from '../scripts/simulate-reserve.mjs';

test('independent experimental arithmetic keeps backing across 300,000 wallets and unrestricted normal exits',()=>{
 const r=simulateReserve(300000);
 assert.equal(r.model,'real-reserve-v2-sizefee-floor-review');assert.equal(r.economics,'trade-size-only-500usd-or-5percent-threshold-3percent-base-7percent-provisional-surcharge');
 assert.equal(r.wallets,300000);assert.equal(r.buys,300000);
 assert(r.sells>=300000);assert(r.transfers>50000);assert.equal(r.finalUserCirculatingSupply,'0');
 assert.equal(BigInt(r.finalUnallocatedReserveUSDWei),5n*W);assert.equal(BigInt(r.finalActualUSDWei),5n*W);
 assert.equal(BigInt(r.finalTotalSupply),0n);assert.equal(BigInt(r.finalReserveUSDWei),0n);assert.equal(r.lifecycleClosed,true);
 assert(BigInt(r.finalPriceWad)>=BigInt(r.priceBeforeFinalExitWad));assert(BigInt(r.finalPriceWad)>0n);
 assert.equal(BigInt(r.cashInUSDWei)-BigInt(r.cashOutUSDWei),BigInt(r.finalReserveUSDWei)+BigInt(r.finalUnallocatedReserveUSDWei));
 assert(BigInt(r.largestBuyUSDWei)>=100000n*W);
 const observed=r.observedPriceTransitions,counts={buy:299999,sell:399965,transfer:59999};
 for(const [kind,accepted] of Object.entries(counts)){
  assert.equal(observed.ordinaryPositiveSupply[kind].accepted,accepted);
  assert.deepEqual(observed.ordinaryPositiveSupply[kind].displayed,{rise:accepted,equal:0,fall:0});
  assert.deepEqual(observed.ordinaryPositiveSupply[kind].exactReservePerShare,{rise:accepted,equal:0,fall:0});
 }
 assert.equal(observed.attemptedTradingOperations,759965);assert.equal(observed.bootstrapBuys,1);assert.equal(observed.normalTerminalSells,1);
 assert.equal(observed.emergencyPartialSells,0);assert.equal(observed.emergencyTerminalSells,0);
 assert.deepEqual(observed.rejectedAttempts,{total:0,byReason:{}});assert.equal(r.negativePriceTransitions,0);

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

test('integer quotes preserve the exact rational $500/5% threshold and one combined fee ceiling',()=>{
 const expectedFee=(v,r,s)=>{
  if(v===0n)return 0n;
  if(r===0n||s===0n)return baseFee(v);
  const tn=r>10000n*W?r:10000n*W,bn=20n*v>tn?20n*v-tn:0n;
  const denominator=40000n*v,numerator=1200n*v*v+7n*bn*bn;
  return (numerator+denominator-1n)/denominator;
 };
 const scale=[1n,100n,10000n,10n**18n,10000n*W+1n,10n**25n];let checked=0;
 for(const r of scale)for(const s of scale)for(const a of [34n,500n*W,500n*W+1n,10n**24n]){
  const p=r*W/s,u=buyQuote(a,r,s),f=expectedFee(a,r,s);
  assert.equal(tradeFee(a,r,s),f);assert.equal(u,p>0n?(a-f)*W/p:0n);
  for(const t of [s/100n,s/4n,s/2n])if(t){
   const normal=sellQuote(t,r,s),emergency=sellQuote(t,r,s,{emergency:true}),fee=expectedFee(t*r/s,r,s);
   assert.equal(normal.gross,t*r/s);assert.equal(normal.baseFee,baseFee(normal.gross));
   assert.equal(normal.impactBps,sellImpactBps(t,r,s));assert.equal(normal.feeBps,300n+normal.impactBps);
   assert.equal(normal.impactFee,fee-baseFee(normal.gross));assert.equal(normal.pressure,0n);
   assert.equal(normal.payout,normal.gross>fee?normal.gross-fee:0n);
   assert.equal(emergency.payout,emergency.gross);assert.equal(emergency.baseFee,0n);assert.equal(emergency.impactFee,0n);
   if(normal.payout){assert((r-normal.payout)*s>r*(s-t));checked++;}
   if(emergency.payout){assert((r-emergency.payout)*s>=r*(s-t));checked++;}
  }
 }
 assert(checked>300);
 const r=10000n*W+19n,v=500n*W+1n;assert.equal(tradeFee(v,r,W),baseFee(v));
 assert.equal(tradeFee(500000n*W,0n,0n),baseFee(500000n*W),'bootstrap remains base-only');
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

test('time and wallet history never enter fees; compatibility pressure views stay zero',()=>{
 const m=new ReserveModel();m.register('a',100n);m.register('b',100n);m.buy('a',10000n*W);m.buy('b',1000n*W);
 m.advance(10);m.sell('a',m.supply/5n);
 const q=m.wallets.get('b').balance/2n,before=sellQuote(q,m.reserve,m.supply),buyBefore=buyQuote(1000n*W,m.reserve,m.supply);
 for(const seconds of [1n,299n,300n,19200n,1000000n]){
  m.advance(seconds);assert.deepEqual(sellQuote(q,m.reserve,m.supply),before);assert.equal(buyQuote(1000n*W,m.reserve,m.supply),buyBefore);
  assert.equal(m.pressureWad,0n);assert.equal(m.lastPartialSellAt,0n);assert.equal(m.currentSellPressure(),0n);assert.equal(m.previewSellPressure(q),0n);
 }
 m.register('c');m.buy('b',W);m.transfer('a','c',W);m.sell('c',m.wallets.get('c').balance);
 assert.equal(m.pressureWad,0n);assert.equal(m.lastPartialSellAt,0n);
 const spent=m.wallets.get('b').spent,amount=100000n*W;
 m.buy('b',amount,{automatic:true});assert.equal(m.wallets.get('b').spent,spent,'automatic mint leaves manual gross quota unchanged');
 assert.throws(()=>m.buy('b',amount),/allowance/);
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
