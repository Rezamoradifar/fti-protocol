// All values are atomic integer units. This checks finalized event evidence,
// not market prices or balances from a later hour.
export function auditHourlySettlement({pool,points,pointValue,allocations,pooled}){
 const check=(ok,message)=>{if(!ok)throw Error(message);};
 for(const value of [pool,points,pointValue])check(typeof value==='bigint'&&value>=0n,'Invalid hourly totals');
 const wallets=new Set();let paid=0n,allocated=0n,recipients=0n;
 for(const row of allocations){
  check(typeof row.wallet==='string'&&!wallets.has(row.wallet.toLowerCase()),'Duplicate hourly recipient');
  wallets.add(row.wallet.toLowerCase());
  check(typeof row.cash==='bigint'&&row.cash>=0n&&typeof row.automatic==='bigint'&&row.automatic>=0n,'Invalid reward allocation');
  const gross=row.cash+row.automatic;allocated+=gross;
  if(pooled){
   check(typeof row.points==='bigint'&&row.points>=0n,'Missing finalized wallet points');
   paid+=row.points;if(row.points>0n)recipients++;
   check(gross===(points===0n?0n:pool*row.points/points),'Wallet reward differs from its hourly pool share');
  }
 }
 check(allocated<=pool,'Hourly allocation exceeds the frozen pool');
 if(pooled){
  check(paid===points,'Incomplete hourly recipient evidence');
  check(pointValue===(points===0n?0n:pool/points),'Point value differs from frozen pool / eligible points');
  check(points===0n?allocated===0n:pool-allocated<recipients,'Undistributed pool exceeds rounding dust');
 }else{
  check(pointValue===(points===0n?0n:allocated/points),'Legacy point value differs from actual allocation');
  check(points===0n||pointValue>=20n*10n**18n,'Legacy paid point below gross floor');
 }
 return {model:pooled?'hourly-global-pool-v2':'legacy-credit',allocated:String(allocated),carry:String(pool-allocated),eligiblePoints:String(points),checked:true};
}
