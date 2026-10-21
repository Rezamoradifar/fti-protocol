import {approvedGenesisLayout} from './approved-genesis-layout.mjs';
import {firstOpenSlot,ZERO_ADDRESS} from '../core/referral-placement.mjs';
const canonical=a=>String(a).toLowerCase();
const exactAddress=a=>/^0x[a-fA-F0-9]{40}$/.test(a);

// Reconstructs the current binary tree from the deterministic 31 Genesis
// positions and actual Registered receipts. No private keys and no mutations.
export const LEGACY_GENESIS_LAYOUT='FTI_GENESIS_COMPLETE_31_V1';
export async function detectGenesisPlacementLayout(genesis,binary){
 const member=await binary.members(genesis[16]);
 if(canonical(member.parent)===canonical(genesis[8]))return approvedGenesisLayout().id;
 if(canonical(member.parent)===canonical(genesis[7]))return LEGACY_GENESIS_LAYOUT;
 throw Error('UNSUPPORTED_GENESIS_LAYOUT');
}
export function genesisPlacementIndex(genesis,genesisLayout=LEGACY_GENESIS_LAYOUT){
 if(!Array.isArray(genesis)||genesis.length!==31||genesis.some(a=>!exactAddress(a))||new Set(genesis.map(canonical)).size!==31)throw Error('INVALID_GENESIS_INDEX');
 const approved=genesisLayout===LEGACY_GENESIS_LAYOUT?null:approvedGenesisLayout();
 if(approved&&genesisLayout!==approved.id)throw Error('UNSUPPORTED_GENESIS_LAYOUT');
 const nodes=new Map();
 for(let i=0;i<genesis.length;i++){
  const n=approved?approved.positions[i].parent:i?Math.floor((i-1)/2)+1:null;
  const parent=n===null?ZERO_ADDRESS:genesis[n-1];
  nodes.set(canonical(genesis[i]),{wallet:genesis[i],exists:true,parent,left:ZERO_ADDRESS,right:ZERO_ADDRESS,depth:n===null?0:nodes.get(canonical(parent)).depth+1});
  if(n!==null)nodes.get(canonical(parent))[approved?approved.positions[i].side:i%2?'left':'right']=genesis[i];
 }
 function append(wallet,parentAddress){
  if(!exactAddress(wallet)||!exactAddress(parentAddress)||canonical(wallet)===canonical(parentAddress)||nodes.has(canonical(wallet)))throw Error('INVALID_REGISTRATION_EVENT');
  const parent=nodes.get(canonical(parentAddress));if(!parent||parent.depth>=64)throw Error('REGISTRATION_PARENT_UNKNOWN_OR_TOO_DEEP');
  const side=canonical(parent.left)===ZERO_ADDRESS?'left':canonical(parent.right)===ZERO_ADDRESS?'right':null;
  if(!side)throw Error('REGISTRATION_PARENT_FULL_OR_EVENT_ORDER_WRONG');
  parent[side]=wallet;
  nodes.set(canonical(wallet),{wallet,exists:true,parent:parentAddress,left:ZERO_ADDRESS,right:ZERO_ADDRESS,depth:parent.depth+1});
 }
 return {append,getMember:async a=>nodes.get(canonical(a)),count:()=>nodes.size,
  async choose(referrer){return firstOpenSlot(referrer,a=>nodes.get(canonical(a)),{maxNodes:1000000});}};
}

