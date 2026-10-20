import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareUnknownCancellation,submitUnknownCancellation} from '../frontend/prepared-cancellation.js';
import {transactionState} from '../frontend/transaction-state.js';
const address='0x'+'a'.repeat(40),hash='0x'+'b'.repeat(64),blockHash='0x'+'c'.repeat(64);
const zero='0x0000000000000000000000000000000000000000',delegation='0xef0100'+'d'.repeat(40);
function fixture({code='0x'}={}){
 const map=new Map(),tracker=transactionState({getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)},56,address);tracker.saveUnknown(3);
 const calls=[],walletCalls=[];
 const receipt={hash,blockNumber:100,blockHash,status:1};
 const sent={hash,from:address,to:code===delegation?zero:address,value:0n,data:'0x',nonce:3,chainId:56n,blockNumber:100,blockHash,type:0,gasLimit:21000n};
 const provider={getNetwork:async()=>{calls.push('network');return {chainId:56n};},getCode:async who=>{calls.push('code:'+who);return who===address?code:'0x';},getTransactionCount:async()=>{calls.push('latest');return 3;},getFeeData:async()=>{calls.push('fee');return {gasPrice:101n};},
  waitForTransaction:async(h,count,timeout)=>{calls.push('receipt');assert.equal(h,hash);assert.equal(count,1);assert.equal(timeout,120000);return receipt;},getTransaction:async()=>{calls.push('transaction');return sent;},getBlock:async number=>{calls.push('block');return {hash:blockHash,number};}};
 const wallet={request:async payload=>{walletCalls.push(payload);return hash;}};
 return {tracker,provider,wallet,calls,walletCalls,receipt,sent};
}
test('preparation uses only public reads and creates an immutable zero-self RPC request',async()=>{
 const f=fixture(),prepared=await prepareUnknownCancellation(f.tracker,f.provider,address,56);
 assert.equal(prepared.record,'unknown:3');assert.equal(prepared.nonce,3);assert.equal(f.walletCalls.length,0);assert.equal(f.tracker.read(),'unknown:3');
 assert.equal(prepared.accountType,'eoa');assert.equal(prepared.accountCode,'0x');
 assert.deepEqual(prepared.request,{from:address,to:address,value:'0x0',data:'0x',nonce:'0x3',chainId:'0x38',gas:'0x5208',gasPrice:'0x7f',type:'0x0'});
 assert(Object.isFrozen(prepared));assert(Object.isFrozen(prepared.request));
});
test('wrong network, invalid wallet, smart account, wrong nonce and unavailable fee never reach the wallet',async()=>{
 for(const mutate of [f=>f.provider.getNetwork=async()=>({chainId:97}),f=>f.provider.getCode=async()=>'0x1234',f=>f.provider.getTransactionCount=async()=>4,f=>f.provider.getTransactionCount=async()=>2,f=>f.provider.getTransactionCount=async()=>undefined,f=>f.provider.getFeeData=async()=>({gasPrice:0n}),f=>f.provider.getFeeData=async()=>({gasPrice:null})]){
  const f=fixture();mutate(f);await assert.rejects(prepareUnknownCancellation(f.tracker,f.provider,address,56));assert.equal(f.walletCalls.length,0);assert.equal(f.tracker.read(),'unknown:3');
 }
 const f=fixture();await assert.rejects(prepareUnknownCancellation(f.tracker,f.provider,'0x123',56));assert.equal(f.walletCalls.length,0);
});
test('record changes during public preparation or before sending preserve the newer state without a prompt',async()=>{
 const f=fixture();f.provider.getFeeData=async()=>{f.tracker.saveUnknown(4);return {gasPrice:100n};};await assert.rejects(prepareUnknownCancellation(f.tracker,f.provider,address,56),/state changed/);assert.equal(f.tracker.read(),'unknown:4');
 const g=fixture(),prepared=await prepareUnknownCancellation(g.tracker,g.provider,address,56);g.tracker.saveUnknown(4);await assert.rejects(submitUnknownCancellation(g.tracker,g.wallet,g.provider,prepared),/state changed/);assert.equal(g.walletCalls.length,0);
});
test('fresh click calls one direct eth_sendTransaction before any asynchronous public read',async()=>{
 const f=fixture(),prepared=await prepareUnknownCancellation(f.tracker,f.provider,address,56);let active=true,submitted;
 f.calls.length=0;f.wallet.request=async payload=>{assert.equal(active,true);assert.deepEqual(f.calls,[]);f.walletCalls.push(payload);return hash;};
 f.provider.waitForTransaction=async()=>{assert.equal(submitted,hash);assert.equal(f.tracker.read(),'unknown:3');assert.equal(f.tracker.last(),hash);return f.receipt;};
 const pending=submitUnknownCancellation(f.tracker,f.wallet,f.provider,prepared,value=>{submitted=value;});active=false;
 await pending;assert.deepEqual(f.walletCalls,[{method:'eth_sendTransaction',params:[prepared.request]}]);assert.equal(f.tracker.read(),null);assert.equal(f.tracker.last(),hash);
});
test('explicit rejection, transport failure and malformed wallet hashes retain the original protected nonce',async()=>{
 for(const result of [{code:4001},Error('transport lost'),'not a hash']){
  const f=fixture(),prepared=await prepareUnknownCancellation(f.tracker,f.provider,address,56);f.wallet.request=async()=>{if(typeof result==='string')return result;throw result;};
  await assert.rejects(submitUnknownCancellation(f.tracker,f.wallet,f.provider,prepared));assert.equal(f.tracker.read(),'unknown:3');assert.equal(f.tracker.last(),null);
 }
});
test('confirmation timeout remembers and displays the real hash without releasing the unknown request',async()=>{
 const f=fixture(),prepared=await prepareUnknownCancellation(f.tracker,f.provider,address,56);let displayed;
 f.provider.waitForTransaction=async()=>{throw Error('RPC timeout');};
 await assert.rejects(submitUnknownCancellation(f.tracker,f.wallet,f.provider,prepared,value=>{displayed=value;}),/timeout/);
 assert.equal(displayed,hash);assert.equal(f.tracker.last(),hash);assert.equal(f.tracker.read(),'unknown:3');assert.equal(f.walletCalls.length,1);
});
test('wallet changes to sender, recipient, nonce, value, data, chain or mined block do not resolve the original request',async()=>{
 for(const change of [{from:'0x'+'d'.repeat(40)},{to:'0x'+'d'.repeat(40)},{nonce:4},{value:1n},{data:'0x12'},{chainId:97n},{blockHash:'0x'+'d'.repeat(64)},{blockNumber:99},{type:4},{type:2},{type:undefined},{gasLimit:22000n},{gasLimit:undefined},{authorizationList:[{}]},{accessList:[{}]},{authorizationList:{}},{accessList:{}}]){
  const f=fixture(),prepared=await prepareUnknownCancellation(f.tracker,f.provider,address,56);Object.assign(f.sent,change);
  await assert.rejects(submitUnknownCancellation(f.tracker,f.wallet,f.provider,prepared),/details differ/);assert.equal(f.tracker.read(),'unknown:3');assert.equal(f.tracker.last(),hash);
 }
});
test('missing transaction, tampered receipt, reorg or concurrent record changes keep the protected request',async()=>{
 for(const mutate of [f=>f.provider.getTransaction=async()=>null,f=>f.receipt.hash='0x'+'d'.repeat(64),f=>f.receipt.status=2,f=>f.provider.getBlock=async()=>({hash:'0x'+'d'.repeat(64)}),f=>f.provider.getBlock=async()=>{f.tracker.saveUnknown(4);return {hash:blockHash};}]){
  const f=fixture(),prepared=await prepareUnknownCancellation(f.tracker,f.provider,address,56);mutate(f);await assert.rejects(submitUnknownCancellation(f.tracker,f.wallet,f.provider,prepared));assert(f.tracker.read()?.startsWith('unknown:'));assert.equal(f.tracker.last(),hash);
 }
});
test('a canonical reverted cancellation consumes its nonce but never claims success',async()=>{
 const f=fixture(),prepared=await prepareUnknownCancellation(f.tracker,f.provider,address,56);f.receipt.status=0;
 await assert.rejects(submitUnknownCancellation(f.tracker,f.wallet,f.provider,prepared),/reverted/);assert.equal(f.tracker.read(),null);assert.equal(f.tracker.last(),hash);
});
test('malformed prepared payloads cannot send funds or move the recorded nonce',async()=>{
 const f=fixture(),prepared=await prepareUnknownCancellation(f.tracker,f.provider,address,56);
 for(const change of [{to:'0x'+'d'.repeat(40)},{value:'0x1'},{nonce:'0x4'},{gas:'0x10000'},{gasPrice:'0x0'},{data:'0x1234'}])await assert.rejects(submitUnknownCancellation(f.tracker,f.wallet,f.provider,{...prepared,request:{...prepared.request,...change}}),/Invalid prepared/);
 assert.equal(f.walletCalls.length,0);assert.equal(f.tracker.read(),'unknown:3');
});
test('an exact EIP-7702 delegation prepares and confirms only a zero-value legacy replacement to the empty fixed recipient',async()=>{
 const f=fixture({code:delegation}),prepared=await prepareUnknownCancellation(f.tracker,f.provider,address,56);
 assert.equal(prepared.accountType,'delegated-eoa');assert.equal(prepared.accountCode,delegation);
 assert.equal(prepared.request.to,zero);assert.notEqual(prepared.request.to,address);
 assert.equal(prepared.request.value,'0x0');assert.equal(prepared.request.data,'0x');assert.equal(prepared.request.gas,'0x5208');assert.equal(prepared.request.type,'0x0');
 assert.equal('authorizationList' in prepared.request,false);assert.equal('accessList' in prepared.request,false);
 assert(f.calls.includes('code:'+zero));assert.equal(f.walletCalls.length,0);
 await submitUnknownCancellation(f.tracker,f.wallet,f.provider,prepared);
 assert.equal(f.walletCalls.length,1);assert.equal(f.tracker.read(),null);assert.equal(f.tracker.last(),hash);
});
test('a delegated replacement sent to the delegated sender itself never releases the protected nonce',async()=>{
 const f=fixture({code:delegation}),prepared=await prepareUnknownCancellation(f.tracker,f.provider,address,56);f.sent.to=address;
 await assert.rejects(submitUnknownCancellation(f.tracker,f.wallet,f.provider,prepared),/details differ/);
 assert.equal(f.tracker.read(),'unknown:3');assert.equal(f.tracker.last(),hash);
});
test('ordinary contract accounts receive a typed unsupported result and keep the original request',async()=>{
 const f=fixture({code:'0x6000600055'});
 await assert.rejects(prepareUnknownCancellation(f.tracker,f.provider,address,56),error=>error.code==='FTI_UNSUPPORTED_SMART_ACCOUNT');
 assert.equal(f.walletCalls.length,0);assert.equal(f.tracker.read(),'unknown:3');
});
test('nonce-confirmed and earlier-transaction results take priority over smart-account classification',async()=>{
 for(const [latest,code]of [[4,'FTI_PREVIOUS_NONCE_CONFIRMED'],[2,'FTI_EARLIER_TRANSACTIONS_PENDING']]){
  const f=fixture({code:'0x6000600055'});f.provider.getTransactionCount=async()=>latest;
  f.provider.getCode=()=>assert.fail('Nonce state must be checked before code classification');
  await assert.rejects(prepareUnknownCancellation(f.tracker,f.provider,address,56),error=>error.code===code&&error.nonce===3&&error.latest===latest);
  assert.equal(f.walletCalls.length,0);assert.equal(f.tracker.read(),'unknown:3');
 }
});
test('malformed bytecode and malformed delegation indicators are not accepted as delegated EOAs',async()=>{
 for(const code of [undefined,null,'','0x0','0xzz','0xef0100','0xef0100'+'d'.repeat(38),'0xef0100'+'d'.repeat(42)]){
  const f=fixture();f.provider.getCode=async()=>code;
  await assert.rejects(prepareUnknownCancellation(f.tracker,f.provider,address,56),error=>error.code==='FTI_INVALID_ACCOUNT_CODE');
  assert.equal(f.walletCalls.length,0);assert.equal(f.tracker.read(),'unknown:3');
 }
});
test('an unreadable or nonempty fixed recipient prevents preparation for delegated accounts',async()=>{
 for(const destinationCode of [undefined,'0x0','0x6000',delegation]){
  const f=fixture({code:delegation});f.provider.getCode=async who=>who===address?delegation:destinationCode;
  await assert.rejects(prepareUnknownCancellation(f.tracker,f.provider,address,56),error=>error.code==='FTI_UNSAFE_CANCELLATION_RECIPIENT');
  assert.equal(f.walletCalls.length,0);assert.equal(f.tracker.read(),'unknown:3');
 }
});
test('classification metadata and copied prepared payloads cannot forge a delegated recipient',async()=>{
 const f=fixture(),prepared=await prepareUnknownCancellation(f.tracker,f.provider,address,56);
 for(const forged of [{...prepared},{...prepared,accountType:'delegated-eoa',accountCode:delegation,request:{...prepared.request,to:zero}},{...prepared,request:{...prepared.request,authorizationList:[]}},{...prepared,request:{...prepared.request,accessList:[]}}]){
  await assert.rejects(submitUnknownCancellation(f.tracker,f.wallet,f.provider,forged),/Invalid prepared/);
 }
 assert.equal(f.walletCalls.length,0);assert.equal(f.tracker.read(),'unknown:3');
});
test('account code or network changes during preparation do not create a wallet request',async()=>{
 const f=fixture();let reads=0;f.provider.getCode=async()=>++reads===1?'0x':delegation;
 await assert.rejects(prepareUnknownCancellation(f.tracker,f.provider,address,56),error=>error.code==='FTI_ACCOUNT_CODE_CHANGED');
 assert.equal(f.walletCalls.length,0);assert.equal(f.tracker.read(),'unknown:3');
 const g=fixture();let networks=0;g.provider.getNetwork=async()=>({chainId:++networks===1?56n:97n});
 await assert.rejects(prepareUnknownCancellation(g.tracker,g.provider,address,56),/network/);
 assert.equal(g.walletCalls.length,0);assert.equal(g.tracker.read(),'unknown:3');
});
