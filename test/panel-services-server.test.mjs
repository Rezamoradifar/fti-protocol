// HTTP integration with disposable local RPC fixtures and offline test wallets.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Wallet} from 'ethers';
import {startWeb} from '../scripts/server.mjs';

test('panel APIs enforce HTTP origins, wallet sessions, durable ownership and read-only history validation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-panel-service-'));
 const saved=Object.fromEntries(['PORT','RPC_URL','EVENT_RPC_URL','FTI_SUPPORT_DATA_DIR'].map(k=>[k,process.env[k]]));
 const rpc=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const q=JSON.parse(raw);const answer=c=>({jsonrpc:'2.0',id:c.id,result:c.method==='eth_chainId'?'0x61':c.method==='eth_blockNumber'?'0x64':'0x'});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(Array.isArray(q)?q.map(answer):answer(q)));});
 let web;
 await new Promise(resolve=>rpc.listen(0,'127.0.0.1',resolve));
 try{
  process.env.PORT='0';process.env.RPC_URL='http://127.0.0.1:'+rpc.address().port;delete process.env.EVENT_RPC_URL;process.env.FTI_SUPPORT_DATA_DIR=path.join(dir,'private-support');
  const addr='0x0000000000000000000000000000000000000001',file=path.join(dir,'deployment.json');
  fs.writeFileSync(file,JSON.stringify({mode:'testnet',chainId:97,deployedBlock:99,binary:addr,token:addr,usd:addr,council:addr,timelock:addr}));
  web=await startWeb(file);const base='http://127.0.0.1:'+web.address().port;
  const call=(route,{method='GET',data,token,origin='https://ftiprotocol.com'}={})=>new Promise((resolve,reject)=>{const request=http.request(base+route,{method,headers:{Host:'ftiprotocol.com',Origin:origin,...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})}},response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>{try{resolve({status:response.statusCode,data:JSON.parse(body)});}catch(e){reject(e);}});});request.on('error',reject);request.end(data?JSON.stringify(data):undefined);});
  const config=(await call('/api/config')).data;assert.equal(config.memberHistoryVersion,1);assert.equal(config.supportTicketVersion,1);
  assert.equal((await call('/api/support/tickets')).status,401);
  assert.equal((await call('/api/support/tickets',{origin:'https://evil.test'})).status,403);
  assert.equal((await call('/api/member-history?wallet=invalid')).status,400);
  assert.equal((await call('/api/member-history?wallet='+addr+'&limit=1.5')).status,400);
  assert.equal((await call('/api/member-history',{method:'POST',data:{}})).status,404);
  const owner=Wallet.createRandom(),stranger=Wallet.createRandom();
  async function login(w){const challenge=await call('/api/support/challenge',{method:'POST',data:{wallet:w.address}});assert.equal(challenge.status,200);assert.match(challenge.data.message,/Origin: https:\/\/ftiprotocol.com/);const session=await call('/api/support/session',{method:'POST',data:{wallet:w.address,nonce:challenge.data.nonce,signature:await w.signMessage(challenge.data.message)}});assert.equal(session.status,200);return session.data.token;}
  const token=await login(owner);const made=await call('/api/support/tickets',{method:'POST',token,data:{topic:'Wallet connection',message:'This is a disposable HTTP integration support report.'}});assert.equal(made.status,201);const ticket=made.data.ticket;assert.equal(ticket.wallet,owner.address);
  assert.equal((await call('/api/support/tickets',{token})).data.tickets[0].id,ticket.id);
  const other=await login(stranger);assert.equal((await call('/api/support/tickets',{token:other})).data.total,0);assert.equal((await call('/api/support/tickets/'+ticket.id,{token:other})).status,404);
  assert.equal((await call('/api/support/tickets?scope=admin',{token:other})).status,503); // A failed council read never grants access.
  const replied=await call('/api/support/tickets/'+ticket.id+'/replies',{method:'POST',token,data:{message:'Follow-up information for the same private test ticket.'}});assert.equal(replied.status,200);assert.equal(replied.data.ticket.messages.length,2);
  assert.equal(fs.statSync(path.join(dir,'private-support')).mode&0o077,0);assert.equal(fs.statSync(path.join(dir,'private-support',ticket.id+'.json')).mode&0o077,0);
 }finally{
  if(web)await new Promise(resolve=>web.close(resolve));await new Promise(resolve=>rpc.close(resolve));
  for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
