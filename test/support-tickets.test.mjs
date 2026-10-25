import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Wallet,getAddress} from 'ethers';
import {createSupportService} from '../scripts/support-tickets.mjs';
const origin='https://ftiprotocol.com',cfg={chainId:56,binary:'0x'+'a1'.repeat(20)};
const a=Wallet.createRandom(),b=Wallet.createRandom(),g=Wallet.createRandom();
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'fti-support-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));let clock=1_800_000_000_000,guardian=true,roleError=false;const options={cfg,council:{isGuardian:async address=>{if(roleError)throw Error('RPC failed');return guardian&&address===g.address;}},dataDir:path.join(base,'records'),origin,now:()=>clock};let service=createSupportService(options);const api=(method,path,body,token,atOrigin=origin)=>service.handle({method,path:'/api/support/'+path,body,authorization:token?'Bearer '+token:undefined,origin:atOrigin});
 const login=async(w=a,atOrigin=origin)=>{const c=await api('POST','challenge',{wallet:w.address},undefined,atOrigin);assert.equal(c.status,200);const signature=await w.signMessage(c.data.message);const s=await api('POST','session',{wallet:w.address,nonce:c.data.nonce,signature},undefined,atOrigin);assert.equal(s.status,200);return s.data.token;};
 return {base,options,api,login,advance:ms=>{clock+=ms;},role:value=>{guardian=value;},roleError:value=>{roleError=value;},restart:()=>{service=createSupportService(options);}};}
const create=(f,token,extra={})=>f.api('POST','tickets',{topic:'Wallet connection',message:'My connected wallet needs assistance.',...extra},token);

