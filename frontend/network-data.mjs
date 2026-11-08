const MAX_UINT256=(1n<<256n)-1n,ADDRESS=/^0x[0-9a-f]{40}$/i,ZERO='0x'+'0'.repeat(40);
function unsigned(value){
 if(!(typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value)||typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)))return null;
 try{const n=BigInt(value);return n>=0n&&n<=MAX_UINT256?n:null;}catch{return null;}
}
function memberField(member,name){const value=unsigned(member?.[name]);if(value===null)throw Error('Invalid membership field: '+name);return value;}
export function memberMetrics(member){
 const units=memberField(member,'units'),carryL=memberField(member,'carryL'),carryR=memberField(member,'carryR'),lifetimeL=memberField(member,'lifetimeL'),lifetimeR=memberField(member,'lifetimeR'),rank=memberField(member,'rank');
 if(rank>4n)throw Error('Invalid membership field: rank');
 return {units,contribution:units*100n,carryL,carryR,lifetimeL,lifetimeR,matchedCarry:carryL<carryR?carryL:carryR,balancedLifetime:lifetimeL<lifetimeR?lifetimeL:lifetimeR,rank:Number(rank)};
}

/** `memberCount()` counts wallet positions, including the initial genesis tree.
 * Buying more units changes a position's contribution, never this count. There
 * is no aggregate purchased-unit getter: do not substitute this wallet count.
 * Keep count and anchor together so callers can show where the number came from.
 */
export function networkPopulation(state,cfg={}){
 const empty={registeredWallets:null,genesisWallets:null,postGenesisWallets:null,block:null,timestamp:null};
 const count=unsigned(state?.count),block=unsigned(state?.block),time=unsigned(state?.timestamp);
 if(count===null||block===null||block>BigInt(Number.MAX_SAFE_INTEGER)||time===null||time===0n||time>BigInt(Number.MAX_SAFE_INTEGER))return empty;
 const result={...empty,registeredWallets:String(count),block:Number(block),timestamp:Number(time)};
 const genesis=cfg?.genesis;
 if(Array.isArray(genesis)&&genesis.length===31&&genesis.every(a=>typeof a==='string'&&ADDRESS.test(a)&&a.toLowerCase()!==ZERO)&&new Set(genesis.map(a=>a.toLowerCase())).size===genesis.length&&count>=BigInt(genesis.length)){
  result.genesisWallets=String(genesis.length);result.postGenesisWallets=String(count-BigInt(genesis.length));
 }
 return result;
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
