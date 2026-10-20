import test from 'node:test';
import assert from 'node:assert/strict';
import {readWalletIdentity,preparationDeadline} from '../frontend/wallet-preflight.js';
const address='0x'+'1'.repeat(40);
test('wallet identity preparation reads only chain and accounts without a wallet send',async()=>{
 const methods=[];const wallet={request:async({method})=>{methods.push(method);return method==='eth_chainId'?'0x38':[address];}};
 assert.deepEqual(await readWalletIdentity(wallet,address,56),{address,chainId:56});assert.deepEqual(methods,['eth_chainId','eth_accounts']);
});
test('a silent mobile provider times out before tracking or sending a transaction',async()=>{
 await assert.rejects(readWalletIdentity({request:()=>new Promise(()=>{})},address,56,{timeoutMs:5}),/No new request was sent/);
 await assert.rejects(preparationDeadline(new Promise(()=>{}),5),/preparation/);
});
test('wrong account, network and malformed account responses fail before prepared review',async()=>{
 for(const values of [{chain:'0x61',accounts:[address]},{chain:'0x38',accounts:[]},{chain:'0x38',accounts:['0x'+'2'.repeat(40)]},{chain:'0x38',accounts:null}])await assert.rejects(readWalletIdentity({request:async({method})=>method==='eth_chainId'?values.chain:values.accounts},address,56),/changed/);
});
