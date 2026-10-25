import test from 'node:test';
import assert from 'node:assert/strict';
import {MAINNET_RELEASE} from '../core/deployment-network.mjs';
import {walletTokenMetadata,addFTIToWallet} from '../frontend/wallet-token.js';

const A='0x'+'1'.repeat(40),B='0x'+'2'.repeat(40),TOKEN='0x43755B1E813b2d41F669ea08bcf859De07195eA1';
const config={chainId:56,mode:'bnb-mainnet',release:MAINNET_RELEASE,tokenContract:'FTIReserveTokenUpgradeable',binaryContract:'FundedBinaryPlanUpgradeable',token:TOKEN};
function fixture(options={}){
 const {chain='0x38',accounts=[A],read,onWatch}=options,result=Object.hasOwn(options,'result')?options.result:true;
 const calls=[];
 const wallet={async request(args){calls.push(args);if(read&&args.method!=='wallet_watchAsset')return read(args);if(args.method==='eth_chainId')return chain;if(args.method==='eth_accounts')return accounts;if(args.method==='wallet_watchAsset'){onWatch?.();return result;}throw Error('Unexpected wallet operation: '+args.method);}};
 return {wallet,calls};
}

test('FTI import metadata is scoped to the verified deployment and does not claim a wallet fiat price',()=>{
 assert.deepEqual(walletTokenMetadata(config),{address:TOKEN,symbol:'FTI',decimals:18,chainId:56,network:'BNB Smart Chain'});
 assert(Object.isFrozen(walletTokenMetadata(config)));
 const testnet={...config,chainId:97,mode:'bnb-testnet'};assert.equal(walletTokenMetadata(testnet).chainId,97);
 for(const cfg of [undefined,{}, {...config,mode:'local'},{...config,release:'other'}, {...config,token:'not an address'}, {...config,token:'0x'+'0'.repeat(40)}, {...testnet,tokenContract:'UnknownToken'}])assert.throws(()=>walletTokenMetadata(cfg));
});

test('explicit FTI import checks current account and chain before one metadata-only wallet prompt',async()=>{
 const {wallet,calls}=fixture();
 assert.equal(await addFTIToWallet(wallet,config,A),true);
 assert.deepEqual(calls,[{method:'eth_chainId'},{method:'eth_accounts'},{method:'wallet_watchAsset',params:{type:'ERC20',options:{address:TOKEN,symbol:'FTI',decimals:18}}}]);
});

test('a declined import is false and an unsupported wallet never becomes a false success',async()=>{
 assert.equal(await addFTIToWallet(fixture({result:false}).wallet,config,A),false);
 for(const result of [undefined,null,'true',{},1])await assert.rejects(addFTIToWallet(fixture({result}).wallet,config,A),/did not confirm/);
 for(const wallet of [null,{}, {request:null}])await assert.rejects(addFTIToWallet(wallet,config,A),e=>e.code===4200);
 const {wallet,calls}=fixture();wallet.request=async args=>{calls.push(args);if(args.method==='eth_chainId')return '0x38';if(args.method==='eth_accounts')return[A];throw Object.assign(Error('Method unavailable'),{code:4200});};
 await assert.rejects(addFTIToWallet(wallet,config,A),e=>e.code===4200);assert.equal(calls.at(-1).method,'wallet_watchAsset');
});

test('wrong wallet, wrong network and invalid deployments fail before any import prompt',async()=>{
 for(const values of [{chain:'0x61'},{accounts:[B]},{accounts:[]},{accounts:null}]){
  const {wallet,calls}=fixture(values);await assert.rejects(addFTIToWallet(wallet,config,A),/network or account changed/);assert(!calls.some(c=>c.method==='wallet_watchAsset'));
 }
 const {wallet,calls}=fixture();await assert.rejects(addFTIToWallet(wallet,{...config,token:'bad'},A));assert.equal(calls.length,0);
 await assert.rejects(addFTIToWallet(wallet,config,'bad'));assert.equal(calls.length,0);
});

test('account-generation invalidation before or during identity reads prevents the prompt',async()=>{
 const before=fixture();await assert.rejects(addFTIToWallet(before.wallet,config,A,{isCurrent:()=>false}),e=>e.code==='FTI_WALLET_CHANGED');assert.equal(before.calls.length,0);
 let current=true;const during=fixture({read:async({method})=>{current=false;return method==='eth_chainId'?'0x38':[A];}});
 await assert.rejects(addFTIToWallet(during.wallet,config,A,{isCurrent:()=>current}),e=>e.code==='FTI_WALLET_CHANGED');assert(!during.calls.some(c=>c.method==='wallet_watchAsset'));
});

test('an import response arriving after the wallet changes is discarded',async()=>{
 let current=true;const {wallet}=fixture({onWatch:()=>{current=false;}});
 await assert.rejects(addFTIToWallet(wallet,config,A,{isCurrent:()=>current}),e=>e.code==='FTI_WALLET_CHANGED');
});

