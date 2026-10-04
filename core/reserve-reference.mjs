// Independent BigInt arithmetic model for the experimental integrated token candidate.
// Explicit integer-second clock and global pressure; no EVM/RPC or binary reward settlement.
export const W=10n**18n;
export const INITIAL_PRICE=W/10n;
export const BASE_FEE_BPS=300n, TRANSFER_BURN_BPS=300n;
export const MAX_IMPACT_BPS=700n, PRESSURE_HALF_LIFE=300n;
export const PRESSURE_DECAY_PER_SECOND=997692176527023318n;
const ceil=(a,b)=>(a+b-1n)/b;
export const feeBps=(amount,bps)=>ceil(amount*bps,10000n);
export const baseFee=amount=>feeBps(amount,BASE_FEE_BPS);

export function buyQuote(amount,reserve,supply,referencePrice=INITIAL_PRICE){
 const userAssets=amount-baseFee(amount);
 if(amount<=0n||userAssets<=0n)return 0n;
 const prePrice=supply===0n?referencePrice:reserve*W/supply;
 return prePrice>0n?userAssets*W/prePrice:0n;
}
// WAD powers are floored at every multiplication, matching integer on-chain semantics.
export function decayPressure(pressure,elapsed){
 if(pressure<0n||pressure>W||elapsed<0n)throw Error('pressure');
 if(elapsed>=64n*PRESSURE_HALF_LIFE)return 0n;
 let factor=W,base=PRESSURE_DECAY_PER_SECOND,n=elapsed;
 while(n>0n){
  if(n%2n===1n)factor=factor*base/W;
  n/=2n;
  if(n>0n)base=base*base/W;
 }
 return pressure*factor/W;
}
export function pressureAfterSale(tokens,supply,pressure=0n){
 if(pressure<0n||pressure>W||tokens<0n||tokens>supply||supply<=0n)throw Error('pressure input');
 return W-(W-pressure)*(supply-tokens)/supply;
}
export function sellImpactBps(tokens,supply,pressure=0n){
 if(tokens<=0n||supply<=0n||tokens>=supply)return 0n;
 const next=pressureAfterSale(tokens,supply,pressure);
 return MAX_IMPACT_BPS*(next*next/W)/W;
}
export function sellQuote(tokens,reserve,supply,{emergency=false,pressure=0n}={}){
 if(tokens<=0n||supply<=0n||tokens>supply)return {gross:0n,payout:0n,baseFee:0n,impactFee:0n,impactBps:0n,feeBps:0n,pressure};
 const gross=tokens*reserve/supply;
 if(emergency||tokens===supply)return {gross,payout:gross,baseFee:0n,impactFee:0n,impactBps:0n,feeBps:0n,pressure};
 const impactBps=sellImpactBps(tokens,supply,pressure),bps=BASE_FEE_BPS+impactBps;
 // Round the combined fee once; separate ceilings would overcharge by up to one wei.
 const fee=feeBps(gross,bps),base=baseFee(gross);
 return {gross,payout:gross>fee?gross-fee:0n,baseFee:base,impactFee:fee-base,impactBps,feeBps:bps,pressure:pressureAfterSale(tokens,supply,pressure)};
}

