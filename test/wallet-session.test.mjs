import test from 'node:test';
import assert from 'node:assert/strict';
import {disconnectSession} from '../frontend/wallet-session.js';
test('clears connection hints, preserves pending and unrelated state',async()=>{
 const data=new Map([['fti-wallet-connected','yes'],['fti-selected-wallet','wc'],['fti-local-account','address'],['fti-pending:56:address','unknown:7'],['language','fa']]);
 assert.equal(await disconnectSession({remote:false},{removeItem:k=>data.delete(k)}),true);
 assert.deepEqual([...data],[['fti-pending:56:address','unknown:7'],['language','fa']]);
});
test('closes remote sessions and tolerates inaccessible storage',async()=>{
 let closed=0;assert.equal(await disconnectSession({remote:true,provider:{disconnect:async()=>closed++}},{removeItem(){throw Error('blocked');}}),true);assert.equal(closed,1);
});
test('reports failed or hung remote disconnection without locking UI',async()=>{
 for(const disconnect of [async()=>{throw Error('network');},()=>new Promise(()=>{})])assert.equal(await disconnectSession({remote:true,provider:{disconnect}},null,10),false);
});
