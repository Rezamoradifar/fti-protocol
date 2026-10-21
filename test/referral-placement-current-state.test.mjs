import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {networkPlacementIndexer} from '../scripts/referral-placement-index.mjs';
import {ZERO_ADDRESS as ZERO} from '../core/referral-placement.mjs';
const a=n=>'0x'+n.toString(16).padStart(40,'0'),genesis=Array.from({length:31},(_,i)=>a(i+1)),HASH='0x'+'a'.repeat(64),OTHER='0x'+'b'.repeat(64),REF=genesis[15];
function fixture(options={}){
 const calls=[],nodes=new Map(),depths=new Map(),state={head:{number:100,timestamp:1000,hash:HASH},chain:56n,hook:async()=>{}};
 nodes.set(REF,{exists:true,parent:genesis[7],left:ZERO,right:ZERO});depths.set(REF,4n);
 async function call(method,args,result){calls.push({method,args});await state.hook(method,args);return typeof result==='function'?result(...args):result;}
 const primary={getNetwork:()=>call('network',[],()=>({chainId:state.chain})),getBlock:tag=>call('block',[tag],()=>({...state.head})),getLogs:()=>assert.fail('Current placement must not read logs')};
 const binary={target:a(900),runner:primary,interface:{getEvent:()=>({topicHash:'0xtopic'}),parseLog:()=>assert.fail('Current placement must not parse logs')},
  members:(...args)=>call('members',args,wallet=>({...nodes.get(wallet)})),depth:(...args)=>call('depth',args,wallet=>depths.get(wallet))};
 const provider={getLogs:()=>assert.fail('Placement must not scan event provider'),getBlock:()=>assert.fail('Header must use the contract provider'),getNetwork:()=>assert.fail('Network must use the contract provider')};
 const index=networkPlacementIndexer({genesis,binary,provider,startBlock:1,chainId:56,...options});
 const add=(wallet,parent,depth,left=ZERO,right=ZERO)=>{nodes.set(wallet,{exists:true,parent,left,right});depths.set(wallet,BigInt(depth));};
 return{index,state,calls,nodes,depths,primary,binary,add};
}

test('a leaf sponsor is resolved from one canonical current block with no history provider calls',async()=>{
 const f=fixture(),q=await f.index.choose(REF);
 assert.deepEqual(q,{referrer:REF,placementParent:REF,side:'left',depth:1,visited:1,source:'canonical-state',chainId:56,block:100,blockHash:HASH,placementParentDepth:4});
 assert.equal('indexedMembers' in q,false);
 for(const c of f.calls)if(['members','depth'].includes(c.method))assert.deepEqual(c.args.at(-1),{blockTag:100});
 assert.equal(f.calls.filter(c=>c.method==='network').length,2);
});

test('full sponsors use strict breadth-first left-to-right placement and verify physical parent depth',async()=>{
 const f=fixture();f.add(REF,genesis[7],4,a(100),a(101));f.add(a(100),REF,5,a(102),a(103));f.add(a(101),REF,5);f.add(a(102),a(100),6);f.add(a(103),a(100),6);
 const q=await f.index.choose(REF);assert.equal(q.placementParent,a(101));assert.equal(q.side,'left');assert.equal(q.depth,2);assert.equal(q.visited,3);assert.equal(q.placementParentDepth,5);
});

test('absolute depth 63 permits a child at 64, but depth 64 and inconsistent selected-parent depth fail closed',async()=>{
 const at63=fixture();at63.depths.set(REF,63n);assert.equal((await at63.index.choose(REF)).placementParentDepth,63);
 const at64=fixture();at64.depths.set(REF,64n);await assert.rejects(at64.index.choose(REF),/REFERRAL_SUBTREE_AT_MAX_DEPTH/);
 const mismatch=fixture();mismatch.add(REF,genesis[7],4,a(100),a(101));mismatch.add(a(100),REF,7);mismatch.add(a(101),REF,5);
 await assert.rejects(mismatch.index.choose(REF),/STALE_PLACEMENT_RETRY/);
});

