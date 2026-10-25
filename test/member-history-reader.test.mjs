import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface} from 'ethers';
import {createMemberHistoryReader} from '../scripts/member-history.mjs';

const A='0x'+'a1'.repeat(20),B='0x'+'b2'.repeat(20),C='0x'+'c3'.repeat(20),D='0x'+'d4'.repeat(20),H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const binary={target:B,interface:new Interface(['event Registered(address indexed wallet,address indexed sponsor,uint256 units)','event Paused(address account)'])};
const token={target:C,interface:new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)'])};
function log(contract,name,args,block,index=0){const {data,topics}=contract.interface.encodeEventLog(contract.interface.getEvent(name),args);return {address:contract.target,data,topics,blockNumber:block,blockHash:H(block),transactionHash:H(block*100+index),index,removed:false};}
function fixture({head=1001,deployedBlock=1,logs=[],chainId=31337,source=false}={}){
 let clock=1800000000000,latest=head;const calls=[];
 const blocks=n=>({number:n,hash:H(n),timestamp:1800000000-10000+n});
 const p={getNetwork:async()=>({chainId:BigInt(chainId)}),getBlock:async n=>{calls.push(['block',n]);return blocks(n==='latest'?latest:n);},getTransactionReceipt:async hash=>{calls.push(['receipt',hash]);const matching=logs.filter(l=>l.transactionHash===hash);return matching.length?{status:1,hash,blockNumber:matching[0].blockNumber,blockHash:matching[0].blockHash,logs:matching}:null;},getLogs:async filter=>{calls.push(['logs',filter]);return logs.filter(l=>l.address.toLowerCase()===filter.address.toLowerCase()&&l.blockNumber>=filter.fromBlock&&l.blockNumber<=filter.toBlock&&filter.topics.every((value,i)=>value===null||(Array.isArray(value)?value:[value]).some(v=>v.toLowerCase()===l.topics[i]?.toLowerCase())));}};
 const eventProvider=source?{...p}:p,cfg={chainId,deployedBlock},secret=Buffer.alloc(32,3);
 const create=(overrides={})=>createMemberHistoryReader({provider:p,eventProvider,contracts:{binary,token},cfg,now:()=>clock,cursorSecret:secret,...overrides});
 return {p,eventProvider,cfg,calls,read:create(),create,clock:v=>clock=v,head:v=>latest=v};
}

