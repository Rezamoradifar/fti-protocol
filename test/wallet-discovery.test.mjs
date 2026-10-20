import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverWallets,requestWalletAccounts} from '../frontend/wallet-selector.js';

const provider=()=>({request:async()=>[]});
function announce(target,p,name='Wallet',rdns='com.example.wallet'){
 const event=new Event('eip6963:announceProvider');event.detail={provider:p,info:{name,rdns}};target.dispatchEvent(event);
}
test('discovers concurrent extensions without requesting accounts and keeps late announcements',()=>{
 const target=new EventTarget(),first=provider(),second=provider();let accountRequests=0;
 first.request=async()=>{accountRequests++;return [];};
 target.addEventListener('eip6963:requestProvider',()=>announce(target,first,'First','com.first'));
 const registry=discoverWallets(target);
 announce(target,second,'Second','com.second');announce(target,first,'First','com.first');
 assert.deepEqual(registry.list().map(w=>w.provider),[first,second]);assert.equal(accountRequests,0);
});
test('rejects malformed announcements and preserves legacy provider fallback',()=>{
 const target=new EventTarget(),legacy=provider();target.ethereum=legacy;
 const registry=discoverWallets(target);announce(target,{});announce(target,provider(),null);
 assert.equal(registry.list().length,1);assert.equal(registry.list()[0].provider,legacy);
});
test('keeps both announced and legacy wallets available without duplicates',()=>{
 const target=new EventTarget(),legacy=provider(),selected=provider();target.ethereum=legacy;
 const registry=discoverWallets(target);announce(target,selected);
 assert.equal(registry.list()[0].provider,selected);assert.equal(registry.list().length,2);
 announce(target,legacy,'Legacy','com.legacy');assert.equal(registry.list().length,2);
});
test('WalletConnect starts pairing through enable and silent reconnect never opens pairing',async()=>{
 let pairing=0,method;
 const selected={remote:true,provider:{enable:async()=>{pairing++;return ['connected'];},request:async args=>{method=args.method;return ['restored'];}}};
 assert.deepEqual(await requestWalletAccounts(selected),['connected']);assert.equal(pairing,1);
 assert.deepEqual(await requestWalletAccounts(selected,true),['restored']);assert.equal(method,'eth_accounts');assert.equal(pairing,1);
});
test('requests permission only from the selected injected wallet',async()=>{
 let method;
 const selected={provider:{request:async args=>{method=args.method;return ['chosen'];},enable:()=>assert.fail('injected wallet must use request')}};
 assert.deepEqual(await requestWalletAccounts(selected),['chosen']);assert.equal(method,'eth_requestAccounts');
});
test('non-array provider metadata does not prevent opening the wallet list',()=>{
 const target=new EventTarget(),p=provider();p.providers={};target.ethereum=p;
 assert.equal(discoverWallets(target).list()[0].provider,p);
});
test('stalled silent reconnect times out and never requests permission',async()=>{
 let method;const selected={provider:{request:args=>{method=args.method;return new Promise(()=>{});}}};
 await assert.rejects(requestWalletAccounts(selected,true,5),/timed out/);assert.equal(method,'eth_accounts');
});
test('SafePal exclusive provider works without ethereum and permission targets SafePal',async()=>{
 const target=new EventTarget(),calls=[];target.safepalProvider={request:async args=>{calls.push(args.method);return ['account'];}};
 const selected=discoverWallets(target).list()[0];assert.equal(selected.name,'SafePal');assert.equal(selected.id,'safepal');assert.deepEqual(calls,[]);
 assert.deepEqual(await requestWalletAccounts(selected),['account']);assert.deepEqual(calls,['eth_requestAccounts']);
});
test('SafePal aliases are deduplicated and MetaMask compatibility flag does not mislabel it',()=>{
 const target=new EventTarget(),p={...provider(),isMetaMask:true,isSafePal:true};target.ethereum=p;target.safepalProvider=p;
 const wallets=discoverWallets(target).list();assert.equal(wallets.length,1);assert.equal(wallets[0].name,'SafePal');
});
test('late injected SafePal is found without losing a different installed wallet',()=>{
 const target=new EventTarget();target.ethereum={...provider(),isMetaMask:true};const registry=discoverWallets(target);assert.equal(registry.list().length,1);
 target.safepalProvider=provider();assert.deepEqual(registry.list().map(w=>w.name),['SafePal','MetaMask']);
});
