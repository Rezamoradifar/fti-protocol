// Read-only recovery by sender + nonce. A nonce change alone never clears a lock.
export async function recoverPending(tracker,provider,address,chainId){
 const deadline=Date.now()+45000;
 const read=async(method,...args)=>{
  const remaining=deadline-Date.now();if(remaining<=0)throw Error('Automatic verification timed out.');
  let timer;try{return await Promise.race([provider[method](...args),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Automatic verification timed out.')),remaining);})]);}finally{clearTimeout(timer);}
 };
 const record=tracker.read();if(!/^unknown:\d+$/.test(record||''))return null;
 const nonce=Number(record.slice(8));if(!Number.isSafeInteger(nonce))return null;
 if(Number((await read('getNetwork')).chainId)!==chainId)throw Error('Wallet network does not match this deployment.');
 const head=await read('getBlockNumber'),safeHead=Math.max(0,head-12);
 const count=block=>read('getTransactionCount',address,block);
 if(await count(safeHead)<=nonce)return null;
 let high=safeHead,low=Math.max(0,high-1024),distance=1024;
 // Start near the head so recent requests do not require ancient archive state.
 for(let step=0;low>0&&step<32;step++){
  if(await count(low)<=nonce)break;
  high=low;distance*=2;low=Math.max(0,safeHead-distance);
 }
 // Find the first block that consumed this nonce, including old requests.
 for(let step=0;low<high&&step<32;step++){
  const mid=Math.floor((low+high)/2);
  if(await count(mid)>nonce)high=mid;else low=mid+1;
 }
 if(low!==high)return null;
 const block=await read('getBlock',low,true);if(!block)return null;
 let transactions;try{transactions=block.prefetchedTransactions;}catch{return null;}
 const tx=transactions.find(t=>t.from?.toLowerCase()===address.toLowerCase()&&t.nonce===nonce);
 if(!tx||!/^0x[0-9a-f]{64}$/i.test(tx.hash))return null;
 const receipt=await read('getTransactionReceipt',tx.hash);
 if(!receipt||receipt.blockHash!==block.hash||receipt.blockNumber!==low||![0,1].includes(Number(receipt.status)))return null;
 // Recheck canonical block and local record after asynchronous reads.
 const canonical=await read('getBlock',low);
 if(canonical?.hash!==block.hash||tracker.read()!==record)return null;
 tracker.clear();return {hash:tx.hash,receipt};
}