test('personal history uses indexed wallet topics, decodes exact values and receipt-verifies every returned event',async()=>{
 const logs=[log(binary,'Registered',[A,D,100n],1000),log(token,'Transfer',[D,A,9007199254740993000000000n],999),log(binary,'Paused',[D],997),log(binary,'Paused',[A],998),log(token,'Transfer',[D,D,1n],996)];
 const f=fixture({logs});const page=await f.read({wallet:A});
 assert.deepEqual(page.rows.map(r=>r.name),['Registered','Transfer','Paused']);assert.equal(page.rows[1].args[2].value,'9007199254740993000000000');
 assert.equal(page.scope,'FTI_CONTRACT_ADDRESS_EVENTS');assert.equal(page.snapshot.number,1001);assert.equal(page.range.from,2);assert.equal(page.range.to,1001);assert.equal(page.range.complete,false);assert(page.nextCursor);
 assert(f.calls.filter(c=>c[0]==='logs').length<=100);assert(f.calls.filter(c=>c[0]==='logs').every(([,q])=>q.toBlock-q.fromBlock<=99));
 assert.equal(f.calls.filter(c=>c[0]==='receipt').length,3);
});
test('overlapping address filters deduplicate exact logs, and same-block pagination never skips older events',async()=>{
 const logs=[log(token,'Transfer',[A,A,3n],1001,2),log(token,'Transfer',[A,D,2n],1001,1),log(binary,'Registered',[A,D,1n],990,0)];
 const f=fixture({logs});const first=await f.read({wallet:A,limit:1});assert.equal(first.rows.length,1);assert.equal(first.rows[0].index,2);
 f.head(1010);const second=await f.read({wallet:A,limit:1,cursor:first.nextCursor});assert.equal(second.rows[0].index,1);assert.equal(second.snapshot.number,1001);
 const third=await f.read({wallet:A,limit:1,cursor:second.nextCursor});assert.equal(third.rows[0].block,990);
 const empty=await f.read({wallet:A,cursor:third.nextCursor});assert.equal(empty.range.from,1);assert.equal(empty.range.to,1);assert.equal(empty.range.complete,true);assert.equal(empty.nextCursor,null);
});
test('empty pages explicitly continue until the verified deployment boundary',async()=>{
 const f=fixture({head:2001});const a=await f.read({wallet:A});assert.deepEqual(a.rows,[]);assert.equal(a.range.complete,false);assert.equal(a.range.from,1002);
 const b=await f.read({wallet:A,cursor:a.nextCursor});assert.equal(b.range.complete,false);assert.equal(b.range.from,2);
 const c=await f.read({wallet:A,cursor:b.nextCursor});assert.equal(c.range.complete,true);assert.equal(c.range.from,1);assert.equal(c.nextCursor,null);
});
test('cursor integrity binds wallet, chain, contract set and deployment, and expires',async()=>{
 const f=fixture(),first=await f.read({wallet:A});
 await assert.rejects(f.read({wallet:D,cursor:first.nextCursor}),/cursor/);
 await assert.rejects(f.read({wallet:A,cursor:first.nextCursor+'A'}),/cursor/);
 await assert.rejects(f.create({cfg:{...f.cfg,deployedBlock:2}})({wallet:A,cursor:first.nextCursor}),/cursor/);
 await assert.rejects(f.create({contracts:{binary:{...binary,target:D},token}})({wallet:A,cursor:first.nextCursor}),/cursor/);
 f.clock(1800000000000+31*60*1000);await assert.rejects(f.read({wallet:A,cursor:first.nextCursor}),/cursor/);
});
test('network/source/anchor mismatches and unverified receipts fail instead of returning fabricated empty history',async()=>{
 const f=fixture({source:true});f.eventProvider.getNetwork=async()=>({chainId:56n});await assert.rejects(f.read({wallet:A}),/network/);
 const g=fixture({source:true});g.eventProvider.getBlock=async n=>({number:n,hash:H(999999)});await assert.rejects(g.read({wallet:A}),/anchor/);
 const event=log(binary,'Registered',[A,D,1n],1000),h=fixture({logs:[event]});h.p.getTransactionReceipt=async()=>null;await assert.rejects(h.read({wallet:A}),/receipt/);
 const i=fixture(),first=await i.read({wallet:A}),original=i.p.getBlock;i.p.getBlock=async n=>({...await original(n),hash:H(7)});await assert.rejects(i.read({wallet:A,cursor:first.nextCursor}),/anchor/);
});
test('malformed, wrong-range, mismatched-topic and conflicting duplicate logs reject the complete page',async()=>{
 for(const patch of [{blockNumber:3000},{removed:true},{blockHash:'0x'},{topics:[H(33)]},{address:D},{index:-1},{data:'0xzz'}]){
  const event=log(binary,'Registered',[A,D,1n],1000),f=fixture({logs:[event]});f.p.getLogs=async()=>[{...event,...patch}];await assert.rejects(f.read({wallet:A}),/history log/);
 }
});
test('RPC availability failures propagate without retry splitting or advancing a cursor',async()=>{
 const f=fixture();f.p.getLogs=async()=>{throw Error('quota exceeded');};await assert.rejects(f.read({wallet:A}),/quota/);
 const abort=new AbortController();abort.abort();await assert.rejects(f.read({wallet:A},abort.signal),{name:'AbortError'});
});
test('page validation rejects invalid identities and unbounded limits before any RPC request',async()=>{
 const f=fixture();for(const wallet of ['bad','0x'+'0'.repeat(40)])await assert.rejects(f.read({wallet}),/wallet/);
 for(const limit of [0,51,1.2,'50'])await assert.rejects(f.read({wallet:A,limit}),/limit/);assert.equal(f.calls.length,0);
 assert.throws(()=>f.create({cfg:{chainId:31337}}),/deployment block/);
});
test('BNB mainnet pages pin a canonical twelve-confirmation anchor and reject stale heads',async()=>{
 const f=fixture({chainId:56});const original=f.p.getBlock;f.p.getBlock=async n=>({...await original(n),timestamp:1800000000});const page=await f.read({wallet:A});assert.equal(page.snapshot.number,989);
 f.clock(1800000000000+46000);await assert.rejects(f.read({wallet:A}),/Stale/);
});
test('cancellation releases HTTP work promptly while holding actual RPC concurrency to four',async()=>{
 const f=fixture();let gated=true,active=0,max=0;const pending=[];
 f.p.getLogs=async()=>{active++;max=Math.max(max,active);try{if(gated)await new Promise(resolve=>pending.push(resolve));return [];}finally{active--;}};
 const abort=new AbortController(),first=f.read({wallet:A},abort.signal);const rejected=assert.rejects(first,{name:'AbortError'});
 for(let i=0;i<40&&pending.length<4;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(pending.length,4);abort.abort();await rejected;
 const second=f.read({wallet:A});await new Promise(resolve=>setImmediate(resolve));assert.equal(pending.length,4);assert.equal(max,4);
 gated=false;for(const resolve of pending)resolve();const page=await second;assert.equal(page.rows.length,0);assert.equal(max,4);
});
test('real local EVM logs and canonical receipts decode through the installed contract ABI',async()=>{
 const [{default:ganache},{BrowserProvider},{deployOne}]=await Promise.all([import('ganache'),import('ethers'),import('../scripts/lib.mjs')]);
 const engine=ganache.provider({chain:{chainId:31337},logging:{quiet:true},wallet:{totalAccounts:3}}),provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 try{
  const sender=await provider.getSigner(0),recipient=await provider.getSigner(1),wallet=await recipient.getAddress();
  const binary=await deployOne('MockUSD',[],sender),token=await deployOne('MockUSD',[],sender);
  for(const contract of [binary,token]){await(await contract.faucet()).wait();await(await contract.transfer(wallet,9007199254740993n)).wait();}
  const read=createMemberHistoryReader({provider,contracts:{binary,token},cfg:{chainId:31337,deployedBlock:1}}),page=await read({wallet});
  assert.equal(page.range.complete,true);assert.equal(page.rows.length,2);assert.deepEqual(new Set(page.rows.map(row=>row.contract)),new Set(['binary','token']));
  for(const row of page.rows){assert.equal(row.name,'Transfer');assert.equal(row.args.find(arg=>arg.name==='to').value,wallet);assert.equal(row.args.find(arg=>arg.name==='value').value,'9007199254740993');}
 }finally{provider.destroy();await engine.disconnect();}
});
