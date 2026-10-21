import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {isAddress} from 'ethers';
import {walletReview} from '../frontend/wallet-review.js';
import {readWalletIdentity,preparationDeadline} from '../frontend/wallet-preflight.js';

const source=fs.readFileSync(new URL('../frontend/controller.js',import.meta.url),'utf8');
const start=source.indexOf('let walletProvider,providerListeners'),end=source.indexOf("$('#connect').onclick=",start);
assert.ok(start>0&&end>start);
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40);
const request={from:A,to:B,chainId:'0x38',nonce:'0xc',gas:'0x5208',gasPrice:'0x64',value:'0x0',data:'0x'};
function fixture({connected=true,onIdentity,fa=false}={}){
 const nodes={},listeners=new Map(),store=new Map(),messages=[],counts={refresh:0,reload:0,confirmed:0,signers:0},calls=[];
 const node=id=>nodes[id]??={hidden:true,disabled:false,textContent:'',elements:{hash:{value:''}},focus(){},scrollIntoView(){}};
 const translate=(en,persian)=>fa&&persian?persian:en;
 const review=walletReview({document:{getElementById:node},translate});
 const provider={on:(name,fn)=>listeners.set(name,fn),removeListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);},request:async input=>{
  calls.push(input.method);assert.ok(['eth_accounts','eth_chainId'].includes(input.method),'observer/connect must not request a transaction');
  if(listeners.size)onIdentity?.(input.method,listeners);
  return input.method==='eth_accounts'?[A]:'0x38';
 }};
 const storage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
 const context={address:connected?A:null,signer:connected?{}:null,state:{},busy:false,connecting:false,refreshSequence:0,autoDirty:false,councilOwner:false,
  cfg:{mode:'bnb-mainnet',chainId:56,tokenContract:'FTIReserveTokenUpgradeable'},v3Model:true,surface:'token',location:{hash:'#trade',reload:()=>counts.reload++},networkProfile:{name:'BNB Smart Chain'},
  sessionStorage:storage,localStorage:storage,review,isAddress,preparationDeadline,readWalletIdentity,
  $:selector=>node(selector.slice(1)),t:translate,text(){},short:value=>value,status:(...args)=>messages.push(args),reason:error=>error.message,
  stopPendingChecks(){},startPendingChecks(){},syncActions(){},renderWallet(){},hashView:{restore(){},hide(){}},
  refresh:async()=>{counts.refresh++;},refreshTokenState:async()=>{},refreshMembershipState:async()=>{},
  chooseWallet:async()=>({name:'SafePal',provider}),requestWalletAccounts:async()=>[A],transactionState:()=>({read:()=>null}),purchaseError:(_,error)=>error.message,
  BrowserProvider:class{async getNetwork(){return{chainId:56n};}},JsonRpcSigner:class{constructor(_,account){counts.signers++;this.account=account;}async getAddress(){return this.account;}}};
 vm.runInNewContext(source.slice(start,end)+'\naudit=()=>({address,hasSigner:!!signer,provider:walletProvider,generation:walletGeneration});',context);
 return{context,nodes,listeners,store,messages,counts,calls,provider,review,
  observe(){context.observeWallet(provider,A);},
  open(){return review.open({request,title:'Sell FTI',onConfirm:()=>{counts.confirmed++;return'confirmed';}});}};
}

test('actual observer ignores same selected-account and network events while preserving an open review',async()=>{
 for(const [event,payload]of [['accountsChanged',[A]],['accountsChanged',['0x'+A.slice(2).toUpperCase()]],['accountsChanged',[A,B]],['chainChanged','0x38'],['chainChanged','0X38']]){
  const f=fixture();f.observe();const before=f.context.audit(),pending=f.open();
  f.listeners.get(event)(payload);assert.equal(f.context.audit().address,A);assert.equal(f.context.audit().provider,f.provider);assert.equal(f.context.audit().generation,before.generation);
  assert.equal(f.nodes['wallet-review-panel'].hidden,false);assert.equal(f.counts.reload,0);assert.equal(f.counts.refresh,0);
  f.nodes['confirm-wallet-request'].onclick();assert.equal(await pending,'confirmed');assert.equal(f.counts.confirmed,1);
 }
});

test('different, empty or malformed account payloads cancel review and keep protected transaction records',async()=>{
 for(const payload of [[B],[],undefined,A,[A,'invalid']]){
  const f=fixture();f.observe();f.store.set('fti-pending:56:'+A,'unknown:12');const pending=f.open().catch(error=>error);
  f.listeners.get('accountsChanged')(payload);assert.match((await pending).message,/cancelled/);
  assert.equal(f.context.audit().address,null);assert.equal(f.context.audit().provider,null);assert.equal(f.context.audit().hasSigner,false);assert.equal(f.counts.confirmed,0);
  assert.equal(f.store.get('fti-pending:56:'+A),'unknown:12');assert.equal(f.counts.refresh,1);
 }
});

