import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventHistoryReader,PUBLIC_EVENT_RPC} from '../scripts/event-history-source.mjs';

const TOKEN='0x1111111111111111111111111111111111111111',BINARY='0x2222222222222222222222222222222222222222';
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),BOUGHT=hash(11),SOLD=hash(12);
const contract=target=>({target,interface:{getEvent:name=>({topicHash:name==='Bought'?BOUGHT:SOLD}),parseLog:log=>({name:log.topics[0]===BOUGHT?'Bought':'Sold',args:{usdIn:100n,userTokens:970n,usdOut:99n,tokensIn:970n},fragment:{inputs:[]}})}});
const trade=(i=0,extra={})=>({address:TOKEN,blockNumber:1980,blockHash:hash(1980),transactionHash:hash(3000+i),index:i,data:'0x1234',topics:[BOUGHT],removed:false,...extra});
function fixture({logs=[trade()],configuredWorks=false,chainId=56}={}){
 const calls={primary:0,configured:0,fallback:0,receipts:0,blocks:[],filters:[]};
 const now=Math.floor(Date.now()/1000),block=n=>({number:n,hash:hash(n),timestamp:n===2000?now:now-10});
 const primary={getNetwork:async()=>{calls.primary++;return {chainId:BigInt(chainId)};},getBlockNumber:async()=>{calls.primary++;return 2000;},getBlock:async n=>{calls.primary++;calls.blocks.push(n);return block(n==='latest'?2000:Number(n));},getTransactionReceipt:async tx=>{calls.receipts++;const matching=logs.filter(l=>l.transactionHash===tx);return {hash:tx,transactionHash:tx,blockNumber:matching[0]?.blockNumber,blockHash:matching[0]?.blockHash,status:1,logs:matching};}};
 const source=(name,works)=>({getNetwork:async()=>({chainId:BigInt(chainId)}),getBlockNumber:async()=>2000,getBlock:async n=>({...block(n==='latest'?2000:Number(n)),timestamp:1}),getLogs:async filter=>{calls[name]++;calls.filters.push({name,...filter});if(!works)throw Error('method eth_getLogs is not available');return logs.filter(l=>l.blockNumber>=filter.fromBlock&&l.blockNumber<=filter.toBlock&&l.address.toLowerCase()===filter.address.toLowerCase());}});
 const eventProvider=source('configured',configuredWorks),fallbackProvider=source('fallback',true);
 const cfg={chainId,deployedBlock:100},contracts={token:contract(TOKEN),binary:contract(BINARY)};
 return {primary,eventProvider,fallbackProvider,cfg,contracts,calls,logs,block,read:()=>createEventHistoryReader({primary,eventProvider,fallbackProvider,cfg,contracts})};
}

