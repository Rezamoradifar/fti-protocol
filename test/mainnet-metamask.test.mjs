import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {keccak256,toQuantity,BrowserProvider,ContractFactory} from 'ethers';
import ganache from 'ganache';
import solc from 'solc';
import {mainnetPayloads,prepareMainnet} from '../scripts/prepare-mainnet.mjs';
import {finalizeMainnet} from '../scripts/finalize-mainnet.mjs';
import {freshDigest} from '../scripts/fresh-testnet.mjs';
import {releaseManifest} from '../scripts/continuity-release.mjs';
import {MainnetSession,validatePlan,digest} from '../tools/mainnet-metamask/session.mjs';
import {buildOperator} from '../tools/mainnet-metamask/build.mjs';
const code='0x1234';
async function fixture(realCollateral=false){
 const input=JSON.parse(fs.readFileSync('config/mainnet-approved-input.REQUIRED.json'));
 if(!realCollateral)input.usdCodeHash=keccak256(code);
 const body={schema:'FTI_MAINNET_UNSIGNED_PLAN_V1',input,manifest:releaseManifest(),nonce:0,...await mainnetPayloads(input,0),readyToBroadcast:false};
 const plan={...body,digest:freshDigest(body)};
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 const wallet={chain:'0x38',account:input.deployer,nonce:0,pending:0,price:1n,estimate:100n,receipts:true,head:20n,sendError:null,sends:[],txs:new Map(),wrongData:false};
 wallet.request=async({method,params=[]})=>{
  switch(method){
   case 'eth_accounts':return [wallet.account];
   case 'eth_chainId':return wallet.chain;
   case 'eth_getTransactionCount':return params[0].toLowerCase()===input.deployer.toLowerCase()?toQuantity(params[1]==='pending'?wallet.pending:wallet.nonce):'0x0';
   case 'eth_getCode':return params[0].toLowerCase()===input.usd.toLowerCase()?code:wallet.sends.some((s,i)=>i<6&&params[0].toLowerCase()===plan.addresses[plan.transactions[i].name].toLowerCase())?code:'0x';
   case 'eth_estimateGas':return toQuantity(wallet.estimate);
   case 'eth_gasPrice':return toQuantity(wallet.price);
   case 'eth_getBalance':return '0xffffffffffffffff';
   case 'eth_blockNumber':return toQuantity(wallet.head);
   case 'eth_getBlockByNumber':return {hash:'0x'+'a'.repeat(64)};
   case 'eth_sendTransaction':{
    if(wallet.sendError)throw wallet.sendError;
    const hash='0x'+String(wallet.sends.length+1).padStart(64,'0');const tx={...params[0],hash,to:params[0].to??null,input:params[0].data};
    wallet.sends.push(tx);wallet.txs.set(hash,tx);wallet.nonce++;wallet.pending++;return hash;
   }
   case 'eth_getTransactionByHash':{const tx=wallet.txs.get(params[0]);return wallet.wrongData?{...tx,input:'0x00'}:tx}
   case 'eth_getTransactionReceipt':{
    if(!wallet.receipts)return null;
    const tx=wallet.txs.get(params[0]);if(!tx)return null;
    return {transactionHash:tx.hash,status:'0x1',blockNumber:'0x1',blockHash:'0x'+'a'.repeat(64),contractAddress:tx.to?null:plan.addresses[plan.transactions[Number(BigInt(tx.nonce))].name]};
   }
   default:throw Error('Unexpected RPC '+method);
  }
 };
 const session=new MainnetSession({provider:wallet,plan,expectedDigest:plan.digest,storage,maxFeeWei:10000n,maxGasPriceWei:2n});
 return {plan,storage,wallet,session};
}
test('browser canonical digest matches the production planner and rejects changed payloads',async()=>{
 const {plan}=await fixture();const {digest:hash,...body}=plan;assert.equal(digest(body),freshDigest(body));
 const altered=structuredClone(plan);altered.transactions[0].data+='00';assert.throws(()=>validatePlan(altered,hash),/digest/);
 altered.digest=digest((({digest,...x})=>x)(altered));assert.throws(()=>validatePlan(altered,altered.digest),/Payload hash/);
});
test('seven explicit wallet operations export exactly the independent finalizer hash map',async()=>{
 const {session,wallet,plan}=await fixture();
 assert.throws(()=>session.exportHashes());
 for(let i=0;i<7;i++){
  await session.sendNext();assert.equal(wallet.sends.length,i+1);assert.equal(wallet.sends[i].nonce,toQuantity(i));
  assert.equal(wallet.sends[i].value,'0x0');assert.equal(wallet.sends[i].data,plan.transactions[i].data);
  assert.equal(wallet.sends[i].gasPrice,'0x2');assert.equal(wallet.sends[i].gas,'0x78');
  await session.reconcile();
 }
 assert.deepEqual(Object.keys(session.exportHashes()),plan.transactions.map(t=>t.name));
 await assert.rejects(session.sendNext(),/All seven/);
});
for(const [label,change,pattern]of [
 ['wrong chain',w=>w.chain='0x61',/mainnet/],
 ['wrong account',w=>w.account='0x'+'1'.repeat(40),/account/],
 ['pending nonce',w=>w.pending=1,/Nonce/],
 ['gas ceiling',w=>w.price=3n,/ceiling/],
 ['gas limit',w=>w.estimate=12000000n,/Gas estimate/]
])test('refuses '+label+' before any wallet send',async()=>{
 const {session,wallet}=await fixture();change(wallet);await assert.rejects(session.sendNext(),pattern);assert.equal(wallet.sends.length,0);
});
test('fee budget blocks cumulative excess before prompting the wallet',async()=>{
 const {session,wallet}=await fixture();session.maxFeeWei=300n;await session.sendNext();
 await assert.rejects(session.sendNext(),/budget/);assert.equal(wallet.sends.length,1);
});
test('unknown send failures survive reload and block another send; explicit rejection can retry',async()=>{
 const {session,wallet,plan,storage}=await fixture();wallet.sendError=Error('Transport lost');
 await assert.rejects(session.sendNext());wallet.sendError=null;
 const reloaded=new MainnetSession({provider:wallet,plan,expectedDigest:plan.digest,storage,maxFeeWei:10000n,maxGasPriceWei:2n});
 await assert.rejects(reloaded.sendNext(),/Uncertain send/);assert.equal(wallet.sends.length,0);
 const other=await fixture();other.wallet.sendError=Object.assign(Error('User rejected'),{code:4001});
 await assert.rejects(other.session.sendNext());assert.equal(other.session.state.steps.length,0);
 other.wallet.sendError=null;await other.session.sendNext();assert.equal(other.wallet.sends.length,1);
});
test('pending, altered and insufficiently confirmed receipts prevent subsequent sends and exports',async()=>{
 const {session,wallet}=await fixture();await session.sendNext();wallet.receipts=false;
 await assert.rejects(session.sendNext(),/Wait/);wallet.receipts=true;wallet.wrongData=true;
 await assert.rejects(session.reconcile(),/differs/);wallet.wrongData=false;wallet.head=5n;
 assert.equal(await session.reconcile(),false);assert.equal(session.state.steps[0].confirmed,false);assert.throws(()=>session.exportHashes());
 assert.equal(wallet.sends.length,1);
});
test('concurrent button clicks cannot create duplicate wallet prompts',async()=>{
 const {session,wallet}=await fixture();const first=session.sendNext();await assert.rejects(session.sendNext(),/running/);await first;assert.equal(wallet.sends.length,1);
});
test('a deployer transaction appearing during gas estimation prevents signing the stale nonce',async()=>{
 const {session,wallet}=await fixture();const request=wallet.request;
 wallet.request=async args=>{const result=await request(args);if(args.method==='eth_estimateGas')wallet.pending=1;return result};
 await assert.rejects(session.sendNext(),/Nonce changed during/);assert.equal(wallet.sends.length,0);
});
test('operator builder uses a reviewed production payload and emits only local assets, never overwrites',async()=>{
 const {plan}=await fixture(true);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-metamask-test-'));
 try{
  await buildOperator(plan,path.join(dir,'public'));
  const html=fs.readFileSync(path.join(dir,'public/index.html'),'utf8');
  assert(html.includes(plan.digest));assert(!html.includes('https://'));assert(html.includes('Content-Security-Policy'));
  assert(fs.statSync(path.join(dir,'public/operator.js')).size>10000);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'public/plan.json'))),plan);
  await assert.rejects(buildOperator(plan,path.join(dir,'public')));
  const changed=structuredClone(plan);changed.manifest.sourceRevision='a'.repeat(40);changed.digest=freshDigest((({digest,...x})=>x)(changed));
  await assert.rejects(buildOperator(changed,path.join(dir,'other')),/different source/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('wallet coordinator sends seven real payloads on a local chain-56 EVM and independent finalizer verifies the deployment',{timeout:120000},async()=>{
 const raw=ganache.provider({logging:{quiet:true},chain:{chainId:56,hardfork:'shanghai'},wallet:{totalAccounts:2,defaultBalance:100}});
 const provider=new BrowserProvider(raw,undefined,{cacheTimeout:-1});
 try{
  const signer=await provider.getSigner();
  // Production MockUSD correctly refuses chain 56. Use a local-only fixture.
  const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'LocalUSD.sol':{content:'pragma solidity 0.8.30; import "@openzeppelin/contracts/token/ERC20/ERC20.sol"; contract LocalUSD is ERC20 { constructor() ERC20("Local collateral", "LOCAL") {} }'}},settings:{evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:file=>({contents:fs.readFileSync('node_modules/'+file,'utf8')})}));
  const local=compiled.contracts['LocalUSD.sol'].LocalUSD;
  const usd=await new ContractFactory(local.abi,'0x'+local.evm.bytecode.object,signer).deploy();await usd.waitForDeployment();
  const input=JSON.parse(fs.readFileSync('config/mainnet-approved-input.REQUIRED.json'));input.deployer=await signer.getAddress();input.usd=await usd.getAddress();input.usdCodeHash=keccak256(await provider.getCode(input.usd));
  const plan=await prepareMainnet({provider,input});
  const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  const session=new MainnetSession({provider:raw,plan,expectedDigest:plan.digest,storage,maxFeeWei:1000000000000000000n,maxGasPriceWei:10000000000n});
  for(let i=0;i<7;i++){
   await session.sendNext();
   for(let block=0;block<12;block++)await raw.request({method:'evm_mine',params:[]});
   assert.equal(await session.reconcile(),true);
  }
  const cfg=await finalizeMainnet({provider,plan,transactions:session.exportHashes(),confirmations:12});
  assert.equal(cfg.chainId,56);assert.equal(cfg.genesis.length,31);assert.equal(cfg.importedUsers,0);
  assert.equal(cfg.binary,plan.addresses.binary);
 }finally{provider.destroy();await raw.disconnect()}
});
