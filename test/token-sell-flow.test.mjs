import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {setImmediate as tick} from 'node:timers/promises';
import {Interface,parseEther,formatEther} from 'ethers';
import {walletReview} from '../frontend/wallet-review.js';
import {readWalletIdentity} from '../frontend/wallet-preflight.js';
import {transactionState,resolvePending,prepareContractRequest,preparedWalletSend,submitTracked,confirmedReceipt} from '../frontend/transaction-state.js';

const source=fs.readFileSync(new URL('../frontend/controller.js',import.meta.url),'utf8');
function section(start,end){const first=source.indexOf(start),last=source.indexOf(end,first);assert.ok(first>=0&&last>first);return source.slice(first,last);}
const transactionCode=section('async function transaction(','async function send(');
const preparedCode=section('async function sendContract(',"$('#find-transaction-hash').onclick=");
const formsCode=section('function amountInput(',"$('#emergency-form').onsubmit=");
const A='0x'+'1'.repeat(40),B='0x'+'2'.repeat(40),TOKEN='0x'+'3'.repeat(40),HASH='0x'+'a'.repeat(64),UNIT=10n**18n;
const iface=new Interface(['function sell(uint256 tokens,uint256 minUSD,uint256 deadline)']);
function fixture(options={}){
 const entries=new Map(),storage={getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
 const tracker=transactionState(storage,56,A),nodes={},calls=[],messages=[],counts={snapshots:0,dashboard:0,estimates:0};let activeClick=false,action;
 function node(id){return nodes[id]??=( {hidden:true,disabled:false,textContent:'',elements:{hash:{}},focus(){},scrollIntoView(){},querySelectorAll(){return[];}} );}
 const buy=node('buy-form'),sell=node('sell-form');
 for(const form of [buy,sell])form.elements={amount:{value:options.amount??'1'},slippage:{value:options.slippage??'0.5'}};
 const translate=(en,fa)=>options.fa&&fa?fa:en;
 const review=walletReview({document:{getElementById:node},translate});
 const receipt={hash:HASH,status:1};
 const walletProvider={request:async request=>{
  calls.push(request);
  if(request.method==='eth_chainId')return'0x38';if(request.method==='eth_accounts')return[A];
  assert.equal(request.method,'eth_sendTransaction');assert.equal(activeClick,true,'wallet send must retain the explicit confirmation click');
  if(options.sendError)throw options.sendError;return HASH;
 }};
 const rpc={estimateGas:async request=>{counts.estimates++;assert.equal(request.from,A);options.onEstimate?.(context);if(options.preflightError)throw Error(options.preflightError);return 100n;},
  send:async method=>{assert.ok(['eth_getTransactionCount','eth_gasPrice'].includes(method));return method==='eth_gasPrice'?'0x64':'0x12';},
  getRpcTransaction:request=>Object.fromEntries(Object.entries(request).map(([key,value])=>[key==='gasLimit'?'gas':key,typeof value==='number'||typeof value==='bigint'?'0x'+value.toString(16):value])),
  waitForTransaction:async()=>receipt,getTransactionReceipt:async()=>null};
 const context={address:A,signer:{getAddress:async()=>A},transactionAddress:null,transactionStage:'',activeTransaction:null,busy:false,connecting:false,
  state:{timestamp:1000,tokenStateVerified:true,tokenPaused:false,tokenRecoveryFrozen:false,emergencyUnwind:false,wallet:{address:A,exists:false,units:0n,unlocked:10n*UNIT,ftiBalance:10n*UNIT,usdBalance:0n}},
  cfg:{mode:'bnb-mainnet',chainId:56,tokenContract:'FTIReserveTokenUpgradeable'},v3Model:true,walletProvider,rpc,review,localStorage:storage,
  $:selector=>node(selector.slice(1)),status:(...message)=>messages.push(message),t:translate,text(){},short:value=>value,integer:String,formatEther,parseEther,
  fmt:formatEther,networkProfile:{currency:'USDT'},clearTimeout,setTimeout,
  syncActions(){},stopPendingChecks(){},startPendingChecks(){},hashView:{restore(){},show(){},hide(){}},explorer:'',
  readWalletIdentity,transactionState,resolvePending,prepareContractRequest,preparedWalletSend,submitTracked,confirmedReceipt,
  purchaseError:(stage,error)=>'['+stage+'] '+error.message,reason:error=>error.message,
  refreshMembershipState:async()=>assert.fail('sale must not select membership reads'),
  refresh:async()=>{counts.dashboard++;throw Error('Contract data service HTTP 503');},
  refreshTokenState:async()=>{counts.snapshots++;context.state={...context.state,timestamp:2000,...options.freshState,wallet:{...context.state.wallet,...options.freshWallet}};},
  read:{token:{quoteSell:async amount=>{calls.push({method:'quoteSell',amount});return[options.quote??UNIT/10n,UNIT/9n];},sell:{populateTransaction:async(...args)=>({to:TOKEN,data:iface.encodeFunctionData('sell',args)})}}},
  approve:()=>assert.fail('selling FTI must not request USDT approval'),checkCollateral:()=>assert.fail('selling FTI must not require a USDT balance'),
  send:()=>assert.fail('V3 sales must not use the legacy BrowserProvider send'),write:()=>assert.fail('V3 sales must not create a BrowserProvider contract write')};
 context.wallet=()=>context.state.wallet;
 vm.runInNewContext(transactionCode+'\n'+preparedCode+'\n'+formsCode+'\nconst originalTransaction=transaction;transaction=(...args)=>capture(originalTransaction(...args));',Object.assign(context,{capture:promise=>(action=promise)}));
 return{context,calls,messages,counts,tracker,nodes,submit(){sell.onsubmit({preventDefault(){}});return action;},
  async ready(){for(let i=0;i<50&&node('wallet-review-panel').hidden;i++)await tick();assert.equal(node('wallet-review-panel').hidden,false);},
  click(){activeClick=true;node('confirm-wallet-request').onclick();activeClick=false;},get action(){return action;}};
}
const sends=f=>f.calls.filter(call=>call.method==='eth_sendTransaction');

test('actual V3 sell bypasses an unavailable dashboard and prepares one explicit wallet sale without membership or USDT approval',async()=>{
 const f=fixture();f.submit();await f.ready();
 assert.equal(f.counts.dashboard,0);assert.equal(f.counts.snapshots,1);assert.equal(f.tracker.read(),null);assert.equal(sends(f).length,0);
 assert.equal(f.nodes['wallet-review-title'].textContent,'Sell FTI');assert.match(f.nodes['wallet-review-description'].textContent,/1\.0 FTI.*0\.0995 USDT/);
 f.click();await f.action;assert.equal(sends(f).length,1);assert.equal(f.counts.snapshots,2);assert.equal(f.counts.dashboard,0);assert.equal(f.tracker.read(),null);
 const request=sends(f)[0].params[0],decoded=iface.decodeFunctionData('sell',request.data);
 assert.equal(request.to,TOKEN);assert.equal(request.chainId,'0x38');assert.equal(request.value,'0x0');assert.equal(request.gas,'0x78');
 assert.equal(decoded.tokens,UNIT);assert.equal(decoded.minUSD,995n*UNIT/10000n);assert.equal(decoded.deadline,3200n);
 assert.match(f.messages.at(-1)[0],/FTI sale confirmed/);
});

test('fractional V3 sales preserve exact token and minimum-output units',async()=>{
 const f=fixture({amount:'0.000000000000000123',quote:11n,slippage:'1'});f.submit();await f.ready();f.click();await f.action;
 const decoded=iface.decodeFunctionData('sell',sends(f)[0].params[0].data);assert.equal(decoded.tokens,123n);assert.equal(decoded.minUSD,10n);
});

test('fresh pause, freeze, emergency, balance and zero-output checks prevent even sale preparation',async()=>{
 for(const options of [{freshState:{tokenPaused:true}},{freshState:{tokenRecoveryFrozen:true}},{freshState:{emergencyUnwind:true}},{freshWallet:{unlocked:UNIT-1n}},{quote:0n}]){
  const f=fixture(options);await f.submit();assert.equal(f.counts.estimates,0);assert.equal(sends(f).length,0);assert.equal(f.tracker.read(),null);
 }
});

test('sale preflight protections have actionable English/Persian messages and create no unknown record',async()=>{
 for(const [preflightError,fa,expected]of [['hourly sell protection',false,/shared hourly sale limit/],['hourly sell protection',true,/سقف مشترک فروش ساعتی/],['single sell protection',false,/reserve limit for a single sale/],['single sell protection',true,/سقف ذخیرهٔ مجاز برای هر فروش/],['slippage\/dust',false,/Preflight failed/]]){
  const f=fixture({preflightError,fa});await f.submit();assert.match(f.messages.at(-1)[0],expected);assert.equal(f.tracker.read(),null);assert.equal(sends(f).length,0);assert.equal(f.nodes['wallet-review-panel'].hidden,true);
 }
});

test('wallet changes during sale preparation or after review never reach the wallet send or create a pending record',async()=>{
 const preparing=fixture({onEstimate(context){context.address=B;}});await preparing.submit();assert.equal(preparing.tracker.read(),null);assert.equal(sends(preparing).length,0);
 const reviewed=fixture();reviewed.submit();await reviewed.ready();reviewed.context.address=B;reviewed.click();await reviewed.action;assert.equal(reviewed.tracker.read(),null);assert.equal(sends(reviewed).length,0);
});

test('explicit sale rejection clears only its own attempt, while an ambiguous wallet reply remains protected',async()=>{
 const rejected=fixture({sendError:Object.assign(Error('rejected'),{code:4001})});rejected.submit();await rejected.ready();rejected.click();await rejected.action;assert.equal(rejected.tracker.read(),null);
 const unknown=fixture({sendError:Error('wallet reply lost')});unknown.submit();await unknown.ready();unknown.click();await unknown.action;assert.equal(unknown.tracker.read(),'unknown:18');
 await unknown.submit();assert.equal(sends(unknown).length,1);assert.equal(unknown.counts.snapshots,1);assert.equal(unknown.tracker.read(),'unknown:18');
});

test('existing unknown or pending-hash records block sales before fresh reads or wallet preparation',async()=>{
 for(const record of ['unknown',HASH]){
  const f=fixture();if(record==='unknown')f.tracker.saveUnknown(3);else f.tracker.save(record);
  await f.submit();assert.equal(f.counts.snapshots,0);assert.equal(f.counts.estimates,0);assert.equal(sends(f).length,0);assert.equal(f.tracker.read(),record==='unknown'?'unknown:3':HASH);
 }
});

test('actual token refresh updates the available-sale balance independently of full dashboard data',async()=>{
 const labels={},state={wallet:{address:A}},context={address:A,signer:{},state,cfg:{chainId:56,token:TOKEN},v3Model:true,rpc:{},read:{binary:{},usd:{},token:{}},refreshSequence:0,
  wallet:()=>state.wallet,preparationDeadline:promise=>promise,readTokenSnapshot:async()=>({timestamp:2000,block:10,tokenStateVerified:true,tokenPaused:false,emergencyUnwind:false,wallet:{address:A,exists:false,units:0n,ftiBalance:parseEther('0.125'),unlocked:parseEther('0.125'),usdBalance:0n,remaining:0n}}),
  memberReadSucceeded(){},renderTokenPrice(){},syncActions(){},text:(key,value)=>labels[key]=value,fmt:formatEther,integer:String,t:value=>value};
 vm.runInNewContext(section('async function refreshTokenState(','async function transaction('),context);await context.refreshTokenState();
 assert.equal(labels['sell-available'],'Available: 0.125 FTI');assert.match(labels['trade-notice'],/before buying FTI/);
});

test('actual action gates freeze sale fields while busy and allow a funded nonmember to sell when ready',()=>{
 const nodes={},button=requires=>({dataset:{requires},disabled:true}),buy=button('buyer'),sell=button('unlocked');
 function node(id){return nodes[id]??={elements:[],dataset:{},querySelectorAll:()=>[],querySelector:()=>({disabled:false})};}
 for(const [id,fields,writeButton]of [['buy-form',['amount','slippage'],buy],['sell-form',['amount','slippage'],sell],['register-form',['units','sponsor']],['auto-form',['enabled','percent','price']]]){
  const form=node(id);for(const name of fields){const field={disabled:false};form.elements.push(field);form.elements[name]=field;}
  form.querySelectorAll=selector=>selector==='input,select'?form.elements:writeButton?[writeButton]:[];
 }
 node('unknown-send-form').elements.hash={};
 const context={busy:true,connecting:false,signer:{},address:A,state:{tokenStateVerified:true,tokenPaused:false,emergencyUnwind:false,phase:0},
  wallet:()=>({exists:false,units:0n,ftiBalance:UNIT,unlocked:UNIT}),councilOwner:false,lockOffset:0,selectableAuto:false,builderMode:'legacy',cfg:{},
  $:selector=>node(selector.slice(1)),document:{querySelectorAll:()=>[buy,sell]},membershipBlock:()=>null,t:value=>value,builderMonthState:()=>({canBegin:false,canProcess:false})};
 context.publishMemberPanel=()=>{};
 vm.runInNewContext(section('function syncActions(){','function write('),context);context.syncActions();
 assert.ok(node('sell-form').elements.every(field=>field.disabled));assert.equal(sell.disabled,true);
 context.busy=false;context.syncActions();assert.ok(node('sell-form').elements.every(field=>!field.disabled));assert.equal(sell.disabled,false);assert.equal(buy.disabled,true);
 context.state.tokenPaused=true;context.syncActions();assert.equal(sell.disabled,true);
});
