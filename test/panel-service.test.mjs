import test from 'node:test';
import assert from 'node:assert/strict';
import {panelService} from '../frontend/panel-service.js';
const token='Bearer '+'a'.repeat(64);
test('support writes are same-origin, memory-authorized and sent exactly once',async()=>{
 let count=0;
 await assert.rejects(()=>panelService('/api/support/tickets',{method:'POST',body:{topic:'Other',message:'A detailed support question'},authorization:token,fetchImpl:async(path,options)=>{count++;assert.equal(path,'/api/support/tickets');assert.equal(options.headers.Authorization,token);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');throw Error('Disconnected');}}),/Disconnected/);
 assert.equal(count,1);
});
test('unauthorized support responses expose a bounded code for session reset',async()=>{
 await assert.rejects(()=>panelService('/api/support/tickets',{authorization:token,fetchImpl:async()=>({ok:false,status:401,json:async()=>({error:'SUPPORT_AUTH_REQUIRED'})})}),e=>e.status===401&&e.code==='SUPPORT_AUTH_REQUIRED');
});
test('rejects external or unrelated paths, history mutations and malformed bearer tokens before fetching',async()=>{
 const fetchImpl=()=>assert.fail('Invalid request must not be sent');
 for(const path of ['https://evil.test/api/support/tickets','//evil.test/api/support/tickets','/rpc','/api/support/tickets/../../state','/api/support/tickets#secret','/api/support/tickets\\x'])await assert.rejects(()=>panelService(path,{fetchImpl}));
 await assert.rejects(()=>panelService('/api/member-history',{method:'POST',body:{},fetchImpl}));
 await assert.rejects(()=>panelService('/api/support/tickets',{authorization:'Bearer wrong',fetchImpl}));
});
test('history reads carry cancellation and keep successful data intact',async()=>{
 const data={rows:[],nextCursor:null};
 assert.equal(await panelService('/api/member-history?wallet=0x1&limit=50',{fetchImpl:async(path,options)=>{assert.equal(options.method,'GET');assert.equal(options.body,undefined);return {ok:true,json:async()=>data};}}),data);
 const aborted=new AbortController();aborted.abort(Error('Wallet changed'));
 await assert.rejects(()=>panelService('/api/member-history?wallet=0x1',{signal:aborted.signal,fetchImpl:()=>assert.fail('Canceled request')}),/Wallet changed/);
});
