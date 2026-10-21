import test from 'node:test';
import assert from 'node:assert/strict';
import {historyCache} from '../scripts/history-cache.mjs';

test('concurrent requests share actual successful history and expire at the original read time',async()=>{
 let now=0,calls=0,finish;
 const read=historyCache(()=>{calls++;return new Promise(resolve=>finish=resolve);},{now:()=>now,ttlMs:100});
 const a=read(),b=read();await Promise.resolve();assert.equal(calls,1);finish({trades:[]});
 assert.strictEqual(await a,await b);now=99;assert.deepEqual(await read(),{trades:[]});assert.equal(calls,1);
 now=100;const next=read();await Promise.resolve();assert.equal(calls,2);finish({trades:[1]});assert.deepEqual(await next,{trades:[1]});
});
test('failed history is briefly coalesced, never an empty success or an old successful payload',async()=>{
 let now=0,calls=0,fail=false;
 const read=historyCache(async()=>{calls++;if(fail)throw Error('RPC unavailable');return ['actual'];},{now:()=>now,ttlMs:100,failureTtlMs:50});
 assert.deepEqual(await read(),['actual']);now=100;fail=true;
 await assert.rejects(read(),/unavailable/);await assert.rejects(read(),/unavailable/);assert.equal(calls,2);
 now=150;fail=false;assert.deepEqual(await read(),['actual']);assert.equal(calls,3);
});
test('a timed-out upstream call remains single-flight until it drains and its late result is discarded',async()=>{
 let now=0,calls=0,finish,signal;
 const read=historyCache(s=>{calls++;signal=s;return new Promise(resolve=>finish=resolve);},{now:()=>now,timeoutMs:5,failureTtlMs:10});
 await assert.rejects(read(),/deadline/);assert.equal(signal.aborted,true);assert.equal(calls,1);
 now=20;await assert.rejects(read(),/deadline/);assert.equal(calls,1);
 finish(['late']);await new Promise(resolve=>setImmediate(resolve));
 const next=read();await Promise.resolve();assert.equal(calls,2);finish(['fresh']);assert.deepEqual(await next,['fresh']);
});
