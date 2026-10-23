// Share only read-only searches. Each caller must still own the same pending
// record before applying a verified result, including after a wallet change.
const searches=new WeakMap();
export async function recoverPending(tracker,provider,address,chainId,{logAddresses=[],candidateHashes=[]}={}){
 const record=tracker.read();if(!/^unknown:\d+$/.test(record||''))return null;
 const nonce=Number(record.slice(8));if(!Number.isSafeInteger(nonce))return null;
 if(!/^0x[0-9a-f]{40}$/i.test(address)||!Number.isSafeInteger(chainId)||chainId<=0)throw Error('Invalid recovery wallet or network.');
 const addresses=[...new Set(logAddresses.map(value=>String(value).toLowerCase()))].sort();
 if(addresses.length>8||addresses.some(value=>!/^0x[0-9a-f]{40}$/.test(value)))throw Error('Invalid recovery contract addresses.');
 if(!Array.isArray(candidateHashes)||candidateHashes.length>16||candidateHashes.some(value=>!/^0x[0-9a-f]{64}$/i.test(value)))throw Error('Invalid recovery transaction hints.');
 // Cancellation remembers its hash while the uncertain nonce stays protected.
 // Verify that saved hash before relying on archive state or indexed logs.
 let remembered;try{remembered=tracker.last?.();}catch{}
 const candidates=[...new Set([remembered,...candidateHashes]
  .filter(value=>/^0x[0-9a-f]{64}$/i.test(value||''))
  .map(value=>value.toLowerCase()))].slice(0,16);
 const key=JSON.stringify([address.toLowerCase(),chainId,nonce,addresses,candidates]);
 let jobs=searches.get(provider);if(!jobs){jobs=new Map();searches.set(provider,jobs);}
 let job=jobs.get(key);
 if(!job){job=findPendingTransaction(provider,address,chainId,nonce,addresses,candidates);jobs.set(key,job);const clean=()=>{if(jobs.get(key)===job)jobs.delete(key);};job.then(clean,clean);}
 const result=await job;
 if(!result||tracker.read()!==record)return null;
 tracker.remember?.(result.hash);tracker.clear();return result;
}

// Read-only recovery by sender + nonce. Hints are untrusted transaction hashes,
// never proof themselves. A nonce change alone never clears a lock.
async function findPendingTransaction(provider,address,chainId,nonce,addresses,candidates){
 const deadline=Date.now()+45000;
 const read=async(method,...args)=>{
  const remaining=deadline-Date.now();if(remaining<=0)throw Error('Automatic verification timed out.');
  let timer;try{return await Promise.race([provider[method](...args),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Automatic verification timed out.')),remaining);})]);}finally{clearTimeout(timer);}
 };
 if(Number((await read('getNetwork')).chainId)!==chainId)throw Error('Wallet network does not match this deployment.');
 const head=await read('getBlockNumber');if(!Number.isSafeInteger(head)||head<0)throw Error('Recovery block is unavailable.');
 const safeHead=Math.max(0,head-12);
 const count=block=>read('getTransactionCount',address,block);
 const validHash=hash=>/^0x[0-9a-f]{64}$/i.test(hash||'');
 const matches=tx=>tx?.from?.toLowerCase()===address.toLowerCase()&&tx.nonce===nonce&&validHash(tx.hash);
 async function verify(tx,expectedBlock,log,strictBlock=false){
  if(!matches(tx))return null;
  const receipt=await read('getTransactionReceipt',tx.hash);
  if(!receipt||receipt.hash?.toLowerCase()!==tx.hash.toLowerCase()||!Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber<0||receipt.blockNumber>safeHead||![0,1].includes(Number(receipt.status)))return null;
  if(expectedBlock&&(receipt.blockHash!==expectedBlock.hash||receipt.blockNumber!==expectedBlock.number))return null;
  if(log&&(log.blockHash!==receipt.blockHash||log.blockNumber!==receipt.blockNumber||log.transactionHash.toLowerCase()!==tx.hash.toLowerCase()))return null;
  // A mined receipt must still belong to the canonical safe block. Neither a
  // changed nonce nor an indexed wallet topic alone proves this transaction.
  const canonical=await read('getBlock',receipt.blockNumber);
  if(canonical?.hash!==receipt.blockHash||strictBlock&&canonical?.number!==receipt.blockNumber)return null;
  if(Number((await read('getNetwork')).chainId)!==chainId)throw Error('Wallet network does not match this deployment.');
  return {hash:tx.hash,receipt};
 }
 // A known hash can be verified without historical account state or log access.
 // This also rejects a hint for another wallet, nonce, chain or pending receipt.
 for(const hash of candidates){
  try{
   const tx=await read('getTransaction',hash);
   if(tx?.hash?.toLowerCase()!==hash||!matches(tx)||Number(tx.chainId)!==chainId)continue;
   const receipt=await read('getTransactionReceipt',hash);
   if(!receipt||!validHash(receipt.blockHash)||tx.blockNumber!==receipt.blockNumber||tx.blockHash!==receipt.blockHash)continue;
   const result=await verify(tx,{hash:tx.blockHash,number:tx.blockNumber},undefined,true);
   if(result)return result;
  }catch{/* An unavailable or invalid hint never releases the request. */}
 }
 let historicalError;
 try{
  // Even a near-head historical read can fail on a pruned node. It is a search
  // optimization only; failure must not prevent verified log candidates below.
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
  if(low===high){
   const block=await read('getBlock',low,true);
   let transactions;try{transactions=block?.prefetchedTransactions;}catch{}
   if(transactions){
    const tx=transactions.find(matches);
    const verified=await verify(tx,block&&{hash:block.hash,number:low});
    if(verified)return verified;
   }
  }
 }catch(error){historicalError=error;}
 // Pruned RPCs can still expose indexed approval/membership events. These logs
 // only supply candidates; sender, nonce, receipt and canonical block are all
 // verified again. A missing result never means the request was not broadcast.
 if(!addresses.length){if(historicalError)throw historicalError;return null;}
 const topic='0x'+address.slice(2).toLowerCase().padStart(64,'0');
 const first=Math.max(0,safeHead-19999),ranges=[];
 for(let end=safeHead;end>=first;end-=2000)ranges.push({fromBlock:Math.max(first,end-1999),toBlock:end});
 const seen=new Set();let examined=0;
 for(let offset=0;offset<ranges.length;offset+=4){
  const replies=await Promise.allSettled(ranges.slice(offset,offset+4).map(range=>read('getLogs',{address:addresses,topics:[null,topic],...range})));
  for(const reply of replies){
   if(reply.status!=='fulfilled'||!Array.isArray(reply.value))continue;
   for(const log of reply.value){
    if(++examined>64)return null;
    if(log.removed||!validHash(log.transactionHash)||!addresses.includes(log.address?.toLowerCase())||log.topics?.[1]?.toLowerCase()!==topic||!Number.isSafeInteger(log.blockNumber)||log.blockNumber<first||log.blockNumber>safeHead||seen.has(log.transactionHash.toLowerCase()))continue;
    seen.add(log.transactionHash.toLowerCase());
    try{
     const tx=await read('getTransaction',log.transactionHash);
     if(tx?.hash?.toLowerCase()!==log.transactionHash.toLowerCase())continue;
     const verified=await verify(tx,null,log);if(verified)return verified;
    }catch{/* Unavailable candidates do not release the recorded request. */}
   }
  }
  if(Date.now()>=deadline)break;
 }
 return null;
}
