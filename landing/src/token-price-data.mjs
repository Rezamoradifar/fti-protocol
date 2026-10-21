// Reviewed FTIReserveTokenUpgradeable zero-argument uint256 getters.
export const TOKEN_PRICE_SELECTORS=Object.freeze({price:'0xa035b1fe',supply:'0x18160ddd',reserve:'0xcd3293de',support:'0xebda404b'});
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const quantity=value=>typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);
const safe=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid price block.');return n;};
const uint=value=>{if(!hash(value))throw Error('Invalid token price response.');return BigInt(value);};
function block(value){
 if(!value||!quantity(value.number)||!quantity(value.timestamp)||!hash(value.hash))throw Error('Token price block could not be verified.');
 const timestamp=safe(BigInt(value.timestamp));
 if(timestamp===0)throw Error('Token price block timestamp could not be verified.');
 return {number:safe(BigInt(value.number)),tag:value.number,hash:value.hash.toLowerCase(),timestamp};
}
export function tokenPriceSupported(config){
 return config?.chainId===56&&config.mode==='bnb-mainnet'&&config.tokenContract==='FTIReserveTokenUpgradeable'&&
  typeof config.token==='string'&&config.token.toLowerCase()==='0x43755b1e813b2d41f669ea08bcf859de07195ea1'&&
  typeof config.usd==='string'&&config.usd.toLowerCase()==='0x55d398326f99059ff775485246999027b3197955';
}
export async function readTokenPrice(config,{fetchImpl=globalThis.fetch,signal,timeoutMs=10000}={}){
 if(!tokenPriceSupported(config))throw Error('Token price is not supported by this deployment.');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw Error('Invalid token price timeout.');
 const controller=new AbortController(),abort=()=>controller.abort();
 if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,timeoutMs);
 async function batch(calls){
  if(controller.signal.aborted)throw Error('Token price reading was cancelled or timed out.');
  const response=await fetchImpl('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal:controller.signal,body:JSON.stringify(calls.map(call=>({jsonrpc:'2.0',...call})))});
  if(!response.ok)throw Error('Token price is unavailable.');
  const rows=await response.json();
  if(!Array.isArray(rows)||rows.length!==calls.length)throw Error('Incomplete token price response.');
  const values=new Map();
  for(const row of rows){
   if(!row||row.jsonrpc!=='2.0'||!calls.some(call=>call.id===row.id)||values.has(row.id)||row.error||!Object.hasOwn(row,'result'))throw Error('Token price could not be verified.');
   values.set(row.id,row.result);
  }
  return values;
 }
 try{
  const initial=await batch([{id:1,method:'eth_chainId',params:[]},{id:2,method:'eth_getBlockByNumber',params:['latest',false]}]);
  if(!quantity(initial.get(1))||BigInt(initial.get(1))!==56n)throw Error('Wrong token price network.');
  const observed=block(initial.get(2)),names=Object.keys(TOKEN_PRICE_SELECTORS);
  const results=await batch(names.map((name,index)=>({id:10+index,method:'eth_call',params:[{to:config.token,data:TOKEN_PRICE_SELECTORS[name]},observed.tag]})));
  const values=Object.fromEntries(names.map((name,index)=>[name,uint(results.get(10+index))]));
  const final=await batch([{id:30,method:'eth_chainId',params:[]},{id:31,method:'eth_getBlockByNumber',params:[observed.tag,false]}]);
  if(!quantity(final.get(30))||BigInt(final.get(30))!==56n)throw Error('Wrong token price network.');
  const canonical=block(final.get(31));
  if(canonical.number!==observed.number||canonical.hash!==observed.hash||canonical.timestamp!==observed.timestamp)throw Error('Token price block changed. Refresh to retry.');
  if(values.price!==(values.supply===0n?0n:values.reserve*10n**18n/values.supply))throw Error('Token reserve and price do not match.');
  return {chainId:56,token:config.token,block:observed.number,blockHash:observed.hash,timestamp:observed.timestamp,
   priceWei:values.supply===0n?null:String(values.price),supplyWei:String(values.supply),reserveWei:String(values.reserve),supportWei:String(values.support)};
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
