// Read-only, bounded pagination of wallet-address events exposed by the installed
// FTI ABIs. This is not an index of unrelated assets, native BNB transfers or
// internal calls. Every returned event is checked against its canonical receipt.
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {getAddress,isAddress,zeroPadValue} from 'ethers';

const HASH=/^0x[0-9a-f]{64}$/i,HEX=/^0x(?:[0-9a-f]{2})*$/i;
const validTime=n=>Number.isSafeInteger(n)&&n>0&&n<=8640000000000;
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const lower=v=>typeof v==='string'?v.toLowerCase():'';
const at=log=>log.index??log.logIndex;
const fail=message=>{throw Object.assign(Error(message),{code:'MEMBER_HISTORY_UNAVAILABLE'});};
async function settled(tasks){const results=await Promise.allSettled(tasks);const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;return results.map(result=>result.value);}
function abortable(task,signal){
 if(!signal)return task;
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
  task.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}
// Slots are held until the underlying provider request settles, including when
// its HTTP caller cancels. Repeated cancelled pages cannot burst RPC concurrency.
function rpcPool(){
 let active=0;const waiting=[];
 const release=()=>{while(waiting.length){const next=waiting.shift();next.signal?.removeEventListener('abort',next.abort);if(next.signal?.aborted){next.reject(next.signal.reason);continue;}next.resolve();return;}active--;};
 async function acquire(signal){
  signal?.throwIfAborted();if(active<4){active++;return;}
  await new Promise((resolve,reject)=>{const item={resolve,reject,signal,abort:null};item.abort=()=>{const at=waiting.indexOf(item);if(at>=0)waiting.splice(at,1);reject(signal.reason);};waiting.push(item);signal?.addEventListener('abort',item.abort,{once:true});});
 }
 return async(task,signal)=>{await acquire(signal);const result=Promise.resolve().then(()=>{signal?.throwIfAborted();return task();}).finally(release);return abortable(result,signal);};
}
const invalid=()=>{throw Object.assign(Error('Invalid or expired history cursor. Start a new search.'),{code:'INVALID_HISTORY_CURSOR'});};
const sameLog=(a,b)=>lower(a.address)===lower(b.address)&&lower(a.data)===lower(b.data)&&at(a)===at(b)&&a.blockNumber===b.blockNumber&&lower(a.blockHash)===lower(b.blockHash)&&lower(a.transactionHash)===lower(b.transactionHash)&&Array.isArray(b.topics)&&a.topics.length===b.topics.length&&a.topics.every((x,i)=>lower(x)===lower(b.topics[i]));
function signature(key,body){return createHmac('sha256',key).update(body).digest();}
function cursorCodec(key,context,now){return {
 encode(value){const body=Buffer.from(JSON.stringify({...value,context})).toString('base64url');return body+'.'+signature(key,body).toString('base64url');},
 decode(value){
  if(typeof value!=='string'||value.length>1600||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(value))invalid();
  const [body,mac]=value.split('.'),received=Buffer.from(mac,'base64url'),expected=signature(key,body);
  if(received.length!==expected.length||!timingSafeEqual(received,expected))invalid();
  let d;try{d=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));}catch{invalid();}
  if(!d||d.v!==1||d.context!==context||!isAddress(d.wallet)||!integer(d.anchor?.number)||!HASH.test(d.anchor?.hash||'')||!integer(d.nextBlock)||d.nextBlock>d.anchor.number||!(d.afterIndex===null||integer(d.afterIndex))||!integer(d.expiresAt)||d.expiresAt<=now())invalid();
  return d;
 }
};}
function eventFilters(contract,wallet){
 const groups=new Map(),unindexed=[];
 for(const event of contract.interface.fragments.filter(f=>f.type==='event'&&!f.anonymous)){
  let position=0,hasUnindexed=false;
  for(const input of event.inputs){
   if(input.indexed)position++;
   if(input.type!=='address')continue;
   if(!input.indexed){hasUnindexed=true;continue;}
   if(!groups.has(position))groups.set(position,new Set());groups.get(position).add(event.topicHash);
  }
  if(hasUnindexed)unindexed.push(event.topicHash);
 }
 const filters=[];
 for(const [position,topics]of groups){const filter=Array(position+1).fill(null);filter[0]=[...topics];filter[position]=zeroPadValue(wallet,32);filters.push(filter);}
 if(unindexed.length)filters.push([unindexed]);
 return filters;
}

