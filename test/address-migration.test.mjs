import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,Contract,parseEther as E,MaxUint256,ZeroHash,id,keccak256,AbiCoder,toBeHex} from 'ethers';
import {deployOne,artifact,settle,checkAccounting} from '../scripts/lib.mjs';
import {collectInventory} from '../scripts/migration-inventory.mjs';
import {completeExport} from '../scripts/migration-complete-export.mjs';
import {layoutDigest,bindingField,buildAddressMigrationManifest,IMPLEMENTATION_SLOT,merklePages,pageLeaf,migrationDomain} from '../scripts/address-migration-manifest.mjs';
import {verifyStagedMigration,verifyAddressMigration} from '../scripts/verify-address-migration.mjs';

const layouts=()=>['FundedBinaryPlanUpgradeable','FTIReserveTokenUpgradeable'].map(n=>JSON.parse(fs.readFileSync(`artifacts/storage-layout/${n}.json`)));
const data=(name)=>artifact(name).abi;
const send=async promise=>{const receipt=await(await promise).wait();assert.equal(receipt.status,1);return receipt;};

test('new-address migration moves funded users and reserves, retires both sources, preserves claims and requires new approvals',{timeout:420000},async()=>{
 const engine=ganache.provider({chain:{chainId:31337},logging:{quiet:true},wallet:{totalAccounts:46},miner:{blockGasLimit:30000000}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 try {
  const w=await Promise.all(Array.from({length:46},(_,i)=>p.getSigner(i))),a=await Promise.all(w.map(s=>s.getAddress()));
  const usd=await deployOne('MockUSD',[],w[0]),council=await deployOne('SevenGuardianCouncil',[a.slice(31,38)],w[0]),tl=await deployOne('FTITimelock',[council.target],w[0]);
  const ti=await deployOne('FTIReserveTokenUpgradeable',[],w[0]),bi=await deployOne('FundedBinaryPlanUpgradeable',[],w[0]);
  const tp=await deployOne('FTIProxy',[ti.target,ti.interface.encodeFunctionData('initialize',[usd.target,tl.target,council.target])],w[0]);
  const token=new Contract(tp.target,data('FTIReserveTokenUpgradeable'),w[0]);
  const bp=await deployOne('FTIProxy',[bi.target,bi.interface.encodeFunctionData('initialize',[usd.target,tp.target,tl.target,council.target,a[45],a.slice(0,31)])],w[0]);
  const binary=new Contract(bp.target,data('FundedBinaryPlanUpgradeable'),w[0]);
  const first=await send(token.bind(bp.target)),ls=layouts();
  let serial=0;
  const councilCall=async(target,callData)=>{
   const n=await council.proposalCount();await send(council.connect(w[31]).propose(target,callData));
   for(let i=32;i<35;i++)await send(council.connect(w[i]).approve(n));
   await assert.rejects(()=>council.execute.staticCall(n)); // only four approvals
   await send(council.connect(w[35]).approve(n));await send(council.execute(n));
  };
  const schedule=async(targets,payloads)=>{
   const values=targets.map(()=>0),salt=id('address-migration-'+serial++);
   await councilCall(tl.target,tl.interface.encodeFunctionData('scheduleBatch',[targets,values,payloads,ZeroHash,salt,259200]));
   await assert.rejects(()=>tl.executeBatch.staticCall(targets,values,payloads,ZeroHash,salt));
   return {targets,values,payloads,salt};
  };
  const delay=async()=>{await p.send('evm_increaseTime',[259201]);await p.send('evm_mine',[]);};
  const execute=async(q)=>send(tl.executeBatch(q.targets,q.values,q.payloads,ZeroHash,q.salt,{gasLimit:28000000}));
  const governed=async(targets,payloads)=>{const q=await schedule(targets,payloads);await delay();return execute(q);};
  const capture=async(b,t,blockTag=undefined)=>{
   const cfg={binaryContract:'FundedBinaryPlanUpgradeable',tokenContract:'FTIReserveTokenUpgradeable',deployedBlock:first.blockNumber,binaryStorageLayout:ls[0]};
   const inventory=await collectInventory({provider:p,binary:b,token:t,usd,cfg,blockTag:blockTag??await p.getBlockNumber()});
   return completeExport(inventory,{provider:p,binary:b,token:t,cfg});
  };
  for(const i of [0,1,2,41,42,43]){await send(usd.connect(w[i]).faucet());await send(usd.connect(w[i]).approve(bp.target,MaxUint256));}
  await send(binary.setAutoBuy(true,MaxUint256));await send(binary.addUnits(2));
  await send(binary.connect(w[1]).addUnits(100));await send(binary.connect(w[2]).addUnits(100));await settle({usd,binary,token},p);
  await send(usd.approve(tp.target,MaxUint256));await send(token.buy(E('300'),0,MaxUint256));
  await send(token.transfer(a[40],E('7')));await send(token.transfer(a[1],E('10')));await send(token.approve(a[2],E('5')));
  await send(binary.connect(w[41]).register(a[30],1));await send(binary.connect(w[42]).register(a[30],1));
  await settle({usd,binary,token},p);
  assert(await binary.totalPending()>0n);assert(await binary.pendingAuto(a[0])>0n);
  await councilCall(binary.target,binary.interface.encodeFunctionData('setRecoveryFrozen',[true]));
  await councilCall(token.target,token.interface.encodeFunctionData('setRecoveryFrozen',[true]));
  const oldB=await usd.balanceOf(bp.target),oldT=await usd.balanceOf(tp.target),oldCash=await binary.pendingReward(a[0]),oldAuto=await binary.pendingAuto(a[0]);
  const peerFields=ls.map(bindingField);
  const migration=await deployOne('FTIAddressMigration',[[bp.target,tp.target],[bi.target,ti.target],ls.map(layoutDigest),peerFields.map(x=>x.slot),peerFields.map(x=>x.offset)],w[0]);
  const destinations=await Promise.all([0,1].map(i=>migration.targets(i))),adapters=await Promise.all([0,1].map(i=>migration.sourceAdapters(i)));
  assert.notEqual(destinations[0],bp.target);assert.notEqual(destinations[1],tp.target);
  const b2=new Contract(destinations[0],data('FundedBinaryPlanUpgradeable'),w[0]),t2=new Contract(destinations[1],data('FTIReserveTokenUpgradeable'),w[0]);
  const receivers=destinations.map(t=>new Contract(t,data('FTIAddressMigrationTarget'),w[0]));
  const arm=new Contract(adapters[0],data('FTIAddressMigrationSource'),w[0]).interface.encodeFunctionData('arm');
  await assert.rejects(()=>binary.upgradeToAndCall.staticCall(adapters[0],arm));
  await assert.rejects(()=>receivers[0].configure.staticCall(id('fake'),1,ZeroHash,0,destinations[1]));
  await governed([bp.target,tp.target],[binary.interface.encodeFunctionData('upgradeToAndCall',[adapters[0],arm]),token.interface.encodeFunctionData('upgradeToAndCall',[adapters[1],arm])]);
  const before=await capture(binary,token),manifest=await buildAddressMigrationManifest({provider:p,coordinator:migration.target,inventory:before,layouts:ls});
  const configure=migration.interface.encodeFunctionData('configure',[manifest.components.map(c=>c.storage.root),manifest.components.map(c=>c.storage.count),manifest.components[1].holders.root,manifest.components[1].holders.count,manifest.digest]);
  await assert.rejects(()=>migration.configure.staticCall(manifest.components.map(c=>c.storage.root),manifest.components.map(c=>c.storage.count),manifest.components[1].holders.root,manifest.components[1].holders.count,manifest.digest));
  await governed([migration.target],[configure]);
  const firstPage=manifest.components[0].storage.pages[0];
  await assert.rejects(()=>receivers[0].importPage.staticCall(firstPage.keys,[id('wrong proof')]));
  assert.equal((await receivers[0].progress()).copied,0n);
  const commitCall=migration.interface.encodeFunctionData('commit',[manifest.digest]);
  const commitQueue=await schedule([migration.target],[commitCall]);await delay();
  await assert.rejects(()=>tl.executeBatch.staticCall(commitQueue.targets,commitQueue.values,commitQueue.payloads,ZeroHash,commitQueue.salt));
  assert.equal(await usd.balanceOf(bp.target),oldB);assert.equal(await usd.balanceOf(destinations[0]),0n);
  for(let kind=0;kind<2;kind++)for(const page of manifest.components[kind].storage.pages)await send(receivers[kind].importPage(page.keys,page.proof));
  await assert.rejects(()=>receivers[0].importPage.staticCall(firstPage.keys,firstPage.proof));
  await assert.rejects(()=>t2.transfer.staticCall(a[40],1n));
  await assert.rejects(()=>t2.setRecoveryFrozen.staticCall(false));
  await assert.rejects(()=>token.transfer.staticCall(a[40],1n));
  await assert.rejects(()=>binary.claim.staticCall());
  for(const page of manifest.components[1].holders.pages)await send(receivers[1].indexHolderPage(page.keys,page.proof));
  const staged=await verifyStagedMigration({provider:p,manifest});assert.equal(staged.newAddressMigration,true);
  await assert.rejects(()=>migration.commit.staticCall(manifest.digest));
  await assert.rejects(()=>migration.abort.staticCall());
  // A failed SECOND collateral leg must roll back the first transfer and every
  // retirement flag. This deliberate corruption is confined to local Ganache.
  let checkpoint=await p.send('evm_snapshot',[]);
  const usdLayout=JSON.parse(fs.readFileSync('artifacts/storage-layout/MockUSD.json'));
  const balanceSlot=usdLayout.storage.find(s=>s.label==='_balances').slot;
  const key=keccak256(AbiCoder.defaultAbiCoder().encode(['address','uint256'],[tp.target,balanceSlot]));
  await p.send('evm_setAccountStorageAt',[usd.target,key,toBeHex(0,32)]);
  await assert.rejects(()=>execute(commitQueue));
  assert.equal(await migration.phase(),1n);assert.equal(await usd.balanceOf(bp.target),oldB);assert.equal(await usd.balanceOf(destinations[0]),0n);
  assert.equal(await new Contract(bp.target,data('FTIAddressMigrationSource'),w[0]).migrationPhase(),1n);
  await p.send('evm_revert',[checkpoint]);
  // The timelock can safely abandon a fully staged but unfunded migration.
  checkpoint=await p.send('evm_snapshot',[]);
  await governed([migration.target],[migration.interface.encodeFunctionData('abort')]);
  assert.equal(await migration.phase(),3n);assert.equal(await usd.balanceOf(bp.target),oldB);
  assert.equal('0x'+(await p.getStorage(bp.target,IMPLEMENTATION_SLOT)).slice(-40),bi.target.toLowerCase());
  assert.equal(await binary.recoveryFrozen(),true);await assert.rejects(()=>t2.transfer.staticCall(a[40],1n));
  await p.send('evm_revert',[checkpoint]);
  const receipt=await execute(commitQueue);
  const after=await capture(b2,t2),verified=await verifyAddressMigration({provider:p,manifest,after,layouts:ls});
  assert.equal(verified.result,'FUNDED_NEW_ADDRESS_MIGRATION_PASS');assert.equal(verified.members,33);
  assert.equal(await usd.balanceOf(bp.target),0n);assert.equal(await usd.balanceOf(tp.target),0n);
  assert.equal(await usd.balanceOf(b2.target),oldB);assert.equal(await usd.balanceOf(t2.target),oldT);
  assert.equal(await b2.pendingReward(a[0]),oldCash);assert.equal(await b2.pendingAuto(a[0]),oldAuto);
  assert.equal(await t2.allowance(a[0],a[2]),0n);
  assert.equal(await usd.allowance(a[0],b2.target),0n);assert.equal(await usd.allowance(a[0],t2.target),0n);
  await assert.rejects(()=>binary.claim.staticCall());await assert.rejects(()=>token.sell.staticCall(E('1'),0,MaxUint256));
  await assert.rejects(()=>token.upgradeToAndCall.staticCall(ti.target,'0x'));
  await assert.rejects(()=>migration.commit.staticCall(manifest.digest));
  await assert.rejects(()=>migration.abort.staticCall());
  for(const mutate of [r=>{r.users.pop();},r=>{r.users[0].creditL+=1n;},r=>{r.global.token.reserve+=1n;},r=>{r.ledger.holders.pop();},r=>{r.global.binary.recoveryFrozen=false;}]){
   const corrupt=structuredClone(after);mutate(corrupt);await assert.rejects(()=>verifyAddressMigration({provider:p,manifest,after:corrupt,layouts:ls}));
  }
  await governed([t2.target,b2.target],[t2.interface.encodeFunctionData('setRecoveryFrozen',[false]),b2.interface.encodeFunctionData('setRecoveryFrozen',[false])]);
  const cashBefore=await usd.balanceOf(a[0]);await send(b2.payRewards(100));assert.equal(await usd.balanceOf(a[0]),cashBefore+oldCash);
  await send(b2.payRewards(100));assert.equal(await usd.balanceOf(a[0]),cashBefore+oldCash);
  const autoBefore=await t2.balanceOf(a[0]);await send(b2.executeAuto(a[0],oldAuto));assert.equal(await b2.pendingAuto(a[0]),0n);assert(await t2.balanceOf(a[0])>autoBefore);
  await assert.rejects(()=>b2.executeAuto.staticCall(a[0],oldAuto));
  await assert.rejects(()=>t2.connect(w[2]).transferFrom.staticCall(a[0],a[40],E('5')));
  await send(t2.approve(a[2],E('5')));await send(t2.connect(w[2]).transferFrom(a[0],a[40],E('5')));assert.equal(await t2.allowance(a[0],a[2]),0n);
  const [out]=await t2.quoteSell(E('1')),cashBeforeSell=await usd.balanceOf(a[0]);await send(t2.sell(E('1'),out,MaxUint256));assert.equal(await usd.balanceOf(a[0]),cashBeforeSell+out);
  await send(usd.approve(t2.target,MaxUint256));await send(t2.buy(E('10'),0,MaxUint256));
  await settle({usd,binary:b2,token:t2},p);
  await send(usd.connect(w[43]).approve(b2.target,MaxUint256));await send(b2.connect(w[43]).register(a[41],1));assert.equal(await b2.registered(a[43]),true);
  await checkAccounting({usd,binary:b2,token:t2});
  // A later migration has its own control namespace: targets from this one can
  // become sources without resetting users or being blocked by the prior seal.
  await settle({usd,binary:b2,token:t2},p);
  await councilCall(b2.target,b2.interface.encodeFunctionData('setRecoveryFrozen',[true]));await councilCall(t2.target,t2.interface.encodeFunctionData('setRecoveryFrozen',[true]));
  const again=await deployOne('FTIAddressMigration',[[b2.target,t2.target],[bi.target,ti.target],ls.map(layoutDigest),peerFields.map(x=>x.slot),peerFields.map(x=>x.offset)],w[0]);
  const nextAdapters=await Promise.all([0,1].map(i=>again.sourceAdapters(i)));
  await governed([b2.target,t2.target],[b2.interface.encodeFunctionData('upgradeToAndCall',[nextAdapters[0],arm]),t2.interface.encodeFunctionData('upgradeToAndCall',[nextAdapters[1],arm])]);
  assert.equal(await new Contract(b2.target,data('FTIAddressMigrationSource'),w[0]).migrationPhase(),1n);
  await governed([again.target],[again.interface.encodeFunctionData('abort')]);assert.equal(await b2.memberCount(),34n);
  console.log('FTI_FUNDED_NEW_ADDRESS_TEST',JSON.stringify({scope:'LOCAL_EVM_NOT_PUBLIC_CHAIN',result:'PASS',members:verified.members,holders:verified.holders,
   binaryCollateral:oldB.toString(),tokenCollateral:oldT.toString(),pendingCash:oldCash.toString(),pendingAuto:oldAuto.toString(),
   sourceBinary:bp.target,targetBinary:b2.target,sourceToken:tp.target,targetToken:t2.target,commitReceipt:receipt.hash,
   protections:['5-of-7','72-hour delay','Merkle pages','no duplicate import','all-or-nothing collateral','abort before commit','terminal source','new approvals','repeat migration namespace'],
   postMigration:['cash exactly once','auto exactly once','transferFrom','sell','buy','registration']}));
 }finally{await engine.disconnect();}
});

test('manifest proofs bind chain, source, target and page and reject altered state',()=>{
 const a=n=>'0x'+n.toString(16).padStart(40,'0'),base={chainId:97,coordinator:a(1),source:a(2),target:a(3),kind:0,codeHash:id('code'),layoutHash:id('layout')};
 const domain=migrationDomain(base),keys=[toBeHex(1,32)],values=[toBeHex(20,32)];
 const leaves=Array.from({length:5},(_,i)=>pageLeaf(domain,0,i,keys,values)),tree=merklePages(leaves);
 const pair=(a,b)=>keccak256('0x'+[a,b].sort().map(s=>s.slice(2)).join(''));
 for(let i=0;i<leaves.length;i++)assert.equal(tree.proofs[i].reduce(pair,leaves[i]),tree.root);
 for(const changed of [{chainId:56},{source:a(4)},{target:a(5)},{coordinator:a(6)},{kind:1},{codeHash:id('other')}])assert.notEqual(migrationDomain({...base,...changed}),domain);
 assert.notEqual(pageLeaf(domain,0,0,keys,[toBeHex(21,32)]),leaves[0]);assert.notEqual(pageLeaf(domain,0,1,keys,values),leaves[0]);
});
