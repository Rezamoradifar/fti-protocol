import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import solc from 'solc';
import {BrowserProvider,Contract,ContractFactory,parseEther as E,MaxUint256,keccak256} from 'ethers';
import {deployOne,artifact,settle,checkAccounting} from '../scripts/lib.mjs';
import {loadMigrationBuild,prepareMigrationDeployment,inspectMigration,exportOperatorManifest,prepareGovernanceAction,
 copyMigrationPages,executeMigrationAction,exportMigrationInventory,sendBudgeted,validateOperatorManifest} from '../scripts/address-migration-operator.mjs';
import {createBudget} from '../scripts/address-migration-policy.mjs';
import {verifyAddressMigration} from '../scripts/verify-address-migration.mjs';
import {checkedLayout} from '../scripts/address-migration-manifest.mjs';
import {spawnSync} from 'node:child_process';
import {assertStorageCompatible} from '../scripts/check-upgrade-layout.mjs';
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v);
const budget=()=>createBudget({maxFeeWei:E('100'),maxGasPriceWei:10000000000n,maxGas:28000000,maxTransactions:1000});
const send=async p=>{const r=await(await p).wait();assert.equal(r.status,1);return r;};

test('migration build pins the reviewed referral layout and rejects unreviewed storage changes',()=>{
 const {layouts}=loadMigrationBuild(),binary=layouts[0];
 assert.deepEqual(binary.storage.filter(s=>['directReferrer','directReferralCount'].includes(s.label)).map(s=>[s.label,s.slot,s.offset]),
  [['directReferrer','89',0],['directReferralCount','90',0]]);
 for(const change of [
  l=>{l.storage.pop();},
  l=>{l.storage.at(-1).slot='91';},
  l=>{l.storage.find(s=>s.label==='members').slot='999';},
  l=>{const field=l.storage.find(s=>s.label==='directReferralCount');l.types[field.type].value='t_address';}
 ]){
  const altered=structuredClone(binary);change(altered);
  assert.throws(()=>checkedLayout('FundedBinaryPlanUpgradeable',altered,binary),/Unreviewed storage layout/);
 }
});

