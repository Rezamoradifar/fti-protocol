import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,Contract,ContractFactory,parseEther as E,MaxUint256,ZeroHash,id} from 'ethers';
import {artifact,deployOne,settle,drainVolume,checkAccounting} from '../scripts/lib.mjs';
import {assertStorageCompatible} from '../scripts/check-upgrade-layout.mjs';
const send=async tx=>{const r=await(await tx).wait();assert.equal(r.status,1);return r;};

test('governed legacy-to-pool conversion preserves funded balances, tree, carry and monthly remainder',{timeout:600000},async()=>{
 // Compile before opening RPC so the compiler cannot expire provider sockets.
 const sources=Object.fromEntries(fs.readdirSync('contracts').filter(n=>n.endsWith('.sol')).map(n=>[n,{content:fs.readFileSync(n==='FundedBinaryPlanUpgradeable.sol'?'test/fixtures/legacy/FundedBinaryPlanUpgradeable.pre-pool.sol.txt':'contracts/'+n,'utf8')}]));
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'FundedBinaryPlanUpgradeable.sol':{'FundedBinaryPlanUpgradeable':['abi','evm.bytecode.object','storageLayout']}}}}),{import:n=>({contents:fs.readFileSync('node_modules/'+n,'utf8')})}));
 assert(!output.errors?.some(e=>e.severity==='error'),JSON.stringify(output.errors));const old=output.contracts['FundedBinaryPlanUpgradeable.sol'].FundedBinaryPlanUpgradeable;
 const next=JSON.parse(fs.readFileSync('artifacts/storage-layout/FundedBinaryPlanUpgradeable.json'));
 assertStorageCompatible(old.storageLayout,next);assert.deepEqual(next.storage.slice(old.storageLayout.storage.length).map(s=>s.label),['poolDistributionState','poolMigrationCursor','poolMigrationMonth','poolMigrationLastMonth']);
 const engine=ganache.provider({chain:{chainId:31337,time:new Date('2026-01-05T00:01:00Z')},logging:{quiet:true},wallet:{totalAccounts:45},miner:{blockGasLimit:30000000}}),p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 try{
  const w=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i))),a=await Promise.all(w.map(s=>s.getAddress()));
  const usd=await deployOne('MockUSD',[],w[0]),council=await deployOne('SevenGuardianCouncil',[a.slice(31,38)],w[0]),tl=await deployOne('FTITimelock',[council.target],w[0]);
  const ti=await deployOne('FTIReserveTokenUpgradeable',[],w[0]),oldImpl=await new ContractFactory(old.abi,'0x'+old.evm.bytecode.object,w[0]).deploy();await oldImpl.waitForDeployment();
  const tp=await deployOne('FTIProxy',[ti.target,ti.interface.encodeFunctionData('initialize',[usd.target,tl.target,council.target])],w[0]);
  const bp=await deployOne('FTIProxy',[oldImpl.target,oldImpl.interface.encodeFunctionData('initialize',[usd.target,tp.target,tl.target,council.target,a[44],a.slice(0,31)])],w[0]);
  const token=new Contract(tp.target,artifact('FTIReserveTokenUpgradeable').abi,w[0]),legacy=new Contract(bp.target,old.abi,w[0]),suite={usd,token,binary:legacy};await send(token.bind(bp.target));
  for(const i of [0,1,2]){await send(usd.connect(w[i]).faucet());await send(usd.connect(w[i]).approve(bp.target,MaxUint256));}
  await send(legacy.addUnits(2));await send(legacy.connect(w[1]).addUnits(100));await send(legacy.connect(w[2]).addUnits(100));await settle(suite,p);
  await p.send('evm_setTime',[Date.parse('2026-02-01T00:00:00Z')]);await p.send('evm_mine',[]);await settle(suite,p);await send(legacy.beginBuilderMonth());while(await legacy.monthPhase()>0n)await send(legacy.processBuilderMonth(100));
  assert(await legacy.builderCarry(0)>0n);await send(legacy.setAutoBuyPercent(true,37));await send(legacy.connect(w[1]).addUnits(5));await send(legacy.connect(w[2]).addUnits(5));await settle(suite,p);
  await send(legacy.connect(w[1]).addUnits(7));await drainVolume(suite);assert(await legacy.assignedPointCredit()>0n);assert(await legacy.assignedBuilderCredit()>0n);
  const binary=new Contract(bp.target,artifact('FundedBinaryPlanUpgradeable').abi,w[0]),impl=await deployOne('FundedBinaryPlanUpgradeable',[],w[0]);
  const councilCall=async(target,data)=>{const n=await council.proposalCount();await send(council.connect(w[31]).propose(target,data));for(let i=32;i<=35;i++)await send(council.connect(w[i]).approve(n));await send(council.execute(n));};
  const scheduled=async(target,data,salt)=>{await councilCall(tl.target,tl.interface.encodeFunctionData('schedule',[target,0,data,ZeroHash,salt,259200]));await p.send('evm_increaseTime',[259201]);await p.send('evm_mine',[]);return()=>send(tl.execute(target,0,data,ZeroHash,salt));};
  const snapshot=async()=>({members:await Promise.all(a.slice(0,31).map(x=>legacy.members(x).then(r=>[...r]))),cash:await Promise.all([...a.slice(0,31),a[44]].map(x=>legacy.pendingReward(x))),auto:await Promise.all(a.slice(0,31).map(x=>legacy.pendingAuto(x))),claims:await Promise.all(a.slice(0,31).map(x=>Promise.all([0,1,2,3].map(i=>legacy.builderClaimed(x,i))))),pool:await legacy.pointPool(),builder:await legacy.builderAccounted(),carry:await Promise.all([0,1,2,3].map(i=>legacy.builderCarry(i))),funding:await Promise.all([0,1,2,3].map(i=>legacy.monthFunding(2026*12+1,i))),usd:await usd.balanceOf(bp.target),tokenUSD:await usd.balanceOf(tp.target),reserve:await token.reserve(),support:await token.supportReserve()});
  await assert.rejects(()=>binary.beginPoolDistribution.staticCall());
  const doUpgrade=await scheduled(bp.target,legacy.interface.encodeFunctionData('upgradeToAndCall',[impl.target,'0x']),id('pool-upgrade'));
  await councilCall(bp.target,legacy.interface.encodeFunctionData('setRecoveryFrozen',[true]));await councilCall(tp.target,token.interface.encodeFunctionData('setRecoveryFrozen',[true]));
  const before=await snapshot();await doUpgrade();assert.equal(await binary.poolDistributionVersion(),0n);assert.equal(await binary.poolDistributionState(),0n);
  await assert.rejects(()=>binary.addUnits.staticCall(1));await assert.rejects(()=>binary.processPoolMigration.staticCall(1));
  const doBegin=await scheduled(bp.target,binary.interface.encodeFunctionData('beginPoolDistribution'),id('begin-pool-conversion'));await doBegin();assert.equal(await binary.poolDistributionState(),1n);
  await send(binary.connect(w[40]).processPoolMigration(1));assert.equal(await binary.poolDistributionVersion(),0n);assert.deepEqual(await snapshot(),before);
  const doReopen=await scheduled(bp.target,binary.interface.encodeFunctionData('setRecoveryFrozen',[false]),id('reopen-pool'));
  await assert.rejects(doReopen); // Governed reopening itself remains blocked while conversion is incomplete.
  let pages=1;while(await binary.poolDistributionVersion()!==1n){await send(binary.connect(w[40]).processPoolMigration(3));pages++;assert(pages<100);const f=await binary.fundingAccounting();assert.equal(f[0],f[1]);assert.equal(f[2],f[3]);}
  assert(pages>10);assert.deepEqual(await snapshot(),before);assert.equal(await binary.assignedPointCredit(),0n);assert.equal(await binary.assignedBuilderCredit(),0n);
  for(const who of a.slice(0,31)){assert.equal(await binary.creditL(who),0n);assert.equal(await binary.creditR(who),0n);for(let i=0;i<4;i++)assert.equal(await binary.builderCredit(2026*12+1,who,i),0n);}
  await assert.rejects(()=>binary.processPoolMigration.staticCall(1));await assert.rejects(()=>binary.beginPoolDistribution.staticCall());
  await doReopen();const reopenToken=await scheduled(tp.target,token.interface.encodeFunctionData('setRecoveryFrozen',[false]),id('reopen-token'));await reopenToken();
  const oldCash=await binary.pendingReward(a[0]),balance=await usd.balanceOf(a[0]);await send(binary.payRewards(100));assert.equal(await usd.balanceOf(a[0]),balance+oldCash);await send(binary.payRewards(100));assert.equal(await usd.balanceOf(a[0]),balance+oldCash);
  await settle({usd,token,binary},p);await send(binary.connect(w[2]).addUnits(7));const pool=await binary.pointPool(),pending=await binary.pendingReward(a[0]),automatic=await binary.pendingAuto(a[0]);await settle({usd,token,binary},p);
  assert.equal(await binary.pointPool(),0n);assert.equal((await binary.pendingReward(a[0]))-pending+(await binary.pendingAuto(a[0]))-automatic,pool);assert.equal(await binary.totalPaidPoints(),7n);await checkAccounting({usd,token,binary});
  console.log('POOL_UPGRADE_LOCAL_PASS',JSON.stringify({members:31,conversionPages:pages,pendingPreserved:true,legacyRemainderReused:true,noLiveTransactions:true}));
 }finally{await engine.disconnect();}
});
