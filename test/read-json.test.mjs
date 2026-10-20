import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readJson,initializeReadSession} from '../frontend/read-json.js';
test('Safari Load failed retries only GET and recovers',async()=>{
 let calls=0;const result=await readJson('/api/state',{fetchImpl:async(url,options)=>{assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');if(++calls===1)throw new TypeError('Load failed');return {ok:true,json:async()=>({count:31})};}});assert.equal(result.count,31);assert.equal(calls,2);
});
test('persistent network failure has bounded attempts and actionable message',async()=>{
 let calls=0;await assert.rejects(readJson('/api/config',{fetchImpl:async()=>{calls++;throw Error('Load failed');}}),/tap Refresh/);assert.equal(calls,2);
});
test('timeouts abort reads without depending on AbortSignal.timeout',async()=>{
 let calls=0;await assert.rejects(readJson('/api/state',{timeoutMs:5,fetchImpl:async(u,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout'))));}}),/tap Refresh/);assert.equal(calls,2);
});
test('HTTP client errors are not retried and RPC sends are rejected',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return {ok:false,status:403};};await assert.rejects(readJson('/api/state',{fetchImpl}),/HTTP 403/);assert.equal(calls,1);await assert.rejects(readJson('/rpc',{fetchImpl}),/Unsupported/);assert.equal(calls,1);
});
test('public read failure still restores authorized wallet',async()=>{
 const events=[];await initializeReadSession({refresh:async()=>{throw Error('offline');},ready:()=>events.push('ready'),failed:()=>events.push('failed'),reconnect:async()=>events.push('connect')});assert.deepEqual(events,['failed','connect']);
});
test('controller boot can load every contract ABI before binding wallet buttons',async()=>{
 for(const name of ['FundedBinaryPlanUpgradeable','FTIReserveTokenUpgradeable','Collateral','SevenGuardianCouncil','FTITimelock']){
  const abi=[{type:'function',name:'balanceOf'}];let fetched=false;
  assert.deepEqual(await readJson('/abi/'+name,{fetchImpl:async(url,options)=>{fetched=true;assert.equal(options.method,'GET');return {ok:true,json:async()=>abi};}}),abi);assert.equal(fetched,true);
 }
});
test('placement and activity reads work; write endpoints and off-origin URLs remain forbidden',async()=>{
 const fetchImpl=async()=>({ok:true,json:async()=>({ok:true})});
 for(const url of ['/api/placement?referrer=0x123','/api/events'])assert.deepEqual(await readJson(url,{fetchImpl}),{ok:true});
 for(const url of ['/rpc','/api/dev/time','https://example.org/api/state','//example.org/api/state','/abi/../rpc'])await assert.rejects(readJson(url,{fetchImpl}),/Unsupported/);
});
