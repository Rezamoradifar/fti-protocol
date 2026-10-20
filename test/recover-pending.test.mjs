import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoverPending} from '../frontend/recover-pending.js';
const address='0x'+'1'.repeat(40),hash='0x'+'a'.repeat(64);
function fixture(){
 let record='unknown:3',reads=0;
 const tracker={read:()=>record,clear:()=>{record=null;}};
 const provider={getNetwork:async()=>({chainId:56n}),getBlockNumber:async()=>1000000,getTransactionCount:async(a,n)=>{reads++;return n<123456?3:4;},getBlock:async n=>({hash:'block',prefetchedTransactions:[{from:address,nonce:3,hash}]}),getTransactionReceipt:async()=>({blockHash:'block',blockNumber:123456,status:1})};
 return {tracker,provider,reads:()=>reads};
}
test('finds old mined sender nonce in bounded reads without sending',async()=>{const f=fixture();const result=await recoverPending(f.tracker,f.provider,address,56);assert.equal(result.hash,hash);assert.equal(f.tracker.read(),null);assert.ok(f.reads()<64);});
test('pending or unbroadcast nonce never unlocks',async()=>{const f=fixture();f.provider.getTransactionCount=async()=>3;assert.equal(await recoverPending(f.tracker,f.provider,address,56),null);assert.equal(f.tracker.read(),'unknown:3');});
test('archive RPC failure preserves lock',async()=>{const f=fixture();f.provider.getTransactionCount=async()=>{throw Error('historical state unavailable');};await assert.rejects(recoverPending(f.tracker,f.provider,address,56));assert.equal(f.tracker.read(),'unknown:3');});
test('mismatched sender, receipt or reorg preserves lock',async()=>{
 for(const mode of ['sender','receipt','reorg']){const f=fixture();let calls=0;f.provider.getBlock=async()=>({hash:mode==='reorg'&&++calls>1?'reorg':'block',prefetchedTransactions:[{from:mode==='sender'?'other':address,nonce:3,hash}]});if(mode==='receipt')f.provider.getTransactionReceipt=async()=>null;assert.equal(await recoverPending(f.tracker,f.provider,address,56),null);assert.equal(f.tracker.read(),'unknown:3');}
});
test('reverted mined transaction resolves but wrong chain never resolves',async()=>{const f=fixture();f.provider.getTransactionReceipt=async()=>({blockHash:'block',blockNumber:123456,status:0});assert.equal((await recoverPending(f.tracker,f.provider,address,56)).receipt.status,0);const g=fixture();await assert.rejects(recoverPending(g.tracker,g.provider,address,97));assert.equal(g.tracker.read(),'unknown:3');});
