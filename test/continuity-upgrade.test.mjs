import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,parseEther as E,MaxUint256,ZeroHash,id} from 'ethers';
import {deployOne,artifact,settle,checkAccounting} from '../scripts/lib.mjs';
import {collectInventory} from '../scripts/migration-inventory.mjs';
import {assertStorageCompatible} from '../scripts/check-upgrade-layout.mjs';
import {completeExport} from '../scripts/migration-complete-export.mjs';
import {verifyTransition} from '../scripts/verify-continuity-transition.mjs';

const implementationSlot='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
test('proxy upgrade keeps funded users, genealogy, rank, liabilities, token balances and proxy addresses',{timeout:240000},async()=>{
 const engine=ganache.provider({chain:{chainId:31337},logging:{quiet:true},wallet:{totalAccounts:45},miner:{blockGasLimit:30000000}}),p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 try{
  const w=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i))),a=await Promise.all(w.map(s=>s.getAddress())),send=async t=>{const r=await(await t).wait();assert.equal(r.status,1);return r;};
  const usd=await deployOne('MockUSD',[],w[0]),council=await deployOne('SevenGuardianCouncil',[a.slice(31,38)],w[0]),timelock=await deployOne('FTITimelock',[council.target],w[0]);
  const ti=await deployOne('FTIReserveTokenUpgradeable',[],w[0]);
  const tokenInit=ti.interface.encodeFunctionData('initialize',[usd.target,timelock.target,council.target]);
  await assert.rejects(()=>ti.initialize.staticCall(usd.target,timelock.target,council.target));
  await assert.rejects(()=>deployOne('FTIProxy',[ti.target,ti.interface.encodeFunctionData('initialize',[usd.target,usd.target,council.target])],w[0]));
  const tp=await deployOne('FTIProxy',[ti.target,tokenInit],w[0]),token=new Contract(tp.target,artifact('FTIReserveTokenUpgradeable').abi,w[0]);
  const bi=await deployOne('FundedBinaryPlanUpgradeable',[],w[0]);
  for(const [level,budget,points,expected] of [[0,E('15.999999999999999999'),1,1],[1,E('16'),1,1],[1,E('20'),1,1],[1,E('20.000000000000000001'),1,0],[3,E('1'),1,3],[2,0n,0,2],[0,E('32'),2,0]])assert.equal(await bi.protectionForValue(level,budget,points),BigInt(expected));
  const binaryArgs=[usd.target,token.target,timelock.target,council.target,a[44],a.slice(0,31)];
  const binaryInit=bi.interface.encodeFunctionData('initialize',binaryArgs);
  await assert.rejects(()=>bi.initialize.staticCall(...binaryArgs));
  const bp=await deployOne('FTIProxy',[bi.target,binaryInit],w[0]),binary=new Contract(bp.target,artifact('FundedBinaryPlanUpgradeable').abi,w[0]);
  const bindReceipt=await send(token.bind(binary.target));assert.equal(await token.name(),'FTI Protocol');assert.equal(await token.symbol(),'FTI');assert.equal(await token.cycle(),1n);assert.equal(await token.cycleStartPrice(),E('0.1'));assert.equal(await binary.epoch(),1n);
  await assert.rejects(()=>token.initialize.staticCall(usd.target,timelock.target,council.target));await assert.rejects(()=>binary.initialize.staticCall(...binaryArgs));
  for(const i of [0,1,2]){await send(usd.connect(w[i]).faucet());await send(usd.connect(w[i]).approve(binary.target,MaxUint256));}
  await send(usd.approve(token.target,MaxUint256));await send(binary.setAutoBuy(true,MaxUint256));await send(binary.addUnits(2));
  await send(binary.connect(w[1]).addUnits(100));await send(binary.connect(w[2]).addUnits(100));await settle({usd,token,binary},p);
  assert.equal(await binary.calculatedPointValue(),await binary.candidateFunding()/await binary.candidatePoints());assert(await binary.pointValue()>=E('20'));
  assert.equal(await binary.rankOf(a[0]),1n);await settle({usd,token,binary},p);await send(token.buy(E('300'),0,MaxUint256));const preR=await token.reserve(),preS=await token.totalSupply(),quote=await token.quoteBuy(E('800'));
  const first=E('485')*preS/preR,second=E('291')*(preS+first)/(preR+E('500'));
  assert.equal(quote,first+second);assert(quote<E('776')*preS/preR);await assert.rejects(()=>token.buy.staticCall(E('800'),quote+1n,MaxUint256));
  const balanceBefore=await token.balanceOf(a[0]);await send(token.buy(E('800'),quote,MaxUint256));
  assert.equal(await token.balanceOf(a[0]),balanceBefore+quote);assert.equal(await token.reserve(),preR+E('800'));
  await assert.rejects(()=>token.quoteBuy(E('64000.01')));
  await send(token.transfer(a[1],E('10')));await send(token.transfer(a[40],E('7')));await send(token.approve(a[2],E('5')));
  assert(await binary.pendingAuto(a[0])>0n);
  const snapshot=async()=>({members:await Promise.all([0,1,2].map(i=>binary.members(a[i]).then(r=>Array.from(r)))),credits:await Promise.all([0,1,2].map(i=>binary.creditL(a[i]))),pending:await binary.pendingReward(a[0]),dev:await binary.pendingReward(a[44]),pool:await binary.pointPool(),balance0:await token.balanceOf(a[0]),balance1:await token.balanceOf(a[1]),allowance:await token.allowance(a[0],a[2]),reserve:await token.reserve(),support:await token.supportReserve(),supply:await token.totalSupply(),ath:await token.ath(),epoch:await binary.epoch()});
  const before=await snapshot(),newTi=await deployOne('FTIReserveTokenUpgradeable',[],w[0]),newBi=await deployOne('FundedBinaryPlanUpgradeable',[],w[0]);
  await assert.rejects(()=>binary.upgradeToAndCall.staticCall(newBi.target,'0x'),/governance/);await assert.rejects(()=>bi.upgradeToAndCall.staticCall(newBi.target,'0x'));await assert.rejects(()=>binary.proxiableUUID());
  const councilCall=async(target,data)=>{const n=await council.proposalCount();await send(council.connect(w[31]).propose(target,data));for(let i=32;i<=35;i++)await send(council.connect(w[i]).approve(n));await send(council.execute(n));};
  const targets=[token.target,binary.target],values=[0,0],payloads=[token.interface.encodeFunctionData('upgradeToAndCall',[newTi.target,'0x']),binary.interface.encodeFunctionData('upgradeToAndCall',[newBi.target,'0x'])],salt=id('continuity-upgrade');
  await councilCall(timelock.target,timelock.interface.encodeFunctionData('scheduleBatch',[targets,values,payloads,ZeroHash,salt,259200]));
  await assert.rejects(()=>timelock.executeBatch.staticCall(targets,values,payloads,ZeroHash,salt));await p.send('evm_increaseTime',[259201]);await p.send('evm_mine',[]);
  await assert.rejects(()=>timelock.executeBatch.staticCall(targets,values,payloads,ZeroHash,salt),/freeze first/);
  await councilCall(binary.target,binary.interface.encodeFunctionData('setRecoveryFrozen',[true]));await councilCall(token.target,token.interface.encodeFunctionData('setRecoveryFrozen',[true]));
  await assert.rejects(()=>binary.setRecoveryFrozen.staticCall(false),/governance/);await assert.rejects(()=>token.setRecoveryFrozen.staticCall(false),/governance/);
  const exportCfg={binaryContract:'FundedBinaryPlanUpgradeable',tokenContract:'FTIReserveTokenUpgradeable',deployedBlock:bindReceipt.blockNumber,binaryStorageLayout:JSON.parse(fs.readFileSync('artifacts/storage-layout/FundedBinaryPlanUpgradeable.json'))};
  const capture=async()=>completeExport(await collectInventory({provider:p,binary,token,usd,cfg:exportCfg,blockTag:await p.getBlockNumber()}),{provider:p,binary,token,cfg:exportCfg});
  const fullBefore=await capture();
  await send(timelock.executeBatch(targets,values,payloads,ZeroHash,salt));
  assert.equal((await p.getStorage(token.target,implementationSlot)).slice(-40).toLowerCase(),newTi.target.slice(2).toLowerCase());assert.equal((await p.getStorage(binary.target,implementationSlot)).slice(-40).toLowerCase(),newBi.target.slice(2).toLowerCase());
  assert.deepEqual(await snapshot(),before);assert.equal(await binary.recoveryFrozen(),true);
  const fullAfter=await capture(),verified=verifyTransition(fullBefore,fullAfter);
  assert.equal(verified.members,31);assert.equal(verified.newAddressMigration,false);
  assert(fullAfter.ledger.holders.some(h=>h.wallet===a[40].toLowerCase()&&h.balance>0n));
  const json=r=>JSON.parse(JSON.stringify(r,(_,v)=>typeof v==='bigint'?String(v):v));
  assert.equal(verifyTransition(json(fullBefore),json(fullAfter)).stateHash,verified.stateHash);
  for(const mutate of [
   r=>r.users.pop(),r=>r.users.push(r.users[0]),
   r=>{r.users[0].member.left=a[40];},r=>{r.users[0].member.carryL+=1n;},
   r=>{r.users[0].member.rank=3n;},r=>{r.users[0].rankReachedAt[0]+=1n;},
   r=>{r.users[0].creditL+=1n;},r=>{r.users[0].pendingReward+=1n;},
   r=>{r.users[0].pendingAuto+=1n;},r=>{r.global.token.supportReserve+=1n;},
   r=>{r.global.token.reserve+=1n;},r=>{r.ledger.allowances[0].amount+=1n;},
   r=>{r.ledger.holders.find(h=>h.wallet===a[40].toLowerCase()).balance+=1n;},
   r=>{r.ledger.epochs[0].entries.push({wallet:a[0],points:1n,auto:false,settled:true});},
   r=>{r.ledger.monthlyGlobal.builderCarry[0]+=1n;},r=>{r.users[0].builderClaimed[0]=true;},
   r=>{r.authorities.binary.governance=a[40];},r=>{r.collateral.binaryToTokenAllowance=0n;},
   r=>{r.queues.rewards=[];},r=>{r.global.binary.calculatedPointValue+=1n;},
   r=>{r.contracts.binary=a[40];},r=>{delete r.global.binary.calculatedPointValue;},
   r=>{delete r.ledger;},r=>{r.global.binary.recoveryFrozen=false;},
   r=>{r.global.binary.phase=1n;},r=>{r.chainId='56';},
   r=>{r.block.number=fullBefore.block.number;},r=>{r.approximate=true;},
   r=>{r.implementations.binary=fullBefore.implementations.binary;}
  ]){const bad=structuredClone(fullAfter);mutate(bad);assert.throws(()=>verifyTransition(fullBefore,bad));}
  const exported=await collectInventory({provider:p,binary,token,usd,cfg:{binaryContract:'FundedBinaryPlanUpgradeable',tokenContract:'FTIReserveTokenUpgradeable'},blockTag:await p.getBlockNumber()});
  assert.equal(exported.implementations.binary.address.toLowerCase(),newBi.target.toLowerCase());assert.equal(exported.users.length,31);
  const badPayload=binary.interface.encodeFunctionData('upgradeToAndCall',[newTi.target,'0x']),badSalt=id('wrong-component');
  await councilCall(timelock.target,timelock.interface.encodeFunctionData('schedule',[binary.target,0,badPayload,ZeroHash,badSalt,259200]));await p.send('evm_increaseTime',[259201]);await p.send('evm_mine',[]);
  await assert.rejects(()=>timelock.execute.staticCall(binary.target,0,badPayload,ZeroHash,badSalt),/component/);
  assert.deepEqual(await snapshot(),before);
  const reopen=[token.interface.encodeFunctionData('setRecoveryFrozen',[false]),binary.interface.encodeFunctionData('setRecoveryFrozen',[false])],reopenSalt=id('reopen-upgrade');
  await councilCall(timelock.target,timelock.interface.encodeFunctionData('scheduleBatch',[targets,values,reopen,ZeroHash,reopenSalt,259200]));await p.send('evm_increaseTime',[259201]);await p.send('evm_mine',[]);await send(timelock.executeBatch(targets,values,reopen,ZeroHash,reopenSalt));
  const userCash=await usd.balanceOf(a[0]),devCash=await usd.balanceOf(a[44]);await send(binary.payRewards(100));assert.equal(await usd.balanceOf(a[0]),userCash+before.pending);assert.equal(await usd.balanceOf(a[44]),devCash+before.dev);await send(binary.payRewards(100));assert.equal(await usd.balanceOf(a[0]),userCash+before.pending);assert.equal(await usd.balanceOf(a[44]),devCash+before.dev);await checkAccounting({usd,token,binary});
  const autoPending=await binary.pendingAuto(a[0]),tokenBeforeAuto=await token.balanceOf(a[0]);
  await send(binary.executeAuto(a[0],autoPending));assert.equal(await binary.pendingAuto(a[0]),0n);assert(await token.balanceOf(a[0])>tokenBeforeAuto);
  await assert.rejects(()=>binary.executeAuto.staticCall(a[0],autoPending));
  await send(token.connect(w[2]).transferFrom(a[0],a[40],E('5')));assert.equal(await token.allowance(a[0],a[2]),0n);
  const usdBeforeSell=await usd.balanceOf(a[0]),[payout]=await token.quoteSell(E('1'));
  await send(token.sell(E('1'),payout,MaxUint256));assert.equal(await usd.balanceOf(a[0]),usdBeforeSell+payout);
  const manualBefore=await token.balanceOf(a[0]);await send(token.buy(E('10'),0,MaxUint256));assert(await token.balanceOf(a[0])>manualBefore);
  await settle({usd,token,binary},p);
  await send(usd.connect(w[41]).faucet());await send(usd.connect(w[41]).approve(binary.target,MaxUint256));
  await send(binary.connect(w[41]).register(a[30],1));assert.equal(await binary.registered(a[41]),true);assert.equal((await binary.members(a[41])).parent,a[30]);await checkAccounting({usd,token,binary});
  // No business cap on repeat units: exceed the former one-million limit.
  await settle({usd,token,binary},p);
  for(let i=0;i<101;i++)await send(usd.connect(w[30]).faucet());
  await send(usd.connect(w[30]).approve(binary.target,MaxUint256));
  await send(binary.connect(w[30]).addUnits(1000001));
  assert.equal(await binary.unitsOf(a[30]),1000001n);await checkAccounting({usd,token,binary});
  console.log('FTI_PROXY_TRANSFER_TEST',JSON.stringify({scope:'LOCAL_EVM_NOT_LIVE_NETWORK',membersVerified:verified.members,holdersVerified:verified.holders,corruptionCasesRejected:29,stateHash:verified.stateHash,pendingCashPreserved:before.pending.toString(),pendingAutoPreserved:autoPending.toString(),postUpgrade:['cash exactly once','auto-buy exactly once','transferFrom','sell payout','buy','new registration','repeat units'],result:'PASS'}));
 }finally{await engine.disconnect();}
});
test('layout gate rejects slot, field and mapping type changes',()=>{
 for(const name of ['FundedBinaryPlanUpgradeable','FTIReserveTokenUpgradeable']){
  const old=JSON.parse(fs.readFileSync(`artifacts/storage-layout/${name}.json`)),same=structuredClone(old);assertStorageCompatible(old,same);
  const bad=structuredClone(old);bad.storage[0].slot='999';assert.throws(()=>assertStorageCompatible(old,bad));
  const removed=structuredClone(old);removed.storage.pop();assert.throws(()=>assertStorageCompatible(old,removed));
  const type=structuredClone(old);type.types[type.storage[0].type].numberOfBytes='17';assert.throws(()=>assertStorageCompatible(old,type));
 }
});
