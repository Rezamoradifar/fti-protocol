// Public, read-only pool data. Selectors are the reviewed
// FundedBinaryPlanUpgradeable ABI's zero-argument uint256/uint8 getters.
export const HOURLY_POOL_SELECTORS=Object.freeze({
 pointPool:'0x965a21d4',epoch:'0x900cf0cf',epochEnd:'0x4bb6b58f',phase:'0xb1c9fe6e',
 frozenPool:'0xeb44bb04',totalPaidPoints:'0x11671cef',pointValue:'0x9f6c6bf5',lastClosedAt:'0x73d93415',
});
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const quantity=value=>typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);
function uint(value){if(typeof value!=='string'||!/^0x[0-9a-f]{64}$/i.test(value))throw Error('Invalid hourly pool contract response.');return BigInt(value);}
function safe(value){const number=Number(value);if(!Number.isSafeInteger(number)||number<0)throw Error('Invalid hourly pool block or time.');return number;}
function block(value){
 if(!value||!quantity(value.number)||!quantity(value.timestamp)||!hash(value.hash))throw Error('Hourly pool block could not be verified.');
 return {number:safe(BigInt(value.number)),tag:value.number,hash:value.hash.toLowerCase(),timestamp:safe(BigInt(value.timestamp))};
}
export function hourlyPoolSupported(config){
 return config?.chainId===56&&config.mode==='bnb-mainnet'&&config.binaryContract==='FundedBinaryPlanUpgradeable'&&
  config.tokenContract==='FTIReserveTokenUpgradeable'&&config.poolDistributionVersion===1&&
  typeof config.binary==='string'&&/^0x[0-9a-f]{40}$/i.test(config.binary);
}

export async function readHourlyPool(config,{fetchImpl=globalThis.fetch,signal,timeoutMs=10000}={}){
 if(!hourlyPoolSupported(config))throw Error('The hourly pool is not supported by this deployment.');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw Error('Invalid hourly pool timeout.');
 const controller=new AbortController(),abort=()=>controller.abort();
 if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,timeoutMs);
 async function batch(calls){
  if(controller.signal.aborted)throw Error('Hourly pool reading was cancelled or timed out.');
  const response=await fetchImpl('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal:controller.signal,
   body:JSON.stringify(calls.map(call=>({jsonrpc:'2.0',...call})))});
  if(!response.ok)throw Error('Hourly pool RPC is unavailable.');
  const rows=await response.json();
  if(!Array.isArray(rows)||rows.length!==calls.length)throw Error('Incomplete hourly pool response.');
  const values=new Map();
  for(const row of rows){
   if(!row||row.jsonrpc!=='2.0'||!calls.some(call=>call.id===row.id)||values.has(row.id)||row.error||!Object.hasOwn(row,'result'))throw Error('Hourly pool RPC could not verify all requested data.');
   values.set(row.id,row.result);
  }
  return values;
 }
 try{
  const initial=await batch([{id:1,method:'eth_chainId',params:[]},{id:2,method:'eth_getBlockByNumber',params:['latest',false]}]);
  if(!quantity(initial.get(1))||BigInt(initial.get(1))!==56n)throw Error('Hourly pool RPC is on a different network.');
  const observed=block(initial.get(2)),names=Object.keys(HOURLY_POOL_SELECTORS);
  const results=await batch(names.map((name,index)=>({id:10+index,method:'eth_call',params:[{to:config.binary,data:HOURLY_POOL_SELECTORS[name]},observed.tag]})));
  const values=Object.fromEntries(names.map((name,index)=>[name,uint(results.get(10+index))]));
  // Pin all values to one block, then reject a reorg or an upstream network
  // change rather than presenting a mixture as a final hourly result.
  const final=await batch([{id:30,method:'eth_chainId',params:[]},{id:31,method:'eth_getBlockByNumber',params:[observed.tag,false]}]);
  if(!quantity(final.get(30))||BigInt(final.get(30))!==56n)throw Error('Hourly pool RPC is on a different network.');
  const canonical=block(final.get(31));
  if(canonical.number!==observed.number||canonical.hash!==observed.hash||canonical.timestamp!==observed.timestamp)throw Error('Hourly pool block changed. Refresh to retry.');
  const phase=safe(values.phase),end=safe(values.epochEnd),closedAt=safe(values.lastClosedAt);
  if(values.epoch<1n||phase>2||end===0||end%3600!==0||closedAt>observed.timestamp||closedAt%3600!==0)throw Error('Inconsistent hourly pool state.');
  let settled=null;
  // Open-phase getters retain the previous completed epoch. During matching
  // and allocation they are partial/current and must not be called "settled".
  if(phase===0&&values.epoch>1n&&closedAt>0){
   const points=values.totalPaidPoints,pool=values.frozenPool,value=values.pointValue;
   if(value!==(points===0n?0n:pool/points))throw Error('The settled hourly point value could not be verified.');
   settled={epoch:String(values.epoch-1n),poolWei:String(pool),points:String(points),pointValueWei:points===0n?null:String(value),closedAt};
  }
  return {chainId:56,binary:config.binary,block:observed.number,blockHash:observed.hash,timestamp:observed.timestamp,
   current:{epoch:String(values.epoch),poolWei:String(values.pointPool),end,timestamp:observed.timestamp,phase},settled};
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