export function createMemberHistoryReader({provider,eventProvider=provider,contracts,cfg,now=()=>Date.now(),cursorSecret=randomBytes(32)}){
 if(!provider||!eventProvider||!integer(cfg?.chainId)||cfg.chainId===0||!integer(cfg.deployedBlock))throw Error('A verified deployment block and chain are required for member history');
 const configured=['binary','token'].map(name=>{const c=contracts?.[name];if(!c?.interface||!isAddress(c.target))throw Error('Invalid member history contracts');return {name,contract:c,address:lower(c.target)};});
 const context=JSON.stringify([cfg.chainId,cfg.deployedBlock,...configured.map(c=>c.address)]),codec=cursorCodec(cursorSecret,context,now);
 let activeRequests=0;const rpc=rpcPool();
 return async function read({wallet,cursor=null,limit=50}={},signal){
  if(!isAddress(wallet)||/^0x0{40}$/i.test(wallet))throw Object.assign(Error('Invalid wallet address'),{code:'INVALID_HISTORY_WALLET'});
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw Object.assign(Error('History page limit must be 1 through 50'),{code:'INVALID_HISTORY_LIMIT'});
  wallet=getAddress(wallet);signal?.throwIfAborted();signal=signal?AbortSignal.any([signal,AbortSignal.timeout(18000)]):AbortSignal.timeout(18000);
  // Prevent anonymous readers from creating an unbounded queue of expensive RPC work.
  if(activeRequests>=2)throw Object.assign(Error('History reader is busy. Retry shortly.'),{code:'MEMBER_HISTORY_BUSY'});
  activeRequests++;
  let calls=0;
  async function checked(task){
   signal.throwIfAborted();if(++calls>240)fail('History RPC request budget exceeded');
   const result=await rpc(task,signal);signal.throwIfAborted();return result;
  }
  try{
   const networks=await settled([checked(()=>provider.getNetwork()),...(eventProvider===provider?[]:[checked(()=>eventProvider.getNetwork())])]);
   if(networks.some(n=>BigInt(n.chainId)!==BigInt(cfg.chainId)))fail('Wrong member history network');
   let position;
   if(cursor){position=codec.decode(cursor);if(lower(position.wallet)!==lower(wallet)||position.nextBlock<cfg.deployedBlock)invalid();}
   else{
    const head=await checked(()=>provider.getBlock('latest'));
    if(!head||!integer(head.number)||!HASH.test(head.hash||'')||!validTime(head.timestamp))fail('Invalid member history head');
    if(cfg.chainId===56&&(now()/1000-head.timestamp>45||head.timestamp-now()/1000>15))fail('Stale member history head');
    const to=head.number-(cfg.chainId===56?12:0);
    if(to<cfg.deployedBlock)fail('Deployment does not yet have enough confirmations');
    const anchor=await checked(()=>provider.getBlock(to));
    if(!anchor||anchor.number!==to||!HASH.test(anchor.hash||''))fail('Missing member history anchor');
    position={v:1,wallet,anchor:{number:to,hash:lower(anchor.hash)},nextBlock:to,afterIndex:null,expiresAt:now()+30*60*1000};
   }
   const canonicalAnchor=await checked(()=>provider.getBlock(position.anchor.number));
   if(!canonicalAnchor||canonicalAnchor.number!==position.anchor.number||lower(canonicalAnchor.hash)!==position.anchor.hash)fail('History anchor changed. Start a new search.');
   if(eventProvider!==provider){const anchor=await checked(()=>eventProvider.getBlock(position.anchor.number));if(!anchor||anchor.number!==position.anchor.number||lower(anchor.hash)!==position.anchor.hash)fail('Member history source anchor mismatch');}
   const to=position.nextBlock,from=Math.max(cfg.deployedBlock,to-999),records=new Map(),blockHashes=new Map();
   const filters=configured.flatMap(c=>eventFilters(c.contract,wallet).map(topics=>({...c,topics})));
   let logCalls=0;
   async function range(filter,lo,hi){
    if(++logCalls>100)fail('Member history log request budget exceeded');
    let logs;
    try{logs=await checked(()=>eventProvider.getLogs({address:filter.contract.target,topics:filter.topics,fromBlock:lo,toBlock:hi}));}
    catch(e){signal?.throwIfAborted();const message=[e?.message,e?.shortMessage,e?.error?.message,e?.info?.error?.message].filter(Boolean).join(' ');if(lo<hi&&/(?:block\s*range|range).*(?:limit|too (?:large|wide)|exceed)|too many (?:logs|results)|query returned more than|(?:log |response )size.*(?:limit|exceed)/i.test(message)){const mid=Math.floor((lo+hi)/2);await range(filter,mid+1,hi);await range(filter,lo,mid);return;}throw e;}
    if(!Array.isArray(logs)||logs.length>5000)fail('Invalid member history log batch');
    for(const log of logs){
     if(lower(log.address)!==filter.address||!integer(log.blockNumber)||log.blockNumber<lo||log.blockNumber>hi||log.removed||!integer(at(log))||!HASH.test(log.transactionHash||'')||!HASH.test(log.blockHash||'')||!HEX.test(log.data||'')||!Array.isArray(log.topics)||log.topics.length>4||!log.topics.every(x=>HASH.test(x))||!filter.topics.every((v,i)=>v===null||(Array.isArray(v)?v:[v]).some(x=>lower(x)===lower(log.topics[i]))))fail('Invalid member history log');
     const priorHash=blockHashes.get(log.blockNumber);if(priorHash&&priorHash!==lower(log.blockHash))fail('Conflicting member history block');blockHashes.set(log.blockNumber,lower(log.blockHash));
     let parsed;try{parsed=filter.contract.interface.parseLog(log);}catch{fail('Undecodable member history event');}
     if(!parsed)fail('Undecodable member history event');
     if(!parsed.fragment.inputs.some((input,i)=>input.type==='address'&&lower(parsed.args[i])===lower(wallet)))continue;
     if(position.afterIndex!==null&&log.blockNumber===to&&at(log)>=position.afterIndex)continue;
     const key=lower(log.transactionHash)+':'+at(log),prior=records.get(key);
     if(prior){if(!sameLog(prior.log,log))fail('Conflicting duplicate member history event');continue;}
     if(records.size>=5000)fail('Member history result budget exceeded');
     records.set(key,{log,contract:filter.name,parsed});
    }
   }
   // Each page covers at most 1,000 blocks; 100-block ranges work with the
   // deployed history provider. At most four requests are in flight.
   for(let hi=to;hi>=from;hi-=100){const lo=Math.max(from,hi-99);await settled(filters.map(filter=>range(filter,lo,hi)));}
   const ordered=[...records.values()].sort((a,b)=>b.log.blockNumber-a.log.blockNumber||at(b.log)-at(a.log)),selected=ordered.slice(0,limit);
   const receipts=new Map(),blocks=new Map();
   async function verify(item){
    const log=item.log,tx=lower(log.transactionHash);
    if(!receipts.has(tx))receipts.set(tx,checked(()=>provider.getTransactionReceipt(log.transactionHash)));
    const receipt=await receipts.get(tx);
    if(!receipt||receipt.status!==1||lower(receipt.hash??receipt.transactionHash)!==tx||receipt.blockNumber!==log.blockNumber||lower(receipt.blockHash)!==lower(log.blockHash)||!Array.isArray(receipt.logs)||!receipt.logs.some(other=>sameLog(log,other)))fail('Member history receipt mismatch');
    if(!blocks.has(log.blockNumber))blocks.set(log.blockNumber,checked(()=>provider.getBlock(log.blockNumber)));
    const block=await blocks.get(log.blockNumber);
    if(!block||block.number!==log.blockNumber||lower(block.hash)!==lower(log.blockHash)||!validTime(block.timestamp))fail('Noncanonical member history event');
    return {name:item.parsed.name,contract:item.contract,block:log.blockNumber,index:at(log),hash:log.transactionHash,timestamp:block.timestamp,args:item.parsed.fragment.inputs.map((input,i)=>({name:input.name,value:typeof item.parsed.args[i]==='bigint'?item.parsed.args[i].toString():item.parsed.args[i]}))};
   }
   const rows=await settled(selected.map(verify));
   const recheck=await checked(()=>provider.getBlock(position.anchor.number));if(!recheck||recheck.number!==position.anchor.number||lower(recheck.hash)!==position.anchor.hash)fail('History anchor changed. Start a new search.');
   let nextCursor=null;
   if(ordered.length>limit){const last=selected[selected.length-1].log;nextCursor=codec.encode({...position,nextBlock:last.blockNumber,afterIndex:at(last)});}
   else if(from>cfg.deployedBlock)nextCursor=codec.encode({...position,nextBlock:from-1,afterIndex:null});
   return {version:1,scope:'FTI_CONTRACT_ADDRESS_EVENTS',wallet,chainId:cfg.chainId,snapshot:position.anchor,range:{from,to,deployedBlock:cfg.deployedBlock,complete:nextCursor===null},rows,nextCursor};
  }finally{activeRequests--;}
 };
}
