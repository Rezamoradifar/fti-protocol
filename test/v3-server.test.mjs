import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {JsonRpcProvider,Wallet,MaxUint256,parseEther as E,keccak256} from 'ethers';
import {deployOne} from '../scripts/lib.mjs';
import {startWeb} from '../scripts/server.mjs';
import {RELEASE,releaseManifest} from '../scripts/v3-release.mjs';

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
  const timelock=await deployOne('FTITimelock',[council.target],signers[0]);
  const token=await deployOne('FTIReserveTokenV3',[usd.target,timelock.target,council.target],signers[0]);
  const binary=await deployOne('FundedBinaryPlan',[usd.target,token.target,timelock.target,council.target,addresses[38],addresses.slice(0,31)],signers[0]);
  await(await token.bind(binary.target)).wait();await(await usd.faucet()).wait();
  await(await usd.approve(binary.target,MaxUint256)).wait();await(await binary.addUnits(1)).wait();
  const cfg={mode:'local',chainId:31337,rpcUrl:rpc,usd:usd.target,council:council.target,token:token.target,binary:binary.target,tokenContract:'FTIReserveTokenV3',binaryContract:'FundedBinaryPlan',councilContract:'SevenGuardianCouncil',batchedRewards:true};
  const file=path.join(dir,'config.json');
  fs.writeFileSync(file,JSON.stringify({...cfg,release:'FTI_V3_INTEGRATED_20261008'}));
  await assert.rejects(()=>startWeb(file),/V3 release mismatch/);
  const keeperCheck=spawnSync(process.execPath,['scripts/keeper.mjs'],{env:{...process.env,DEPLOYMENT_FILE:file},encoding:'utf8',timeout:15000});
  assert.notEqual(keeperCheck.status,0);assert.match(keeperCheck.stderr,/V3 release mismatch/);
  fs.writeFileSync(file,JSON.stringify(cfg));
  await assert.rejects(()=>startWeb(file),/V3 release mismatch/);
  const missingKeeper=spawnSync(process.execPath,['scripts/keeper.mjs'],{env:{...process.env,DEPLOYMENT_FILE:file},encoding:'utf8',timeout:15000});
  assert.notEqual(missingKeeper.status,0);assert.match(missingKeeper.stderr,/V3 release mismatch/);
  const codeHashes={};
  for(const [key,contract] of Object.entries({usd,council,timelock,token,binary}))codeHashes[key]=keccak256(await provider.getCode(contract.target));
  fs.writeFileSync(file,JSON.stringify({...cfg,release:RELEASE,...releaseManifest(),timelock:timelock.target,development:addresses[38],daoPartners:addresses.slice(31,38),transferFeeBps:300,transferFeeMode:'burn',codeHashes}));
  process.env.PORT='0';process.env.HOST='127.0.0.1';delete process.env.RPC_URL;
  server=await startWeb(file);const origin='http://127.0.0.1:'+server.address().port;
  for(const route of ['/app/','/token/','/admin/']){
    const html=await fetch(origin+route);assert.equal(html.status,200);assert.match(await html.text(),/src="\.\/app.js"/);
    const js=await fetch(origin+route+'app.js');assert.equal(js.status,200);assert.equal(await js.text(),fs.readFileSync('web/app.js','utf8'));
  }
  if(fs.existsSync('landing/dist/index.html')){
    const home=await fetch(origin+'/');assert.equal(home.status,200);assert.equal(await home.text(),fs.readFileSync('landing/dist/index.html','utf8'));
    for(const file of ['app.js','app.css','protocol-ring.webp']){
      const asset=await fetch(origin+'/'+file);assert.equal(asset.status,200);assert.deepEqual(Buffer.from(await asset.arrayBuffer()),fs.readFileSync('landing/dist/'+file));
    }
  }
  const stateResponse=await fetch(origin+'/api/state?wallet='+addresses[0]);assert.equal(stateResponse.status,200);const state=await stateResponse.json();
  assert.equal(state.cycle,'1');assert.equal(state.cycleStartPrice,E('0.1').toString());assert.equal(state.development,addresses[38]);assert.equal(state.rewardModel,'attributed-credit-target-v2');
  assert.equal(state.pricingModel,'zero-start-reserve-v3');assert.equal(state.rewardQueue,'1');
  assert.equal(state.bb,E('5').toString());assert.equal(state.wallet.unlocked,'0');assert.deepEqual(state.wallet.locks,[]);
  const abi=await(await fetch(origin+'/abi/FTIReserveTokenV3')).json();
  assert.equal(abi.find(x=>x.type==='constructor').inputs.length,3);
  assert.equal(abi.some(x=>x.name==='CharityMinted'||x.name==='animalWalletA'||x.name==='CHARITY_BPS'),false);
  assert(abi.some(x=>x.name==='quoteTransfer'));
  assert(abi.some(x=>x.name==='TRANSFER_FEE_BPS'));
  await(await usd.approve(token.target,MaxUint256)).wait();
  await(await token.buy(E('100'),0,MaxUint256)).wait();
  await(await token.transfer(addresses[39],E('10'))).wait();
  const recipient=await(await fetch(origin+'/api/state?wallet='+addresses[39])).json();
  assert.equal(recipient.wallet.ftiBalance,E('9.7').toString());
  assert.equal(recipient.wallet.unlocked,E('9.7').toString());
  assert.equal(recipient.supply,E('969.7').toString());
  assert.equal(recipient.reserve,E('100').toString());
  const locks=await(await fetch(origin+'/api/locks?wallet='+addresses[0])).json();assert.deepEqual(locks.locks,[]);
  const cfgPublic=await(await fetch(origin+'/api/config')).json();assert.equal('rpcUrl' in cfgPublic,false);
 }finally{
  if(server)await new Promise(r=>server.close(r));provider.destroy();await chain.close();fs.rmSync(dir,{recursive:true,force:true});
  for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
