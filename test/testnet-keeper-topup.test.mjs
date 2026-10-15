import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {BrowserProvider,Wallet,parseEther as E} from 'ethers';
import {topUpKeeper} from '../tools/top-up-testnet-keeper.mjs';

test('bounded testnet Keeper funding resumes the identical signed transfer and never funds twice',{timeout:60000},async()=>{
 const engine=ganache.provider({chain:{chainId:97,hardfork:'berlin'},miner:{defaultGasPrice:100000000},logging:{quiet:true}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 const owner=new Wallet(Object.values(engine.getInitialAccounts())[0].secretKey,p),keeper=Wallet.createRandom().address;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-keeper-fund-')),logs=[];
 const args={p,owner,keeper,dir,log:(...x)=>logs.push(x)};
 try{
  const original=p.broadcastTransaction.bind(p);p.broadcastTransaction=async()=>{throw Error('test network lost before broadcast');};
  await assert.rejects(()=>topUpKeeper(args),/network lost/);
  const j=JSON.parse(fs.readFileSync(path.join(dir,'keeper-gas-topup.json')));
  assert.equal(await p.getBalance(keeper),0n);p.broadcastTransaction=original;
  const result=await topUpKeeper(args);assert.equal(result.transaction,j.hash);assert.equal(await p.getBalance(keeper),E('0.005'));
  const nonce=await p.getTransactionCount(owner.address);await topUpKeeper(args);assert.equal(await p.getTransactionCount(owner.address),nonce);
  assert(!JSON.stringify(logs).includes(j.raw));assert.equal(fs.statSync(path.join(dir,'keeper-gas-topup.json')).mode&0o777,0o600);
  const wrong=Object.create(p);wrong.getNetwork=async()=>({chainId:56n});
  await assert.rejects(()=>topUpKeeper({...args,p:wrong}),/Only testnet/);
  await assert.rejects(()=>topUpKeeper({...args,keeper:owner.address}),/must differ/);
 }finally{p.destroy();await engine.disconnect();fs.rmSync(dir,{recursive:true,force:true});}
});
