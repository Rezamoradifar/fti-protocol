import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {JsonRpcProvider,Wallet,MaxUint256,parseEther as E} from 'ethers';
import {deployOne} from '../scripts/lib.mjs';
import {startWeb} from '../scripts/server.mjs';

test('new V3 deployment is readable by the panel API without legacy locks or timelock',async()=>{
 const chain=ganache.server({logging:{quiet:true},wallet:{totalAccounts:40},chain:{chainId:31337},miner:{blockGasLimit:30000000}});
 await chain.listen(0);const rpc='http://127.0.0.1:'+chain.address().port;
 const provider=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const signers=await Promise.all(Array.from({length:40},(_,i)=>provider.getSigner(i)));const addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-v3-api-'));let server;
 const saved={PORT:process.env.PORT,HOST:process.env.HOST,RPC_URL:process.env.RPC_URL};
 try{
  const usd=await deployOne('MockUSD',[],signers[0]);
  const council=await deployOne('SevenGuardianCouncil',[addresses.slice(31,38)],signers[0]);
  const token=await deployOne('FTIReserveTokenV3',[usd.target,addresses[39],council.target],signers[0]);
  const binary=await deployOne('FundedBinaryPlan',[usd.target,token.target,addresses[39],council.target,addresses[38],addresses.slice(0,31)],signers[0]);
  await(await token.bind(binary.target)).wait();await(await usd.faucet()).wait();
  await(await usd.approve(binary.target,MaxUint256)).wait();await(await binary.addUnits(1)).wait();
  const cfg={mode:'local',chainId:31337,rpcUrl:rpc,usd:usd.target,council:council.target,token:token.target,binary:binary.target,tokenContract:'FTIReserveTokenV3',binaryContract:'FundedBinaryPlan',councilContract:'SevenGuardianCouncil',batchedRewards:true};
  const file=path.join(dir,'config.json');fs.writeFileSync(file,JSON.stringify(cfg));
  process.env.PORT='0';process.env.HOST='127.0.0.1';delete process.env.RPC_URL;
  server=await startWeb(file);const origin='http://127.0.0.1:'+server.address().port;
  const stateResponse=await fetch(origin+'/api/state?wallet='+addresses[0]);assert.equal(stateResponse.status,200);const state=await stateResponse.json();
  assert.equal(state.pricingModel,'zero-start-reserve-v3');assert.equal(state.rewardQueue,'1');
  assert.equal(state.bb,E('5').toString());assert.equal(state.wallet.unlocked,'0');assert.deepEqual(state.wallet.locks,[]);
  const abi=await(await fetch(origin+'/abi/FTIReserveTokenV3')).json();
  assert.equal(abi.find(x=>x.type==='constructor').inputs.length,3);
  assert.equal(abi.some(x=>x.name==='CharityMinted'||x.name==='animalWalletA'||x.name==='CHARITY_BPS'),false);
  const locks=await(await fetch(origin+'/api/locks?wallet='+addresses[0])).json();assert.deepEqual(locks.locks,[]);
  const cfgPublic=await(await fetch(origin+'/api/config')).json();assert.equal('rpcUrl' in cfgPublic,false);
 }finally{
  if(server)await new Promise(r=>server.close(r));provider.destroy();await chain.close();fs.rmSync(dir,{recursive:true,force:true});
  for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
