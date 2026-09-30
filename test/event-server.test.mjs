import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startWeb} from '../scripts/server.mjs';

test('separate event RPC validates network and caches successful results',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-events-'));
 const saved={PORT:process.env.PORT,RPC_URL:process.env.RPC_URL,EVENT_RPC_URL:process.env.EVENT_RPC_URL};
 let chain='0x61',calls=0,web;
 const rpc=http.createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const q=JSON.parse(raw);calls++;
  const result=q.method==='eth_chainId'?chain:q.method==='eth_blockNumber'?'0x64':[];
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
 });
 await new Promise(r=>rpc.listen(0,'127.0.0.1',r));
 try{
  process.env.PORT='0';process.env.RPC_URL='http://127.0.0.1:1';
  process.env.EVENT_RPC_URL=`http://127.0.0.1:${rpc.address().port}`;
  const addr='0x0000000000000000000000000000000000000001';
  const file=path.join(dir,'deployment.json');
  fs.writeFileSync(file,JSON.stringify({mode:'testnet',chainId:97,deployedBlock:99,binary:addr,token:addr,usd:addr,council:addr,timelock:addr}));
  web=await startWeb(file);let url=`http://127.0.0.1:${web.address().port}/api/events`;
  let response=await fetch(url);assert.equal(response.status,200);assert.deepEqual(await response.json(),[]);
  const before=calls;response=await fetch(url);assert.equal(response.status,200);assert.equal(calls,before);
  await new Promise(r=>web.close(r));web=null;
  chain='0x38';web=await startWeb(file);url=`http://127.0.0.1:${web.address().port}/api/events`;
  response=await fetch(url);assert.equal(response.status,503);assert.match((await response.json()).error,/RPC unavailable/);
 }finally{
  if(web)await new Promise(r=>web.close(r));await new Promise(r=>rpc.close(r));
  for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
