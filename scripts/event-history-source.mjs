import {readMarket} from './market-reader.mjs';
import {readEvents} from './event-reader.mjs';
export const PUBLIC_EVENT_RPC='https://bsc-rpc.publicnode.com';
class IntegrityError extends Error {}
const fail=message=>{throw new IntegrityError(message);};
const lower=value=>typeof value==='string'?value.toLowerCase():'';
const hash=value=>/^0x[0-9a-f]{64}$/i.test(value||'');
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const index=log=>log.index??log.logIndex;
function availability(error){
 const seen=new Set();let available=false;
 for(let e=error;e&&!seen.has(e);e=e.cause){
  seen.add(e);if(e instanceof IntegrityError||e.name==='AbortError')return false;
  const message=[e.message,e.shortMessage,e.error?.message,e.info?.error?.message].filter(Boolean).join(' ');
  if(/unavailable|rate.?limit|quota|missing trie|prun|disabled|not supported|not available|timeout|timed out|network|fetch failed|connection|socket|server error|bad response|403|429|502|503|504/i.test(message))available=true;
  if(['NETWORK_ERROR','SERVER_ERROR','TIMEOUT','BAD_DATA'].includes(e.code)||[-32000,-32005,-32601].includes(e.code))available=true;
 }
 return available;
}
export function createEventHistoryReader({primary,eventProvider=primary,fallbackProvider,contracts,cfg}){
 let active=0;const queue=[];
 async function checked(signal,task){
  signal?.throwIfAborted();
  await new Promise(resolve=>{if(active<4){active++;resolve();}else queue.push(resolve);});
  try{signal?.throwIfAborted();const result=await task();signal?.throwIfAborted();return result;}
  finally{const next=queue.shift();if(next)next();else active--;}
 }
 const load=(kind,provider,from,to,signal)=>kind==='market'?readMarket(provider,contracts.token,from,to,{signal}):readEvents(provider,{binary:contracts.binary,token:contracts.token},from,to,80,{signal});
 return async function read(kind,signal){
  if(!['market','events'].includes(kind))throw Error('Unknown history kind');
  const count=kind==='market'?300:1500;
  if(Number(cfg.chainId)!==56){
   const network=await checked(signal,()=>eventProvider.getNetwork());
   if(BigInt(network.chainId)!==BigInt(cfg.chainId))fail('Wrong history network');
   const latest=await checked(signal,()=>eventProvider.getBlockNumber());
   return load(kind,eventProvider,Math.max(cfg.deployedBlock||0,latest-count+1),latest,signal);
  }
  const network=await checked(signal,()=>primary.getNetwork());
  if(BigInt(network.chainId)!==56n)fail('Wrong primary history network');
  const head=await checked(signal,()=>primary.getBlock('latest'));
  const now=Date.now()/1000;
  if(!head||!integer(head.number)||head.number===0||!hash(head.hash)||!integer(head.timestamp)||head.timestamp<=0||now-head.timestamp>45||head.timestamp-now>15)fail('Stale or invalid primary history head');
  const deployed=cfg.deployedBlock||0;
  if(!integer(deployed)||deployed>head.number)fail('Invalid history deployment block');
  const to=Math.max(deployed,head.number-12),from=Math.max(deployed,to-count+1);
  const anchor=await checked(signal,()=>primary.getBlock(to));
  if(!anchor||anchor.number!==to||!hash(anchor.hash))fail('Missing primary history anchor');
  async function identify(source){
   const n=await checked(signal,()=>source.getNetwork());
   if(BigInt(n.chainId)!==56n)fail('Wrong history source network');
   const block=await checked(signal,()=>source.getBlock(to));
   if(!block||block.number!==to||lower(block.hash)!==lower(anchor.hash))fail('History source anchor mismatch');
  }
  const receipts=new Map(),blocks=new Map(),expectedHashes=new Map();
  async function canonicalBlock(number,expected){
   if(!blocks.has(number))blocks.set(number,checked(signal,()=>primary.getBlock(number)));
   const block=await blocks.get(number);signal?.throwIfAborted();
   if(!block||block.number!==number||!hash(block.hash)||!integer(block.timestamp)||block.timestamp<=0||(expected&&lower(block.hash)!==lower(expected)))fail('Noncanonical history block');
   return block;
  }
  const sameLog=(a,b)=>lower(a.address)===lower(b.address)&&lower(a.data)===lower(b.data)&&index(a)===index(b)&&a.blockNumber===b.blockNumber&&lower(a.blockHash)===lower(b.blockHash)&&lower(a.transactionHash)===lower(b.transactionHash)&&Array.isArray(a.topics)&&a.topics.length===b.topics.length&&a.topics.every((t,i)=>lower(t)===lower(b.topics[i]));
  async function verify(log){
   const tx=lower(log.transactionHash);
   if(!receipts.has(tx)){
    if(receipts.size>=100)fail('History receipt budget exceeded');
    receipts.set(tx,checked(signal,()=>primary.getTransactionReceipt(log.transactionHash)));
   }
   const receipt=await receipts.get(tx);signal?.throwIfAborted();
   if(!receipt||receipt.status!==1||lower(receipt.hash??receipt.transactionHash)!==tx||receipt.blockNumber!==log.blockNumber||lower(receipt.blockHash)!==lower(log.blockHash)||!Array.isArray(receipt.logs)||!receipt.logs.some(item=>sameLog(item,log)))fail('History receipt mismatch');
   await canonicalBlock(log.blockNumber,log.blockHash);signal?.throwIfAborted();
  }
  function wrapper(source,verifyReceipts){const seen=new Map();return {
   async getLogs(filter){
    const logs=await checked(signal,()=>source.getLogs(filter));
    if(!Array.isArray(logs))fail('Invalid history logs');
    const addresses=(Array.isArray(filter.address)?filter.address:[filter.address]).map(lower),unique=[];
    for(const log of logs){
     if(!addresses.includes(lower(log.address))||!integer(log.blockNumber)||log.blockNumber<filter.fromBlock||log.blockNumber>filter.toBlock||log.blockNumber<from||log.blockNumber>to||log.removed||!integer(index(log))||!hash(log.transactionHash)||!hash(log.blockHash)||!/^0x(?:[0-9a-f]{2})*$/i.test(log.data||'')||!Array.isArray(log.topics)||!log.topics.every(hash))fail('Invalid history log filter or range');
     if(filter.topics&&!filter.topics.every((topic,i)=>topic==null||(Array.isArray(topic)?topic:[topic]).some(t=>lower(t)===lower(log.topics[i]))))fail('History log topic mismatch');
     const expected=expectedHashes.get(log.blockNumber);if(expected&&expected!==lower(log.blockHash))fail('Conflicting history block hashes');
     expectedHashes.set(log.blockNumber,lower(log.blockHash));
     const key=lower(log.transactionHash)+':'+index(log),prior=seen.get(key);
     if(prior){if(!sameLog(prior,log))fail('Conflicting duplicate history log');}else{seen.set(key,log);unique.push(log);}
    }
    if(verifyReceipts){
     let cursor=0;
     await Promise.all(Array.from({length:Math.min(4,unique.length)},async()=>{while(cursor<unique.length){await verify(unique[cursor++]);signal?.throwIfAborted();}}));
     signal?.throwIfAborted();
    }
    return unique;
   },
   getBlock:number=>canonicalBlock(number,expectedHashes.get(number))
  };}
  await identify(eventProvider);
  let result;
  try{result=await load(kind,wrapper(eventProvider,false),from,to,signal);signal?.throwIfAborted();}
  catch(error){
   signal?.throwIfAborted();
   if(!fallbackProvider||!availability(error))throw error;
   await identify(fallbackProvider);
   result=await load(kind,wrapper(fallbackProvider,true),from,to,signal);signal?.throwIfAborted();
  }
  const canonical=await checked(signal,()=>primary.getBlock(to));
  if(!canonical||canonical.number!==to||lower(canonical.hash)!==lower(anchor.hash))fail('History anchor changed');
  return result;
 };
}