test('support nonce is wallet, origin, chain and contract bound, single use and expires',async t=>{
 const f=await fixture(t);const c=await f.api('POST','challenge',{wallet:a.address});assert.equal(c.status,200);assert.match(c.data.message,/Chain ID: 56/);assert(c.data.message.includes(getAddress(cfg.binary)));assert(c.data.message.includes(origin));
 const sig=await a.signMessage(c.data.message);const cross=await f.api('POST','session',{wallet:a.address,nonce:c.data.nonce,signature:sig},undefined,'https://app.ftiprotocol.com');assert.equal(cross.status,401);
 assert.equal((await f.api('POST','session',{wallet:a.address,nonce:c.data.nonce,signature:sig})).status,401);
 const expired=await f.api('POST','challenge',{wallet:a.address});f.advance(301_000);assert.equal((await f.api('POST','session',{wallet:a.address,nonce:expired.data.nonce,signature:await a.signMessage(expired.data.message)})).status,401);
 assert.equal((await f.api('POST','challenge',{wallet:a.address},undefined,'https://evil.example')).status,403);
});
test('wrong signer cannot authenticate or replay consumed nonce',async t=>{
 const f=await fixture(t);const c=await f.api('POST','challenge',{wallet:a.address});const body={wallet:a.address,nonce:c.data.nonce,signature:await b.signMessage(c.data.message)};assert.equal((await f.api('POST','session',body)).status,401);body.signature=await a.signMessage(c.data.message);assert.equal((await f.api('POST','session',body)).status,401);
 const token=await f.login();assert.equal((await create(f,token)).status,201);f.advance(1_801_000);assert.equal((await f.api('GET','tickets',{},token)).status,401);
});
test('tickets persist privately, remain isolated by wallet, and reload after restart',async t=>{
 const f=await fixture(t),token=await f.login(),other=await f.login(b);const made=await create(f,token,{hash:'0x'+'12'.repeat(32)});assert.equal(made.status,201);const id=made.data.ticket.id;assert.equal(made.data.ticket.wallet,a.address);
 assert.equal((await f.api('GET','tickets/'+id,{},other)).status,404);assert.equal((await f.api('POST','tickets/'+id+'/replies',{message:'Intruder'},other)).status,404);assert.deepEqual((await f.api('GET','tickets',{},other)).data.tickets,[]);
 const st=await fs.stat(path.join(f.options.dataDir,id+'.json'));assert.equal(st.mode&0o077,0);assert.equal((await fs.stat(f.options.dataDir)).mode&0o077,0);
 f.restart();assert.equal((await f.api('GET','tickets',{},token)).status,401);const again=await f.login();const read=await f.api('GET','tickets/'+id,{},again);assert.equal(read.status,200);assert.equal(read.data.ticket.messages[0].text,'My connected wallet needs assistance.');
});
test('guardian replies and status require a fresh successful role read on every request',async t=>{
 const f=await fixture(t),member=await f.login(),team=await f.login(g),id=(await create(f,member)).data.ticket.id;
 assert.equal((await f.api('GET','tickets?scope=admin',{},member)).status,403);
 const reply=await f.api('POST','tickets/'+id+'/replies?scope=admin',{message:'We are reviewing this issue.'},team);assert.equal(reply.status,200);assert.equal(reply.data.ticket.status,'answered');assert.equal(reply.data.ticket.messages.at(-1).role,'team');
 f.role(false);assert.equal((await f.api('GET','tickets?scope=admin',{},team)).status,403);assert.equal((await f.api('POST','tickets/'+id+'/replies?scope=admin',{message:'Stale authority'},team)).status,403);
 f.role(true);f.roleError(true);assert.equal((await f.api('POST','tickets/'+id+'/status?scope=admin',{status:'closed'},team)).status,503);f.roleError(false);
 const close=await f.api('POST','tickets/'+id+'/status?scope=admin',{status:'closed'},team);assert.equal(close.status,200);assert.equal((await f.api('POST','tickets/'+id+'/replies',{message:'Member after close'},member)).status,409);
});
test('concurrent replies serialize without data loss and untrusted markup stays plain JSON text',async t=>{
 const f=await fixture(t),token=await f.login(),id=(await create(f,token)).data.ticket.id;const values=['<script>alert(1)</script>','Second independent response'];const replies=await Promise.all(values.map(message=>f.api('POST','tickets/'+id+'/replies',{message},token)));assert(replies.every(r=>r.status===200));const result=await f.api('GET','tickets/'+id,{},token);assert.equal(result.data.ticket.messages.length,3);assert.deepEqual(result.data.ticket.messages.slice(1).map(m=>m.text),values);
 assert.equal((await create(f,token,{message:'short'})).status,400);assert.equal((await create(f,token,{topic:'__proto__'})).status,400);assert.equal((await create(f,token,{hash:'javascript:alert(1)'})).status,400);
 assert.equal((await f.api('GET','tickets?limit=500',{},token)).status,400);
});
test('sessions cannot cross the permitted subdomain where they were authenticated',async t=>{
 const f=await fixture(t),token=await f.login(a,'https://app.ftiprotocol.com');assert.equal((await f.api('GET','tickets',{},token,'https://app.ftiprotocol.com')).status,200);assert.equal((await f.api('GET','tickets',{},token,origin)).status,403);
});
test('symlinked or corrupt support files fail closed without exposing their content',async t=>{
 const f=await fixture(t);await fs.mkdir(f.options.dataDir,{mode:0o700});const secret=path.join(f.base,'outside.json');await fs.writeFile(secret,'private unrelated content');await fs.symlink(secret,path.join(f.options.dataDir,'1'.repeat(32)+'.json'));const token=await f.login();const result=await f.api('GET','tickets',{},token);assert.equal(result.status,503);assert.deepEqual(result.data,{error:'SUPPORT_UNAVAILABLE'});
});
test('challenge issuance is bounded per wallet and bad input is rejected',async t=>{
 const f=await fixture(t);for(let i=0;i<5;i++)assert.equal((await f.api('POST','challenge',{wallet:a.address})).status,200);assert.equal((await f.api('POST','challenge',{wallet:a.address})).status,429);assert.equal((await f.api('POST','challenge',{wallet:'0x'+'0'.repeat(40)})).status,400);assert.equal((await f.api('POST','challenge',[])).status,400);
});
