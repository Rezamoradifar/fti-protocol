import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoverPending} from '../frontend/recover-pending.js';
const address='0x'+'1'.repeat(40),hash='0x'+'a'.repeat(64);
function fixture(){
 let record='unknown:3',reads=0;
 const tracker={read:()=>record,clear:()=>{record=null;}};
 const provider={getNetwork:async()=>({chainId:56n}),getBlockNumber:async()=>1000000,getTransactionCount:async(a,n)=>{reads++;return n<123456?3:4;},getBlock:async n=>({hash:'block',prefetchedTransactions:[{from:address,nonce:3,hash}]}),getTransactionReceipt:async()=>({hash,blockHash:'block',blockNumber:123456,status:1})};
 return {tracker,provider,reads:()=>reads};
}
test('finds old mined sender nonce in bounded reads without sending',async()=>{const f=fixture();const result=await recoverPending(f.tracker,f.provider,address,56);assert.equal(result.hash,hash);assert.equal(f.tracker.read(),null);assert.ok(f.reads()<64);});
test('pending or unbroadcast nonce never unlocks',async()=>{const f=fixture();f.provider.getTransactionCount=async()=>3;assert.equal(await recoverPending(f.tracker,f.provider,address,56),null);assert.equal(f.tracker.read(),'unknown:3');});
test('archive RPC failure preserves lock',async()=>{const f=fixture();f.provider.getTransactionCount=async()=>{throw Error('historical state unavailable');};await assert.rejects(recoverPending(f.tracker,f.provider,address,56));assert.equal(f.tracker.read(),'unknown:3');});
test('mismatched sender, receipt or reorg preserves lock',async()=>{
 for(const mode of ['sender','receipt','reorg']){const f=fixture();let calls=0;f.provider.getBlock=async()=>({hash:mode==='reorg'&&++calls>1?'reorg':'block',prefetchedTransactions:[{from:mode==='sender'?'other':address,nonce:3,hash}]});if(mode==='receipt')f.provider.getTransactionReceipt=async()=>null;assert.equal(await recoverPending(f.tracker,f.provider,address,56),null);assert.equal(f.tracker.read(),'unknown:3');}
});
test('reverted mined transaction resolves but wrong chain never resolves',async()=>{const f=fixture();f.provider.getTransactionReceipt=async()=>({hash,blockHash:'block',blockNumber:123456,status:0});assert.equal((await recoverPending(f.tracker,f.provider,address,56)).receipt.status,0);const g=fixture();await assert.rejects(recoverPending(g.tracker,g.provider,address,97));assert.equal(g.tracker.read(),'unknown:3');});

