// Keep a submitted hash across reloads until its receipt is known. No retry/send here.
const memory=new Map();
export function transactionState(storage,chainId,address){
 let legacy;try{legacy=globalThis.sessionStorage;}catch{}
 const key=`fti-pending:${chainId}:${address.toLowerCase()}`;
 const lastKey=`fti-last-transaction:${chainId}:${address.toLowerCase()}`;
 const remember=hash=>{if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Invalid transaction hash.');memory.set(lastKey,hash);try{storage?.setItem(lastKey,hash);}catch{}};
 return {
  read(){try{return storage?storage.getItem(key)||legacy?.getItem(key)||null:memory.get(key)||null;}catch{return memory.get(key)||null;}},
  save(hash){if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Invalid transaction hash.');memory.set(key,hash);try{storage?.setItem(key,hash);}catch{}remember(hash);},
  remember,
  last(){try{const hash=storage?storage.getItem(lastKey):memory.get(lastKey);return /^0x[0-9a-f]{64}$/i.test(hash||'')?hash:null;}catch{return memory.get(lastKey)||null;}},
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
   if(/^0x[0-9a-f]{64}$/i.test(receipt.hash||''))tracker.remember?.(receipt.hash);
   if(error.cancelled){tracker.clear();throw Error('Transaction cancelled or replaced. Review wallet activity before continuing.');}
  }else if(error.receipt){receipt=error.receipt;}
  else throw error; // Retain the submitted hash on RPC/time-out failures.
 }
 if(!receipt)throw Error('Transaction confirmation is pending. Check wallet activity before retrying.');
 if(/^0x[0-9a-f]{64}$/i.test(receipt.hash||''))tracker.remember?.(receipt.hash);
 tracker.clear();
 if(Number(receipt.status)!==1)throw Error('Transaction reverted on-chain.');
 return receipt;
}
export async function resolvePending(tracker,provider){
 const hash=tracker.read();if(!hash)return null;
 if(hash.startsWith('unknown:'))throw Error('Send result is unknown. Inspect wallet activity and verify its transaction hash before continuing.');
 const receipt=await provider.getTransactionReceipt(hash);
 if(!receipt)throw Error('Transaction confirmation is pending. Check wallet activity before retrying.');
 tracker.remember?.(hash);tracker.clear();return receipt;
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
 tracker.remember?.(hash);tracker.clear();return receipt;
}

// Preparation is read-only. Failures here must never create an uncertain-send lock.
export async function prepareContractRequest(method,args,signer,readProvider){
 const request=await method.populateTransaction(...args);
 const estimate=readProvider?{...request,from:await signer.getAddress()}:request;
 const gas=await (readProvider||signer).estimateGas(estimate);
 return {...request,gasLimit:(gas*120n+99n)/100n};
}
function explicitRejection(error,seen=new Set(),depth=0){
 if(!error||typeof error!=='object'||seen.has(error)||depth>6)return false;
 seen.add(error);
 if(error.code===4001||error.code==='ACTION_REJECTED')return true;
 return ['error','info','data','cause','originalError'].some(key=>explicitRejection(error[key],seen,depth+1));
}

// Explicit user action only: consume the recorded nonce without buying or approving.
// Never unlock on a timeout, a rejected cancellation, or nonce observations alone.
export async function cancelUnknown(tracker,provider,signer,address,chainId,onSubmitted=()=>{}){
 const record=tracker.read();
 if(!/^unknown:\d+$/.test(record||''))throw Error('No unknown send to cancel.');
 const nonce=Number(record.slice(8));
 if(!Number.isSafeInteger(nonce))throw Error('Invalid nonce.');
 const account=await signer.getAddress();
 if(account.toLowerCase()!==address.toLowerCase())throw Error('Wallet changed. Connect the original wallet.');
 if(Number((await provider.getNetwork()).chainId)!==chainId||Number((await signer.provider.getNetwork()).chainId)!==chainId)throw Error('Wallet network does not match this deployment.');
 if(await provider.getCode(address)!=='0x')throw Error('Use wallet activity to resolve this smart-account request.');
 const latest=await provider.getTransactionCount(address,'latest');
 if(latest>nonce)throw Error('The previous nonce is already confirmed. Verify its transaction hash instead.');
 if(latest<nonce)throw Error('Earlier transactions must confirm first. Check wallet activity.');
 const fee=await provider.getFeeData();
 if(!fee.gasPrice||fee.gasPrice<=0n)throw Error('Network fee is unavailable. No cancellation sent.');
 if(tracker.read()!==record)throw Error('Transaction state changed. Refresh before continuing.');
 const tx=await signer.sendTransaction({to:address,value:0n,data:'0x',nonce,chainId,gasLimit:21000n,gasPrice:(fee.gasPrice*125n+99n)/100n});
 if(tx.from?.toLowerCase()!==address.toLowerCase()||tx.to?.toLowerCase()!==address.toLowerCase()||tx.nonce!==nonce||BigInt(tx.value)!==0n||tx.data!=='0x'||Number(tx.chainId)!==chainId)throw Error('Cancellation details differ from the request. Check wallet activity.');
 // Persist the hash before waiting so reloads can reconcile the mined nonce.
 tracker.save(tx.hash);
 onSubmitted(tx.hash);
 return confirmedReceipt(tx,tracker);
}

// Serialize before recording uncertainty. The callback makes exactly one wallet
// send request, returns its hash immediately, and reads receipts on our RPC.
export function preparedWalletSend(wallet,readProvider,rpcRequest){
 if(!wallet||typeof wallet.request!=='function')throw Error('Wallet is not connected.');
 if(!/^0x[0-9a-f]{40}$/i.test(rpcRequest.to||'')||!/^0x[0-9a-f]{40}$/i.test(rpcRequest.from||'')||!rpcRequest.gas)throw Error('Invalid prepared transaction.');
 const request={...rpcRequest};
 return async()=>{
  const hash=await wallet.request({method:'eth_sendTransaction',params:[request]});
  if(!/^0x[0-9a-f]{64}$/i.test(hash||''))throw Error('Wallet did not return a transaction hash.');
  return {hash,wait:()=>readProvider.waitForTransaction(hash,1,120000)};
 };
}
