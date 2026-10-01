import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {ReserveModel,W,buyQuote} from '../core/reserve-reference.mjs';
export function simulateReserve(count=300000){
 if(!Number.isSafeInteger(count)||count<100||count>300000)throw Error('Wallet count must be 100..300000');
 const m=new ReserveModel();let seed=20261001,buys=0,sells=0,transfers=0,limitedOrders=0,largestBuy=0n,largestSale=0n;
 const rnd=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return Math.floor((seed>>>0)/4294967296*n);};
 for(let i=0;i<count;i++){
  const whale=i>0&&i%10000===0;m.register(i,whale?1000n:1n);
  let amount=(whale?500000n:BigInt(10+rnd(491)))*W;
  while(buyQuote(amount,m.reserve,m.supply)>m.room(i)){amount/=2n;limitedOrders++;}
  m.buy(i,amount);buys++;if(amount>largestBuy)largestBuy=amount;
  if(i>0&&i%3===0){const id=rnd(i),b=m.wallets.get(id).balance;if(b>10n**9n){const q=m.sell(id,b/4n);sells++;if(q>largestSale)largestSale=q;}}
  if(i>0&&i%5===0){const from=rnd(i),to=i,amount=m.wallets.get(from).balance/10n;if(amount>100n){m.transfer(from,to,amount);transfers++;}}
 }
 const beforeExitPrice=m.price();
 // No more token funding or purchases during this complete exit.
 for(let i=count-1;i>=0;i--){const b=m.wallets.get(i).balance;if(b){const q=m.sell(i,b);sells++;if(q>largestSale)largestSale=q;}}
 if(m.held!==0n||m.supply!==m.anchor)throw Error('incomplete exit');
 if([...m.wallets.values()].some(w=>w.balance!==0n))throw Error('wallet not empty');
 const result={wallets:count,buys,sells,transfers,checks:m.checks,limitedOrderHalvings:limitedOrders,largestBuyUSDWei:String(largestBuy),largestSaleUSDWei:String(largestSale),priceBeforeFinalExitWad:String(beforeExitPrice),finalPriceWad:String(m.price()),cashInUSDWei:String(m.cashIn),cashOutUSDWei:String(m.cashOut),finalReserveUSDWei:String(m.reserve),finalCirculatingSupply:'0',nonRedeemableAnchorShares:String(m.anchor),allUserTokensSold:true,negativePriceTransitions:0,unfundedPayouts:0,scope:'BigInt arithmetic simulation; all user locks assumed mature. Not a 300k-account EVM/RPC throughput or binary-settlement load test.'};
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const result=simulateReserve(Number(process.argv[2]||300000));if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));}