const contract='0x'+'2'.repeat(40),topic='0x'+address.slice(2).padStart(64,'0');
function prunedFixture(){
 let record='unknown:3';const calls=[],events=[];
 const block=999900,log={address:contract,topics:['event',topic],transactionHash:hash,blockHash:'canonical',blockNumber:block,removed:false};
 const tx={hash,from:address,nonce:3};
 const receipt={hash,blockHash:'canonical',blockNumber:block,status:1};
 const tracker={read:()=>record,remember:value=>events.push(['remember',value]),clear:()=>{events.push(['clear']);record=null;}};
 const provider={getNetwork:async()=>({chainId:56n}),getBlockNumber:async()=>1000000,getTransactionCount:async(a,n)=>{if(n===999988)return 4;throw Error('missing trie node');},getLogs:async filter=>{calls.push(filter);return block>=filter.fromBlock&&block<=filter.toBlock?[log]:[];},getTransaction:async()=>tx,getTransactionReceipt:async()=>receipt,getBlock:async()=>({hash:'canonical'})};
 return {tracker,provider,log,tx,receipt,calls,events,setRecord:value=>{record=value;}};
}
const options={logAddresses:[contract]};
test('pruned historical state recovers a real indexed transaction after canonical verification',async()=>{
 const f=prunedFixture();const found=await recoverPending(f.tracker,f.provider,address,56,options);
 assert.equal(found.hash,hash);assert.equal(f.tracker.read(),null);assert.deepEqual(f.events,[['remember',hash],['clear']]);
 assert.ok(f.calls.length<=10);for(const filter of f.calls){assert.deepEqual(filter.address,[contract]);assert.deepEqual(filter.topics,[null,topic]);assert.ok(filter.toBlock-filter.fromBlock<2000);assert.ok(filter.toBlock<=999988);assert.ok(filter.fromBlock>=979989);}
});
test('a pruned safe-head count still permits canonical log recovery',async()=>{
 const f=prunedFixture();f.provider.getTransactionCount=async()=>{throw Error('missing trie node');};
 const result=await recoverPending(f.tracker,f.provider,address,56,options);
 assert.equal(result.hash,hash);assert.equal(f.tracker.read(),null);
 assert.deepEqual(f.events,[['remember',hash],['clear']]);
});
test('a wallet indexed in a log cannot release a different sender, nonce or transaction hash',async()=>{
 for(const mode of ['sender','nonce','hash']){const f=prunedFixture();if(mode==='sender')f.tx.from=contract;if(mode==='nonce')f.tx.nonce=4;if(mode==='hash')f.tx.hash='0x'+'b'.repeat(64);
  assert.equal(await recoverPending(f.tracker,f.provider,address,56,options),null);assert.equal(f.tracker.read(),'unknown:3');assert.deepEqual(f.events,[]);
 }
});
test('log recovery preserves the lock on tampered receipts, reorgs, or changed browser state',async()=>{
 for(const mode of ['receipt-hash','receipt-block','unsafe-block','status','log-block-hash','reorg','record']){
  const f=prunedFixture();
  if(mode==='receipt-hash')f.receipt.hash='0x'+'b'.repeat(64);
  if(mode==='receipt-block')f.receipt.blockNumber--;
  if(mode==='unsafe-block')f.receipt.blockNumber=1000000;
  if(mode==='status')f.receipt.status=2;
  if(mode==='log-block-hash')f.log.blockHash='other';
  if(mode==='reorg')f.provider.getBlock=async()=>({hash:'replacement'});
  if(mode==='record')f.provider.getBlock=async()=>{f.setRecord('unknown:4');return {hash:'canonical'};};
  assert.equal(await recoverPending(f.tracker,f.provider,address,56,options),null);assert.equal(f.tracker.read(),mode==='record'?'unknown:4':'unknown:3');assert.deepEqual(f.events,[]);
 }
});
test('unknown pending nonce, failed log RPC and missing matches never imply a failed broadcast',async()=>{
 const pending=prunedFixture();pending.provider.getTransactionCount=async()=>3;
 assert.equal(await recoverPending(pending.tracker,pending.provider,address,56,options),null);assert.equal(pending.calls.length,0);assert.equal(pending.tracker.read(),'unknown:3');
 for(const mode of ['unavailable','empty','removed','topic','contract']){const f=prunedFixture();
  if(mode==='unavailable')f.provider.getLogs=async()=>{throw Error('limit exceeded');};
  if(mode==='empty')f.provider.getLogs=async()=>[];
  if(mode==='removed')f.log.removed=true;
  if(mode==='topic')f.log.topics[1]='0x'+'0'.repeat(64);
  if(mode==='contract')f.log.address='0x'+'3'.repeat(40);
  assert.equal(await recoverPending(f.tracker,f.provider,address,56,options),null);assert.equal(f.tracker.read(),'unknown:3');assert.deepEqual(f.events,[]);
 }
});
test('recent log candidate examination is bounded and cannot exceed 64 logs',async()=>{
 const f=prunedFixture();let txReads=0;f.provider.getLogs=async()=>Array.from({length:65},(_,i)=>({...f.log,transactionHash:'0x'+i.toString(16).padStart(64,'0')}));f.provider.getTransaction=async()=>{txReads++;return null;};
 assert.equal(await recoverPending(f.tracker,f.provider,address,56,options),null);assert.ok(txReads<=64);assert.equal(f.tracker.read(),'unknown:3');assert.deepEqual(f.events,[]);
});
test('primary history recovery also remembers the exact verified hash before releasing the request',async()=>{
 const f=fixture(),events=[];f.tracker.remember=value=>events.push(value);const clear=f.tracker.clear;f.tracker.clear=()=>{assert.deepEqual(events,[hash]);clear();};
 assert.equal((await recoverPending(f.tracker,f.provider,address,56)).hash,hash);
});
