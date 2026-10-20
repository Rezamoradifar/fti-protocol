import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transactionState} from '../frontend/transaction-state.js';

const source=fs.readFileSync(new URL('../frontend/controller.js',import.meta.url),'utf8');
const start=source.indexOf('function stopPendingChecks()');
const end=source.indexOf('function syncActions()',start);
assert.ok(start>0&&end>start,'extract the actual pending-monitor controller integration');
const account='0x'+'1'.repeat(40),hash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64);
const receipt=()=>({hash,status:1,blockNumber:100,blockHash});

function fixture({record=hash,recoverPending=async()=>null,rpc={}}={}){
 const data=new Map(),localStorage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 const tracker=transactionState(localStorage,56,account);
 if(record?.startsWith('unknown:'))tracker.saveUnknown(Number(record.slice(8)));
 else if(record)tracker.save(record);
 const monitors=[],shown=[],statuses=[],nodes={'unknown-send-form':{hidden:false}};
 let refreshed=0;
 const context={pendingWatch:null,busy:false,connecting:false,address:account,signer:{},
  walletProvider:{request(){assert.fail('background verification must never invoke a wallet');}},
  localStorage,transactionState,cfg:{chainId:56},document:{},recoveryOptions:{},recoverPending,
  rpc:{getNetwork:async()=>({chainId:56n}),getTransactionReceipt:async()=>receipt(),
   getBlock:async number=>({number,hash:blockHash}),...rpc},
  pendingMonitor(options){const monitor={options,started:false,stopped:false,start(){this.started=true;},stop(){this.stopped=true;}};monitors.push(monitor);return monitor;},
  hashView:{show(value,options){shown.push({value,options});}},
  $:selector=>nodes[selector.slice(1)],
  refreshMembershipState:async()=>{refreshed++;},
  status:(value,error)=>statuses.push({value,error}),t:value=>value};
 vm.runInNewContext(source.slice(start,end),context);
 return {context,tracker,monitors,shown,statuses,nodes,refreshed:()=>refreshed,
  start(){context.startPendingChecks();return monitors.at(-1);}};
}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}

test('known canonical receipt resolves the saved hash and updates membership without wallet calls',async()=>{
 const f=fixture(),monitor=f.start();assert.equal(monitor.started,true);
 assert.equal(await monitor.options.check(),true);
 assert.equal(f.tracker.read(),null);assert.equal(f.tracker.last(),hash);
 assert.equal(f.shown[0].value,hash);assert.equal(f.nodes['unknown-send-form'].hidden,true);
 assert.equal(f.refreshed(),1);assert.equal(f.statuses.at(-1).error,false);
});

test('known canonical reverted receipt resolves the nonce but reports a failed transaction',async()=>{
 const f=fixture({rpc:{getTransactionReceipt:async()=>({...receipt(),status:0})}}),monitor=f.start();
 assert.equal(await monitor.options.check(),true);assert.equal(f.tracker.read(),null);
 assert.equal(f.statuses.at(-1).error,true);
});

test('unknown records remain protected when no verified transaction is recovered',async()=>{
 let calls=0;const f=fixture({record:'unknown:3',recoverPending:async guarded=>{calls++;assert.equal(guarded.read(),'unknown:3');return null;}});
 const monitor=f.start();assert.equal(monitor.options.maxAttempts,3);
 assert.equal(await monitor.options.check(),false);assert.equal(calls,1);
 assert.equal(f.tracker.read(),'unknown:3');assert.equal(f.shown.length,0);
});

test('read failures preserve the unknown record for the bounded scheduler to retry',async()=>{
 const f=fixture({record:'unknown:3',recoverPending:async()=>{throw Error('RPC unavailable');}}),monitor=f.start();
 await assert.rejects(monitor.options.check(),/RPC unavailable/);
 assert.equal(f.tracker.read(),'unknown:3');assert.equal(f.shown.length,0);
});

test('account, signer or provider change during a known receipt lookup prevents clearing and UI updates',async()=>{
 for(const key of ['address','signer','walletProvider']){
  const pending=deferred(),f=fixture({rpc:{getTransactionReceipt:()=>pending.promise}}),monitor=f.start();
  const action=monitor.options.check();await Promise.resolve();
  f.context[key]=key==='address'?'0x'+'2'.repeat(40):{};
  pending.resolve(receipt());assert.equal(await action,false);
  assert.equal(f.tracker.read(),hash,key);assert.equal(f.shown.length,0,key);
 }
});

test('a stopped callback stays invalid after busy is reset and a new monitor starts',async()=>{
 const pending=deferred(),f=fixture({rpc:{getTransactionReceipt:()=>pending.promise}}),old=f.start();
 const action=old.options.check();await Promise.resolve();
 f.context.stopPendingChecks();f.context.busy=true;f.context.busy=false;
 const current=f.start();assert.notEqual(old,current);assert.equal(old.stopped,true);
 pending.resolve(receipt());assert.equal(await action,false);
 assert.equal(f.tracker.read(),hash);assert.equal(f.shown.length,0);
});

test('the guarded unknown tracker cannot clear or remember after the monitor is stopped',async()=>{
 const pending=deferred();let guarded;
 const f=fixture({record:'unknown:3',recoverPending:async value=>{guarded=value;await pending.promise;value.remember(hash);value.clear();return {hash,receipt:receipt()};}}),monitor=f.start();
 const action=monitor.options.check();f.context.stopPendingChecks();
 assert.equal(guarded.read(),null);pending.resolve();assert.equal(await action,false);
 assert.equal(f.tracker.read(),'unknown:3');assert.equal(f.tracker.last(),null);assert.equal(f.shown.length,0);
});

test('another pending record written while a lookup is in flight is preserved',async()=>{
 const pending=deferred(),f=fixture({rpc:{getTransactionReceipt:()=>pending.promise}}),monitor=f.start();
 const action=monitor.options.check();await Promise.resolve();f.tracker.saveUnknown(4);
 pending.resolve(receipt());assert.equal(await action,false);assert.equal(f.tracker.read(),'unknown:4');assert.equal(f.shown.length,0);
});

test('wrong chain, absent receipt, wrong hash, wrong status and noncanonical block never release the saved request',async()=>{
 const cases=[
  {getNetwork:async()=>({chainId:97n})},
  {getTransactionReceipt:async()=>null},
  {getTransactionReceipt:async()=>({...receipt(),hash:'0x'+'c'.repeat(64)})},
  {getTransactionReceipt:async()=>({...receipt(),status:2})},
  {getBlock:async number=>({number,hash:'0x'+'c'.repeat(64)})},
  {getBlock:async number=>({number:number+1,hash:blockHash})},
  {getTransactionReceipt:async()=>({...receipt(),blockNumber:undefined,blockHash:undefined}),getBlock:async()=>({})},
  {getTransactionReceipt:async()=>({...receipt(),blockNumber:-1})}
 ];
 for(const rpc of cases){const f=fixture({rpc}),monitor=f.start();assert.equal(await monitor.options.check(),false);assert.equal(f.tracker.read(),hash);assert.equal(f.shown.length,0);}
});

test('no monitor starts while busy, connecting, disconnected or without a pending record',()=>{
 for(const change of [{busy:true},{connecting:true},{address:null},{signer:null}]){
  const f=fixture();Object.assign(f.context,change);f.context.startPendingChecks();assert.equal(f.monitors.length,0);
 }
 const f=fixture({record:null});f.context.startPendingChecks();assert.equal(f.monitors.length,0);
});
