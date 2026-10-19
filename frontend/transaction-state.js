// Keep a submitted hash across reloads until its receipt is known. No retry/send here.
const memory=new Map();
export function transactionState(storage,chainId,address){
 const key=`fti-pending:${chainId}:${address.toLowerCase()}`;
 return {
  read(){try{return storage?.getItem(key)||memory.get(key)||null;}catch{return memory.get(key)||null;}},
  save(hash){if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Invalid transaction hash.');memory.set(key,hash);try{storage?.setItem(key,hash);}catch{}},
  clear(){memory.delete(key);try{storage?.removeItem(key);}catch{}},
 };
}
export async function confirmedReceipt(tx,tracker){
 tracker.save(tx.hash);
 let receipt;
 try{receipt=await tx.wait();}
 catch(error){
  if(error.code==='TRANSACTION_REPLACED'&&error.receipt){
   receipt=error.receipt;
   if(error.cancelled){tracker.clear();throw Error('Transaction cancelled or replaced. Review wallet activity before continuing.');}
  }else if(error.receipt){receipt=error.receipt;}
  else throw error; // Retain the submitted hash on RPC/time-out failures.
 }
 if(!receipt)throw Error('Transaction confirmation is pending. Check wallet activity before retrying.');
 tracker.clear();
 if(Number(receipt.status)!==1)throw Error('Transaction reverted on-chain.');
 return receipt;
}
export async function resolvePending(tracker,provider){
 const hash=tracker.read();if(!hash)return null;
 const receipt=await provider.getTransactionReceipt(hash);
 if(!receipt)throw Error('Transaction confirmation is pending. Check wallet activity before retrying.');
 tracker.clear();return receipt;
}
