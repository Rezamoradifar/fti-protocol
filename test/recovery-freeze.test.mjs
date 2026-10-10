import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,MaxUint256,ZeroHash,id} from 'ethers';
import {deployOne,checkAccounting} from '../scripts/lib.mjs';

test('recovery freezes cash, genealogy, transfers and approvals; only delayed council governance can reopen',{timeout:180000},async()=>{
 const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:45},miner:{blockGasLimit:30000000}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 try{
  const w=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i))),a=await Promise.all(w.map(s=>s.getAddress()));
  const usd=await deployOne('MockUSD',[],w[0]),council=await deployOne('SevenGuardianCouncil',[a.slice(31,38)],w[0]);
  const timelock=await deployOne('FTITimelock',[council.target],w[0]);
  const token=await deployOne('FTIReserveTokenRecovery',[usd.target,timelock.target,council.target],w[0]);
  const binary=await deployOne('FundedBinaryPlanFloor',[usd.target,token.target,timelock.target,council.target,a[44],a.slice(0,31)],w[0]);
  const send=async t=>{const r=await(await t).wait();assert.equal(r.status,1);return r;};await send(token.bind(binary.target));
  await send(usd.faucet());await send(usd.approve(binary.target,MaxUint256));await send(usd.approve(token.target,MaxUint256));
  await send(binary.addUnits(1));await send(token.buy(E('100'),0,MaxUint256));await send(token.approve(a[1],E('10')));
  const held=await token.balanceOf(a[0]),cash=await usd.balanceOf(binary.target),support=await token.supportReserve();
  const councilCall=async(target,data)=>{
   const n=await council.proposalCount();await send(council.connect(w[31]).propose(target,data));
   for(let i=32;i<=34;i++)await send(council.connect(w[i]).approve(n));
   await assert.rejects(()=>council.execute.staticCall(n),/5 of 7/);
   await send(council.connect(w[35]).approve(n));await send(council.execute(n));
  };
  await assert.rejects(()=>binary.setRecoveryFrozen.staticCall(true),/recovery role/);
  await councilCall(binary.target,binary.interface.encodeFunctionData('setRecoveryFrozen',[true]));
  await councilCall(token.target,token.interface.encodeFunctionData('setRecoveryFrozen',[true]));
  for(const [n,args]of [['addUnits',[1]],['processVolume',[1]],['beginEpochClose',[]],['processEpoch',[1]],['payRewards',[1]],['claim',[]],['setAutoBuy',[true,E('1')]],['releaseAutoToCash',[]],['beginBuilderMonth',[]],['processBuilderMonth',[1]]])await assert.rejects(()=>binary[n].staticCall(...args),/recovery frozen/);
  await assert.rejects(()=>token.transfer.staticCall(a[1],E('1')),/recovery frozen/);
  await assert.rejects(()=>token.connect(w[1]).transferFrom.staticCall(a[0],a[1],E('1')),/recovery frozen/);
  await assert.rejects(()=>token.approve.staticCall(a[2],E('1')),/recovery frozen/);
  await assert.rejects(()=>token.sell.staticCall(E('1'),0,MaxUint256),/recovery frozen/);
  assert.equal(await token.balanceOf(a[0]),held);assert.equal(await usd.balanceOf(binary.target),cash);assert.equal(await token.supportReserve(),support);
  await assert.rejects(()=>binary.setRecoveryFrozen.staticCall(false),/governance/);
  await assert.rejects(()=>token.setRecoveryFrozen.staticCall(false),/governance/);
  const snapshotBlock=await p.getBlockNumber(),root=id('test snapshot attestation');
  const targets=[binary.target,token.target,binary.target],values=[0,0,0];
  // Checkpoint first, then reopen both components in one atomic delayed transaction.
  const payloads=[binary.interface.encodeFunctionData('recordRecoveryCheckpoint',[root,snapshotBlock]),token.interface.encodeFunctionData('setRecoveryFrozen',[false]),binary.interface.encodeFunctionData('setRecoveryFrozen',[false])];
  const salt=id('recovery-test');
  await councilCall(timelock.target,timelock.interface.encodeFunctionData('scheduleBatch',[targets,values,payloads,ZeroHash,salt,259200]));
  await assert.rejects(()=>timelock.executeBatch.staticCall(targets,values,payloads,ZeroHash,salt));
  await p.send('evm_increaseTime',[259201]);await p.send('evm_mine',[]);
  await send(timelock.executeBatch(targets,values,payloads,ZeroHash,salt));
  assert.equal(await binary.recoverySnapshotRoot(),root);assert.equal(await binary.recoveryCheckpointSerial(),1n);
  assert.equal(await binary.recoveryFrozen(),false);assert.equal(await token.recoveryFrozen(),false);
  await send(token.transfer(a[1],E('1')));await send(binary.payRewards(100));assert.equal(await usd.balanceOf(a[44]),E('1'));
  await assert.rejects(()=>timelock.executeBatch.staticCall(targets,values,payloads,ZeroHash,salt));
  await checkAccounting({usd,binary,token});
 }finally{await engine.disconnect();}
});
