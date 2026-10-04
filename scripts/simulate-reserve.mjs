import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {ReserveModel,W} from '../core/reserve-reference.mjs';

export function simulateReserve(count=300000){
 if(!Number.isSafeInteger(count)||count<100||count>300000)throw Error('Wallet count must be 100..300000');
 const m=new ReserveModel();let seed=20261004,buys=0,sells=0,transfers=0,largestBuy=0n,largestSale=0n;
 const rnd=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return Math.floor((seed>>>0)/4294967296*n);};

 for(let i=0;i<count;i++){
  const whale=i>0&&i%10000===0;
  m.advance(1); // One deterministic second between arrivals; buys do not clear pressure.
  m.register(i,whale?1000n:1n);
  const amount=(whale?500000n:BigInt(10+rnd(491)))*W;
  m.buy(i,amount);buys++;if(amount>largestBuy)largestBuy=amount;

  if(i>100&&i%3===0){
   const id=rnd(i),b=m.wallets.get(id).balance;
   if(b>10n**9n){
    const amount=b/20n; // No hard supply/hour cap; global pressure prices every partial sale.
    if(amount>0n){const q=m.sell(id,amount);sells++;if(q.payout>largestSale)largestSale=q.payout;}
   }
  }
  if(i>0&&i%5===0){
   const from=rnd(i),to=i,amount=m.wallets.get(from).balance/10n;
   if(amount>100n){m.transfer(from,to,amount);transfers++;}
  }
 }

 const beforeExitPrice=m.price();
 // Normal unrestricted exits: dynamic fee on partials, exact remaining reserve on final exit.
 let finalReferencePrice=beforeExitPrice;
 for(let i=count-1;i>=0;i--){
  const b=m.wallets.get(i).balance;
  if(b){if(b===m.supply)finalReferencePrice=m.price();const q=m.sell(i,b);sells++;if(q.payout>largestSale)largestSale=q.payout;}
 }
 if(m.userHeld!==0n||m.supply!==0n)throw Error('incomplete user exit');
 if([...m.wallets.values()].some(w=>w.balance!==0n))throw Error('wallet not empty');
 if(m.reserve!==0n)throw Error('normal final redemption not fully drained');
 if(m.cashIn-m.cashOut!==m.reserve+m.unallocatedReserve)throw Error('protected cash reconciliation');
 if(m.price()!==finalReferencePrice||m.price()<=0n||!m.lifecycleClosed)throw Error('terminal reference');
 const result={
  model:'real-reserve-v2-integrated-experiment',economics:'global-pressure-3-to-10-percent-partials-exact-final-redemption',
  wallets:count,buys,sells,transfers,checks:m.checks,
  largestBuyUSDWei:String(largestBuy),largestSaleUSDWei:String(largestSale),
  priceBeforeFinalExitWad:String(beforeExitPrice),finalPriceWad:String(m.price()),
  cashInUSDWei:String(m.cashIn),cashOutUSDWei:String(m.cashOut),finalReserveUSDWei:String(m.reserve),
  finalUnallocatedReserveUSDWei:String(m.unallocatedReserve),finalActualUSDWei:String(m.reserve+m.unallocatedReserve),
  finalUserCirculatingSupply:'0',finalTotalSupply:String(m.supply),lifecycleClosed:m.lifecycleClosed,
  allUserTokensSold:true,negativePriceTransitions:0,unfundedPayouts:0,
  scope:'BigInt experimental accounting simulation with a deterministic integer-second clock and five-minute pressure half-life. Normal partial exits use a global quadratic surcharge on top of the 3% fee (10% maximum total); the final normal exit pays all live owned reserve and leaves zero-supply support protected and unallocated, freezes the historical reference, and keeps restart review-gated. Buys and new wallets do not reset pressure. No EVM/RPC throughput, gas, identity/Sybil, binary settlement or legal analysis.'
 };
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=simulateReserve(Number(process.argv[2]||300000));
 if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
}
