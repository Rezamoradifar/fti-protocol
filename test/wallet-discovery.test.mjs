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
test('uses announced wallets before window.ethereum to avoid extension collisions',()=>{
 const target=new EventTarget(),legacy=provider(),selected=provider();target.ethereum=legacy;
 const registry=discoverWallets(target);announce(target,selected);
 assert.equal(registry.list()[0].provider,selected);assert.equal(registry.list().length,1);
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
