import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {mainnetRpcUrl,operationalRpcUrl} from '../scripts/mainnet-rpc.mjs';
import {selectedMainnetCollateral,assertSelectedMainnetCollateral} from '../scripts/mainnet-collateral.mjs';

test('selected collateral is the user-chosen BNB USDT with a fixed observed code identity',()=>{
 const c=selectedMainnetCollateral();assert.equal(c.chainId,56);assert.equal(c.decimals,18);assert.equal(c.symbol,'USDT');
 assert.equal(c.address,'0x55d398326f99059fF775485246999027B3197955');
 assertSelectedMainnetCollateral({usd:c.address,usdCodeHash:c.usdCodeHash});
 assert.throws(()=>assertSelectedMainnetCollateral({usd:'0x'+'1'.repeat(40),usdCodeHash:c.usdCodeHash}),/selected BNB USDT/);
 assert.throws(()=>assertSelectedMainnetCollateral({usd:c.address,usdCodeHash:'0x'+'0'.repeat(64)}),/selected BNB USDT/);
});
test('mainnet reads a private RPC file; never falls back from an empty file or accepts public/symlink files',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-mainnet-rpc-'));
 try{
  const file=path.join(dir,'rpc'),link=path.join(dir,'link');
  const endpoint='https://go.getblock.io/TEST-NOT-A-REAL-KEY/';
  fs.writeFileSync(file,endpoint+'\n',{mode:0o600});
  assert.equal(mainnetRpcUrl({FTI_MAINNET_RPC_FILE:file}),endpoint);
  fs.chmodSync(file,0o644);assert.throws(()=>mainnetRpcUrl({FTI_MAINNET_RPC_FILE:file}),/private/);
  fs.chmodSync(file,0o600);fs.symlinkSync(file,link);assert.throws(()=>mainnetRpcUrl({FTI_MAINNET_RPC_FILE:link}));
  assert.throws(()=>mainnetRpcUrl({FTI_MAINNET_RPC_FILE:file,FTI_MAINNET_RPC_URL:endpoint}),/one explicit/);
  fs.writeFileSync(file,'');assert.throws(()=>mainnetRpcUrl({FTI_MAINNET_RPC_FILE:file,RPC_URL:endpoint}),/Empty/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('RPC selection preserves testnet config and refuses implicit or insecure mainnet transport',()=>{
 assert.equal(operationalRpcUrl({chainId:97,rpcUrl:'http://127.0.0.1:3110/rpc'},{FTI_MAINNET_RPC_FILE:'/must/not/read'}),'http://127.0.0.1:3110/rpc');
 assert.equal(operationalRpcUrl({chainId:56},{RPC_URL:'http://127.0.0.1:4173/rpc'}),'http://127.0.0.1:4173/rpc');
 for(const rpc of ['http://example.com/key','https://user:password@example.com','file:///tmp/key','https://example.com/#fragment'])assert.throws(()=>mainnetRpcUrl({FTI_MAINNET_RPC_URL:rpc}));
 assert.throws(()=>operationalRpcUrl({chainId:56,rpcUrl:'https://must-not-reuse.invalid'},{}),/Explicit/);
});
