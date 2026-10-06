import {test} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,MaxUint256} from 'ethers';
import {deployPaidRankFeatureSuite,seedPaidRank} from './fixtures/paid-rank-feature-suite.mjs';
import {drainVolume,checkAccounting} from '../scripts/lib.mjs';
const tx=async p=>(await p).wait();
test('TEST_ONLY seeded rank: matured and rolled enable cannot create an auto snapshot for older unmatched backlog',async()=>{
 const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:45,deterministic:true},chain:{chainId:31337,time:new Date('2026-10-06T12:00:00Z')},miner:{timestampIncrement:0,blockGasLimit:30000000}});
 try{
  const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
  const signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));
  const s=await deployPaidRankFeatureSuite(signers,{tokenContract:'FTIRetirementReviewToken',binaryContract:'BinaryPlan'});
  for(const i of [0,1,2]){await tx(s.usd.connect(signers[i]).faucet());await tx(s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256));await tx(s.binary.connect(signers[i]).addUnits(i===0?1:3));}
  await seedPaidRank(s.binary,s.addresses[0],1);await drainVolume(s);
  const epoch=await s.binary.epoch(),oldEnd=await s.binary.epochEnd();await p.send('evm_increaseTime',[7200]);await p.send('evm_mine',[]);await tx(s.binary.beginEpochClose());assert.equal(await s.binary.phase(),1n);
  await tx(s.binary.setAutoBuy(true));const boundary=(await s.binary.nextAutoSetting(s.addresses[0])).effectiveAt;assert(boundary>oldEnd);
  const now=(await p.getBlock('latest')).timestamp;await p.send('evm_increaseTime',[Number(boundary)-now+1]);await p.send('evm_mine',[]);await tx(s.binary.setAutoBuy(true));
  assert.equal(await s.binary.effectiveAutoEnabled(s.addresses[0]),true);assert.equal(await s.binary.autoEnabledFrom(s.addresses[0]),boundary);
  while(await s.binary.phase()>0n)await tx(s.binary.processEpoch(100,{gasLimit:12000000}));
  assert.equal(await s.binary.autoSnapshot(epoch,s.addresses[0]),false);assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);assert.equal(await s.token.balanceOf(s.addresses[0]),0n);assert.equal(await s.binary.pendingReward(s.addresses[0]),E('630'));await checkAccounting(s);
 }finally{await engine.disconnect();}
});
