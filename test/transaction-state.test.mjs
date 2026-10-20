import test from 'node:test';import assert from 'node:assert/strict';
import {transactionState,confirmedReceipt,resolvePending} from '../frontend/transaction-state.js';
const hash='0x'+'a'.repeat(64);
function fixture(){const data=new Map();const storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};return {storage,tracker:transactionState(storage,56,'0xABC')};}
test('RPC confirmation failure preserves hash across reload and prevents retry until receipt',async()=>{
 const {storage,tracker}=fixture();await assert.rejects(confirmedReceipt({hash,wait:async()=>{throw Error('RPC offline');}},tracker));
 const reload=transactionState(storage,56,'0xabc');assert.equal(reload.read(),hash);
 await assert.rejects(resolvePending(reload,{getTransactionReceipt:async()=>null}),/pending/);assert.equal(reload.read(),hash);
 assert.equal((await resolvePending(reload,{getTransactionReceipt:async h=>{assert.equal(h,hash);return {status:1};}})).status,1);assert.equal(reload.read(),null);
});
test('successful and reverted receipts clear pending tracking',async()=>{
 for(const status of [0,1]){const {tracker}=fixture();const result=confirmedReceipt({hash,wait:async()=>({status})},tracker);if(status)assert.equal((await result).status,1);else await assert.rejects(result,/reverted/);assert.equal(tracker.read(),null);}
});
test('speed-up succeeds but cancellation never claims success',async()=>{
 for(const cancelled of [false,true]){const {tracker}=fixture();const result=confirmedReceipt({hash,wait:async()=>{throw {code:'TRANSACTION_REPLACED',cancelled,receipt:{status:1}};}},tracker);if(cancelled)await assert.rejects(result,/cancelled/);else assert.equal((await result).status,1);assert.equal(tracker.read(),null);}
});
test('pending records are scoped to chain and wallet',()=>{const {storage,tracker}=fixture();tracker.save(hash);assert.equal(transactionState(storage,97,'0xABC').read(),null);assert.equal(transactionState(storage,56,'0xDEF').read(),null);});

test('unknown send survives reload, blocks another send, and never clears on nonce movement alone',async()=>{
 const {submitTracked,reconcileUnknown}=await import('../frontend/transaction-state.js');const {storage,tracker}=fixture();
 await assert.rejects(submitTracked(async()=>{throw Error('RPC transport lost');},tracker,17));
 const reload=transactionState(storage,56,'0xabc');assert.equal(reload.read(),'unknown:17');
 let called=false;await assert.rejects(submitTracked(async()=>{called=true;},reload,18));assert.equal(called,false);
 await assert.rejects(resolvePending(reload,{getTransactionReceipt:()=>{throw Error('must not query non-hash');}}),/unknown/);
 await assert.rejects(reconcileUnknown(reload,{getTransaction:async()=>({from:'0xDEF',nonce:17})},'0xABC',hash),/match/);
 await assert.rejects(reconcileUnknown(reload,{getTransaction:async()=>({from:'0xABC',nonce:18})},'0xABC',hash),/match/);
 const p={getTransaction:async()=>({from:'0xABC',nonce:17}),getTransactionReceipt:async()=>({status:1})};
 assert.equal((await reconcileUnknown(reload,p,'0xABC',hash)).status,1);assert.equal(reload.read(),null);
});
test('explicit wallet rejection and estimate failure release lock; ambiguous errors do not',async()=>{
 const {submitTracked}=await import('../frontend/transaction-state.js');
 for(const error of [{code:'ACTION_REJECTED'},{code:4001},{code:'CALL_EXCEPTION',action:'estimateGas'}]){
  const {tracker}=fixture();await assert.rejects(submitTracked(async()=>{throw error;},tracker,2));assert.equal(tracker.read(),null);
 }
});
test('storage failure stops request before wallet is invoked',async()=>{
 const {submitTracked}=await import('../frontend/transaction-state.js');let called=false;
 const tracker=transactionState({getItem:()=>null,setItem:()=>{throw Error('storage denied');}},56,'0x123');
 await assert.rejects(submitTracked(async()=>{called=true;},tracker,0));assert.equal(called,false);
});

test('nested mobile-wallet rejection clears lock without treating transport failure as rejection',async()=>{
 const {submitTracked}=await import('../frontend/transaction-state.js');
 for(const error of [{code:'UNKNOWN_ERROR',info:{error:{code:4001}}},{cause:{originalError:{code:'ACTION_REJECTED'}}}]){
  const {tracker}=fixture();await assert.rejects(submitTracked(async()=>{throw error;},tracker,0));assert.equal(tracker.read(),null);
 }
 const {tracker}=fixture();await assert.rejects(submitTracked(async()=>{throw {code:'UNKNOWN_ERROR',info:{error:{code:-32000}}};},tracker,0));assert.equal(tracker.read(),'unknown:0');tracker.clear();
});
test('populate and estimate errors occur before lock or wallet send, including RPC timeout',async()=>{
 const {prepareContractRequest,submitTracked}=await import('../frontend/transaction-state.js');
 for(const stage of ['populate','estimate']){
  const {tracker}=fixture();let sent=false;
  const method={populateTransaction:async()=>{if(stage==='populate')throw Error('RPC timeout');return {to:'contract',data:'0x12'};}};
  const signer={estimateGas:async()=>{throw Error('RPC timeout');}};
  await assert.rejects((async()=>{await prepareContractRequest(method,[1n],signer);await submitTracked(async()=>{sent=true;return {hash};},tracker,0);})(),/RPC timeout/);
  assert.equal(sent,false);assert.equal(tracker.read(),null);
 }
});
test('prepared membership preserves calldata and adds gas margin without sending',async()=>{
 const {prepareContractRequest}=await import('../frontend/transaction-state.js');let called=0;
 const request={to:'contract',data:'0x1234',value:0n};
 const result=await prepareContractRequest({populateTransaction:async(...args)=>{assert.deepEqual(args,[3n]);return request;}},[3n],{estimateGas:async r=>{assert.equal(r,request);called++;return 101n;}});
 assert.equal(called,1);assert.deepEqual(result,{...request,gasLimit:122n});assert.equal(request.gasLimit,undefined);
});
test('public read provider estimates with the correct sender without calling wallet RPC',async()=>{
 const {prepareContractRequest}=await import('../frontend/transaction-state.js');
 const from='0x'+'1'.repeat(40),to='0x'+'2'.repeat(40),request={to,data:'0x1234'};
 const signer={getAddress:async()=>from,estimateGas:async()=>{throw Error('Wallet Load failed');},sendTransaction:async()=>{throw Error('Must not send during preparation');}};
 const result=await prepareContractRequest({populateTransaction:async()=>request},[],signer,{estimateGas:async r=>{assert.deepEqual(r,{...request,from});return 100n;}});
 assert.deepEqual(result,{...request,gasLimit:120n});
});
test('public preflight reverts stop preparation without wallet fallback or sending',async()=>{
 const {prepareContractRequest}=await import('../frontend/transaction-state.js');let walletCalls=0;
 await assert.rejects(prepareContractRequest({populateTransaction:async()=>({to:'contract',data:'0x'})},[],{getAddress:async()=> 'wallet',estimateGas:async()=>{walletCalls++;}}, {estimateGas:async()=>{throw Error('reverted');}}),/reverted/);
 assert.equal(walletCalls,0);
});
