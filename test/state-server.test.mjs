import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Interface,parseEther,ZeroAddress} from 'ethers';
import {startWeb} from '../scripts/server.mjs';

const address=n=>'0x'+n.toString(16).padStart(40,'0');
const walletA=address(101),walletB=address(102),blockHash='0x'+'ab'.repeat(32);
const addresses={binary:address(1),token:address(2),usd:address(3),council:address(4),timelock:address(5)};
const interfaces=Object.fromEntries(Object.entries({binary:'BinaryPlan',token:'FTIToken',usd:'MockUSD',council:'Council',timelock:'FTITimelock'})
 .map(([name,artifact])=>[name,new Interface(JSON.parse(fs.readFileSync(new URL('../artifacts/'+artifact+'.json',import.meta.url))).abi)]));

function defaultOutput(param){
 if(param.baseType==='array')return param.arrayLength<0?[]:Array.from({length:param.arrayLength},()=>defaultOutput(param.arrayChildren));
 if(param.baseType==='tuple')return param.components.map(defaultOutput);
 if(param.type==='address')return ZeroAddress;
 if(param.type==='bool')return false;
 if(param.type==='string')return '';
 if(param.type==='bytes')return '0x';
 if(param.type.startsWith('bytes'))return '0x'+'00'.repeat(Number(param.type.slice(5)));
 return 0n;
}

async function withServer(run,{failedGetter}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-state-http-'));
 const saved=Object.fromEntries(['PORT','HOST','RPC_URL','EVENT_RPC_URL','WALLETCONNECT_PROJECT_ID'].map(key=>[key,process.env[key]]));
 const timestamp=Math.floor(Date.now()/1000),calls=[],unexpected=[];
 const contractsByAddress=new Map(Object.entries(addresses).map(([name,value])=>[value.toLowerCase(),name]));
 const block={number:'0x64',hash:blockHash,parentHash:'0x'+'cd'.repeat(32),timestamp:'0x'+timestamp.toString(16),
  nonce:'0x0000000000000000',difficulty:'0x0',gasLimit:'0x1c9c380',gasUsed:'0x0',miner:ZeroAddress,
  extraData:'0x',transactions:[],baseFeePerGas:'0x0'};
 function answer(request){
  const call={method:request.method,params:request.params};calls.push(call);
  let result;
  if(request.method==='eth_chainId')result='0x61';
  else if(request.method==='eth_blockNumber')result='0x64';
  else if(request.method==='eth_getBlockByNumber')result=block;
  else if(request.method==='eth_getLogs')result=[];
  else if(request.method==='eth_call'){
   const input=request.params[0],name=contractsByAddress.get(input.to.toLowerCase()),iface=interfaces[name];
   const parsed=iface?.parseTransaction({data:input.data});
   if(!parsed)throw Error('Unexpected fixture contract or selector');
   Object.assign(call,{contract:name,getter:parsed.name,args:[...parsed.args].map(String),blockTag:request.params[1]});
   if(failedGetter===name+'.'+parsed.name)return {jsonrpc:'2.0',id:request.id,error:{code:-32000,
    message:'Upstream failed: https://fixture.invalid/SECRET_RPC_SENTINEL?apiKey=DO_NOT_EXPOSE'}};
   const method=parsed.name,who=parsed.args.length?parsed.args[0]?.toLowerCase?.():undefined,multiplier=who===walletB?2n:1n;
   let values=parsed.fragment.outputs.map(defaultOutput);
   if(method==='members'){
    const member={parent:ZeroAddress,left:ZeroAddress,right:ZeroAddress,units:multiplier,carryL:2n*multiplier,
     carryR:multiplier,lifetimeL:10n*multiplier,lifetimeR:8n*multiplier,rank:0n,exists:true,autoEnabled:false,maxAutoPrice:0n};
    values=parsed.fragment.outputs.map(param=>member[param.name]??defaultOutput(param));
   }else if(method==='balanceOf')values=[parseEther(name==='usd'?'42.25':'5')*multiplier];
   else if(method==='remainingAllowance')values=[parseEther('100')*multiplier];
   else if(method==='unlocked')values=[parseEther('4')*multiplier];
   else if(method==='pendingReward')values=[parseEther('3')*multiplier];
   else if(method==='pendingAuto')values=[parseEther('1')*multiplier];
   else if(method==='lockInfo')values=[[[parseEther('1')*multiplier,10n,BigInt(timestamp+86400)]]];
   else if(method==='accounting')values=[parseEther(name==='binary'?'32':'20'),parseEther(name==='binary'?'32':'20')];
   else{
    const scalar={price:parseEther('0.125'),totalSupply:parseEther('100'),reserve:parseEther('12.5'),buybackFund:parseEther('3'),
     floorFund:parseEther('2'),ath:parseEther('0.15'),walletClock:10n,memberCount:2n,epoch:7n,epochEnd:BigInt(timestamp+3600),
     pointPool:parseEther('25'),totalPending:parseEther('5'),totalAuto:parseEther('2'),nextBuilderMonth:BigInt(timestamp+86400)};
    if(Object.hasOwn(scalar,method))values=[scalar[method]];
   }
   result=iface.encodeFunctionResult(parsed.fragment,values);
  }else throw Error('Unexpected fixture RPC method: '+request.method);
  return {jsonrpc:'2.0',id:request.id,result};
 }
 const rpc=http.createServer(async(req,res)=>{
  try{
   let raw='';for await(const chunk of req)raw+=chunk;
   const request=JSON.parse(raw),reply=item=>{try{return answer(item);}catch(error){unexpected.push(error.message);return {jsonrpc:'2.0',id:item.id,error:{code:-32603,message:error.message}};}};
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(Array.isArray(request)?request.map(reply):reply(request)));
  }catch(error){unexpected.push(error.message);res.writeHead(500);res.end('Fixture failure');}
 });
 let web;
 await new Promise(resolve=>rpc.listen(0,'127.0.0.1',resolve));
 try{
  process.env.PORT='0';process.env.HOST='127.0.0.1';process.env.RPC_URL=`http://127.0.0.1:${rpc.address().port}`;
  delete process.env.EVENT_RPC_URL;delete process.env.WALLETCONNECT_PROJECT_ID;
  const config=path.join(dir,'deployment.json');
  fs.writeFileSync(config,JSON.stringify({mode:'testnet',chainId:97,deployedBlock:99,tokenContract:'FTIToken',binaryContract:'BinaryPlan',...addresses}));
  web=await startWeb(config);
  const origin=`http://127.0.0.1:${web.address().port}`;
  await run({origin,calls,timestamp});
  assert.deepEqual(unexpected,[],'Every RPC request must be understood by the local fixture');
 }finally{
  if(web)await new Promise(resolve=>web.close(resolve));
  await new Promise(resolve=>rpc.close(resolve));
  for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  fs.rmSync(dir,{recursive:true,force:true});
 }
}

