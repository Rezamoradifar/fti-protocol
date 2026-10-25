import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createWalletConnectAdapter} from '../frontend/walletconnect-adapter.js';
import {validPairingUri,pairingLinks} from '../frontend/walletconnect-modal.js';
import {walletConnectOptions} from '../core/deployment-network.mjs';

const NOW=1800000000000,A='0x'+'1'.repeat(40),B='0x'+'2'.repeat(40);
const URI='wc:'+'a'.repeat(64)+'@2?relay-protocol=irn&symKey='+'b'.repeat(64);
const session=(chain=56,accounts=[A])=>({topic:'approved-test-session',expiry:NOW/1000+600,namespaces:{eip155:{accounts:accounts.map(a=>'eip155:'+chain+':'+a),chains:['eip155:'+chain],methods:['personal_sign','eth_sendTransaction','eth_sign','eth_signTransaction','eth_signTypedData','eth_signTypedData_v3','eth_signTypedData_v4','wallet_sendCalls','wallet_switchEthereumChain','wallet_addEthereumChain','wallet_getCapabilities'],events:['accountsChanged','chainChanged']}}});
function fixture({chain=56,initial,connect,timeoutMs=5000}={}){
 const events=new Map(),signEvents=new Map(),calls=[],screens=[];
 const client={session:initial,
  client:{proposal:{getAll:()=>[{id:1,pairingTopic:'a'.repeat(64)},{id:2,pairingTopic:'c'.repeat(64)}]},core:{pairing:{disconnect:async({topic})=>{calls.push(['cancelPairing',topic]);}},expirer:{set:(...args)=>calls.push(['expireProposal',...args])}},on(name,fn){signEvents.set(name,fn);},emit(name,data){signEvents.get(name)?.(data);}},
  on(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},
  removeListener(name,fn){events.get(name)?.delete(fn);},
  emit(name,data){for(const fn of [...(events.get(name)||[])])fn(data);},
  async connect(options){calls.push(['connect',options]);const result=connect?await connect(client):session(chain);client.session=result;return result;},
  async request(args,scope){calls.push(['request',args,scope]);return 'wallet-result';},
  async disconnect(){calls.push(['disconnect']);client.session=undefined;client.emit('disconnect',{code:4900});},
  setDefaultChain(...args){calls.push(['default',...args]);}
 };
 const options=walletConnectOptions('c'.repeat(32),chain,'https://ftiprotocol.com');
 const provider=createWalletConnectAdapter(client,options,{now:()=>NOW,timeoutMs,showPairing:screen=>{screens.push(screen);screen.closed=false;return()=>{screen.closed=true;};}});
 return {client,provider,calls,screens,options};
}
test('production graph removes AppKit/Coinbase/Zod instead of overriding a major API',()=>{
 const pkg=JSON.parse(fs.readFileSync('package.json')),lock=JSON.parse(fs.readFileSync('package-lock.json'));
 assert.equal(pkg.dependencies['@walletconnect/universal-provider'],'2.26.0');assert.equal(pkg.dependencies.qrcode,'1.5.4');
 assert.equal(pkg.dependencies['@walletconnect/ethereum-provider'],undefined);assert.equal(pkg.overrides.zod,undefined);
 for(const key of Object.keys(lock.packages))assert(!/(?:^|\/)(?:zod|@reown\/appkit[^/]*|@coinbase\/cdp-sdk)$/.test(key),key);
});
for(const chain of [56,97])test(`only explicit chain ${chain} is proposed, with the same-origin read RPC`,async()=>{
 const {provider,calls}=fixture({chain});assert.equal(provider.session,undefined);assert.deepEqual(await provider.request({method:'eth_accounts'}),[]);assert.equal(calls.length,0);
 assert.deepEqual(await provider.enable(),[A]);assert.equal(await provider.request({method:'eth_chainId'}),'0x'+chain.toString(16));
 const proposal=calls.find(c=>c[0]==='connect')[1];
 assert.deepEqual(proposal.namespaces.eip155.chains,['eip155:'+chain]);assert.deepEqual(proposal.optionalNamespaces.eip155.chains,['eip155:'+chain]);
 assert.deepEqual(proposal.namespaces.eip155.rpcMap,{[chain]:'https://ftiprotocol.com/rpc'});
 assert.deepEqual(proposal.namespaces.eip155.methods,['eth_sendTransaction','personal_sign']);assert(!JSON.stringify(proposal).includes('eip155:1"'));
});
test('a valid restored session is read silently and does not open QR or request approval',async()=>{
 const {provider,calls,screens}=fixture({initial:session()});
 assert.equal(provider.session.topic,'approved-test-session');assert.deepEqual(await provider.request({method:'eth_accounts'}),[A]);assert.equal(calls.length,0);assert.equal(screens.length,0);
 assert.deepEqual(await provider.enable(),[A]);assert.equal(calls.filter(c=>c[0]==='connect').length,0);
});
test('foreign-chain and expired stored sessions cannot authorize silent access',async()=>{
 for(const initial of [session(97),{...session(),expiry:NOW/1000-1}]){
  const {provider,calls}=fixture({initial});assert.equal(provider.session,undefined);assert.deepEqual(await provider.request({method:'eth_accounts'}),[]);assert.equal(calls.length,0);
  assert.deepEqual(await provider.enable(),[A]);assert.deepEqual(calls.slice(0,2).map(c=>c[0]),['disconnect','connect']);
 }
});
test('concurrent connect attempts share one pairing and close its QR on approval',async()=>{
 let approve;const {provider,client,calls,screens}=fixture({connect:()=>new Promise(resolve=>{approve=resolve;})});
 const first=provider.enable(),second=provider.enable();assert(provider.connecting);client.emit('display_uri',URI);assert.equal(screens.length,1);assert.equal(screens[0].uri,URI);
 approve(session());assert.deepEqual(await first,[A]);assert.deepEqual(await second,[A]);assert.equal(calls.filter(c=>c[0]==='connect').length,1);assert(screens[0].closed);assert(!provider.connecting);
 client.emit('display_uri',URI);assert.equal(screens.length,1);
});
test('cancel aborts pairing, closes the screen and disconnects an approval arriving later',async()=>{
 let approve;const {provider,client,calls,screens}=fixture({connect:()=>new Promise(resolve=>{approve=resolve;})});
 const result=provider.enable();client.emit('display_uri',URI);screens[0].onCancel();await assert.rejects(result,e=>e.code===4001);assert(screens[0].closed);assert.deepEqual(calls.find(c=>c[0]==='cancelPairing'),['cancelPairing','a'.repeat(64)]);
 approve(session());await new Promise(resolve=>setImmediate(resolve));assert.equal(client.session,undefined);assert.equal(provider.session,undefined);
});
test('wallet rejection releases the operation so the next explicit attempt can retry',async()=>{
 let count=0;const {provider}=fixture({connect:async()=>{if(++count===1)throw Object.assign(Error('Rejected'),{code:4001});return session();}});
 await assert.rejects(provider.enable(),e=>e.code===4001);assert(!provider.connecting);assert.deepEqual(await provider.enable(),[A]);assert.equal(count,2);
});
test('a stalled pairing expires without inventing accounts',async()=>{
 const {provider,calls}=fixture({connect:()=>new Promise(()=>{}),timeoutMs:5});
 const rejected=assert.rejects(provider.enable(),e=>e.code===4001);await new Promise(resolve=>setTimeout(resolve,15));await rejected;assert.equal(provider.session,undefined);assert.deepEqual(provider.accounts,[]);
});
test('a wallet approval missing the required chain or valid account is rejected',async()=>{
 for(const approved of [session(97),session(56,['bad-address']),{...session(),expiry:NOW/1000-1},{...session(),namespaces:{eip155:{accounts:['eip155:56:'+A],methods:[]}}},undefined]){
  const {provider}=fixture({connect:async()=>approved});await assert.rejects(provider.enable(),e=>e.code===4901);assert.equal(provider.session,undefined);
 }
});
test('all wallet requests retain their arguments and route through the approved BNB namespace',async()=>{
 const {provider,calls}=fixture({initial:session()});
 for(const args of [{method:'eth_sendTransaction',params:[{from:A,to:B,data:'0x1234'}]},{method:'personal_sign',params:['0x1234',A]},{method:'eth_signTypedData_v4',params:[A,'{"domain":{"chainId":56}}']},{method:'eth_getTransactionReceipt',params:['0x'+'1'.repeat(64)]}]){
  assert.equal(await provider.request(args),'wallet-result');const row=calls.at(-1);assert.equal(row[1],args);assert.equal(row[2],'eip155:56');
 }
});
test('unconnected signing is blocked and another network cannot be added or selected',async()=>{
 const {provider,calls}=fixture();await assert.rejects(provider.request({method:'personal_sign',params:['0x',A]}),e=>e.code===4900);assert.equal(calls.length,0);
 await provider.enable();for(const method of ['wallet_switchEthereumChain','wallet_addEthereumChain'])await assert.rejects(provider.request({method,params:[{chainId:'0x1'}]}),e=>e.code===4901);
});
test('chain drift emits a hex chain event and blocks signing until the target switch succeeds',async()=>{
 const {provider,client,calls}=fixture({initial:session()}),events=[];provider.on('chainChanged',value=>events.push(value));
 client.emit('chainChanged','97');assert.equal(await provider.request({method:'eth_chainId'}),'0x61');assert.deepEqual(events,['0x61']);assert.deepEqual(await provider.request({method:'eth_accounts'}),[]);
 await assert.rejects(provider.request({method:'eth_sendTransaction',params:[{}]}),e=>e.code===4901);
 assert.equal(await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x38'}]}),'wallet-result');assert.equal(calls.filter(c=>c[0]==='request').at(-1)[2],'eip155:56');assert.deepEqual(await provider.request({method:'eth_accounts'}),[A]);assert.deepEqual(events,['0x61','0x38']);
});
test('account changes are validated and removal/once listeners follow EIP-1193 behavior',async()=>{
 const {provider,client}=fixture({initial:session()}),seen=[],once=[];const fn=value=>seen.push(value);provider.on('accountsChanged',fn);provider.once('accountsChanged',value=>once.push(value));
 // The wallet's approved namespace must contain B before its active-account event.
 client.session=session(56,[A,B]);
 client.emit('accountsChanged',[B,'bad-address','eip155:97:'+A,B]);assert.deepEqual(provider.accounts,[B]);assert.deepEqual(seen,[[B]]);assert.deepEqual(once,[[B]]);
 provider.removeListener('accountsChanged',fn);client.emit('accountsChanged',[A]);assert.deepEqual(provider.accounts,[A]);assert.equal(seen.length,1);assert.equal(once.length,1);
});
test('an account event cannot authorize an address outside the approved BNB session',async()=>{
 const {provider,client,calls}=fixture({initial:session()});client.emit('accountsChanged',[B]);
 assert.deepEqual(await provider.request({method:'eth_accounts'}),[]);assert.equal(provider.session,undefined);await assert.rejects(provider.request({method:'eth_sendTransaction',params:[{from:B,to:A,chainId:'0x61'}]}),e=>e.code===4900);assert.equal(calls.length,0);
});
test('new accounts become usable only after a wallet-approved namespace update',async()=>{
 const {provider,client}=fixture({initial:session()});client.emit('accountsChanged',[B]);assert.deepEqual(provider.accounts,[]);
 client.session=session(56,[B]);client.emit('session_update',{topic:client.session.topic,params:{namespaces:client.session.namespaces}});client.emit('accountsChanged',[B]);assert.deepEqual(provider.accounts,[B]);
 assert.equal(await provider.request({method:'eth_sendTransaction',params:[{from:B,to:A,chainId:'0x38'}]}),'wallet-result');
});
test('send/sign transactions and wallet batches reject wrong callers or payload networks before forwarding',async()=>{
 const {provider,calls}=fixture({initial:session()});
 for(const method of ['eth_sendTransaction','eth_signTransaction','wallet_sendCalls'])for(const payload of [{from:B,chainId:'0x38'},{from:A,chainId:'0x61'},{from:A,chainId:null},{chainId:'0x38'}])await assert.rejects(provider.request({method,params:[payload]}),e=>[4100,4901].includes(e.code));
 assert.equal(calls.length,0);assert.equal(await provider.request({method:'wallet_sendCalls',params:[{from:A,chainId:'0x38',calls:[{to:B,data:'0x'}]}]}),'wallet-result');
});
test('personal_sign supports both documented wallet parameter orders but never an inactive caller',async()=>{
 const {provider,calls}=fixture({initial:session()});
 for(const params of [['0x1234',A],[A,'0x1234']])assert.equal(await provider.request({method:'personal_sign',params}),'wallet-result');
 const count=calls.length;for(const params of [['0x1234',B],[B,'0x1234'],[A,B]])await assert.rejects(provider.request({method:'personal_sign',params}),e=>e.code===4100);assert.equal(calls.length,count);
 await assert.rejects(provider.request({method:'eth_sign',params:[B,'0x1234']}),e=>e.code===4100);assert.equal(calls.length,count);
});
test('typed-data signatures require an active caller and any supplied domain chain must match',async()=>{
 const {provider,calls}=fixture({initial:session()});
 for(const method of ['eth_signTypedData','eth_signTypedData_v3','eth_signTypedData_v4']){
  for(const params of [[B,JSON.stringify({domain:{chainId:56}})],[A,JSON.stringify({domain:{chainId:97}})],[A,{domain:{chainId:'0x61'}}],[A,'not JSON'],[A,{domain:null}]])await assert.rejects(provider.request({method,params}),e=>[4100,4901,-32602].includes(e.code));
 }
 assert.equal(calls.length,0);assert.equal(await provider.request({method:'eth_signTypedData_v4',params:[A,JSON.stringify({domain:{chainId:'0x38'}})]}),'wallet-result');
});
test('session approval of an account does not approve signing methods or raw-transaction bypasses',async()=>{
 const initial=session();initial.namespaces.eip155.methods=['eth_sendTransaction','personal_sign'];const {provider,calls}=fixture({initial});
 for(const method of ['eth_signTypedData_v4','eth_signTransaction','wallet_sendCalls','wallet_switchEthereumChain'])await assert.rejects(provider.request({method,params:[{from:A,chainId:'0x38'}]}),e=>e.code===4100);
 await assert.rejects(provider.request({method:'eth_sendRawTransaction',params:['0x1234']}),e=>e.code===4200);assert.equal(calls.length,0);
});
test('cancelled underlying approval is serialized so it cannot overwrite a newer approved session',async()=>{
 let approveA,count=0;const {provider,client,calls,screens}=fixture({connect:()=>++count===1?new Promise(resolve=>{approveA=resolve;}):Promise.resolve({...session(),topic:'new-approved-session'})});
 const first=provider.enable();client.emit('display_uri',URI);screens[0].onCancel();await assert.rejects(first,e=>e.code===4001);
 await assert.rejects(provider.enable(),e=>e.code===4001&&/closing/.test(e.message));assert.equal(count,1);assert(provider.connecting);
 assert.deepEqual(calls.filter(c=>c[0]==='expireProposal'),[['expireProposal',1,0]]);
 approveA({...session(),topic:'cancelled-old-session'});await new Promise(resolve=>setImmediate(resolve));assert(!provider.connecting);assert.equal(client.session,undefined);
 assert.deepEqual(await provider.enable(),[A]);assert.equal(provider.session.topic,'new-approved-session');assert.equal(count,2);
});
test('Core proposal expiry releases a cancelled operation before the next explicit connection',async()=>{
 let rejectA,count=0;const {provider,client,screens}=fixture({connect:()=>++count===1?new Promise((_,reject)=>{rejectA=reject;}):Promise.resolve(session())});
 client.client.core.expirer.set=(id,expiry)=>{assert.equal(id,1);assert.equal(expiry,0);rejectA(Error('Proposal expired'));};
 const first=provider.enable();client.emit('display_uri',URI);screens[0].onCancel();await assert.rejects(first,e=>e.code===4001);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(await provider.enable(),[A]);assert.equal(count,2);
});
test('disconnect clears all authorized accounts and emits one disconnect event',async()=>{
 const {provider}=fixture({initial:session()}),events=[];provider.on('disconnect',event=>events.push(event));await provider.disconnect();assert.equal(provider.session,undefined);assert.deepEqual(provider.accounts,[]);assert.deepEqual(await provider.request({method:'eth_accounts'}),[]);assert.equal(events.length,1);
});
test('account revocation prevents signing even when the transport suppresses its empty array',async()=>{
 for(const lowLevel of [false,true]){
  const {provider,client,calls}=fixture({initial:session()}),seen=[];provider.on('accountsChanged',value=>seen.push(value));
  if(lowLevel)client.client.emit('session_event',{topic:session().topic,params:{event:{name:'accountsChanged',data:[]}}});else client.emit('accountsChanged',[]);
  assert.deepEqual(seen,[[]]);assert.deepEqual(provider.accounts,[]);assert.equal(provider.session,undefined);assert.equal(provider.connected,false);await assert.rejects(provider.request({method:'personal_sign',params:['0x',A]}),e=>e.code===4900);assert.equal(calls.length,0);
 }
});
test('pairing URI validation rejects non-WalletConnect links, missing keys and duplicates',()=>{
 assert.equal(validPairingUri(URI),URI);
 for(const value of ['javascript:alert(1)','https://example.com/?uri='+URI,URI.replace('@2?','@1?'),URI.replace('relay-protocol=irn','relay-protocol=evil'),URI.replace('symKey=','missing='),URI+'&symKey='+'c'.repeat(64),URI+'&relay-protocol=irn',URI+'x'.repeat(4096)])assert.throws(()=>validPairingUri(value));
});
test('mobile wallet links use fixed official hosts and encode the complete pairing URI',()=>{
 const links=pairingLinks(URI);assert.deepEqual(links.map(x=>new URL(x.href).origin),['https://link.trustwallet.com','https://metamask.app.link']);for(const link of links)assert.equal(new URL(link.href).searchParams.get('uri'),URI);
});

test('FTI asset import is optional in the connection proposal and still needs wallet approval',async()=>{
 const {provider,calls}=fixture();await provider.enable();const proposal=calls.find(c=>c[0]==='connect')[1];
 assert(proposal.optionalNamespaces.eip155.methods.includes('wallet_watchAsset'));assert(!proposal.namespaces.eip155.methods.includes('wallet_watchAsset'));
 const count=calls.length;await assert.rejects(provider.request({method:'wallet_watchAsset',params:{type:'ERC20',options:{address:B,symbol:'FTI',decimals:18}}}),e=>e.code===4100);assert.equal(calls.length,count);
});

test('approved FTI asset import forwards metadata only on the active BNB chain',async()=>{
 const initial=session();initial.namespaces.eip155.methods.push('wallet_watchAsset');const {provider,client,calls}=fixture({initial});
 const request={method:'wallet_watchAsset',params:{type:'ERC20',options:{address:B,symbol:'FTI',decimals:18}}};
 assert.equal(await provider.request(request),'wallet-result');assert.deepEqual(calls.at(-1),['request',request,'eip155:56']);
 const count=calls.length;client.emit('chainChanged',97);await assert.rejects(provider.request(request),e=>e.code===4901);assert.equal(calls.length,count);
 client.emit('chainChanged',56);client.emit('accountsChanged',[]);await assert.rejects(provider.request(request),e=>e.code===4900);assert.equal(calls.length,count);
});

test('asset import rejects other standards, malformed metadata and price or image injection',async()=>{
 const initial=session();initial.namespaces.eip155.methods.push('wallet_watchAsset');const {provider,calls}=fixture({initial});
 const valid={address:B,symbol:'FTI',decimals:18};
 for(const params of [null,[],{type:'ERC721',options:valid},{type:'ERC20',options:null},{type:'ERC20',options:[]},
  ...[{address:'bad'},{address:'0x'+'0'.repeat(40)},{symbol:'OTHER'},{decimals:6},{decimals:'18'},{price:'100'},{image:'javascript:alert(1)'}].map(patch=>({type:'ERC20',options:{...valid,...patch}})),
  {type:'ERC20',options:valid,chainId:97}])await assert.rejects(provider.request({method:'wallet_watchAsset',params}),e=>e.code===-32602);
 assert.equal(calls.length,0);
});
