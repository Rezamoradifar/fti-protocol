// Independent BigInt arithmetic model. No EVM, locks, RPC or binary reward settlement.
export const W=10n**18n, INITIAL_PRICE=W/10n, CAP_REFERENCE=1000000n*W;
const ceil=(a,b)=>(a+b-1n)/b;
export const fee=amount=>ceil(amount*3n,100n);
export const buyQuote=(amount,reserve,supply)=>(amount-fee(amount))*supply/reserve;
export const sellQuote=(tokens,reserve,supply)=>{const gross=tokens*reserve/supply;return {gross,fee:fee(gross),payout:gross-fee(gross)};};
export class ReserveModel {
 constructor(){this.reserve=0n;this.anchor=0n;this.supply=0n;this.held=0n;this.wallets=new Map();this.cashIn=0n;this.cashOut=0n;this.checks=0;}
 price(){return this.supply?this.reserve*W/this.supply:INITIAL_PRICE;}
 check(oldR,oldS){if(oldS&&this.reserve*oldS<=oldR*this.supply)throw Error('price growth');if(this.reserve!==this.cashIn-this.cashOut)throw Error('cash');if(this.supply!==this.anchor+this.held)throw Error('shares');if(this.reserve>10n**30n||this.supply>10n**36n)throw Error('bounds');if(sellQuote(this.held,this.reserve,this.supply).gross>this.reserve)throw Error('redemption backing');this.checks++;}
 register(id,units=1n){if(this.wallets.has(id))throw Error('duplicate');const amount=units*5n*W,oldR=this.reserve,oldS=this.supply;this.wallets.set(id,{units,balance:0n,spent:0n});this.reserve+=amount;this.cashIn+=amount;if(!this.supply){this.anchor=amount*W/INITIAL_PRICE;this.supply=this.anchor;}this.check(oldR,oldS);}
 room(id){const w=this.wallets.get(id);const available=CAP_REFERENCE+this.held-100n*w.balance;return available>0n?available/99n:0n;}
 buy(id,amount){const w=this.wallets.get(id),minted=buyQuote(amount,this.reserve,this.supply);if(amount<=0n||minted<1000000n)throw Error('dust');if(w.spent+amount>w.units*500n*W)throw Error('allowance');if(minted>this.room(id))throw Error('holding cap');const r=this.reserve,s=this.supply;this.reserve+=amount;this.cashIn+=amount;this.supply+=minted;this.held+=minted;w.balance+=minted;w.spent+=amount;this.check(r,s);return minted;}
 sell(id,tokens){const w=this.wallets.get(id);if(tokens<=0n||tokens>w.balance)throw Error('balance');const {payout}=sellQuote(tokens,this.reserve,this.supply);if(!payout)throw Error('dust');const r=this.reserve,s=this.supply;w.balance-=tokens;this.supply-=tokens;this.held-=tokens;this.reserve-=payout;this.cashOut+=payout;this.check(r,s);return payout;}
 transfer(from,to,amount){const a=this.wallets.get(from),b=this.wallets.get(to),burn=fee(amount),received=amount-burn;if(from===to||amount>a.balance||received<=0n)throw Error('transfer');if((b.balance+received)*100n>CAP_REFERENCE+this.held-burn)throw Error('holding cap');const r=this.reserve,s=this.supply;a.balance-=amount;b.balance+=received;this.supply-=burn;this.held-=burn;this.check(r,s);}
}
