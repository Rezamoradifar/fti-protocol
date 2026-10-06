import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {ReserveModel,W} from '../core/reserve-reference.mjs';

export function simulateReserve(count=300000){
 if(!Number.isSafeInteger(count)||count<100||count>300000)throw Error('Wallet count must be 100..300000');
 const m=new ReserveModel();let seed=20261004,buys=0,sells=0,transfers=0,largestBuy=0n,largestSale=0n;
 const rnd=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return Math.floor((seed>>>0)/4294967296*n);};
 const transitionBucket=()=>({accepted:0,displayed:{rise:0,equal:0,fall:0},exactReservePerShare:{rise:0,equal:0,fall:0}});
 const observed={
  attemptedTradingOperations:0,ordinaryPositiveSupply:{buy:transitionBucket(),sell:transitionBucket(),transfer:transitionBucket()},
  bootstrapBuys:0,normalTerminalSells:0,emergencyPartialSells:0,emergencyTerminalSells:0,
  rejectedAttempts:{total:0,byReason:{}},
  scope:'Accepted normal buys, partial sells and positive transfers with positive supply before and after. Bootstrap and terminal states have no two-sided live R/S and are counted separately. Registration support injections are excluded. Rejections are separate; invariant checks are not the denominator. No probability estimate or exhaustive guarantee.'
 };
 const compare=(after,before)=>after>before?'rise':after<before?'fall':'equal';
 function observe(kind,action,{emergency=false}={}){
  observed.attemptedTradingOperations++;
  const oldR=m.reserve,oldS=m.supply,oldP=m.price();let result;
  try{result=action();}catch(error){
   observed.rejectedAttempts.total++;const reason=String(error.message);observed.rejectedAttempts.byReason[reason]=(observed.rejectedAttempts.byReason[reason]??0)+1;throw error;
  }
  if(kind==='buy'&&oldS===0n)observed.bootstrapBuys++;
  else if(kind==='sell'&&emergency){if(m.supply===0n)observed.emergencyTerminalSells++;else observed.emergencyPartialSells++;}
  else if(kind==='sell'&&m.supply===0n)observed.normalTerminalSells++;
  else if(oldS>0n&&m.supply>0n){
   const bucket=observed.ordinaryPositiveSupply[kind];bucket.accepted++;
   bucket.displayed[compare(m.price(),oldP)]++;
   bucket.exactReservePerShare[compare(m.reserve*oldS,oldR*m.supply)]++;
  }
  return result;
 }


 for(let i=0;i<count;i++){
  const whale=i>0&&i%10000===0;
  m.advance(1); // Passage of time does not affect trade-size-only fees.
  m.register(i,whale?1000n:1n);
  const amount=(whale?500000n:BigInt(10+rnd(491)))*W;
  observe('buy',()=>m.buy(i,amount));buys++;if(amount>largestBuy)largestBuy=amount;

  if(i>100&&i%3===0){
   const id=rnd(i),b=m.wallets.get(id).balance;
   if(b>10n**9n){
    const amount=b/20n; // No hard supply/hour cap; only this trade's size sets its fee.
    if(amount>0n){const q=observe('sell',()=>m.sell(id,amount));sells++;if(q.payout>largestSale)largestSale=q.payout;}
   }
  }
  if(i>0&&i%5===0){
   const from=rnd(i),to=i,amount=m.wallets.get(from).balance/10n;
   if(amount>100n){observe('transfer',()=>m.transfer(from,to,amount));transfers++;}
  }
 }

 const beforeExitPrice=m.price();
 // Normal unrestricted exits: trade-size-only fee on partials, exact remaining reserve on final exit.
 let finalReferencePrice=beforeExitPrice;
 for(let i=count-1;i>=0;i--){
  const b=m.wallets.get(i).balance;
  if(b){if(b===m.supply)finalReferencePrice=m.price();const q=observe('sell',()=>m.sell(i,b));sells++;if(q.payout>largestSale)largestSale=q.payout;}
 }
 if(m.userHeld!==0n||m.supply!==0n)throw Error('incomplete user exit');
 if([...m.wallets.values()].some(w=>w.balance!==0n))throw Error('wallet not empty');
 if(m.reserve!==0n)throw Error('normal final redemption not fully drained');
 if(m.cashIn-m.cashOut!==m.reserve+m.unallocatedReserve)throw Error('protected cash reconciliation');
 if(m.price()!==finalReferencePrice||m.price()<=0n||!m.lifecycleClosed)throw Error('terminal reference');
 const result={
  model:'real-reserve-v2-sizefee-floor-review',economics:'trade-size-only-500usd-or-5percent-threshold-3percent-base-7percent-provisional-surcharge',
  wallets:count,buys,sells,transfers,checks:m.checks,observedPriceTransitions:observed,
  largestBuyUSDWei:String(largestBuy),largestSaleUSDWei:String(largestSale),
  priceBeforeFinalExitWad:String(beforeExitPrice),finalPriceWad:String(m.price()),
  cashInUSDWei:String(m.cashIn),cashOutUSDWei:String(m.cashOut),finalReserveUSDWei:String(m.reserve),
  finalUnallocatedReserveUSDWei:String(m.unallocatedReserve),finalActualUSDWei:String(m.reserve+m.unallocatedReserve),
  finalUserCirculatingSupply:'0',finalTotalSupply:String(m.supply),lifecycleClosed:m.lifecycleClosed,
  allUserTokensSold:true,negativePriceTransitions:Object.values(observed.ordinaryPositiveSupply).reduce((sum,bucket)=>sum+bucket.displayed.fall,0),unfundedPayouts:0,
  scope:'BigInt token-accounting simulation only. Live buys and partial sells charge ceil(3% V + 7% B^2/(B+T)), T=max($500,5% pretrade live reserve), B=max(V-T,0), with exact fractional-atom threshold and one combined ceiling. The 7% coefficient remains provisional. Bootstrap buys retain the base-only exception. No global pressure, time decay or wallet history. Final normal and all emergency sales are fee-free. Protected price-protection-fund cash stays outside live reserve, and restart remains review-gated. This model does not establish binary settlement equivalence, EVM/RPC throughput, gas, identity/Sybil safety or legal conclusions.'
 };
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=simulateReserve(Number(process.argv[2]||300000));
 if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
}
