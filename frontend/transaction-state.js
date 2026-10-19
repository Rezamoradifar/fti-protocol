// Keep a submitted hash across reloads until its receipt is known. No retry/send here.
const memory=new Map();
export function transactionState(storage,chainId,address){
 let legacy;try{legacy=globalThis.sessionStorage;}catch{}
 const key=`fti-pending:${chainId}:${address.toLowerCase()}`;
 return {
  read(){try{return storage?storage.getItem(key)||legacy?.getItem(key)||null:memory.get(key)||null;}catch{return memory.get(key)||null;}},
  save(hash){if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Invalid transaction hash.');memory.set(key,hash);try{storage?.setItem(key,hash);}catch{}},
  saveUnknown(nonce){const value='unknown:'+String(nonce);if(!Number.isSafeInteger(nonce)||nonce<0)throw Error('Invalid nonce.');if(!storage)throw Error('Browser storage is required before sending.');storage.setItem(key,value);memory.set(key,value);},
  clear(){try{legacy?.removeItem(key);}catch{}memory.delete(key);try{storage?.removeItem(key);}catch{}},
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
 if(hash.startsWith('unknown:'))throw Error('Send result is unknown. Inspect wallet activity and verify its transaction hash before continuing.');
 const receipt=await provider.getTransactionReceipt(hash);
 if(!receipt)throw Error('Transaction confirmation is pending. Check wallet activity before retrying.');
 tracker.clear();return receipt;
}

export async function submitTracked(send,tracker,nonce){
 if(tracker.read())throw Error('A previous transaction must be resolved first.');
 tracker.saveUnknown(nonce);
 try{const tx=await send();tracker.save(tx.hash);return tx;}
 catch(error){
  // Explicit rejection or an estimate failure proves no broadcast for this request.
  if(explicitRejection(error)||(error.code==='CALL_EXCEPTION'&&error.action==='estimateGas'))tracker.clear();
  throw error;
 }
}
export async function reconcileUnknown(tracker,provider,address,hash){
 const value=tracker.read();if(!value?.startsWith('unknown:'))throw Error('No unknown send to verify.');
 if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Enter a valid transaction hash.');
 const tx=await provider.getTransaction(hash);
 if(!tx||tx.from.toLowerCase()!==address.toLowerCase()||tx.nonce!==Number(value.slice(8)))throw Error('Transaction does not match the wallet and pending nonce.');
 const receipt=await provider.getTransactionReceipt(hash);
 if(!receipt)throw Error('Transaction confirmation is pending. Check wallet activity before retrying.');
 tracker.clear();return receipt;
}

// Preparation is read-only. Failures here must never create an uncertain-send lock.
export async function prepareContractRequest(method,args,signer){
 const request=await method.populateTransaction(...args);
 const gas=await signer.estimateGas(request);
 return {...request,gasLimit:(gas*120n+99n)/100n};
}
function explicitRejection(error,seen=new Set(),depth=0){
 if(!error||typeof error!=='object'||seen.has(error)||depth>6)return false;
 seen.add(error);
 if(error.code===4001||error.code==='ACTION_REJECTED')return true;
 return ['error','info','data','cause','originalError'].some(key=>explicitRejection(error[key],seen,depth+1));
}
