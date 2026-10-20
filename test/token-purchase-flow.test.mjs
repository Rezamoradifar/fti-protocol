import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseEther} from 'ethers';

const source=fs.readFileSync(new URL('../frontend/controller.js',import.meta.url),'utf8');
const formStart=source.indexOf('function amountInput('),formEnd=source.indexOf("$('#emergency-form').onsubmit=",formStart);
const approvalStart=source.indexOf('async function approve('),approvalEnd=source.indexOf('let walletProvider',approvalStart);
const transactionStart=source.indexOf('async function transaction('),transactionEnd=source.indexOf('async function send(',transactionStart);
assert.ok(formStart>0&&formEnd>formStart&&approvalStart>0&&approvalEnd>approvalStart&&transactionEnd>transactionStart);
const UNIT=10n**18n,tokenAddress='0x'+'2'.repeat(40),account='0x'+'1'.repeat(40);

function fixture(options={}){
 const calls=[],form={elements:{amount:{value:options.amount||'5'},slippage:{value:options.slippage||'1'}}},sell={elements:{amount:{value:'1'},slippage:{value:'1'}}};
 let approved=options.allowance??5n*UNIT,action,snapshots=0;
 const state={timestamp:1000,tokenPaused:false,tokenRecoveryFrozen:false,emergencyUnwind:false,wallet:{exists:true,units:1n,usdBalance:41n*UNIT,remaining:500n*UNIT,unlocked:0n,...options.initialWallet},...options.initialState};
 const context={state,parseEther,cfg:{token:tokenAddress,tokenContract:'FTIReserveTokenUpgradeable'},address:account,transactionAddress:account,transactionStage:'',v3Model:true,
  $:selector=>selector==='#buy-form'?form:sell,t:value=>value,text(){},fmt:String,networkProfile:{testAssets:false,currency:'USDT'},status(){},clearTimeout,setTimeout,
  transaction(fn,flags){calls.push(['transaction',flags]);action=fn();return action;},
  wallet:()=>context.state.wallet,
  checkCollateral:async amount=>{calls.push(['balance',amount]);if(amount>context.state.wallet.usdBalance)throw Error('Insufficient collateral');},
  refreshTokenState:async()=>{snapshots++;calls.push(['snapshot']);context.state={...context.state,timestamp:2000,...options.freshState,wallet:{...context.state.wallet,...options.freshWallet}};options.onSnapshot?.(context,form);},
  refresh:async()=>assert.fail('Token purchase must not use the dashboard endpoint'),
  read:{token:{quoteBuy:async amount=>{calls.push(['quote',amount]);assert.equal(snapshots,1,'quote must follow post-approval snapshot');return options.quote??1000n*UNIT;}},
   usd:{allowance:async(owner,spender)=>{assert.equal(owner,account);assert.equal(spender,tokenAddress);calls.push(['allowance',approved]);return snapshots&&options.finalAllowance!==undefined?options.finalAllowance:approved;}}},
  sendContract:async(key,method,...args)=>{calls.push(['send',key,method,...args]);if(key==='usd'){
   if(options.rejectApproval)throw Object.assign(Error('Approval rejected'),{code:4001});
   approved=args[1];options.onApproval?.(context,form);
  }},
  send:()=>assert.fail('Token buy must use the prepared confirmation path'),
  write:()=>assert.fail('BrowserProvider signer sends must not be used for token buy')};
 vm.runInNewContext(source.slice(approvalStart,approvalEnd)+'\n'+source.slice(formStart,formEnd),context);
 return {context,form,calls,submit(){form.onsubmit({preventDefault(){}});return action;}};
}
const sends=f=>f.calls.filter(call=>call[0]==='send');

test('actual token buy skips sufficient approval and sends the exact amount, slippage and fresh deadline through sendContract',async()=>{
 const f=fixture();await f.submit();
 assert.equal(f.calls[0][1].tokenPurchase,true);
 assert.deepEqual(sends(f),[['send','token','buy',5n*UNIT,990n*UNIT,3200n]]);
 assert.equal(f.calls.filter(([kind])=>kind==='balance').length,2);
 assert.ok(f.calls.findIndex(([kind])=>kind==='snapshot')<f.calls.findIndex(([kind])=>kind==='quote'));
});

test('actual buy obtains only the required USDT approval before preparing the token purchase',async()=>{
 const f=fixture({allowance:0n});await f.submit();
 assert.deepEqual(sends(f),[['send','usd','approve',tokenAddress,5n*UNIT],['send','token','buy',5n*UNIT,990n*UNIT,3200n]]);
 assert.ok(f.calls.findIndex(call=>call[0]==='send'&&call[1]==='usd')<f.calls.findIndex(([kind])=>kind==='snapshot'));
});

