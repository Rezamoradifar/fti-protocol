import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {JsonRpcProvider,MaxUint256,parseEther as E} from 'ethers';
import {deploySuite} from '../scripts/lib.mjs';
import {startWeb} from '../scripts/server.mjs';

test('integrated API reports experimental pressure, disabled caps, complete final payout and historical quote',async()=>{
 const chain=ganache.server({logging:{quiet:true},wallet:{totalAccounts:42},chain:{chainId:31337},miner:{blockGasLimit:30000000}});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-integrated-state-'));
 const saved=Object.fromEntries(['PORT','RPC_URL','EVENT_RPC_URL'].map(k=>[k,process.env[k]]));
 let web,p;
 try{
  await chain.listen(0,'127.0.0.1');const rpcUrl=`http://127.0.0.1:${chain.address().port}`;
  p=new JsonRpcProvider(rpcUrl,undefined,{cacheTimeout:-1});p.pollingInterval=10;
  const signers=await Promise.all(Array.from({length:42},(_,i)=>p.getSigner(i)));
  const s=await deploySuite(signers,{tokenContract:'FTIReserveToken',binaryContract:'BinaryPlan'});
  const config=path.join(dir,'local.json');fs.writeFileSync(config,JSON.stringify({mode:'local',chainId:31337,rpcUrl,tokenContract:'FTIReserveToken',binaryContract:'BinaryPlan',lockVersion:3,binary:s.binary.target,token:s.token.target,usd:s.usd.target,council:s.council.target,timelock:s.timelock.target}));
  process.env.PORT='0';delete process.env.RPC_URL;delete process.env.EVENT_RPC_URL;
  web=await startWeb(config);const base=`http://127.0.0.1:${web.address().port}`;
  async function state(){const r=await fetch(base+'/api/state?wallet='+s.addresses[0]);assert.equal(r.status,200);return r.json();}
  let d=await state();assert.equal(d.pricingModel,'real-reserve-quarantine-pressure-review');assert.equal(d.supply,'0');assert.equal(d.price,E('0.1').toString());assert.equal(d.lifecycleClosed,false);assert.equal(d.sellPressureWad,'0');assert.equal(d.maxSingleSellBps,'0');assert.equal(d.maxHourlySellBps,'0');
  await(await s.usd.faucet()).wait();await(await s.usd.approve(s.binary.target,MaxUint256)).wait();await(await s.usd.approve(s.token.target,MaxUint256)).wait();
  await(await s.binary.addUnits(1)).wait();await(await s.token.buy(E('100'),0,MaxUint256)).wait();
  const q=(await s.token.totalSupply())/2n;await(await s.token.sell(q,0,MaxUint256)).wait();
  d=await state();assert(BigInt(d.sellPressureWad)>0n);assert.equal(d.sellWindowGross,'0');assert.equal(d.wallet.remaining,E('400').toString());assert.equal(d.wallet.lockCount,'0');assert.deepEqual(d.wallet.locks,[]);
  const last=await s.token.price(),reserve=await s.token.reserve(),before=await s.usd.balanceOf(s.addresses[0]);
  await(await s.token.sell(await s.token.totalSupply(),reserve,MaxUint256)).wait();
  assert.equal((await s.usd.balanceOf(s.addresses[0]))-before,reserve);
  d=await state();assert.equal(d.reserve,'0');assert.equal(d.supply,'0');assert.equal(d.account2[0],E('5').toString());assert.equal(d.account2[1],E('5').toString());assert.equal(d.unallocatedReserve,E('5').toString());assert.equal(d.rewardModel,'global-pool-paid-points-v2');assert.equal(d.wallet.cumulativePaidRankPoints,'0');assert.equal(d.price,last.toString());assert.equal(d.referencePrice,last.toString());assert.equal(d.lifecycleClosed,true);assert.equal(d.wallet.remaining,E('400').toString());
 }finally{
  if(web)await new Promise(r=>web.close(r));if(p)p.destroy();await chain.close();
  for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