for(const sourceKind of ['current','october-9'])test(`operator migrates ${sourceKind} logic, resumes pages and verifies before governed reopening`,{timeout:600000},async()=>{
 const sourceDir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-migration-source-'));
 const engine=ganache.provider({chain:{chainId:31337,time:new Date('2026-01-05T00:00:00Z')},logging:{quiet:true},wallet:{totalAccounts:46},miner:{blockGasLimit:30000000}});
 const provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 try {
  const w=await Promise.all(Array.from({length:46},(_,i)=>provider.getSigner(i))),a=await Promise.all(w.map(s=>s.getAddress()));
  const usd=await deployOne('MockUSD',[],w[0]),council=await deployOne('SevenGuardianCouncil',[a.slice(31,38)],w[0]),tl=await deployOne('FTITimelock',[council.target],w[0]);
  let binaryArtifact=artifact('FundedBinaryPlanUpgradeable');
  if(sourceKind==='october-9'){
   const sources=Object.fromEntries(fs.readdirSync('contracts').filter(n=>n.endsWith('.sol')).map(n=>[n,{content:fs.readFileSync(n==='FundedBinaryPlanUpgradeable.sol'?'test/fixtures/legacy/FundedBinaryPlanUpgradeable.20261009.sol.txt':'contracts/'+n,'utf8')}]));
   const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'FundedBinaryPlanUpgradeable.sol':{'FundedBinaryPlanUpgradeable':['abi','evm.bytecode.object','storageLayout']}}}}),{import:n=>({contents:fs.readFileSync('node_modules/'+n,'utf8')})}));
   assert(!compiled.errors?.some(e=>e.severity==='error'),JSON.stringify(compiled.errors));
   const c=compiled.contracts['FundedBinaryPlanUpgradeable.sol'].FundedBinaryPlanUpgradeable;
   assertStorageCompatible(c.storageLayout,loadMigrationBuild().layouts[0]);
   binaryArtifact={contractName:'FundedBinaryPlanUpgradeable',abi:c.abi,bytecode:'0x'+c.evm.bytecode.object};
   assert(!c.abi.some(f=>f.name==='autoBuyPercent'));
  }
  const bi=await new ContractFactory(binaryArtifact.abi,binaryArtifact.bytecode,w[0]).deploy();await bi.waitForDeployment();
  const ti=await deployOne('FTIReserveTokenUpgradeable',[],w[0]);
  const tp=await deployOne('FTIProxy',[ti.target,ti.interface.encodeFunctionData('initialize',[usd.target,tl.target,council.target])],w[0]);
  const token=new Contract(tp.target,artifact('FTIReserveTokenUpgradeable').abi,w[0]);
  const bp=await deployOne('FTIProxy',[bi.target,bi.interface.encodeFunctionData('initialize',[usd.target,tp.target,tl.target,council.target,a[45],a.slice(0,31)])],w[0]);
  const binary=new Contract(bp.target,binaryArtifact.abi,w[0]);
  const first=await send(token.bind(bp.target));
  for(const i of [0,1,2]){await send(usd.connect(w[i]).faucet());await send(usd.connect(w[i]).approve(bp.target,MaxUint256));}
  await send(binary.setAutoBuy(true,MaxUint256));await send(binary.addUnits(2));
  await send(binary.connect(w[1]).addUnits(100));await send(binary.connect(w[2]).addUnits(100));await settle({usd,binary,token},provider);
  await send(usd.approve(tp.target,MaxUint256));await send(token.buy(E('100'),0,MaxUint256));await send(token.transfer(a[40],E('1')));
  const cfg={chainId:31337,binaryContract:'FundedBinaryPlanUpgradeable',tokenContract:'FTIReserveTokenUpgradeable',binary:bp.target,token:tp.target,usd:usd.target,
   timelock:tl.target,council:council.target,binaryImplementation:bi.target,tokenImplementation:ti.target,deployedBlock:first.blockNumber,daoPartners:a.slice(31,38),codeHashes:{},implementationCodeHashes:{}};
  for(const key of ['binary','token','usd','timelock','council'])cfg.codeHashes[key]=keccak256(await provider.getCode(cfg[key]));
  for(const key of ['binary','token'])cfg.implementationCodeHashes[key]=keccak256(await provider.getCode(cfg[key+'Implementation']));
  let build=loadMigrationBuild();
  if(sourceKind==='october-9'){
   await assert.rejects(()=>prepareMigrationDeployment({provider,cfg,build}),/Source ABI probe failed/);
   cfg.artifactHashes={};cfg.constructorArgs={binaryImplementation:[],tokenImplementation:[]};
   cfg.transactions={binaryImplementation:bi.deploymentTransaction().hash,tokenImplementation:ti.deploymentTransaction().hash};
   for(const app of [binaryArtifact,artifact('FTIReserveTokenUpgradeable')]){
    const raw=JSON.stringify(app);fs.writeFileSync(path.join(sourceDir,app.contractName+'.json'),raw);
    cfg.artifactHashes[app.contractName]=createHash('sha256').update(raw).digest('hex');
   }
   build=loadMigrationBuild(process.cwd(),{sourceArtifactsDir:sourceDir});
   const badHashes={...cfg,artifactHashes:{...cfg.artifactHashes,FundedBinaryPlanUpgradeable:'f'.repeat(64)}};
   await assert.rejects(()=>prepareMigrationDeployment({provider,cfg:badHashes,build}),/artifact hash mismatch/);
   await assert.rejects(()=>prepareMigrationDeployment({provider,cfg:{...cfg,transactions:{...cfg.transactions,binaryImplementation:ti.deploymentTransaction().hash}},build}),/source creation mismatch/);
  }
  const preflight=await prepareMigrationDeployment({provider,cfg,build});
  const deployment=await sendBudgeted({ctx:preflight,signer:w[0],budget:budget(),transaction:preflight.transaction});
  const record={address:deployment.contractAddress,transactionHash:deployment.hash};
  let ctx=await inspectMigration({provider,cfg,build,record});
  const consent={expectedChain:31337,expectedCoordinator:record.address,signer:w[0],confirmations:1};
  await assert.rejects(()=>inspectMigration({provider,cfg:{...cfg,implementationCodeHashes:{...cfg.implementationCodeHashes,token:'0x'+'f'.repeat(64)}},build,record}));
  await assert.rejects(()=>inspectMigration({provider,cfg,build,record:{...record,address:a[44]}}));
  const governed=async(action,manifest)=>{
   ctx=await inspectMigration({provider,cfg,build,record});
   const plan=await prepareGovernanceAction(ctx,action,manifest);
   // The OPERATOR does not vote; five independent local fixture guardians do.
   const n=await council.proposalCount();await send(w[31].sendTransaction(plan.councilProposal));
   for(let i=32;i<=34;i++)await send(council.connect(w[i]).approve(n));
   await assert.rejects(()=>council.execute.staticCall(n));
   await send(council.connect(w[35]).approve(n));await send(council.execute(n));
   await assert.rejects(()=>executeMigrationAction({ctx,action,manifest,operation:plan.operation,budget:budget(),...consent}),/Timelock not ready/);
   await provider.send('evm_increaseTime',[259201]);await provider.send('evm_mine',[]);
   await assert.rejects(()=>executeMigrationAction({ctx,action,manifest,operation:'0x'+'e'.repeat(64),budget:budget(),...consent}),/Reviewed operation mismatch/);
   return executeMigrationAction({ctx,action,manifest,operation:plan.operation,budget:budget(),...consent});
  };
  await governed('freeze');await governed('arm');ctx=await inspectMigration({provider,cfg,build,record});
  const manifest=JSON.parse(json(await exportOperatorManifest(ctx)));
  validateOperatorManifest(manifest,cfg,record,build);
  const bad=structuredClone(manifest);bad.components[0].storage.pages[0].values[0]='0x'+'f'.repeat(64);
  const {digest,...body}=bad;bad.digest=keccak256(Buffer.from(json(body)));
  assert.throws(()=>validateOperatorManifest(bad,cfg,record,build),/Merkle/);
  await governed('configure',manifest);ctx=await inspectMigration({provider,cfg,build,record});
  await assert.rejects(()=>prepareGovernanceAction(ctx,'commit',manifest),/Incomplete/);
  await assert.rejects(()=>copyMigrationPages({ctx,manifest,budget:budget(),maxPages:1,...consent,expectedChain:56}));
  const events=[];const onEvent=async e=>events.push(e);
  const partial=await copyMigrationPages({ctx,manifest,budget:budget(),maxPages:1,onEvent,...consent});
  assert.equal(partial.result,'COPY_PAUSED');assert.equal(partial.sent,1);
  // A NEW invocation uses on-chain counters rather than a journal pretending a page is done.
  const rest=await copyMigrationPages({ctx,manifest,budget:budget(),maxPages:1000,onEvent,...consent});
  assert.equal(rest.result,'COPY_COMPLETE');assert(rest.sent>0);assert.equal(rest.fundsMoved,false);
  const again=await copyMigrationPages({ctx,manifest,budget:budget(),...consent});assert.equal(again.sent,0);
  assert(events.some(e=>e.event==='CONFIRMED'));assert.equal(await usd.balanceOf(ctx.targets[0]),0n);
  const bBefore=await usd.balanceOf(bp.target),tBefore=await usd.balanceOf(tp.target),claim=await binary.pendingReward(a[0]);
  const commit=await governed('commit',manifest);ctx=await inspectMigration({provider,cfg,build,record});
  assert.equal(await usd.balanceOf(bp.target),0n);assert.equal(await usd.balanceOf(tp.target),0n);
  assert.equal(await usd.balanceOf(ctx.targets[0]),bBefore);assert.equal(await usd.balanceOf(ctx.targets[1]),tBefore);
  await assert.rejects(()=>prepareGovernanceAction(ctx,'commit',manifest));await assert.rejects(()=>prepareGovernanceAction(ctx,'abort',manifest));
  const after=await exportMigrationInventory(ctx,true),verified=await verifyAddressMigration({provider,manifest,after,layouts:build.layouts});
  assert.equal(verified.result,'FUNDED_NEW_ADDRESS_MIGRATION_PASS');
  await governed('reopen',manifest);
  const b2=new Contract(ctx.targets[0],binaryArtifact.abi,w[0]),t2=new Contract(ctx.targets[1],artifact('FTIReserveTokenUpgradeable').abi,w[0]);
  const cash=await usd.balanceOf(a[0]);await send(b2.payRewards(100));await send(b2.payRewards(100));assert.equal(await usd.balanceOf(a[0]),cash+claim);
  assert.equal(await usd.allowance(a[0],b2.target),0n);assert.equal(await usd.allowance(a[0],t2.target),0n);
  await checkAccounting({usd,binary:b2,token:t2});
  console.log('FTI_MIGRATION_OPERATOR_TEST',JSON.stringify({scope:'LOCAL_EVM_NOT_PUBLIC_CHAIN',sourceKind,result:'PASS',members:verified.members,holders:verified.holders,
   importedPages:partial.sent+rest.sent,resume:true,governedCommit:commit.hash,exactCollateral:true,newApprovals:true,postMigrationCashExactlyOnce:true}));
 }finally{await engine.disconnect();fs.rmSync(sourceDir,{recursive:true,force:true});}
});

test('CLI help is read-only and unknown commands fail rather than default to a write',()=>{
 const help=spawnSync(process.execPath,['scripts/migrate-addresses.mjs','--help'],{encoding:'utf8'});
 assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/Writes are opt-in/);
 const bad=spawnSync(process.execPath,['scripts/migrate-addresses.mjs','transfer-everything'],{encoding:'utf8'});
 assert.notEqual(bad.status,0);
});
