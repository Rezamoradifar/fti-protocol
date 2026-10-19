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
