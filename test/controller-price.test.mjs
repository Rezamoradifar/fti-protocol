import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {formatEther,parseEther} from 'ethers';

const source=fs.readFileSync(new URL('../frontend/controller.js',import.meta.url),'utf8');
const priceStart=source.indexOf('let tokenPriceSnapshot,'),priceEnd=source.indexOf('async function refreshMembershipState()',priceStart);
const walletStart=source.indexOf('async function refreshTokenState()'),walletEnd=source.indexOf('async function transaction(',walletStart);
const navStart=source.indexOf('function navigate('),navEnd=source.indexOf("document.querySelectorAll('[data-page],[data-go]')",navStart);
const market=(overrides={})=>({block:123,timestamp:2000,price:parseEther('0.103092783505154639'),reserve:parseEther('41.31'),supply:parseEther('400.707'),cycleStartPrice:parseEther('0.1'),...overrides});
const address='0x'+'1'.repeat(40);
function fixture(readPrice=async()=>market()){
 const elements=new Map(),calls=[];
 const node=id=>{if(!elements.has(id))elements.set(id,{textContent:'—',dataset:{}});return elements.get(id);};
 const context={cfg:{token:'0x'+'2'.repeat(40),chainId:56,tokenContract:'FTIReserveTokenUpgradeable'},v3Model:true,rpc:{},read:{token:{},binary:{},usd:{}},
  state:{tokenStateVerified:false,wallet:null},address:null,signer:null,refreshSequence:0,
  $:selector=>node(selector.slice(1)),text:(id,value)=>{node(id).textContent=value;},t:value=>value,
  displayNumber:(value,options)=>new Intl.NumberFormat('en-US',options).format(value),formatEther,fmt:value=>formatEther(value),integer:String,utc:value=>'time:'+value,
  Date:class extends Date{static now(){return 2000*1000;}},
  preparationDeadline:async promise=>promise,readTokenPriceSnapshot:async options=>{calls.push(options);return readPrice();},
  status:()=>assert.fail('Public price reads must not overwrite wallet status'),
  cancelEvents(){},
  readTokenSnapshot:async()=>({...market({block:124,price:parseEther('0.11')}),tokenStateVerified:true,tokenPaused:false,emergencyUnwind:false,wallet:{address,exists:true,units:1n,ftiBalance:parseEther('1'),unlocked:parseEther('1'),remaining:parseEther('499'),usdBalance:parseEther('40')}}),
  syncActions(){},wallet:()=>context.state.wallet,
 };
 vm.runInNewContext(source.slice(priceStart,priceEnd)+'\n'+source.slice(walletStart,walletEnd),context);
 return {context,calls,node,elements};
}

test('anonymous canonical prices populate member, token and trade displays with eight significant digits and their own freshness',async()=>{
 const f=fixture();await f.context.refreshTokenPrice();
 for(const id of ['price','token-spot','trade-price']){assert.equal(f.node(id).textContent,'0.10309278');assert.equal(f.node(id).dataset.state,'verified');}
 for(const id of ['price-status','token-price-status','trade-price-status'])assert.match(f.node(id).textContent,/Live.*time:2000.*Block 123/);
 assert.equal(f.node('token-reserve').textContent,'41.31');assert.equal(f.node('token-supply').textContent,'400.707');
 assert.equal(f.context.address,null);assert.equal(f.context.state.wallet,null);assert.equal(f.context.state.tokenStateVerified,false);
 assert.equal('address' in f.calls[0],false);
});

test('the actual post-purchase wallet refresh immediately updates visible price and an older public reply cannot overwrite it',async()=>{
 let release;const f=fixture(()=>new Promise(resolve=>{release=resolve;})),pending=f.context.refreshTokenPrice();
 f.context.address=address;f.context.signer={};await f.context.refreshTokenState();
 assert.equal(f.node('trade-price').textContent,'0.11');assert.equal(f.context.state.wallet.ftiBalance,parseEther('1'));
 release(market());await pending;
 assert.equal(f.node('price').textContent,'0.11');assert.match(f.node('price-status').textContent,/Block 124/);
});

test('a slow full dashboard render cannot overwrite the canonical V3 price, reserve or supply',async()=>{
 const f=fixture();await f.context.refreshTokenPrice();
 f.context.d={price:parseEther('999'),reserve:parseEther('999'),supply:parseEther('999'),bb:0n,floor:0n,count:1n,pointPool:0n,epoch:1n,phase:0,level:0n,epochEnd:2001,account1:[0n,0n],account2:[0n,0n],jobCursor:0n,jobCount:0n,cursor:0n,clock:0n,cycle:1n,ath:parseEther('0.1'),builderMultiplier:1n};
 const start=source.indexOf('const legacyPriceValues='),end=source.indexOf("$('#emergency-panel').hidden",start);
 assert.ok(start>0&&end>start);vm.runInNewContext(source.slice(start,end),f.context);
 assert.equal(f.node('price').textContent,'0.10309278');assert.equal(f.node('token-reserve').textContent,'41.31');assert.equal(f.node('token-supply').textContent,'400.707');
});

