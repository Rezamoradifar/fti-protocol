import assert from 'node:assert/strict';
// submit(method,args) must await the confirmed transaction, not just broadcast.
export async function sellUnlocked({wallet,token,usd,submit,now}){
 const address=await wallet.getAddress();const amount=await token.unlocked(address);
 if(amount===0n){const locks=await token.lockInfo(address);return {status:'PENDING',reason:'No unlocked tokens',locks:locks.map(l=>({clock:l.clock.toString(),deadline:l.deadline.toString()}))};}
 const tokenBefore=await token.balanceOf(address),usdBefore=await usd.balanceOf(address);
 const [quote]=await token.quoteSell(amount);assert(quote>0n,'Zero sell quote');
 const minUSD=quote*995n/1000n;
 await submit('sell',[amount,minUSD,(await now())+1200]);
 const tokenAfter=await token.balanceOf(address),usdAfter=await usd.balanceOf(address);
 assert.equal(tokenBefore-tokenAfter,amount,'Sell did not burn the expected tokens');
 assert(usdAfter-usdBefore>=minUSD,'Sell proceeds below minimum');
 return {status:'PASS',sold:amount.toString(),receivedUSD:(usdAfter-usdBefore).toString()};
}
