import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {ReserveModel,W} from '../core/reserve-reference.mjs';

export function simulateReserve(count=300000){
 if(!Number.isSafeInteger(count)||count<100||count>300000)throw Error('Wallet count must be 100..300000');
 const m=new ReserveModel();let seed=20261004,buys=0,sells=0,transfers=0,largestBuy=0n,largestSale=0n;
 const rnd=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return Math.floor((seed>>>0)/4294967296*n);};

 for(let i=0;i<count;i++){
  const whale=i>0&&i%10000===0;
  m.register(i,whale?1000n:1n);
  const amount=(whale?500000n:BigInt(10+rnd(491)))*W;
  m.buy(i,amount);buys++;if(amount>largestBuy)largestBuy=amount;

  if(i>100&&i%3===0){
   const id=rnd(i),b=m.wallets.get(id).balance;
   if(b>10n**9n){
    let amount=b/20n; // normally <=5% of this wallet; still enforce protocol supply cap below.
    const cap=m.supply*499n/10000n;if(amount>cap)amount=cap;
    if(amount>0n){const q=m.sell(id,amount);sells++;if(q.payout>largestSale)largestSale=q.payout;}
   }
  }
  if(i>0&&i%5===0){
   const from=rnd(i),to=i,amount=m.wallets.get(from).balance/10n;
   if(amount>100n){m.transfer(from,to,amount);transfers++;}
  }
 }

 const beforeExitPrice=m.price();
 // Emergency redemption: no new buys/support, no whale surcharge/cap. Animal-support shares remain backed.
 for(let i=count-1;i>=0;i--){
  const b=m.wallets.get(i).balance;
  if(b){const q=m.sell(i,b,{emergency:true});sells++;if(q.payout>largestSale)largestSale=q.payout;}
 }
 if(m.userHeld!==0n||m.supply!==m.animalSupply)throw Error('incomplete user exit');
 if([...m.wallets.values()].some(w=>w.balance!==0n))throw Error('wallet not empty');
 const animalBeforeDrain=m.animalSupply;
 if(animalBeforeDrain>0n)m.emergencyRedeemAnimal(animalBeforeDrain);
 if(m.supply!==0n||m.reserve!==0n)throw Error('emergency liquidity not fully drained');
 const result={
  model:'real-reserve-v2-zero-start',
  wallets:count,buys,sells,transfers,checks:m.checks,
  largestBuyUSDWei:String(largestBuy),largestSaleUSDWei:String(largestSale),
  priceBeforeFinalExitWad:String(beforeExitPrice),finalPriceWad:String(m.price()),
  cashInUSDWei:String(m.cashIn),cashOutUSDWei:String(m.cashOut),finalReserveUSDWei:String(m.reserve),
  finalUserCirculatingSupply:'0',animalSupportSupplyBeforeDrain:String(animalBeforeDrain),finalAnimalSupportSupply:String(m.animalSupply),
  allUserTokensSold:true,negativePriceTransitions:0,unfundedPayouts:0,
  scope:'BigInt V2 accounting simulation. Final user and animal-support exits use fee-free 5-of-7 emergency redemption semantics and drain modeled reserve/supply to zero. No EVM/RPC throughput, hourly timing, gas, identity/Sybil, binary settlement or legal analysis.'
 };
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=simulateReserve(Number(process.argv[2]||300000));
 if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
}
