import test from 'node:test';
import assert from 'node:assert/strict';
import {preparedWalletSend,submitTracked,transactionState,confirmedReceipt} from '../frontend/transaction-state.js';
const hash='0x'+'a'.repeat(64), request={from:'0x'+'1'.repeat(40),to:'0x'+'2'.repeat(40),gas:'0x12345',data:'0x1234',chainId:'0x38'};
function tracker(){const m=new Map();return transactionState({getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)},56,request.from);}
test('one direct wallet send, no wallet block lookup, hash saved before receipt failure',async()=>{
 const t=tracker(),calls=[];
 const send=preparedWalletSend({request:async r=>{calls.push(r);assert.equal(t.read(),'unknown:3');return hash;}},{waitForTransaction:async()=>{assert.equal(t.read(),hash);throw Error('read offline');}},request);
 const tx=await submitTracked(send,t,3);assert.equal(t.read(),hash);
 assert.deepEqual(calls,[{method:'eth_sendTransaction',params:[request]}]);
 await assert.rejects(confirmedReceipt(tx,t),/offline/);assert.equal(t.read(),hash);
});
test('invalid preparation never records uncertainty or calls wallet',()=>{const t=tracker();assert.throws(()=>preparedWalletSend({request:()=>assert.fail()}, {}, {...request,gas:null}));assert.equal(t.read(),null);});
test('explicit reject unlocks, transport failure and malformed hash stay locked',async()=>{
 for(const [result,locked] of [[{code:4001},false],[Error('transport'),true],['bad hash',true]]){
  const t=tracker(),send=preparedWalletSend({request:async()=>{if(typeof result==='string')return result;throw result;}},{},request);
  await assert.rejects(submitTracked(send,t,3));assert.equal(t.read(),locked?'unknown:3':null);
 }
});
test('confirmed receipt clears the hash without repeating the send',async()=>{let sends=0;const t=tracker();const tx=await submitTracked(preparedWalletSend({request:async()=>{sends++;return hash;}},{waitForTransaction:async(h,n,timeout)=>{assert.equal(h,hash);assert.equal(n,1);assert.equal(timeout,120000);return {status:1};}},request),t,3);await confirmedReceipt(tx,t);assert.equal(t.read(),null);assert.equal(sends,1);});