export class ReserveModel {
 constructor(){
  this.reserve=0n;this.unallocatedReserve=0n;this.supply=0n;this.userHeld=0n;
  this.referencePrice=INITIAL_PRICE;this.lifecycleClosed=false;
  this.now=0n;this.pressureWad=0n;this.lastPartialSellAt=0n;
  this.wallets=new Map();this.cashIn=0n;this.cashOut=0n;this.checks=0;
 }
 price(){return this.supply?this.reserve*W/this.supply:this.referencePrice;}
 currentSellPressure(){return decayPressure(this.pressureWad,this.now-this.lastPartialSellAt);}
 advance(seconds){const n=BigInt(seconds);if(n<0n)throw Error('time');this.now+=n;}
 previewSellPressure(tokens){return pressureAfterSale(tokens,this.supply,this.currentSellPressure());}
 register(id,units=1n){
  if(this.wallets.has(id)||units<=0n)throw Error('registration');
  this.wallets.set(id,{units,balance:0n,spent:0n});
  const oldR=this.reserve,oldS=this.supply,amount=units*5n*W;
  // Support without outstanding shares has no authorized owner. Keep it outside live backing.
  if(oldS===0n)this.unallocatedReserve+=amount;else this.reserve+=amount;
  this.cashIn+=amount;
  this.check(oldR,oldS,oldS>0n);
 }
 check(oldR=this.reserve,oldS=this.supply,strict=false){
  if(this.reserve+this.unallocatedReserve!==this.cashIn-this.cashOut)throw Error('cash');
  if(this.unallocatedReserve<0n)throw Error('protected cash');
  if(this.supply!==this.userHeld)throw Error('shares');
  if(this.reserve<0n||this.supply<0n||this.reserve+this.unallocatedReserve>10n**30n||this.supply>10n**36n)throw Error('bounds');
  if(oldS>0n){
   const lhs=this.reserve*oldS,rhs=oldR*this.supply;
   if(strict?lhs<=rhs:lhs<rhs)throw Error('price growth');
  }
  if(this.supply>0n&&this.userHeld*this.reserve/this.supply>this.reserve)throw Error('redemption backing');
  this.checks++;
 }
 requireGrowth(newR,newS){
  if(this.supply<=0n||newS<=0n)throw Error('supply');
  if(newR*this.supply<=this.reserve*newS)throw Error('price must increase');
  if(newR*W/newS<=this.price())throw Error('price step too small');
 }
 buy(id,amount){
  if(this.lifecycleClosed)throw Error('restart policy pending');
  const w=this.wallets.get(id);if(!w||amount<=0n)throw Error('buy');
  const allowance=w.units*500n*W;if(w.spent+amount>allowance)throw Error('allowance');
  const userMint=buyQuote(amount,this.reserve,this.supply,this.referencePrice);
  if(userMint<1000000n)throw Error('dust');
  const r=this.reserve,s=this.supply,newR=r+amount,newS=s+userMint;
  if(newR+this.unallocatedReserve>10n**30n||newS>10n**36n)throw Error('bounds');
  if(s>0n)this.requireGrowth(newR,newS);
  else if(newR*W/newS<=this.referencePrice)throw Error('price step too small');
  this.reserve=newR;this.cashIn+=amount;
  this.supply=newS;this.userHeld+=userMint;
  w.balance+=userMint;w.spent+=amount;
  this.check(r,s,s>0n);
  return {userMint};
 }
 sell(id,tokens,{emergency=false}={}){
  const w=this.wallets.get(id);if(!w||tokens<=0n||tokens>w.balance)throw Error('balance');
  const finalRedemption=tokens===this.supply;
  const q=sellQuote(tokens,this.reserve,this.supply,{emergency,pressure:this.currentSellPressure()});if(q.payout<=0n)throw Error('dust');
  const r=this.reserve,s=this.supply,oldPrice=this.price(),newR=r-q.payout,newS=s-tokens;
  if(!emergency&&!finalRedemption)this.requireGrowth(newR,newS);
  w.balance-=tokens;this.userHeld-=tokens;
  this.supply=newS;this.reserve=newR;this.cashOut+=q.payout;
  if(finalRedemption){this.referencePrice=oldPrice;this.lifecycleClosed=true;}
  else if(!emergency){this.pressureWad=q.pressure;this.lastPartialSellAt=this.now;}
  this.check(r,s,!emergency&&!finalRedemption);
  return q;
 }
 transfer(from,to,amount){
  const a=this.wallets.get(from),b=this.wallets.get(to);
  if(!a||!b||amount<0n||amount>a.balance)throw Error('transfer');
  if(amount===0n)return {burned:0n,received:0n};
  const burned=feeBps(amount,TRANSFER_BURN_BPS),received=amount-burned;
  if(received<=0n)throw Error('transfer dust');
  const r=this.reserve,s=this.supply;
  this.requireGrowth(r,s-burned);
  a.balance-=amount;b.balance+=received;
  this.supply-=burned;this.userHeld-=burned;
  this.check(r,s,true);
  return {burned,received};
 }
}