export function networkPlacementIndexer({genesis,genesisLayout=LEGACY_GENESIS_LAYOUT,binary,provider,startBlock,chunkSize=1500,chainId,placementTimeoutMs=10000,maxPlacementNodes=4096}){
 if(!Number.isSafeInteger(startBlock)||startBlock<1)throw Error('INVALID_CREATION_BLOCK');
 if(!Number.isSafeInteger(chunkSize)||chunkSize<100||chunkSize>10000)throw Error('INVALID_LOG_CHUNK_SIZE');
 if(chainId!==undefined&&(!Number.isSafeInteger(chainId)||chainId<1))throw Error('INVALID_PLACEMENT_CHAIN');
 if(!Number.isSafeInteger(placementTimeoutMs)||placementTimeoutMs<1||placementTimeoutMs>10000)throw Error('INVALID_PLACEMENT_TIMEOUT');
 if(!Number.isSafeInteger(maxPlacementNodes)||maxPlacementNodes<1||maxPlacementNodes>4096)throw Error('INVALID_SCAN_LIMIT');
 const topic=binary.interface.getEvent('Registered').topicHash;
 let index=genesisPlacementIndex(genesis,genesisLayout),lastBlock=startBlock-1,inFlight;
 const sync=()=>{
  if(inFlight)return inFlight;
  inFlight=(async()=>{
   const latest=await provider.getBlockNumber();
   if(latest<lastBlock){index=genesisPlacementIndex(genesis,genesisLayout);lastBlock=startBlock-1;}
   for(let start=lastBlock+1;start<=latest;start+=chunkSize){
    const end=Math.min(start+chunkSize-1,latest);
    const logs=await provider.getLogs({address:binary.target,topics:[topic],fromBlock:start,toBlock:end});
    for(const log of logs){const parsed=binary.interface.parseLog(log);
     if(parsed?.name!=='Registered')throw Error('BAD_REGISTERED_EVENT');
     index.append(parsed.args.wallet,parsed.args.sponsor);}
    lastBlock=end;
   }
   return index;
  })().finally(()=>{inFlight=null;});return inFlight;
 };
 // Placement needs current storage, not a historical event scan. Use the same
 // provider as the contract calls even when a separate log provider was supplied.
 const stateProvider=binary.runner?.provider||binary.runner||provider,flights=new Map();let activeChoices=0;
 function number(value,error){
  if(!(typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value)||typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)))throw Error(error);
  const parsed=BigInt(value);if(parsed<0n||parsed>BigInt(Number.MAX_SAFE_INTEGER))throw Error(error);return Number(parsed);
 }
 function header(value){
  if(!value||!Number.isSafeInteger(value.number)||value.number<0||!Number.isSafeInteger(value.timestamp)||value.timestamp<=0||!/^0x[0-9a-f]{64}$/i.test(value.hash||''))throw Error('INVALID_PLACEMENT_BLOCK');
  return {number:value.number,timestamp:value.timestamp,hash:value.hash.toLowerCase()};
 }
 function member(value){
  if(!value||typeof value.exists!=='boolean'||!['parent','left','right'].every(key=>typeof value[key]==='string'&&exactAddress(value[key])))throw Error('INVALID_PLACEMENT_MEMBER');
  return {exists:value.exists,parent:value.parent,left:value.left,right:value.right};
 }
 async function chooseAtHead(ctx,referrer){
  const read=async fn=>{
   if(ctx.stopped)throw Error('PLACEMENT_TIMEOUT');ctx.pending++;
   try{let value;try{value=await fn();}catch{throw Error('PLACEMENT_RPC_UNAVAILABLE');}if(ctx.stopped)throw Error('PLACEMENT_TIMEOUT');return value;}
   finally{ctx.pending--;if(!ctx.pending)for(const done of ctx.waiters.splice(0))done();}
  };
  const network=number((await read(()=>stateProvider.getNetwork()))?.chainId,'INVALID_PLACEMENT_CHAIN');
  if(network<1||chainId!==undefined&&network!==chainId)throw Error('WRONG_PLACEMENT_CHAIN');
  const anchor=header(await read(()=>stateProvider.getBlock('latest'))),at={blockTag:anchor.number},members=new Map(),parents=new Map();
  const getMember=async wallet=>{
   const key=canonical(wallet);if(members.has(key))return members.get(key);
   const value=member(await read(()=>binary.members(wallet,at)));
   if(parents.has(key)&&canonical(value.parent)!==parents.get(key))throw Error('INVALID_PLACEMENT_ANCESTRY');
   for(const child of [value.left,value.right])if(canonical(child)!==ZERO_ADDRESS){
    const id=canonical(child);if(id===key||parents.has(id)&&parents.get(id)!==key)throw Error('CYCLIC_BINARY_NETWORK');parents.set(id,key);
   }
   members.set(key,value);return value;
  };
  const inviter=await getMember(referrer);if(!inviter.exists)throw Error('REFERRAL_TREE_INCOMPLETE');
  const inviterDepth=number(await read(()=>binary.depth(referrer,at)),'INVALID_PLACEMENT_DEPTH');
  if(inviterDepth>=64)throw Error('REFERRAL_SUBTREE_AT_MAX_DEPTH');
  const result=await firstOpenSlot(referrer,getMember,{maxDepth:64-inviterDepth,maxNodes:maxPlacementNodes});
  const parent=member(await read(()=>binary.members(result.placementParent,at)));
  const placementParentDepth=number(await read(()=>binary.depth(result.placementParent,at)),'INVALID_PLACEMENT_DEPTH');
  if(!parent.exists||placementParentDepth>=64||placementParentDepth!==inviterDepth+result.depth-1||canonical(parent[result.side])!==ZERO_ADDRESS||result.side==='right'&&canonical(parent.left)===ZERO_ADDRESS)throw Error('STALE_PLACEMENT_RETRY');
  const canonicalBlock=header(await read(()=>stateProvider.getBlock(anchor.number)));
  const latest=header(await read(()=>stateProvider.getBlock('latest')));
  const finalNetwork=number((await read(()=>stateProvider.getNetwork()))?.chainId,'INVALID_PLACEMENT_CHAIN');
  if(finalNetwork!==network||canonicalBlock.number!==anchor.number||canonicalBlock.hash!==anchor.hash||canonicalBlock.timestamp!==anchor.timestamp||latest.number<anchor.number||latest.timestamp<anchor.timestamp||latest.number===anchor.number&&latest.hash!==anchor.hash)throw Error('PLACEMENT_CHAIN_CHANGED');
  return {...result,source:'canonical-state',chainId:network,block:anchor.number,blockHash:anchor.hash,placementParentDepth};
 }
 function choose(referrer){
  if(typeof referrer!=='string'||!exactAddress(referrer)||canonical(referrer)===ZERO_ADDRESS)return Promise.reject(Error('INVALID_REFERRER'));
  const key=canonical(referrer);if(flights.has(key))return flights.get(key).result;
  if(activeChoices>=4)return Promise.reject(Error('PLACEMENT_BUSY'));
  const ctx={stopped:false,pending:0,waiters:[]},flight={};activeChoices++;flights.set(key,flight);let timer;
  const work=Promise.resolve().then(()=>chooseAtHead(ctx,referrer));
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{ctx.stopped=true;reject(Error('PLACEMENT_TIMEOUT'));},placementTimeoutMs);});
  flight.result=Promise.race([work,timeout]).finally(()=>{
   clearTimeout(timer);ctx.stopped=true;
   // Retain the single flight/admission slot until its native read settles.
   // A late result cannot resume BFS or start further RPC calls after timeout.
   const drained=ctx.pending?new Promise(resolve=>ctx.waiters.push(resolve)):Promise.resolve();
   void drained.then(()=>{if(flights.get(key)===flight)flights.delete(key);activeChoices--;});
  });
  return flight.result;
 }
 return {sync,choose};
}