test('unknown sponsors, malformed member fields, cycles, wrong ancestry and scan exhaustion never return a suggestion',async()=>{
 for(const kind of ['unknown','malformed','cycle','ancestry','capacity']){
  const f=fixture(kind==='capacity'?{maxPlacementNodes:1}:{});
  if(kind==='unknown')f.nodes.set(REF,{exists:false,parent:ZERO,left:ZERO,right:ZERO});
  if(kind==='malformed')f.nodes.get(REF).left='bad';
  if(kind==='cycle')f.nodes.get(REF).right=REF;
  if(['ancestry','capacity'].includes(kind)){f.add(REF,genesis[7],4,a(100),a(101));f.add(a(100),kind==='ancestry'?a(999):REF,5);f.add(a(101),REF,5);}
  await assert.rejects(f.index.choose(REF));
 }
});

test('a changing selected vacancy, canonical block or network is rejected before returning placement',async()=>{
 for(const kind of ['vacancy','hash','network','latest']){
  const f=fixture();let memberReads=0,networkReads=0;
  f.state.hook=async(method,args)=>{
   if(kind==='vacancy'&&method==='members'&&++memberReads===2)f.nodes.get(REF).left=a(100);
   if(kind==='hash'&&method==='block'&&args[0]===100)f.state.head.hash=OTHER;
   if(kind==='network'&&method==='network'&&++networkReads===2)f.state.chain=97n;
   if(kind==='latest'&&method==='block'&&args[0]===100)f.state.head.number=99;
  };
  await assert.rejects(f.index.choose(REF),/STALE_PLACEMENT_RETRY|PLACEMENT_CHAIN_CHANGED/);
 }
});

test('wrong chains and malformed headers fail before member traversal; upstream RPC details never escape',async()=>{
 const wrong=fixture();wrong.state.chain=97n;await assert.rejects(wrong.index.choose(REF),/WRONG_PLACEMENT_CHAIN/);assert.equal(wrong.calls.some(c=>c.method==='members'),false);
 for(const change of [{hash:'bad'},{timestamp:0},{number:-1}]){const f=fixture();Object.assign(f.state.head,change);await assert.rejects(f.index.choose(REF),/INVALID_PLACEMENT_BLOCK/);}
 const failed=fixture();failed.state.hook=async method=>{if(method==='members')throw Error('private https://rpc.invalid/secret-key');};
 await assert.rejects(failed.index.choose(REF),error=>error.message==='PLACEMENT_RPC_UNAVAILABLE'&&!('cause' in error));
});

test('same-sponsor requests share a flight and timeout never resumes scanning or releases an unsettled native read',async()=>{
 const f=fixture({placementTimeoutMs:20});let release,first=true;
 f.state.hook=async method=>{if(method==='members'&&first){first=false;await new Promise(resolve=>{release=resolve;});}};
 const pending=f.index.choose(REF);assert.equal(f.index.choose(REF),pending);await assert.rejects(pending,/PLACEMENT_TIMEOUT/);
 const count=f.calls.length;await assert.rejects(f.index.choose(REF),/PLACEMENT_TIMEOUT/);assert.equal(f.calls.length,count);
 release();await tick();await tick();assert.equal(f.calls.length,count);assert.equal((await f.index.choose(REF)).source,'canonical-state');
});

test('admission remains bounded while timed-out native reads are unsettled',async()=>{
 const f=fixture({placementTimeoutMs:20}),release=[];
 for(let i=40;i<44;i++)f.add(a(i),genesis[7],4);
 f.state.hook=async method=>{if(method==='members')await new Promise(resolve=>release.push(resolve));};
 const pending=Array.from({length:4},(_,i)=>assert.rejects(f.index.choose(a(40+i)),/PLACEMENT_TIMEOUT/));
 await assert.rejects(f.index.choose(a(44)),/PLACEMENT_BUSY/);await Promise.all(pending);
 await assert.rejects(f.index.choose(a(44)),/PLACEMENT_BUSY/);const count=f.calls.length;release.forEach(resolve=>resolve());await tick();await tick();assert.equal(f.calls.length,count);
});
