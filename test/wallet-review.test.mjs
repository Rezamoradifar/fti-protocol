import test from 'node:test';
import assert from 'node:assert/strict';
import {walletReview} from '../frontend/wallet-review.js';
import {preparedWalletSend,submitTracked,transactionState} from '../frontend/transaction-state.js';
const hash='0x'+'a'.repeat(64),address='0x'+'1'.repeat(40),to='0x'+'2'.repeat(40);
const request={from:address,to,gas:'0x5208',gasPrice:'0x64',nonce:'0x3',chainId:'0x38',value:'0x0',data:'0x'};
function fixture(){
 const nodes={};for(const id of ['wallet-review-panel','wallet-review-details','confirm-wallet-request','cancel-wallet-review','wallet-review-title','wallet-review-from','wallet-review-to','wallet-review-network','wallet-review-nonce'])nodes[id]={hidden:true,disabled:true,textContent:'',focus(){},scrollIntoView(){}};
 let now=1000;const view=walletReview({document:{getElementById:id=>nodes[id]},translate:key=>key,now:()=>now});
 return {nodes,view,tick:()=>{now+=31000;}};
}
test('preparation sends nothing; the final click reaches the mobile wallet in the original click stack',async()=>{
 const f=fixture(),data=new Map(),tracker=transactionState({getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},56,address);
 f.nodes['wallet-review-details'].open=true;
 let active=false,calls=0;
 const callback=preparedWalletSend({request:r=>{calls++;assert(active,'mobile gesture must still be active');assert.equal(r.method,'eth_sendTransaction');assert.equal(tracker.read(),'unknown:3');return Promise.resolve(hash);}},{},request);
 const result=f.view.open({request,title:'Buy membership units',onConfirm:()=>submitTracked(callback,tracker,3)});
 assert.equal(calls,0);assert.equal(tracker.read(),null);assert.equal(f.nodes['wallet-review-panel'].hidden,false);
 assert.equal(f.nodes['wallet-review-details'].open,false);
 await Promise.resolve();active=true;f.nodes['confirm-wallet-request'].onclick();active=false;
 assert.equal(calls,1);f.nodes['confirm-wallet-request'].onclick();assert.equal(calls,1);
 assert.equal((await result).hash,hash);assert.equal(tracker.read(),hash);assert.equal(f.nodes['wallet-review-panel'].hidden,true);
});
test('expired requests, changed accounts or transaction records and cancelled reviews never send',async()=>{
 for(const mode of ['expired','account','storage','cancel']){
  const f=fixture();let sends=0;
  const result=f.view.open({request,title:'Cancel previous request',isCurrent:()=>{if(mode==='storage')throw Error('unavailable');return mode!=='account';},onConfirm:()=>{sends++;}});
  const failure=assert.rejects(result);
  if(mode==='expired')f.tick();
  if(mode==='cancel')f.nodes['cancel-wallet-review'].onclick();else f.nodes['confirm-wallet-request'].onclick();
  await failure;assert.equal(sends,0);assert.equal(f.nodes['wallet-review-panel'].hidden,true);
 }
});
test('wallet events cancel a prepared request before tracking or broadcasting',async()=>{
 const f=fixture();let sends=0;const promise=f.view.open({request,title:'Purchase',onConfirm:()=>{sends++;}});const failure=assert.rejects(promise);
 f.view.cancel();f.nodes['confirm-wallet-request'].onclick();await failure;assert.equal(sends,0);
});
test('invalid payloads never open review and callback failures settle a single request',async()=>{
 const f=fixture();assert.throws(()=>f.view.open({request:{...request,nonce:'bad'},title:'Bad',onConfirm:()=>assert.fail()}),/Invalid/);
 assert.equal(f.nodes['wallet-review-panel'].hidden,true);
 const promise=f.view.open({request,title:'Purchase',onConfirm:()=>{throw Error('wallet unavailable');}});const failure=assert.rejects(promise,/unavailable/);
 f.nodes['confirm-wallet-request'].onclick();await failure;assert.equal(f.nodes['confirm-wallet-request'].disabled,true);
});
