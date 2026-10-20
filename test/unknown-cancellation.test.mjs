import test from 'node:test';import assert from 'node:assert/strict';
import {cancelUnknown,transactionState} from '../frontend/transaction-state.js';
const address='0x'+'a'.repeat(40),hash='0x'+'b'.repeat(64);
function fixture(){
 const data=new Map(),tracker=transactionState({getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},56,address);tracker.saveUnknown(0);
 const provider={getNetwork:async()=>({chainId:56n}),getCode:async()=>'0x',getTransactionCount:async()=>0,getFeeData:async()=>({gasPrice:100n})};
 let sent;
 const signer={provider,getAddress:async()=>address,sendTransaction:async request=>{sent=request;return {...request,from:address,hash,wait:async()=>({status:1})};}};
 return {tracker,provider,signer,sent:()=>sent};
}
test('explicit cancellation sends only zero value to self at recorded nonce and clears after receipt',async()=>{
 const f=fixture();await cancelUnknown(f.tracker,f.provider,f.signer,address,56);
 assert.deepEqual(f.sent(),{to:address,value:0n,data:'0x',nonce:0,chainId:56,gasLimit:21000n,gasPrice:125n});assert.equal(f.tracker.read(),null);
});
test('wrong account/network, smart account, or mined nonce prevents any send and preserves lock',async()=>{
 for(const mutate of [f=>f.signer.getAddress=async()=>'0x'+'c'.repeat(40),f=>f.provider.getNetwork=async()=>({chainId:97}),f=>f.provider.getCode=async()=>'0x1234',f=>f.provider.getTransactionCount=async()=>1]){
  const f=fixture();mutate(f);await assert.rejects(cancelUnknown(f.tracker,f.provider,f.signer,address,56));assert.equal(f.sent(),undefined);assert.equal(f.tracker.read(),'unknown:0');
 }
});
test('rejection or transport failure never clears the original unknown request',async()=>{
 for(const error of [{code:4001},Error('RPC timeout')]){const f=fixture();f.signer.sendTransaction=async()=>{throw error;};await assert.rejects(cancelUnknown(f.tracker,f.provider,f.signer,address,56));assert.equal(f.tracker.read(),'unknown:0');}
});
test('receipt timeout retains cancellation hash for reconciliation and never resends',async()=>{
 const f=fixture();f.signer.sendTransaction=async request=>({...request,from:address,hash,wait:async()=>{throw Error('timeout');}});
 await assert.rejects(cancelUnknown(f.tracker,f.provider,f.signer,address,56));assert.equal(f.tracker.read(),hash);
 await assert.rejects(cancelUnknown(f.tracker,f.provider,f.signer,address,56),/No unknown/);
});
test('wallet changes requested nonce: never claims successful cancellation',async()=>{
 const f=fixture();f.signer.sendTransaction=async request=>({...request,from:address,hash,nonce:1});
 await assert.rejects(cancelUnknown(f.tracker,f.provider,f.signer,address,56),/differ/);assert.equal(f.tracker.read(),'unknown:0');
});
