import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {isAddress} from 'ethers';
import {readWalletIdentity,preparationDeadline} from '../frontend/wallet-preflight.js';
const source=fs.readFileSync(new URL('../frontend/controller.js',import.meta.url),'utf8');
const start=source.indexOf('async function connect('),end=source.indexOf("$('#connect').onclick=",start);
const address='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40);
function fixture({silent=false,selection=true,accounts=[address],permissionError,chain='0x38',currentAccounts=accounts}={}){
 const calls=[],labels=[],messages=[],storage=new Map(),nodes={'unknown-send-form':{hidden:true}};
 let fallback=0,signers=0;
 const selected={name:'SafePal',id:'safepal',provider:{request:async request=>{
  calls.push(request.method);
  if(request.method==='eth_chainId')return chain;
  if(request.method==='eth_accounts')return currentAccounts;
  if(request.method==='wallet_switchEthereumChain')throw Error('User rejected network switch');
  assert.fail('No wallet permissions or transactions may be requested outside the selector');
 }}};
 const context={connecting:false,busy:false,signer:null,address:null,selectedWallet:null,walletProvider:null,autoDirty:false,councilOwner:false,
  cfg:{mode:'bnb-mainnet',chainId:56,tokenContract:'FTIReserveTokenUpgradeable'},networkProfile:{name:'BNB Smart Chain'},v3Model:true,surface:'member',location:{hash:'#network'},
  syncActions(){},text:(id,value)=>labels.push([id,value]),status:(value,error)=>messages.push([value,error]),t:value=>value,short:value=>value.slice(0,6)+'…'+value.slice(-4),
  chooseWallet:async options=>{calls.push(['choose',options]);return selection?selected:null;},
  requestWalletAccounts:async(value,quiet)=>{assert.equal(value,selected);assert.equal(quiet,silent);if(permissionError)throw permissionError;return accounts;},
  detachWallet(){},clearWallet(){context.signer=null;context.address=null;},
  BrowserProvider:class{async getNetwork(){return {chainId:56n};}getSigner(){assert.fail('getSigner must not issue another permission request');}},
  JsonRpcSigner:class{constructor(provider,account){signers++;this.account=account;}async getAddress(){return this.account;}},
  observeWallet:provider=>{context.walletProvider=provider;},preparationDeadline,readWalletIdentity,isAddress,
  sessionStorage:{setItem:(key,value)=>storage.set(key,value)},localStorage:{},transactionState:()=>({read:()=>null}),hashView:{restore(){}},$:selector=>nodes[selector.slice(1)],
  refresh:async()=>{throw Error('Contract data service HTTP 400');},refreshMembershipState:async()=>{fallback++;},refreshTokenState:async()=>assert.fail('Member connection uses membership data'),
  purchaseError:(_,error)=>error.message,startPendingChecks(){}};
 vm.runInNewContext(source.slice(start,end),context);
 return {context,calls,labels,messages,storage,signers:()=>signers,fallback:()=>fallback,run:()=>context.connect({silent})};
}
test('actual SafePal connection asks the selector to authorize and uses its granted account without a second signer permission',async()=>{
 const f=fixture();await f.run();
 assert.equal(f.calls[0][1].authorize,true);assert.equal(f.context.address,address);assert.equal(f.context.connecting,false);assert.equal(f.signers(),1);assert.equal(f.fallback(),1);
 assert.equal(f.storage.get('fti-wallet-connected'),'yes');assert(f.labels.some(([id,value])=>id==='connect-label'&&value.startsWith('SafePal · ')));
 assert(f.messages.some(([value])=>value==='Confirm connection in your wallet.'));
 assert(!f.calls.includes('eth_requestAccounts'));assert(!f.calls.includes('eth_sendTransaction'));
});
test('silent reconnect never asks the selector to authorize and uses only readonly identity checks',async()=>{
 const f=fixture({silent:true});await f.run();assert.equal(f.calls[0][1].authorize,false);assert.equal(f.context.address,address);assert.equal(f.signers(),1);
 assert(!f.messages.some(([value])=>value==='Confirm connection in your wallet.'));
});
test('closing selection or rejecting permission restores Connect without inventing a connected account',async()=>{
 for(const options of [{selection:false},{permissionError:Object.assign(Error('Rejected'),{code:4001})}]){
  const f=fixture(options);await f.run();assert.equal(f.context.address,null);assert.equal(f.context.connecting,false);assert.equal(f.signers(),0);assert.equal(f.storage.size,0);
  assert.deepEqual(f.labels.at(-1),['connect-label','Connect wallet']);
 }
});
test('a pending permission timeout restores the control and describes waiting without creating a session',async()=>{
 const f=fixture({permissionError:Object.assign(Error('pending'),{code:'FTI_WALLET_AUTHORIZATION_TIMEOUT'})});await f.run();
 assert.equal(f.context.connecting,false);assert.equal(f.context.address,null);assert.equal(f.storage.size,0);assert.match(f.messages.at(-1)[0],/has not answered/);
});
test('malformed, empty or changed accounts cannot become a connected signer',async()=>{
 for(const options of [{accounts:[]},{accounts:'invalid'},{accounts:['not-an-address']},{currentAccounts:[other]}]){
  const f=fixture(options);await f.run();assert.equal(f.context.address,null);assert.equal(f.signers(),0);assert.equal(f.context.connecting,false);
 }
});
test('network-switch rejection leaves no connected signer and performs no permission retry',async()=>{
 const f=fixture({chain:'0x1'});await f.run();assert.equal(f.context.address,null);assert.equal(f.signers(),0);assert.equal(f.calls.filter(x=>x==='wallet_switchEthereumChain').length,1);assert(!f.calls.includes('eth_requestAccounts'));
});