test('a silent identity read times out before an asset request and invalid options never prompt',async()=>{
 const {wallet,calls}=fixture({read:()=>new Promise(()=>{})});
 await assert.rejects(addFTIToWallet(wallet,config,A,{timeoutMs:5}),/No new request was sent/);assert(!calls.some(c=>c.method==='wallet_watchAsset'));
 for(const options of [{timeoutMs:0},{timeoutMs:30001},{timeoutMs:1.5},{isCurrent:true}]){
  const f=fixture();await assert.rejects(addFTIToWallet(f.wallet,config,A,options),/Invalid/);assert.equal(f.calls.length,0);
 }
});

test('an unanswered import times out but concurrent and later retries share its one real prompt',async()=>{
 let finish;const {wallet,calls}=fixture();wallet.request=async args=>{calls.push(args);if(args.method==='eth_chainId')return '0x38';if(args.method==='eth_accounts')return[A];return new Promise(resolve=>{finish=resolve;});};
 const first=addFTIToWallet(wallet,config,A,{timeoutMs:10}),second=addFTIToWallet(wallet,config,A,{timeoutMs:10});
 const outcomes=await Promise.allSettled([first,second]);assert(outcomes.every(r=>r.status==='rejected'&&r.reason.code==='FTI_TOKEN_IMPORT_PENDING'));
 assert.equal(calls.filter(c=>c.method==='wallet_watchAsset').length,1);
 const retry=addFTIToWallet(wallet,config,A,{timeoutMs:100});await new Promise(setImmediate);finish(true);assert.equal(await retry,true);
 assert.equal(calls.filter(c=>c.method==='wallet_watchAsset').length,1);
});

test('only the underlying import completion releases its provider for a new explicit request',async()=>{
 let finish;let prompts=0;const {wallet}=fixture();wallet.request=async args=>{if(args.method==='eth_chainId')return '0x38';if(args.method==='eth_accounts')return[A];prompts++;return prompts===1?new Promise(resolve=>{finish=resolve;}):false;};
 await assert.rejects(addFTIToWallet(wallet,config,A,{timeoutMs:5}),e=>e.code==='FTI_TOKEN_IMPORT_PENDING');
 await assert.rejects(addFTIToWallet(wallet,config,A,{timeoutMs:5}),e=>e.code==='FTI_TOKEN_IMPORT_PENDING');assert.equal(prompts,1);
 finish(true);await new Promise(setImmediate);
 assert.equal(await addFTIToWallet(wallet,config,A),false);assert.equal(prompts,2);
});

test('a pending dialog cannot be reused for a different account or configured asset',async()=>{
 let finish,account=A;let prompts=0;const {wallet}=fixture();wallet.request=async args=>{if(args.method==='eth_chainId')return '0x38';if(args.method==='eth_accounts')return[account];prompts++;return new Promise(resolve=>{finish=resolve;});};
 await assert.rejects(addFTIToWallet(wallet,config,A,{timeoutMs:5}),e=>e.code==='FTI_TOKEN_IMPORT_PENDING');
 account=B;await assert.rejects(addFTIToWallet(wallet,config,B),e=>e.code==='FTI_TOKEN_IMPORT_PENDING');
 account=A;await assert.rejects(addFTIToWallet(wallet,{...config,token:B},A),e=>e.code==='FTI_TOKEN_IMPORT_PENDING');assert.equal(prompts,1);
 finish(false);await new Promise(setImmediate);
});

test('a late provider rejection is handled and a subsequent explicit import can recover',async()=>{
 let rejectFirst,prompts=0;const {wallet}=fixture();wallet.request=async args=>{if(args.method==='eth_chainId')return '0x38';if(args.method==='eth_accounts')return[A];prompts++;if(prompts===1)return new Promise((_,reject)=>{rejectFirst=reject;});return true;};
 await assert.rejects(addFTIToWallet(wallet,config,A,{timeoutMs:5}),e=>e.code==='FTI_TOKEN_IMPORT_PENDING');
 rejectFirst(Object.assign(Error('User declined'),{code:4001}));await new Promise(setImmediate);
 assert.equal(await addFTIToWallet(wallet,config,A),true);assert.equal(prompts,2);
});

test('method-not-found maps to unsupported and synchronous provider failures do not lock retries',async()=>{
 let prompts=0;const {wallet}=fixture();wallet.request=args=>{if(args.method==='eth_chainId')return Promise.resolve('0x38');if(args.method==='eth_accounts')return Promise.resolve([A]);if(++prompts===1)throw Object.assign(Error('Method not found'),{code:-32601});return Promise.resolve(true);};
 await assert.rejects(addFTIToWallet(wallet,config,A),e=>e.code===4200);assert.equal(await addFTIToWallet(wallet,config,A),true);assert.equal(prompts,2);
});
