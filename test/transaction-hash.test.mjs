import test from 'node:test';
import assert from 'node:assert/strict';
import {transactionHashView} from '../frontend/transaction-hash.js';
import {transactionState,confirmedReceipt,reconcileUnknown} from '../frontend/transaction-state.js';
const hash='0x'+'a'.repeat(64),other='0x'+'b'.repeat(64),address='0x'+'1'.repeat(40);
function fixture(clipboard={writeText:async()=>{}}){
 const nodes=Object.fromEntries(['transaction-hash-panel','transaction-hash-value','copy-transaction-hash','transaction-link','unknown-send-form'].map(id=>[id,{hidden:false,disabled:false,value:'',focus(){this.focused=true;},select(){this.selected=true;},setSelectionRange(start,end){this.selection=[start,end];},removeAttribute(name){delete this[name];}}]));
 nodes['unknown-send-form'].elements={hash:{value:''}};
 const statuses=[];const view=transactionHashView({document:{getElementById:id=>nodes[id]},clipboard,translate:key=>key,status:s=>statuses.push(s),explorer:'https://bscscan.com'});
 return {nodes,view,statuses};
}
function stored(){const data=new Map();const storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};return {data,storage,tracker:transactionState(storage,56,address)};}
test('a returned hash is shown in full, linked and copied exactly without a transaction request',async()=>{
 let copied;const f=fixture({writeText:async value=>{copied=value;}});
 f.view.show(hash,{pending:true});
 assert.equal(f.nodes['transaction-hash-value'].value,hash);assert.equal(f.nodes['unknown-send-form'].elements.hash.value,hash);
 assert.equal(f.nodes['transaction-link'].href,'https://bscscan.com/tx/'+hash);assert.equal(f.nodes['transaction-hash-panel'].hidden,false);
 await f.nodes['copy-transaction-hash'].onclick();assert.equal(copied,hash);
 assert.throws(()=>f.view.show(address),/Invalid/);assert.throws(()=>f.view.show('unknown:3'),/Invalid/);
});
test('mobile clipboard failure selects the complete hash for manual copying',async()=>{
 const f=fixture({writeText:async()=>{throw Error('denied');}});f.view.show(hash);await f.nodes['copy-transaction-hash'].onclick();
 assert.equal(f.nodes['transaction-hash-value'].selected,true);assert.equal(f.nodes['transaction-hash-value'].focused,true);
 assert.match(f.statuses.at(-1),/selected/);
});
test('confirmed and timed-out transaction hashes survive reload without acting as pending locks',async()=>{
 const f=stored();await confirmedReceipt({hash,wait:async()=>({status:1})},f.tracker);
 const reload=transactionState(f.storage,56,address);assert.equal(reload.read(),null);assert.equal(reload.last(),hash);
 const v=fixture();v.view.restore(reload);assert.equal(v.nodes['transaction-hash-value'].value,hash);
 await assert.rejects(confirmedReceipt({hash:other,wait:async()=>{throw Error('timeout');}},reload));
 v.view.restore(transactionState(f.storage,56,address));assert.equal(v.nodes['transaction-hash-value'].value,other);
});
test('an unknown purchase never displays the previous approval hash; disconnect hides it',()=>{
 const f=stored(),v=fixture();f.tracker.save(hash);v.view.show(hash,{pending:true});f.tracker.clear();f.tracker.saveUnknown(3);v.view.restore(f.tracker);
 assert.equal(v.nodes['transaction-hash-panel'].hidden,true);assert.equal(v.nodes['transaction-hash-value'].value,'');assert.equal(f.tracker.read(),'unknown:3');
 assert.equal(v.nodes['unknown-send-form'].elements.hash.value,'');assert.equal(v.nodes['transaction-link'].href,undefined);
 assert.equal(transactionState(f.storage,97,address).last(),null);assert.equal(transactionState(f.storage,56,'0x'+'2'.repeat(40)).last(),null);
 v.view.show(hash);v.view.hide();assert.equal(v.nodes['transaction-hash-value'].value,'');assert.equal(v.nodes['copy-transaction-hash'].disabled,true);
});
test('clipboard rejection after disconnect leaves the cleared view and status untouched',async()=>{
 let reject;const f=fixture({writeText:()=>new Promise((_,r)=>{reject=r;})});f.view.show(hash,{pending:true});
 const copying=f.nodes['copy-transaction-hash'].onclick();f.view.hide();reject(Error('permission denied'));await copying;
 assert.equal(f.nodes['transaction-hash-value'].value,'');assert.equal(f.nodes['unknown-send-form'].elements.hash.value,'');
 assert.equal(f.nodes['transaction-hash-value'].focused,undefined);assert.equal(f.nodes['transaction-hash-value'].selected,undefined);assert.deepEqual(f.statuses,[]);
});
test('clipboard completion for an older hash cannot overwrite the current hash status',async()=>{
 let resolve;const f=fixture({writeText:()=>new Promise(r=>{resolve=r;})});f.view.show(hash);
 const copying=f.nodes['copy-transaction-hash'].onclick();f.view.show(other);resolve();await copying;
 assert.equal(f.nodes['transaction-hash-value'].value,other);assert.deepEqual(f.statuses,[]);
});
test('manual verification remembers only a hash matching the original wallet and nonce',async()=>{
 const f=stored();f.tracker.saveUnknown(3);
 await assert.rejects(reconcileUnknown(f.tracker,{getTransaction:async()=>({from:address,nonce:2})},address,hash));
 assert.equal(f.tracker.last(),null);assert.equal(f.tracker.read(),'unknown:3');
 await reconcileUnknown(f.tracker,{getTransaction:async()=>({from:address,nonce:3}),getTransactionReceipt:async()=>({status:1})},address,hash);
 assert.equal(f.tracker.read(),null);assert.equal(f.tracker.last(),hash);
});