test('fallback constant is the separately configured public history endpoint',()=>assert.equal(PUBLIC_EVENT_RPC,'https://bsc-rpc.publicnode.com'));
test('market fallback verifies primary receipts and uses primary block timestamps in the fixed confirmed window',async()=>{
 const f=fixture(),data=await f.read()('market');
 assert.deepEqual([data.fromBlock,data.toBlock],[1689,1988]);assert.equal(data.trades.length,1);assert.equal(data.trades[0].time,f.block(1980).timestamp);
 assert.equal(f.calls.receipts,1);assert.equal(f.calls.configured,1);assert.ok(f.calls.fallback>0);assert.ok(f.calls.blocks.includes(1980));
});
test('successful configured reads never try fallback, including a real empty result',async()=>{
 const f=fixture({configuredWorks:true,logs:[]}),data=await f.read()('market');assert.deepEqual(data.trades,[]);assert.equal(f.calls.fallback,0);
});
test('event fallback keeps the fixed 1500-block window and actual parsed events',async()=>{
 const f=fixture(),data=await f.read()('events');assert.equal(data.length,1);assert.equal(data[0].hash,trade().transactionHash);
 const filters=f.calls.filters.filter(x=>x.name==='fallback');assert.equal(Math.min(...filters.map(x=>x.fromBlock)),489);assert.equal(Math.max(...filters.map(x=>x.toBlock)),1988);
});
for(const failure of ['chain','hash'])test(`configured ${failure} identity mismatch fails closed before fallback`,async()=>{
 const f=fixture();if(failure==='chain')f.eventProvider.getNetwork=async()=>({chainId:1n});else f.eventProvider.getBlock=async n=>({...f.block(Number(n)),hash:hash(999)});
 await assert.rejects(f.read()('market'));assert.equal(f.calls.fallback,0);assert.equal(f.calls.configured,0);
});
for(const failure of ['chain','hash'])test(`fallback ${failure} identity mismatch fails closed`,async()=>{
 const f=fixture();if(failure==='chain')f.fallbackProvider.getNetwork=async()=>({chainId:1n});else f.fallbackProvider.getBlock=async n=>({...f.block(Number(n)),hash:hash(999)});
 await assert.rejects(f.read()('market'));assert.equal(f.calls.fallback,0);
});
test('both sources failing never becomes an empty market or activity result',async()=>{
 for(const kind of ['market','events']){const f=fixture();f.fallbackProvider.getLogs=async()=>{throw Error('HTTP 403');};await assert.rejects(f.read()(kind));}
});
for(const [name,mutation] of [
 ['removed',l=>({...l,removed:true})],['address',l=>({...l,address:BINARY})],['range',l=>({...l,blockNumber:1989})],['topics',l=>({...l,topics:[hash(99)]})]
])test(`fallback rejects ${name} log outside the requested filter`,async()=>{
 const f=fixture();f.fallbackProvider.getLogs=async()=>[mutation(trade())];await assert.rejects(f.read()('market'));
});
for(const [name,mutation] of [
 ['address',l=>({...l,address:BINARY})],['data',l=>({...l,data:'0xabcd'})],['topics',l=>({...l,topics:[SOLD]})],['index',l=>({...l,index:9})],['transaction hash',l=>({...l,transactionHash:hash(77)})],['block hash',l=>({...l,blockHash:hash(77)})],['block number',l=>({...l,blockNumber:1979})]
])test(`fallback receipt must contain an exact primary ${name} match`,async()=>{
 const f=fixture();f.primary.getTransactionReceipt=async tx=>({hash:tx,transactionHash:tx,blockNumber:1980,blockHash:hash(1980),status:1,logs:[mutation(trade())]});await assert.rejects(f.read()('market'));
});
test('fallback log block must remain canonical on the primary provider',async()=>{
 const f=fixture(),original=f.primary.getBlock;f.primary.getBlock=async n=>n===1980?{...f.block(n),hash:hash(66)}:original(n);await assert.rejects(f.read()('market'));
});
test('primary anchor reorg after loading rejects the whole result',async()=>{
 const f=fixture();let reads=0;const original=f.primary.getBlock;f.primary.getBlock=async n=>{const value=await original(n);return Number(n)===1988&&++reads>1?{...value,hash:hash(88)}:value;};await assert.rejects(f.read()('market'));
});
test('receipt reads are deduplicated per transaction',async()=>{
 const f=fixture({logs:[trade(),trade(1,{transactionHash:trade().transactionHash})]}),data=await f.read()('market');assert.equal(data.trades.length,2);assert.equal(f.calls.receipts,1);
});
test('receipt verification has bounded concurrency',async()=>{
 const f=fixture({logs:Array.from({length:12},(_,i)=>trade(i))}),original=f.primary.getTransactionReceipt;let active=0,max=0;
 f.primary.getTransactionReceipt=async tx=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,1));const receipt=await original(tx);active--;return receipt;};
 assert.equal((await f.read()('market')).trades.length,12);assert.ok(max<=4);assert.ok(max>0);
});
test('more than 100 receipt candidates is refused',async()=>{
 const f=fixture({logs:Array.from({length:101},(_,i)=>trade(i))});await assert.rejects(f.read()('market'));assert.ok(f.calls.receipts<=100);
});
test('stale primary heads are rejected before reading event sources',async()=>{
 const f=fixture(),original=f.primary.getBlock;f.primary.getBlock=async n=>({...await original(n),timestamp:Math.floor(Date.now()/1000)-120});await assert.rejects(f.read()('market'));assert.equal(f.calls.configured,0);assert.equal(f.calls.fallback,0);
});
test('abort during configured loading never starts fallback',async()=>{
 const f=fixture(),controller=new AbortController();f.eventProvider.getLogs=async()=>{controller.abort();throw Error('offline');};await assert.rejects(f.read()('market',controller.signal));assert.equal(f.calls.fallback,0);
});
test('pre-aborted reads make no provider calls',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(f.read()('events',controller.signal));assert.equal(f.calls.primary+f.calls.configured+f.calls.fallback,0);
});
test('legacy network preserves eventProvider latest range and never touches primary or fallback',async()=>{
 const f=fixture({chainId:31337,configuredWorks:true,logs:[]});f.primary.getNetwork=async()=>{throw Error('primary must not be used');};f.fallbackProvider.getNetwork=async()=>{throw Error('fallback must not be used');};
 const data=await f.read()('market');assert.deepEqual([data.fromBlock,data.toBlock],[1701,2000]);assert.equal(f.calls.primary,0);assert.equal(f.calls.fallback,0);
});
test('configured malformed activity logs fail closed through the reader error wrapper',async()=>{
 const f=fixture({configuredWorks:true});f.eventProvider.getLogs=async()=>[trade(0,{address:'0x3333333333333333333333333333333333333333'})];await assert.rejects(f.read()('events'));assert.equal(f.calls.fallback,0);
});
test('receipt limiter is shared across concurrent history reads',async()=>{
 const f=fixture({logs:Array.from({length:12},(_,i)=>trade(i))}),original=f.primary.getTransactionReceipt,read=f.read();let active=0,max=0;
 f.primary.getTransactionReceipt=async tx=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,1));try{return await original(tx);}finally{active--;}};
 const [market,events]=await Promise.all([read('market'),read('events')]);assert.equal(market.trades.length,12);assert.equal(events.length,12);assert.equal(f.calls.receipts,24);assert.ok(max<=4);
});
test('aborted queued waiter transfers its reserved slot to the next concurrent read',async()=>{
 const f=fixture({configuredWorks:true,logs:[]}),read=f.read(),controllers=Array.from({length:6},()=>new AbortController()),gates=[];let started=0,active=0,max=0;
 f.primary.getNetwork=async()=>{started++;active++;max=Math.max(max,active);await new Promise(resolve=>gates.push(resolve));active--;return {chainId:56n};};
 const settled=Promise.allSettled(controllers.map(c=>read('market',c.signal)));await new Promise(setImmediate);assert.equal(started,4);controllers[4].abort();gates.shift()();await new Promise(setImmediate);
 try{assert.equal(started,5,'the next waiter must acquire the released slot even while three earlier calls remain blocked');assert.ok(max<=4);}finally{for(const release of gates.splice(0))release();}
 const results=await settled;assert.equal(results.filter(r=>r.status==='fulfilled').length,5);assert.equal(results[4].status,'rejected');
});

test('duplicate fallback logs do not duplicate actual trade volume',async()=>{const log=trade(),f=fixture({logs:[log,{...log}]});const data=await f.read()('market');assert.equal(data.trades.length,1);assert.equal(f.calls.receipts,1);});