test('different or malformed chain events still cancel and reload, and disconnect still resets',async()=>{
 for(const payload of ['0x1',undefined,'56','0x','0x038']){
  const f=fixture();f.observe();const pending=f.open().catch(error=>error);f.listeners.get('chainChanged')(payload);await pending;
  assert.equal(f.counts.reload,1);assert.equal(f.context.audit().address,null);assert.equal(f.counts.confirmed,0);
 }
 const f=fixture();f.observe();const pending=f.open().catch(error=>error);f.listeners.get('disconnect')();await pending;
 assert.equal(f.context.audit().address,null);assert.equal(f.counts.refresh,1);assert.equal(f.counts.confirmed,0);
});

test('callbacks retained from a detached provider cannot reset its replacement session or review',async()=>{
 const f=fixture();f.observe();const stale=[...f.listeners.values()],replacement={on(){},removeListener(){}};
 f.context.observeWallet(replacement,A);const pending=f.open();
 for(const callback of stale)callback();
 assert.equal(f.context.audit().address,A);assert.equal(f.context.audit().provider,replacement);assert.equal(f.counts.reload,0);assert.equal(f.counts.refresh,0);
 assert.equal(f.nodes['wallet-review-panel'].hidden,false);f.nodes['confirm-wallet-request'].onclick();await pending;
});

test('callbacks from an earlier observer cannot reset a new account session on the same provider object',async()=>{
 const f=fixture();f.observe();const stale=[...f.listeners.values()];f.context.address=B;f.context.signer={};f.context.observeWallet(f.provider,B);
 const pending=f.review.open({request:{...request,from:B},title:'Sell FTI',onConfirm:()=>{f.counts.confirmed++;return'confirmed';}});
 stale[0]([B]);stale[1]('0x1');stale[2]();
 assert.equal(f.context.audit().address,B);assert.equal(f.context.audit().provider,f.provider);assert.equal(f.counts.reload,0);assert.equal(f.counts.refresh,0);
 assert.equal(f.nodes['wallet-review-panel'].hidden,false);f.nodes['confirm-wallet-request'].onclick();assert.equal(await pending,'confirmed');
});

test('actual connection tolerates repeated same identity before signer commit using the granted account',async()=>{
 const f=fixture({connected:false,onIdentity(_,listeners){listeners.get('accountsChanged')([A]);listeners.get('chainChanged')('0x38');}});
 await f.context.connect();assert.equal(f.context.audit().address,A);assert.equal(f.context.audit().hasSigner,true);assert.equal(f.counts.signers,1);assert.equal(f.context.audit().generation,1);
 assert.equal(f.context.connecting,false);assert.equal(f.counts.reload,0);assert.ok(!f.calls.includes('eth_sendTransaction'));
});

test('a real account or chain change during final connection identity cannot commit a stale signer',async()=>{
 for(const event of ['accountsChanged','chainChanged']){
  const f=fixture({connected:false,onIdentity(_,listeners){listeners.get(event)?.(event==='accountsChanged'?[B]:'0x1');}});
  await f.context.connect();assert.equal(f.context.audit().address,null);assert.equal(f.context.audit().hasSigner,false);assert.equal(f.counts.signers,0);assert.equal(f.context.connecting,false);
 }
});

test('token cancellation is labelled separately from selling and prompts a new sale only after confirmation',async()=>{
 for(const [surface,fa]of [['token',false],['token',true],['member',false]]){
  const f=fixture({fa});f.context.surface=surface;f.context.location.hash=surface==='token'?'#trade':'#network';f.context.v3Model=true;f.observe();
  let record='unknown:12',finish,cancelSends=0,refreshed=0;
  const tracker={read:()=>record},prepared={record,accountType:'eoa',request};
  Object.assign(f.context,{transactionState:()=>tracker,readWalletIdentity:async()=>{},rpc:{},
   prepareUnknownCancellation:async()=>prepared,refreshTokenState:async()=>{refreshed++;},refreshMembershipState:async()=>{refreshed++;},
   submitUnknownCancellation:async()=>{cancelSends++;await new Promise(resolve=>{finish=resolve;});record=null;}});
  const from=source.indexOf("$('#cancel-unknown').onclick="),to=source.indexOf('async function approve(',from);
  vm.runInNewContext(source.slice(from,to),f.context);const action=f.nodes['cancel-unknown'].onclick();
  for(let n=0;n<20&&f.nodes['wallet-review-panel'].hidden;n++)await Promise.resolve();
  assert.equal(f.nodes['wallet-review-panel'].hidden,false);
  if(surface==='token')assert.match(f.nodes['wallet-review-description'].textContent,fa?/فروش FTI نیست/:/does not sell FTI/);
  else assert.match(f.nodes['wallet-review-description'].textContent,/does not buy units/);
  assert.equal(cancelSends,0);f.nodes['confirm-wallet-request'].onclick();assert.equal(cancelSends,1);assert.equal(record,'unknown:12');assert.equal(refreshed,0);
  finish();await action;assert.equal(refreshed,1);assert.equal(cancelSends,1);
  assert.match(f.messages.at(-1)[0],surface==='member'?/Review your balance/:fa?/دوباره تأیید فروش FTI/:/press Confirm FTI sale again/);
 }
});
