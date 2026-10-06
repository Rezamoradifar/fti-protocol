// Independent BigInt arithmetic model for the local trade-size-only fee review.
// USD and FTI have 18 decimals. This does not model binary reward settlement.
export const W=10n**18n;
export const INITIAL_PRICE=W/10n;
export const BASE_FEE_BPS=300n, TRANSFER_BURN_BPS=300n;
export const MAX_IMPACT_BPS=700n, LARGE_TRADE_MIN_USD=500n*W;
// Legacy pressure constants/views remain disabled compatibility surfaces.
export const PRESSURE_HALF_LIFE=0n, PRESSURE_DECAY_PER_SECOND=0n;
const ceil=(a,b)=>(a+b-1n)/b;
export const feeBps=(amount,bps)=>ceil(amount*bps,10000n);
export const baseFee=amount=>feeBps(amount,BASE_FEE_BPS);
export const thresholdTimes20=reserve=>reserve>20n*LARGE_TRADE_MIN_USD?reserve:20n*LARGE_TRADE_MIN_USD;
export function tradeFee(value,reserve,supply){
 if(value<=0n)return 0n;
 if(reserve===0n||supply===0n)return baseFee(value); // Explicit bootstrap exception.
 // T=max($500,R/20), B=max(V-T,0). Keep T and B as rational atoms.
 const t20=thresholdTimes20(reserve),b20=20n*value>t20?20n*value-t20:0n;
 if(b20===0n)return baseFee(value);
 // ceil(3V/100 + 7B^2/(100(B+T))); combine before the sole ceiling.
 return ceil(3n*value*20n*(b20+t20)+7n*b20*b20,100n*20n*(b20+t20));
}
export function buyQuote(amount,reserve,supply,referencePrice=INITIAL_PRICE){
 const userAssets=amount-tradeFee(amount,reserve,supply);
 if(amount<=0n||userAssets<=0n)return 0n;
 const prePrice=supply===0n?referencePrice:reserve*W/supply;
 return prePrice>0n?userAssets*W/prePrice:0n;
}
export function decayPressure(){return 0n;}
export function pressureAfterSale(tokens,supply){
 if(tokens<0n||tokens>supply)throw Error('supply');
 return 0n;
}
// Truncated indicative average surcharge, never used to reconstruct the fee.
export function sellImpactBps(tokens,reserve,supply){
 if(tokens<=0n||supply<=0n||tokens>=supply)return 0n;
 const value=tokens*reserve/supply,t20=thresholdTimes20(reserve),b20=20n*value>t20?20n*value-t20:0n;
 return value>0n?MAX_IMPACT_BPS*b20*b20/(400n*value*value):0n;
}
export function sellQuote(tokens,reserve,supply,{emergency=false}={}){
 if(tokens<=0n||supply<=0n||tokens>supply)return {gross:0n,payout:0n,baseFee:0n,impactFee:0n,impactBps:0n,feeBps:0n,pressure:0n};
 const gross=tokens*reserve/supply;
 if(emergency||tokens===supply)return {gross,payout:gross,baseFee:0n,impactFee:0n,impactBps:0n,feeBps:0n,pressure:0n};
 const totalFee=tradeFee(gross,reserve,supply),base=baseFee(gross),impactBps=sellImpactBps(tokens,reserve,supply);
 return {gross,payout:gross>totalFee?gross-totalFee:0n,baseFee:base,impactFee:totalFee-base,impactBps,feeBps:BASE_FEE_BPS+impactBps,pressure:0n};
}

export class ReserveModel {
 constructor(){
  this.reserve=0n;this.unallocatedReserve=0n;this.supply=0n;this.userHeld=0n;
  this.referencePrice=INITIAL_PRICE;this.lifecycleClosed=false;
  this.now=0n;
  this.wallets=new Map();this.cashIn=0n;this.cashOut=0n;this.checks=0;
 }
 price(){return this.supply?this.reserve*W/this.supply:this.referencePrice;}
 get priceProtectionFund(){return this.unallocatedReserve;}
 get pressureWad(){return 0n;}
 get lastPartialSellAt(){return 0n;}
 currentSellPressure(){return 0n;}
 advance(seconds){const n=BigInt(seconds);if(n<0n)throw Error('time');this.now+=n;}
 previewSellPressure(tokens){return pressureAfterSale(tokens,this.supply);}
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
 buy(id,amount,{automatic=false}={}){
  if(this.lifecycleClosed)throw Error('restart policy pending');
  const w=this.wallets.get(id);if(!w||amount<=0n)throw Error('buy');
  const allowance=w.units*500n*W;if(!automatic&&w.spent+amount>allowance)throw Error('allowance');
  const userMint=buyQuote(amount,this.reserve,this.supply,this.referencePrice);
  if(userMint<1000000n)throw Error('dust');
  const r=this.reserve,s=this.supply,newR=r+amount,newS=s+userMint;
  if(newR+this.unallocatedReserve>10n**30n||newS>10n**36n)throw Error('bounds');
  if(s>0n)this.requireGrowth(newR,newS);
  else if(newR*W/newS<=this.referencePrice)throw Error('price step too small');
  this.reserve=newR;this.cashIn+=amount;
  this.supply=newS;this.userHeld+=userMint;
  w.balance+=userMint;if(!automatic)w.spent+=amount;
  this.check(r,s,s>0n);
  return {userMint};
 }
 sell(id,tokens,{emergency=false}={}){
  const w=this.wallets.get(id);if(!w||tokens<=0n||tokens>w.balance)throw Error('balance');
  const finalRedemption=tokens===this.supply;
  const q=sellQuote(tokens,this.reserve,this.supply,{emergency});if(q.payout<=0n)throw Error('dust');
  const r=this.reserve,s=this.supply,oldPrice=this.price(),newR=r-q.payout,newS=s-tokens;
  if(!emergency&&!finalRedemption)this.requireGrowth(newR,newS);
  w.balance-=tokens;this.userHeld-=tokens;
  this.supply=newS;this.reserve=newR;this.cashOut+=q.payout;
  if(finalRedemption){this.referencePrice=oldPrice;this.lifecycleClosed=true;}
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
