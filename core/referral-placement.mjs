// Deterministic read-only binary placement. The inviter is NOT necessarily the
// physical parent: use registerWithPlacement(referrer, placementParent, units)
// after resolving a slot. The contract independently checks ancestry and vacancy.
export const ZERO_ADDRESS='0x0000000000000000000000000000000000000000';
const normalize=a=>typeof a==='string'?a.toLowerCase():'';
const isAddress=a=>/^0x[a-f0-9]{40}$/.test(normalize(a));
export async function firstOpenSlot(referrer, getMember, {maxDepth=64,maxNodes=4096}={}){
 if(!isAddress(referrer)||normalize(referrer)===ZERO_ADDRESS)throw Error('INVALID_REFERRER');
 if(!Number.isSafeInteger(maxDepth)||maxDepth<1||maxDepth>64)throw Error('INVALID_DEPTH_LIMIT');
 if(!Number.isSafeInteger(maxNodes)||maxNodes<1||maxNodes>1000000)throw Error('INVALID_SCAN_LIMIT');
 if(typeof getMember!=='function')throw Error('INVALID_MEMBER_LOOKUP');
 const queue=[{wallet:referrer,depth:0}],seen=new Set();
 for(let head=0;head<queue.length;head++){
  if(head>=maxNodes)throw Error('PLACEMENT_INDEX_CAPACITY_REACHED');
  const {wallet,depth}=queue[head],id=normalize(wallet);
  if(seen.has(id))throw Error('CYCLIC_BINARY_NETWORK');
  seen.add(id);
  const member=await getMember(wallet);
  if(!member?.exists)throw Error('REFERRAL_TREE_INCOMPLETE');
  const left=normalize(member.left),right=normalize(member.right);
  if(!isAddress(left)||!isAddress(right))throw Error('INVALID_CHILD_ADDRESS');
  if(depth<maxDepth){
   // Strict breadth-first search, with left slot before right slot.
   if(left===ZERO_ADDRESS)return {referrer,placementParent:wallet,side:'left',depth:depth+1,visited:head+1};
   if(right===ZERO_ADDRESS)return {referrer,placementParent:wallet,side:'right',depth:depth+1,visited:head+1};
   queue.push({wallet:member.left,depth:depth+1},{wallet:member.right,depth:depth+1});
  }
 }
 throw Error('REFERRAL_SUBTREE_AT_MAX_DEPTH');
}
