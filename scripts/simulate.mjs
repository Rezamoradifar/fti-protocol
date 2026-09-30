import {Protocol,W} from '../core/reference.mjs';
let seed=Number(process.argv[3]||42)>>>0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const count=Number(process.argv[2]||2000);if(!Number.isSafeInteger(count)||count<31||count>20000)throw Error('Wallets must be 31..20000');
const p=new Protocol();let buys=0,autoBuys=0,sells=0,rejected=0;const samples=[];
for(let i=0;i<count;i++){
 const units=BigInt(1+Math.floor(random()*5));p.register(units,i?Math.floor((i-1)/2):null);
 if(random()<.35){try{p.buy(i,BigInt(20+Math.floor(random()*380))*W);buys++;}catch(e){if(!['holding cap','allowance'].includes(e.message))throw e;rejected++;}}
 if((i+1)%100===0){p.settle();for(let j=0;j<=i;j++)if(p.members[j].rank>0&&p.members[j].pending>20n*W&&random()<.15){try{p.buy(j,p.members[j].pending*5n/100n,true);autoBuys++;}catch(e){if(e.message!=='holding cap')throw e;rejected++;}}samples.push({wallets:i+1,price:Number(p.token.price())/1e18,reserve:Number(p.token.reserve)/1e18});}
}
p.settle();p.month();for(let i=0;i<count;i++)p.claim(i);
// Stop all external inflows. Assume every holding/vesting deadline has elapsed.
for(const[id,balance]of p.token.balances)if(balance>0n){p.sell(id,balance);sells++;}
p.check();console.log(JSON.stringify({seed:Number(process.argv[3]||42),wallets:count,buys,autoBuys,sells,rejected,externalIn:p.externalIn.toString(),externalOut:p.externalOut.toString(),remainingContract1:p.cash.toString(),remainingContract2:p.token.cash.toString(),realSupplyAfterCompleteExit:p.token.supply.toString(),invariants:'passed exact BigInt accounting and k inequality',limitations:'All tokens assumed unlocked for final selloff. Reference is not EVM gas, lock or adversarial governance simulation.',samples},null,2));