test('a smaller existing allowance is reset and approved without changing the purchase amount',async()=>{
 const f=fixture({allowance:2n*UNIT});await f.submit();
 assert.deepEqual(sends(f),[['send','usd','approve',tokenAddress,0],['send','usd','approve',tokenAddress,5n*UNIT],['send','token','buy',5n*UNIT,990n*UNIT,3200n]]);
});

test('rejected approval never proceeds to a token quote or buy',async()=>{
 const f=fixture({allowance:0n,rejectApproval:true});await assert.rejects(f.submit(),/rejected/);
 assert.equal(sends(f).length,1);assert.equal(f.calls.some(([kind])=>kind==='quote'),false);
 assert.equal(sends(f).some(call=>call[1]==='token'),false);
});

test('the amount and slippage captured for this purchase stay fixed across asynchronous approval',async()=>{
 const f=fixture({allowance:0n,onApproval(_,form){form.elements.amount.value='40';form.elements.slippage.value='5';}});await f.submit();
 assert.deepEqual(sends(f).at(-1),['send','token','buy',5n*UNIT,990n*UNIT,3200n]);
});

test('post-approval membership, pause, freeze, emergency, balance and purchase cap changes prevent the buy',async()=>{
 for(const changes of [
  {freshWallet:{exists:false}}, {freshWallet:{units:0n}},
  {freshState:{tokenPaused:true}}, {freshState:{tokenRecoveryFrozen:true}}, {freshState:{emergencyUnwind:true}},
  {freshWallet:{usdBalance:4n*UNIT}}, {freshWallet:{remaining:4n*UNIT}},
 ]){
  const f=fixture({allowance:0n,...changes});await assert.rejects(f.submit());
  assert.equal(sends(f).some(call=>call[1]==='token'),false);
 }
});

test('an unverified final approval or unavailable quote cannot send a token purchase',async()=>{
 for(const changes of [{finalAllowance:0n},{quote:0n},{quote:-1n}]){
  const f=fixture(changes);await assert.rejects(f.submit());assert.equal(sends(f).some(call=>call[1]==='token'),false);
 }
});

test('initial insufficient balance, purchase cap and membership prevent even the approval request',async()=>{
 for(const initialWallet of [{usdBalance:4n*UNIT},{remaining:4n*UNIT},{exists:false},{units:0n}]){
  const f=fixture({allowance:0n,initialWallet});await assert.rejects(f.submit());assert.equal(sends(f).length,0);
 }
});

test('invalid amounts, slippage and above-contract step limit prevent wallet requests',async()=>{
 for(const options of [{amount:'0'},{amount:'-1'},{slippage:'-1'},{slippage:'6'},{amount:'64001'}]){
  const f=fixture(options);await assert.rejects(f.submit());assert.equal(sends(f).length,0);
 }
});

function transactionFixture(record=null){
 const counters={snapshot:0,dashboard:0,run:0,monitor:0},messages=[],tracker={read:()=>record};
 const context={busy:false,signer:{},address:account,connecting:false,transactionStage:'',transactionAddress:null,activeTransaction:null,v3Model:true,
  cfg:{mode:'mainnet',chainId:56},walletProvider:{},localStorage:{},rpc:{},explorer:'',
  stopPendingChecks(){},startPendingChecks(){counters.monitor++;},syncActions(){},status:(...args)=>messages.push(args),t:value=>value,
  readWalletIdentity:async()=>{},transactionState:()=>tracker,hashView:{restore(){}},resolvePending:async()=>null,
  refreshTokenState:async()=>{counters.snapshot++;},refreshMembershipState:async()=>assert.fail('Token option must select token data'),
  refresh:async()=>{counters.dashboard++;throw Error('Contract data service HTTP 400');},
  purchaseError:(_,error)=>error.message,$:()=>({hidden:true})};
 vm.runInNewContext(source.slice(transactionStart,transactionEnd),context);
 return {context,counters,messages,tracker,run:()=>context.transaction(async()=>{counters.run++;return 'Purchase confirmed';},{tokenPurchase:true})};
}

test('the actual transaction wrapper uses verified token reads before and after purchase without /api/state',async()=>{
 const f=transactionFixture();await f.run();
 assert.equal(f.counters.dashboard,0);assert.equal(f.counters.snapshot,2);assert.equal(f.counters.run,1);
 assert.equal(f.context.busy,false);assert.equal(f.messages.at(-1)[0],'Purchase confirmed');
});

test('the actual token transaction wrapper preserves an unknown send and never starts another purchase',async()=>{
 const f=transactionFixture('unknown:3');await f.run();
 assert.equal(f.tracker.read(),'unknown:3');assert.equal(f.counters.snapshot,0);assert.equal(f.counters.run,0);
 assert.equal(f.counters.monitor,1);assert.equal(f.context.busy,false);
});