test('state HTTP responses isolate wallets and reuse the verified public snapshot',async()=>{
 await withServer(async({origin,calls,timestamp})=>{
  let response=await fetch(origin+'/api/config');assert.equal(response.status,200);
  assert.equal((await response.json()).stateReaderVersion,1);
  const get=async suffix=>{const r=await fetch(origin+'/api/state'+suffix),data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
  const publicState=await get(''),firstReadCount=calls.length;
  assert.equal(publicState.block,100);assert.equal(publicState.blockHash,blockHash);assert.equal(publicState.timestamp,timestamp);
  assert.equal(publicState.price,String(parseEther('0.125')));assert.equal(publicState.supply,String(parseEther('100')));
  assert.deepEqual(publicState.account1,[String(parseEther('32')),String(parseEther('32'))]);
  assert.equal(Object.hasOwn(publicState,'wallet'),false);
  const repeated=await get('');assert.deepEqual(repeated,publicState);
  assert(calls.length-firstReadCount<firstReadCount/2,'A repeated HTTP request must avoid the public getter fanout');
  const [a,b]=await Promise.all([get('?wallet='+walletA),get('?wallet='+walletB)]);
  assert.equal(a.wallet.address,walletA);assert.equal(b.wallet.address,walletB);
  assert.equal(a.wallet.units,'1');assert.equal(b.wallet.units,'2');
  assert.equal(a.wallet.usdBalance,String(parseEther('42.25')));assert.equal(b.wallet.usdBalance,String(parseEther('84.5')));
  assert.equal(a.wallet.ftiBalance,String(parseEther('5')));assert.equal(b.wallet.ftiBalance,String(parseEther('10')));
  assert.deepEqual(a.wallet.locks,[{amount:String(parseEther('1')),clock:'10',deadline:String(timestamp+86400)}]);
  assert.equal(a.wallet.lockCount,1);assert.equal(a.blockHash,b.blockHash);
  assert.equal(Object.hasOwn(await get(''),'wallet'),false,'Wallet data must never enter the anonymous snapshot');
  assert.equal(calls.filter(call=>call.contract==='token'&&call.getter==='price').length,1);
  assert(calls.filter(call=>call.method==='eth_call').every(call=>call.blockTag==='0x64'),'Actual ABI reads must use the verified block');
  const beforeInvalid=calls.length;
  response=await fetch(origin+'/api/state?wallet=not-a-wallet');assert.equal(response.status,400);
  assert.deepEqual(await response.json(),{error:'Invalid address'});assert.equal(calls.length,beforeInvalid);
 });
});

test('a required getter failure has a safe HTTP 503, field and retry header',async()=>{
 await withServer(async({origin,calls})=>{
  const response=await fetch(origin+'/api/state'),text=await response.text();
  assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'2');
  assert.deepEqual(JSON.parse(text),{error:'Contract state is temporarily unavailable. Retry shortly.',code:'FTI_STATE_UNAVAILABLE',field:'price'});
  assert.doesNotMatch(text,/SECRET_RPC_SENTINEL|DO_NOT_EXPOSE|fixture\.invalid|apiKey|https?:/);
  const before=calls.length,repeated=await fetch(origin+'/api/state');
  assert.equal(repeated.status,503);assert.equal(repeated.headers.get('retry-after'),'2');
  assert.equal(await repeated.text(),text);assert.equal(calls.length,before,'The failure backoff must avoid another RPC burst');
 },{failedGetter:'token.price'});
});

test('the existing activity endpoint still reads and caches actual RPC results',async()=>{
 await withServer(async({origin,calls})=>{
  const response=await fetch(origin+'/api/events');assert.equal(response.status,200);assert.deepEqual(await response.json(),[]);
  assert(calls.some(call=>call.method==='eth_getLogs'),'The response must come from the local RPC activity reader');
  const before=calls.length,repeated=await fetch(origin+'/api/events');
  assert.equal(repeated.status,200);assert.deepEqual(await repeated.json(),[]);assert.equal(calls.length,before);
 });
});
