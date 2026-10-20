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

export function networkPlacementIndexer({genesis,genesisLayout=LEGACY_GENESIS_LAYOUT,binary,provider,startBlock,chunkSize=1500}){
 if(!Number.isSafeInteger(startBlock)||startBlock<1)throw Error('INVALID_CREATION_BLOCK');
 if(!Number.isSafeInteger(chunkSize)||chunkSize<100||chunkSize>10000)throw Error('INVALID_LOG_CHUNK_SIZE');
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
 return {sync,async choose(referrer){
  const graph=await sync(),result=await graph.choose(referrer);
  // Cross-check both the inviter and the physical parent against latest state;
  // another registration can race with this read-only suggestion. The on-chain
  // entrypoint independently rejects a stale slot and wrong subtree.
  const [r,p]=await Promise.all([binary.members(referrer),binary.members(result.placementParent)]);
  if(!r.exists||!p.exists||canonical(p[result.side])!==ZERO_ADDRESS)throw Error('STALE_PLACEMENT_RETRY');
  return {...result,indexedBlock:lastBlock,indexedMembers:graph.count()};
 }};
}