test('a failed later refresh retains the last verified price but visibly marks it unavailable',async()=>{
 let fail=false;const f=fixture(async()=>{if(fail)throw Error('RPC offline');return market();});
 await f.context.refreshTokenPrice();fail=true;await assert.rejects(f.context.refreshTokenPrice(),/offline/);
 assert.equal(f.node('price').textContent,'0.10309278');assert.equal(f.node('price').dataset.state,'stale');
 assert.match(f.node('price-status').textContent,/Price feed unavailable.*time:2000.*Block 123/);
});

test('an unreadable initial public price stays absent and reports unavailability instead of inventing zero',async()=>{
 const f=fixture(async()=>{throw Error('RPC offline');});await assert.rejects(f.context.refreshTokenPrice(),/offline/);
 assert.equal(f.node('price').textContent,'—');assert.equal(f.node('price').dataset.state,'stale');
 assert.equal(f.node('price-status').textContent,'Price feed unavailable');
});

test('an older failed public request cannot mark a newer post-purchase observation stale',async()=>{
 let reject;const f=fixture(()=>new Promise((_,fail)=>{reject=fail;})),pending=f.context.refreshTokenPrice();
 f.context.address=address;f.context.signer={};await f.context.refreshTokenState();reject(Error('Old request failed'));await assert.rejects(pending);
 assert.equal(f.node('price').textContent,'0.11');assert.equal(f.node('price').dataset.state,'verified');assert.match(f.node('price-status').textContent,/Live.*Block 124/);
});

test('zero supply never displays the cycle opening quote as a traded market price',async()=>{
 const f=fixture(async()=>market({price:0n,reserve:0n,supply:0n,cycleStartPrice:parseEther('0.2')}));await f.context.refreshTokenPrice();
 assert.equal(f.node('price').textContent,'—');assert.equal(f.node('trade-price').textContent,'—');assert.equal(f.node('bootstrap-display').textContent,'0.2 USD');
 assert.match(f.node('token-price-status').textContent,/No price exists while token supply is zero/);
});

test('old canonical observations are labelled delayed instead of live',async()=>{
 const f=fixture(async()=>market({timestamp:1900}));await f.context.refreshTokenPrice();
 assert.equal(f.node('trade-price').dataset.state,'stale');assert.match(f.node('trade-price-status').textContent,/Delayed chain data.*Block 123/);
});

test('overlapping public refreshes share one read and a completed read permits the next refresh',async()=>{
 let release;const f=fixture(()=>new Promise(resolve=>{release=resolve;}));
 const first=f.context.refreshTokenPrice(),second=f.context.refreshTokenPrice();assert.equal(f.calls.length,1);
 release(market());await Promise.all([first,second]);
 const next=f.context.refreshTokenPrice();assert.equal(f.calls.length,2);release(market({block:124}));await next;
});

test('entering the member overview or token trade starts a wallet-independent price read immediately',async()=>{
 for(const page of ['overview','token-home','trade']){
  const f=fixture();Object.assign(f.context,{titles:{[page]:page},defaultPage:page,surfacePages:[[page,page]],location:{hash:'#'+page,search:''},document:{querySelectorAll:()=>[]},history:{replaceState(){}},withLanguage:value=>value});
  vm.runInNewContext(source.slice(navStart,navEnd),f.context);f.context.navigate(page);assert.equal(f.calls.length,1);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.node('price').textContent,'0.10309278');
 }
 assert.ok(source.indexOf('navigate(location.hash.slice(1)')<source.indexOf('await initializeReadSession('));
});

test('the actual visible member, token and trade sections each include a dedicated price freshness status',()=>{
 const jsx=fs.readFileSync(new URL('../frontend/main.jsx',import.meta.url),'utf8');
 for(const [start,end,price,status]of [['function Overview()','function Membership()','price','price-status'],['function TokenHome()','function Activity()','token-spot','token-price-status'],['function Trading()','function Rewards()','trade-price','trade-price-status']]){
  const section=jsx.slice(jsx.indexOf(start),jsx.indexOf(end));assert.ok(section.includes(`id="${price}"`));assert.ok(section.includes(`id="${status}" role="status"`));
 }
});
