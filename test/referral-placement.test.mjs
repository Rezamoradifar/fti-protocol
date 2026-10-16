import test from 'node:test';
import assert from 'node:assert/strict';
import {firstOpenSlot,ZERO_ADDRESS} from '../core/referral-placement.mjs';
import {genesisPlacementIndex,networkPlacementIndexer} from '../scripts/referral-placement-index.mjs';

const address=n=>'0x'+n.toString(16).padStart(40,'0');
const genesis=()=>Array.from({length:31},(_,i)=>address(i+1));

test('a full inviter can refer indefinitely; every new member has only two binary children',async()=>{
 const g=genesis(),idx=genesisPlacementIndex(g),referrer=g[15];
 const placed=[];
 for(let i=0;i<1000;i++){
  const recommendation=await idx.choose(referrer);
  assert.equal(recommendation.referrer,referrer);
  const wallet=address(100+i);
  idx.append(wallet,recommendation.placementParent);
  placed.push(recommendation);
 }
 assert.equal(idx.count(),1031);
 assert.deepEqual(placed.slice(0,9).map(p=>[p.placementParent,p.side]),[
  [referrer,'left'],[referrer,'right'],[address(100),'left'],[address(100),'right'],
  [address(101),'left'],[address(101),'right'],[address(102),'left'],
  [address(102),'right'],[address(103),'left']]);
 assert.equal(placed[999].depth,9);
 const memberships=new Map();for(let n=0;n<1000;n++){
  const parent=placed[n].placementParent;
  memberships.set(parent,(memberships.get(parent)||0)+1);
 }
 assert.ok([...memberships.values()].every(n=>n<=2));
 const deepSponsor=address(100);const next=await idx.choose(deepSponsor);
 assert.notEqual(next.placementParent,referrer);
});

test('referral search rejects unknown sponsor, full subtree and malformed binary links',async()=>{
 const g=genesis(),idx=genesisPlacementIndex(g);
 await assert.rejects(idx.choose(address(500)),/REFERRAL_TREE_INCOMPLETE/);
 await assert.rejects(firstOpenSlot(address(16),async addr=>{
  const m=await idx.getMember(addr);
  return {...m,left:'broken'};
 }),/INVALID_CHILD_ADDRESS/);
 const small=new Map([
  [address(1),{exists:true,left:address(2),right:address(3)}],
  [address(2),{exists:true,left:address(4),right:address(5)}],
  [address(3),{exists:true,left:address(6),right:address(7)}]
 ]);
 await assert.rejects(firstOpenSlot(address(1),async a=>small.get(a),{maxDepth:1}),/REFERRAL_SUBTREE_AT_MAX_DEPTH/);
 await assert.rejects(firstOpenSlot(address(1),async a=>small.get(a),{maxDepth:64,maxNodes:1}),/PLACEMENT_INDEX_CAPACITY_REACHED/);
 await assert.rejects(firstOpenSlot(ZERO_ADDRESS,()=>({exists:true})),/INVALID_REFERRER/);
});

test('network index consumes chronological on-chain Registered receipts only once',async()=>{
 const g=genesis(),first=address(400),second=address(401);
 const logs=[{wallet:first,sponsor:g[15],blockNumber:101},{wallet:second,sponsor:g[15],blockNumber:102}];
 const calls=[];
 const binary={target:address(900),interface:{getEvent:()=>({topicHash:'0xfake'}),parseLog:l=>({name:'Registered',args:l})},
  members:async addr=>{
   if(addr===g[15])return{exists:true,left:first,right:second};
   if(addr===first||addr===second)return{exists:true,left:ZERO_ADDRESS,right:ZERO_ADDRESS};
   return{exists:true,left:ZERO_ADDRESS,right:ZERO_ADDRESS};
  }};
 const provider={getBlockNumber:async()=>105,getLogs:async req=>{calls.push(req);return logs.filter(l=>l.blockNumber>=req.fromBlock&&l.blockNumber<=req.toBlock);}};
 const indexer=networkPlacementIndexer({genesis:g,binary,provider,startBlock:100,chunkSize:100});
 const q=await indexer.choose(g[15]);
 assert.equal(q.placementParent,first);assert.equal(q.side,'left');
 assert.equal(q.indexedMembers,33);assert.equal(q.indexedBlock,105);
 assert.equal(calls.length,1);
 const next=await indexer.choose(g[15]);assert.equal(next.placementParent,first);assert.equal(calls.length,1);
});

test('stale placement never returns a different actual on-chain position',async()=>{
 const g=genesis(),binary={target:address(900),interface:{getEvent:()=>({topicHash:'0xfake'}),parseLog:()=>null},
  members:async a=>({exists:true,left:a===g[15]?address(250):ZERO_ADDRESS,right:ZERO_ADDRESS})};
 const provider={getBlockNumber:async()=>10,getLogs:async()=>[]};
 const idx=networkPlacementIndexer({genesis:g,binary,provider,startBlock:1});
 await assert.rejects(idx.choose(g[15]),/STALE_PLACEMENT_RETRY/);
});

test('six-row network index replays registration into an empty left side without overwriting the right chain',async()=>{
 const {approvedGenesisLayout}=await import('../scripts/approved-genesis-layout.mjs');
 const g=genesis(),first=address(400),logs=[{wallet:first,sponsor:g[8],blockNumber:101}];
 const binary={target:address(900),interface:{getEvent:()=>({topicHash:'0xfake'}),parseLog:l=>({name:'Registered',args:l})},
  members:async a=>a===g[8]?{exists:true,left:first,right:g[16]}:{exists:true,left:ZERO_ADDRESS,right:ZERO_ADDRESS}};
 const provider={getBlockNumber:async()=>105,getLogs:async()=>logs};
 const idx=networkPlacementIndexer({genesis:g,genesisLayout:approvedGenesisLayout().id,binary,provider,startBlock:100,chunkSize:100});
 const graph=await idx.sync();assert.equal((await graph.getMember(g[8])).right,g[16]);assert.equal((await graph.getMember(g[8])).left,first);
 const q=await idx.choose(g[8]);assert.equal(q.placementParent,first);assert.equal(q.side,'left');assert.equal(q.indexedMembers,32);
});
