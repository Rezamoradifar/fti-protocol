import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {setImmediate as tick} from 'node:timers/promises';
import {walletReview} from '../frontend/wallet-review.js';
import {transactionState,preparedWalletSend,prepareContractRequest,submitTracked,confirmedReceipt} from '../frontend/transaction-state.js';
import {prepareUnknownCancellation,submitUnknownCancellation} from '../frontend/prepared-cancellation.js';
import {readWalletIdentity,preparationDeadline} from '../frontend/wallet-preflight.js';
const source=fs.readFileSync(new URL('../frontend/controller.js',import.meta.url),'utf8');
const address='0x'+'1'.repeat(40),contract='0x'+'2'.repeat(40),hash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64);
function fixture(){
 const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 const tracker=transactionState(storage,56,address),nodes={};
 for(const id of ['wallet-review-panel','confirm-wallet-request','cancel-wallet-review','wallet-review-title','wallet-review-from','wallet-review-to','wallet-review-network','wallet-review-nonce','wallet-review-description','unknown-send-form','transaction-link','cancel-unknown'])nodes[id]={hidden:true,disabled:false,textContent:'',focus(){},scrollIntoView(){}};
 const review=walletReview({document:{getElementById:id=>nodes[id]},translate:key=>key});
 let active=false,submitted,calls=[];
 const receipt={hash,status:1,blockNumber:10,blockHash};
 const wallet={request:async request=>{
  calls.push(request.method);
  if(request.method==='eth_chainId')return '0x38';if(request.method==='eth_accounts')return [address];
  assert.equal(request.method,'eth_sendTransaction','no wallet block, fee or estimate RPC is allowed');
  assert(active,'the wallet must be called in the final click stack');submitted=request.params[0];return hash;
 }};
 const rpc={estimateGas:async request=>{assert.equal(request.from,address);return 100n;},send:async method=>method==='eth_gasPrice'?'0x64':'0x3',getRpcTransaction:request=>Object.fromEntries(Object.entries(request).map(([key,value])=>[key==='gasLimit'?'gas':key,typeof value==='bigint'||typeof value==='number'?'0x'+value.toString(16):value])),
  getNetwork:async()=>({chainId:56n}),getCode:async()=>'0x',getTransactionCount:async()=>3,
  waitForTransaction:async()=>receipt,getTransaction:async()=>({hash,from:address,to:address,nonce:3,value:0n,data:'0x',chainId:56n,blockNumber:10,blockHash}),getBlock:async()=>({hash:blockHash})};
 const signer={getAddress:async()=>address,sendTransaction:()=>assert.fail('BrowserProvider signer sends are forbidden')};
 const context={$,address,signer,transactionAddress:address,walletProvider:wallet,rpc,review,activeTransaction:tracker,cfg:{chainId:56},read:{binary:{addUnits:{populateTransaction:async()=>({to:contract,data:'0x1234'})}}},
  prepareContractRequest,preparedWalletSend,submitTracked,confirmedReceipt,transactionState,prepareUnknownCancellation,submitUnknownCancellation,readWalletIdentity,preparationDeadline,localStorage:storage,integer:value=>String(value),
  hashView:{show:value=>assert.equal(value,hash),hide(){}},status(){},short:value=>value,t:key=>key,reason:error=>error.message,busy:false,syncActions(){},refresh:async()=>{},transactionStage:'',explorer:'https://bscscan.com',window:{confirm:()=>assert.fail('native confirmation must not be used')}};
 function $(selector){return nodes[selector.slice(1)];}
 return {context,nodes,tracker,calls,submitted:()=>submitted,click:()=>{active=true;nodes['confirm-wallet-request'].onclick();active=false;}};
}
async function ready(f){for(let i=0;i<30&&f.nodes['wallet-review-panel'].hidden;i++)await tick();assert.equal(f.nodes['wallet-review-panel'].hidden,false);}
test('the actual purchase controller prepares fully before opening one direct wallet confirmation',async()=>{
 const f=fixture();const start=source.indexOf('async function sendContract('),end=source.indexOf("$('#find-transaction-hash').onclick=",start);
 vm.runInNewContext(source.slice(start,end)+'\nrun=()=>sendContract("binary","addUnits",1n);',f.context);
 const action=f.context.run();await ready(f);assert(!f.calls.includes('eth_sendTransaction'));assert.equal(f.tracker.read(),null);
 f.click();await action;assert.equal(f.calls.filter(x=>x==='eth_sendTransaction').length,1);assert.equal(f.submitted().nonce,'0x3');assert.equal(f.submitted().gasPrice,'0x64');assert.equal(f.submitted().gas,'0x78');assert.equal(f.tracker.read(),null);
});
test('the actual cancellation controller uses the new inline button even when native confirm and wallet block reads fail',async()=>{
 const f=fixture();f.tracker.saveUnknown(3);
 const start=source.indexOf("$('#cancel-unknown').onclick="),end=source.indexOf('async function approve(',start);
 vm.runInNewContext(source.slice(start,end),f.context);
 const action=f.nodes['cancel-unknown'].onclick();await ready(f);assert(!f.calls.includes('eth_sendTransaction'));assert.equal(f.tracker.read(),'unknown:3');
 f.click();await action;assert.equal(f.calls.filter(x=>x==='eth_sendTransaction').length,1);assert.equal(f.submitted().to,address);assert.equal(f.submitted().value,'0x0');assert.equal(f.submitted().nonce,'0x3');assert.equal(f.tracker.read(),null);
});
