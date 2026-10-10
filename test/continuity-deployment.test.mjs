import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import ganache from 'ganache';
import {JsonRpcProvider,Wallet} from 'ethers';
import {verifyV3Deployment} from '../scripts/continuity-release.mjs';
import {startWeb} from '../scripts/server.mjs';

test('fresh continuity deployment verifies creation inputs, proxies and served API/ABIs',{timeout:240000},async()=>{
 const engine=ganache.server({chain:{chainId:31337},logging:{quiet:true},wallet:{totalAccounts:10},miner:{blockGasLimit:30000000}});
 await engine.listen(0,'127.0.0.1');const rpc='http://127.0.0.1:'+engine.address().port;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-deploy-')),keys=Object.values(engine.provider.getInitialAccounts()).map(a=>a.secretKey);
 const dao=path.join(dir,'dao.json'),output=path.join(dir,'deployment.json');fs.writeFileSync(dao,JSON.stringify({threshold:5,partners:keys.slice(1,8).map(k=>new Wallet(k).address)}));
 const oldRpc=process.env.RPC_URL,oldPort=process.env.PORT;let web;
 const p=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1});
 try{
  let log='';const exit=await new Promise((resolve,reject)=>{const c=spawn(process.execPath,['scripts/deploy-continuity-testnet.mjs'],{env:{...process.env,RPC_URL:rpc,DEPLOYER_PRIVATE_KEY:keys[0],DAO_CONFIG:dao,V3_TESTNET_SECRETS:path.join(dir,'genesis.json'),V3_DEPLOYMENT_FILE:output}});c.stdout.on('data',d=>log+=d);c.stderr.on('data',d=>log+=d);c.on('error',reject);c.on('exit',resolve);});
  assert.equal(exit,0,log);const cfg=JSON.parse(fs.readFileSync(output));
  assert.equal(cfg.initialState.totalSupply,'0');assert.equal(cfg.initialState.reserve,'0');
  const contracts=await verifyV3Deployment(cfg,p);assert.equal(await contracts.binary.memberCount(),31n);assert.equal(await contracts.binary.epoch(),1n);
  const bad=structuredClone(cfg);bad.tokenImplementation=cfg.binaryImplementation;await assert.rejects(()=>verifyV3Deployment(bad,p),/Implementation mismatch/);
  process.env.RPC_URL=rpc;process.env.PORT='0';web=await startWeb(output);const base='http://127.0.0.1:'+web.address().port;
  for(const route of ['/health','/api/config','/api/state','/abi/FundedBinaryPlanUpgradeable','/abi/FTIReserveTokenUpgradeable','/app/','/token/','/admin/'])assert.equal((await fetch(base+route)).status,200,route);
  const state=await(await fetch(base+'/api/state?wallet='+cfg.deployer)).json();assert.equal(state.wallet.exists,true);assert.equal(state.wallet.units,'0');assert.equal(state.supply,'0');assert.equal(state.pointValue,'0');assert.equal(state.calculatedPointValue,'0');assert.equal(state.binaryRecoveryFrozen,false);
  const storage=await(await fetch(base+'/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getStorageAt',params:[cfg.token,'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc','latest']})})).json();assert.equal(storage.result.slice(-40).toLowerCase(),cfg.tokenImplementation.slice(2).toLowerCase());
  const abi=await(await fetch(base+'/abi/FTIReserveTokenUpgradeable')).json();assert(abi.some(f=>f.name==='BUY_STEP'));
 }finally{
  if(web)await new Promise(r=>web.close(r));p.destroy();await engine.close();fs.rmSync(dir,{recursive:true,force:true});
  if(oldRpc===undefined)delete process.env.RPC_URL;else process.env.RPC_URL=oldRpc;
  if(oldPort===undefined)delete process.env.PORT;else process.env.PORT=oldPort;
 }
});
