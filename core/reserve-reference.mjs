// Independent BigInt arithmetic model for FTI Token V2.
// No EVM, RPC, binary reward settlement, gas market or identity/Sybil model.
export const W=10n**18n;
export const BASE_FEE_BPS=300n, ANIMAL_BPS=100n, MAX_IMPACT_BPS=700n;
const ceil=(a,b)=>(a+b-1n)/b;
export const feeBps=(amount,bps)=>ceil(amount*bps,10000n);
export const baseFee=amount=>feeBps(amount,BASE_FEE_BPS);
export const animalValue=amount=>feeBps(amount,ANIMAL_BPS);

export function buyQuote(amount,reserve,supply){
 const userAssets=amount-baseFee(amount);
 if(amount<=0n||userAssets<=0n)return 0n;
 return supply===0n?userAssets:userAssets*supply/reserve;
}
export function animalBuyQuote(amount,reserve,supply){
 const assets=animalValue(amount);
 return supply===0n?assets:assets*supply/reserve;
}
export function sellImpactBps(tokens,supply){
 if(tokens<=0n||supply<=0n)return 0n;
 const size=ceil(tokens*10000n,supply);
 if(size<=100n)return 0n;
 if(size<=500n)return (size-100n)*300n/400n;
 const extra=300n+(size-500n)*400n/500n;
 return extra>MAX_IMPACT_BPS?MAX_IMPACT_BPS:extra;
}
export function sellQuote(tokens,reserve,supply,{emergency=false}={}){
 if(tokens<=0n||supply<=0n||tokens>supply)return {gross:0n,payout:0n,baseFee:0n,impactFee:0n,impactBps:0n};
 const gross=tokens*reserve/supply;
 const base=baseFee(gross),impactBps=emergency?0n:sellImpactBps(tokens,supply),impact=feeBps(gross,impactBps);
 const payout=gross>base+impact?gross-base-impact:0n;
 return {gross,payout,baseFee:base,impactFee:impact,impactBps};
}

export class ReserveModel {
 constructor(){
  this.reserve=0n;this.supply=0n;this.userHeld=0n;this.animalSupply=0n;
  this.wallets=new Map();this.cashIn=0n;this.cashOut=0n;this.checks=0;
 }
 price(){return this.supply?this.reserve*W/this.supply:0n;}
 register(id,units=1n){
  if(this.wallets.has(id)||units<=0n)throw Error('registration');
  this.wallets.set(id,{units,balance:0n,spent:0n});
  const oldR=this.reserve,oldS=this.supply,amount=units*5n*W;
  this.reserve+=amount;this.cashIn+=amount;
  this.check(oldR,oldS,oldS>0n);
 }
 check(oldR=this.reserve,oldS=this.supply,strict=false){
  if(this.reserve!==this.cashIn-this.cashOut)throw Error('cash');
  if(this.supply!==this.userHeld+this.animalSupply)throw Error('shares');
  if(this.reserve<0n||this.supply<0n||this.reserve>10n**30n||this.supply>10n**36n)throw Error('bounds');
  if(oldS>0n){
   const lhs=this.reserve*oldS,rhs=oldR*this.supply;
   if(strict?lhs<=rhs:lhs<rhs)throw Error('price growth');
  }
  if(this.supply>0n&&this.userHeld*this.reserve/this.supply>this.reserve)throw Error('redemption backing');
  this.checks++;
 }
 buy(id,amount){
  const w=this.wallets.get(id);if(!w||amount<=0n)throw Error('buy');
  const allowance=w.units*500n*W;if(w.spent+amount>allowance)throw Error('allowance');
  const userMint=buyQuote(amount,this.reserve,this.supply),animalMint=animalBuyQuote(amount,this.reserve,this.supply);
  if(userMint<1000000n)throw Error('dust');
  const r=this.reserve,s=this.supply;
  this.reserve+=amount;this.cashIn+=amount;
  this.supply+=userMint+animalMint;this.userHeld+=userMint;this.animalSupply+=animalMint;
  w.balance+=userMint;w.spent+=amount;
  this.check(r,s,s>0n);
  return {userMint,animalMint};
 }
 sell(id,tokens,{emergency=false}={}){
  const w=this.wallets.get(id);if(!w||tokens<=0n||tokens>w.balance)throw Error('balance');
  if(!emergency&&ceil(tokens*10000n,this.supply)>500n)throw Error('anti-whale tx cap');
  const q=sellQuote(tokens,this.reserve,this.supply,{emergency});if(q.payout<=0n)throw Error('dust');
  const r=this.reserve,s=this.supply;
  const support=animalValue(q.gross),animalMint=support*s/r;
  w.balance-=tokens;this.userHeld-=tokens;
  this.supply=this.supply-tokens+animalMint;this.animalSupply+=animalMint;
  this.reserve-=q.payout;this.cashOut+=q.payout;
  this.check(r,s,true);
  return {...q,animalMint};
 }
 transfer(from,to,amount){
  const a=this.wallets.get(from),b=this.wallets.get(to);
  if(!a||!b||from===to||amount<=0n||amount>a.balance)throw Error('transfer');
  const r=this.reserve,s=this.supply;
  a.balance-=amount;b.balance+=amount;
  this.check(r,s,false);
 }
}
