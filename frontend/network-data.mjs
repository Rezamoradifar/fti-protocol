export function memberMetrics(member){
 const units=BigInt(member.units),carryL=BigInt(member.carryL),carryR=BigInt(member.carryR),lifetimeL=BigInt(member.lifetimeL),lifetimeR=BigInt(member.lifetimeR);
 return {units,contribution:units*100n,carryL,carryR,lifetimeL,lifetimeR,matchedCarry:carryL<carryR?carryL:carryR,balancedLifetime:lifetimeL<lifetimeR?lifetimeL:lifetimeR,rank:Number(member.rank)};
}
export function missingHistoricalState(error){return /missing trie node|historical state|state.*unavailable/i.test(JSON.stringify(error?.info?.error||{})+' '+(error?.message||''));}
export async function readTreeMember(binary,address,context){
 try{return await binary.members(address,{blockTag:context.approximate?'latest':context.blockTag});}
 catch(error){
  if(!context.approximate&&missingHistoricalState(error)){
   context.approximate=true;
   return binary.members(address,{blockTag:'latest'});
  }
  throw error;
 }
}
