// Independent audit adaptation: the prior-history boundary cases use the final
// unmodified retirement token with auto off. Full runs also cover the inherited
// real paid-point suite against the historical reserve token.
import {describe,test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256} from 'ethers';
import {deployOne,deploySuite,drainVolume,settle,checkAccounting} from '../scripts/lib.mjs';

// Canonical global-pool rules. "Paid rank points" means funded allocation, not
// withdrawing a claim. No-eligible global-pool carry remains PROVISIONAL: these
// tests prove the implemented arithmetic, not approval of its ownership risk.
const WAD=E('1');
const rankRates=[500n,600n,700n,800n,1000n];
const capRows=[[5n,10n,15n,20n,25n],[5n,10n,12n,16n,20n],[5n,10n,10n,12n,15n],[5n,10n,10n,10n,10n]];
const engineOptions={logging:{quiet:true},wallet:{totalAccounts:45},chain:{chainId:31337,time:new Date('2026-10-04T00:00:00Z')},miner:{blockGasLimit:30000000,timestampIncrement:0}};
async function fails(action){await assert.rejects(async()=>{const tx=await action();await tx.wait();});}
async function advanceToClose(s,p){await drainVolume(s);const b=await p.getBlock('latest');await p.send('evm_increaseTime',[Math.max(0,Number(await s.binary.epochEnd())-b.timestamp+1)]);await p.send('evm_mine',[]);await(await s.binary.beginEpochClose()).wait();}
async function finishEpoch(s){while(await s.binary.phase()>0n)await(await s.binary.processEpoch(100,{gasLimit:12000000})).wait();}
async function runMonth(s,p){
 const key=Number(await s.binary.nextBuilderMonth()),end=Date.UTC(Math.floor(key/12),key%12+1,1)/1000;
 const b=await p.getBlock('latest');await p.send('evm_increaseTime',[Math.max(0,end-b.timestamp+3601)]);await p.send('evm_mine',[]);
 await settle(s,p);await(await s.binary.beginBuilderMonth()).wait();
 while(await s.binary.monthPhase()>0n)await(await s.binary.processBuilderMonth(100,{gasLimit:12000000})).wait();
}

describe('BinaryPlan: actual funded paid points and global point-pool allocation',()=>{
 let engine,p,signers,s,snapshot;
 before(async()=>{
  engine=ganache.provider(engineOptions);p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
  signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));
  s=await deploySuite(signers,{tokenContract:'FTIReserveToken',binaryContract:'BinaryPlan'});
  for(const i of [0,1,2,3,4,15,30,36,37,38]){
   await(await s.usd.connect(signers[i]).faucet()).wait();
   await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();
   await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();
  }
  snapshot=await p.send('evm_snapshot',[]);
 });
 beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
 after(async()=>{await engine.disconnect();});
 const units=async(i,n)=>(await s.binary.connect(signers[i]).addUnits(n)).wait();

 test('20 real hourly epochs: raw 10 pays 5 and flushes 5; only allocation 100 promotes Builder 1, with old-rank auto timing',async()=>{
  const root=s.addresses[0],dev=s.addresses[35];await units(0,1);
  await(await s.binary.setAutoBuy(true)).wait();
  let expectedReward=0n;
  for(let hour=1;hour<=20;hour++){
   await units(1,10);await units(2,10);
   const current=await s.binary.epoch(),pool=await s.binary.pointPool(),beforeReward=await s.binary.pendingReward(root);
   await advanceToClose(s,p);await(await s.binary.processEpoch(100,{gasLimit:12000000})).wait();
   assert.equal(await s.binary.phase(),2n);
   assert.equal(await s.binary.paidPoints(current,root),5n,'Member cap remains 5 even with 10 raw matches');
   assert.equal(await s.binary.cumulativePaidRankPoints(root),BigInt((hour-1)*5),'matching alone grants no rank credit');
   assert.equal(await s.binary.rankOf(root),0n,'rank does not advance before payout allocation');
   assert.equal(await s.binary.autoSnapshot(current,root),false,'old Member rank controls this epoch');
   const m=await s.binary.members(root);
   assert.equal(m.carryL,0n);assert.equal(m.carryR,0n,'all 10 matches consumed: 5 paid and 5 flushed');
   assert.equal(m.lifetimeL,BigInt(hour*10));assert.equal(m.lifetimeR,BigInt(hour*10));
   assert.equal(await s.binary.pointValue(),pool/5n);assert((await s.binary.pointValue())>E('20'),'PV has no $20 ceiling');
   await(await s.binary.processEpoch(1,{gasLimit:12000000})).wait();
   assert.equal(await s.binary.pendingReward(root)-beforeReward,pool);
   assert.equal(await s.binary.cumulativePaidRankPoints(root),BigInt(hour*5));
   assert.equal(await s.binary.rankOf(root),hour===20?1n:0n);
   assert.equal(await s.binary.pendingAuto(root),0n,'promotion cannot retroactively enable auto for this epoch');
   await finishEpoch(s);expectedReward+=pool;
   assert.equal(await s.binary.pointPool(),0n);assert.equal(await s.binary.pendingReward(root),expectedReward);
   assert.equal(await s.binary.pendingReward(dev),E(String(1+hour*20)),'development receives only its 1% when division is exact');
   assert.equal(await s.binary.builderAccounted(),E(String((1+hour*20)*4)));
   assert.equal(await s.usd.balanceOf(s.token.target),E(String((1+hour*20)*5)),'all $5/unit support reaches the separate token contract');
   await checkAccounting(s);
  }
  assert.equal(await s.binary.cumulativePaidRankPoints(root),100n);
  assert.equal(await s.binary.tokenBuyLimit(root),E('600')*await s.token.priceMultiplier());
  const reached=await s.binary.rankReachedAt(root,0);assert(reached>0n);
  await(await s.binary.claim()).wait();assert.equal(await s.binary.pendingReward(root),0n);
  assert.equal(await s.binary.cumulativePaidRankPoints(root),100n,'withdrawal neither adds nor resets rank points');
  await fails(()=>s.binary.claim());assert.equal(await s.binary.cumulativePaidRankPoints(root),100n);
  await(await s.token.buy(E('100'),0,MaxUint256)).wait();
  const spent=await s.binary.tokenBuySpent(root);assert.equal(spent,E('100'));
  await units(1,12);await units(2,12);const current=await s.binary.epoch();
  // Create a real pending liability by failing the new immediate allocation attempt.
  await(await s.usd.setBlocked(s.token.target,true)).wait();
  const tokensBefore=await s.token.balanceOf(root),reserveBefore=await s.token.reserve();
  await settle(s,p);
  assert.equal(await s.token.balanceOf(root),tokensBefore);assert.equal(await s.token.reserve(),reserveBefore);
  await(await s.usd.setBlocked(s.token.target,false)).wait();
  assert.equal(await s.binary.paidPoints(current,root),10n,'next epoch uses the new Builder 1 cap');
  assert.equal(await s.binary.cumulativePaidRankPoints(root),110n);
  assert.equal(await s.binary.autoSnapshot(current,root),true);
  assert.equal(await s.binary.pendingAuto(root),E('108'));
  const protectedBefore={builder:await s.binary.builderAccounted(),pending:await s.binary.totalPending(),dev:await s.binary.pendingReward(dev),pool:await s.binary.pointPool()};
  await(await s.binary.executeAuto(root,E('108'),{gasLimit:3000000})).wait();
  assert.equal(await s.binary.tokenBuySpent(root),spent,'funded reward auto-buy stays outside gross manual quota');
  assert.equal(await s.binary.pendingAuto(root),0n);
  assert.deepEqual({builder:await s.binary.builderAccounted(),pending:await s.binary.totalPending(),dev:await s.binary.pendingReward(dev),pool:await s.binary.pointPool()},protectedBefore);
  assert.equal(await s.binary.rankReachedAt(root,0),reached,'permanent rank timestamp is never reset');
  await checkAccounting(s);

  // Existing monthly equal share / 20% cap / once per wallet and pool survives.
  const month=await s.binary.nextBuilderMonth(),balance=await s.binary.monthFunding(month,0),before=await s.binary.pendingReward(root);
  await runMonth(s,p);
  assert.equal(await s.binary.pendingReward(root)-before,balance/5n);
  assert.equal(await s.binary.builderCarry(0),balance-balance/5n);
  assert.equal(await s.binary.builderClaimed(root,0),true);
  assert.equal(await s.binary.cumulativePaidRankPoints(root),110n,'monthly bonus does not create binary rank points');
  const carry=await s.binary.builderCarry(0),paid=await s.binary.pendingReward(root);await runMonth(s,p);
  assert.equal(await s.binary.pendingReward(root),paid,'same wallet cannot claim this builder pool twice');
  assert.equal(await s.binary.builderCarry(0),carry);await checkAccounting(s);
  console.log('PAID_POINT_REAL_PATH',JSON.stringify({epochs:20,rawMatched:200,rankPoints:100,flushed:100,rank:1,rankCredit:'funded allocation; not cash claim',autoStartsNextEpoch:true}));
 });

 test('hourly registration-unit gate: four then one in separate hours carry fully; one-wallet five-unit top-up settles',async()=>{
  for(let level=0;level<4;level++)for(let rank=0;rank<5;rank++)assert.equal(await s.binary.cap(rank,level),capRows[level][rank]);
  const root=s.addresses[0],dev=s.addresses[35];
  await units(0,1);await units(1,1);await units(2,2);await drainVolume(s);
  const count=await s.binary.memberCount();assert.equal(await s.binary.epochUnits(),4n);
  const carry=await s.binary.members(root);assert.equal(carry.carryL,1n);assert.equal(carry.carryR,2n);
  await settle(s,p);
  assert.equal(await s.binary.pointPool(),E('360'),'four units cannot distribute even with eligible matches');
  assert.equal(await s.binary.pendingReward(root),0n);assert.equal(await s.binary.cumulativePaidRankPoints(root),0n);
  assert.equal(await s.binary.pendingReward(dev),E('4'),'development gets only the ordinary 1 USD per unit');
  assert.equal((await s.binary.members(root)).carryL,carry.carryL);assert.equal((await s.binary.members(root)).carryR,carry.carryR);
  assert.equal(await s.binary.epochUnits(),0n);await checkAccounting(s);
  // Registration units from another hour cannot satisfy this hour's gate.
  await units(2,1);assert.equal(await s.binary.epochUnits(),1n);await settle(s,p);
  assert.equal(await s.binary.pointPool(),E('450'),'four previous-hour units plus one current-hour unit remain full carry');
  assert.equal(await s.binary.pendingReward(root),0n);assert.equal(await s.binary.pendingReward(dev),E('5'));
  assert.equal(await s.binary.cumulativePaidRankPoints(root),0n);await checkAccounting(s);
  await settle(s,p);assert.equal(await s.binary.pointPool(),E('450'),'an empty hour does not divert carry');
  assert.equal(await s.binary.pendingReward(dev),E('5'));
  // A single existing wallet pays 500 USD: five registration units, no new wallets.
  await units(2,5);assert.equal(await s.binary.epochUnits(),5n);assert.equal(await s.binary.memberCount(),count);
  const pool=await s.binary.pointPool(),builder=await s.binary.builderAccounted(),tokenCash=await s.usd.balanceOf(s.token.target);
  assert.equal(pool,E('900'));assert.equal(builder,E('40'));assert.equal(tokenCash,E('50'));
  const epoch=await s.binary.epoch();await settle(s,p);
  assert.equal(await s.binary.paidPoints(epoch,root),1n);assert.equal(await s.binary.pendingReward(root),pool);
  assert.equal(await s.binary.pointPool(),0n);assert.equal(await s.binary.cumulativePaidRankPoints(root),1n);
  assert.equal(await s.binary.pendingReward(dev),E('10'),'no development exception consumes the carried point pool');
  assert.equal(await s.binary.builderAccounted(),builder);assert.equal(await s.usd.balanceOf(s.token.target),tokenCash);
  assert.equal(await s.binary.memberCount(),count);assert.equal(await s.binary.unitsOf(s.addresses[2]),8n);
  assert.equal(await s.binary.unitsSinceSettlement(),0n);await checkAccounting(s);
 });

 test('one new wallet registering five units reaches the hourly gate; zero eligible points still carry the full pool',async()=>{
  const who=s.addresses[36],dev=s.addresses[35],count=await s.binary.memberCount();
  await(await s.binary.connect(signers[36]).register(s.addresses[15],5)).wait();
  assert.equal(await s.binary.memberCount(),count+1n);assert.equal(await s.binary.unitsOf(who),5n);
  assert.equal(await s.binary.epochUnits(),5n);assert.equal(await s.binary.pointPool(),E('450'));
  await advanceToClose(s,p);assert.equal(await s.binary.phase(),1n,'five units reaches matching despite only one registering wallet');
  await finishEpoch(s);
  assert.equal(await s.binary.totalPaidPoints(),0n);assert.equal(await s.binary.allocated(),0n);assert.equal(await s.binary.pointValue(),0n);
  assert.equal(await s.binary.pointPool(),E('450'));assert.equal(await s.binary.pendingReward(who),0n);
  assert.equal(await s.binary.pendingReward(dev),E('5'));assert.equal(await s.binary.builderAccounted(),E('20'));
  assert.equal(await s.usd.balanceOf(s.token.target),E('25'));await checkAccounting(s);
  await settle(s,p);assert.equal(await s.binary.pointPool(),E('450'));assert.equal(await s.binary.pendingReward(dev),E('5'));await checkAccounting(s);
 });

 test('proportional full-pool distribution rounds only exact residual to development and preserves every protected bucket',async()=>{
  for(const[i,n]of [[0,1],[1,1],[2,4],[3,3],[4,4]])await units(i,n);
  const pool=await s.binary.pointPool(),builder=await s.binary.builderAccounted(),dev=await s.binary.pendingReward(s.addresses[35]),reserve=await s.token.reserve();
  assert.equal(pool,E('1170'));await advanceToClose(s,p);await(await s.binary.processEpoch(100,{gasLimit:12000000})).wait();
  assert.equal(await s.binary.totalPaidPoints(),7n);
  assert.equal(await s.binary.paidPoints(1,s.addresses[0]),4n);assert.equal(await s.binary.paidPoints(1,s.addresses[1]),3n);
  const reward0=pool*4n/7n,reward1=pool*3n/7n,rounding=pool-reward0-reward1;assert.equal(rounding,1n);
  await(await s.binary.processEpoch(1,{gasLimit:12000000})).wait();
  assert.equal(await s.binary.pendingReward(s.addresses[0]),reward0);
  await(await s.binary.claim()).wait(); // Claims may run between allocation batches.
  assert.equal(await s.binary.cumulativePaidRankPoints(s.addresses[0]),4n);
  const receipt=await(await s.binary.processEpoch(100,{gasLimit:12000000})).wait();
  assert.equal(await s.binary.pendingReward(s.addresses[1]),reward1);
  assert.equal(await s.binary.allocated(),reward0+reward1);assert.equal(await s.binary.pointPool(),0n);
  assert.equal(await s.binary.pendingReward(s.addresses[35]),dev+rounding);
  const events=receipt.logs.map(l=>{try{return s.binary.interface.parseLog(l);}catch{return null;}}).filter(e=>e?.name==='PointPoolRoundingAllocated');
  assert.equal(events.length,1);assert.equal(events[0].args.amount,rounding);
  assert.equal(await s.binary.builderAccounted(),builder);assert.equal(await s.token.reserve(),reserve);
  assert.equal(await s.binary.totalAuto(),0n);await checkAccounting(s);
 });

 test('no eligible points carries the whole pool provisionally; later self-controlled matches still expose global-pool ownership risk',async()=>{
  await units(30,100);await settle(s,p);
  assert.equal(await s.binary.pointPool(),E('9000'));assert.equal(await s.binary.pendingReward(s.addresses[35]),E('100'));
  assert.equal(await s.binary.allocated(),0n);assert.equal(await s.binary.pointValue(),0n);
  await settle(s,p);assert.equal(await s.binary.pointPool(),E('9000'),'an empty hourly close cannot classify the pool as rounding');
  assert.equal(await s.binary.pendingReward(s.addresses[35]),E('100'));
  await(await s.binary.connect(signers[36]).register(s.addresses[15],1)).wait();
  await(await s.binary.connect(signers[37]).register(s.addresses[36],2)).wait();
  await(await s.binary.connect(signers[38]).register(s.addresses[36],2)).wait();await settle(s,p);
  assert.equal(await s.binary.pendingReward(s.addresses[36]),E('9450'));
  assert.equal(await s.binary.cumulativePaidRankPoints(s.addresses[36]),2n);
  assert.equal(await s.binary.pointPool(),0n);assert.equal(await s.binary.pendingReward(s.addresses[35]),E('105'));
  await checkAccounting(s);
  console.log('PROVISIONAL_GLOBAL_POOL_RISK',JSON.stringify({unrelatedCarriedPool:'9000',subtreeCost:'500',subtreeReward:'9450',paidRankPoints:2,ownershipApproved:false}));
 });
});

// TEST ONLY. These methods deliberately create boundary histories that are NOT
// evidence of organic rank attainment. No production setter or deployment exists.
// Every allocation still runs production matching/allocation against actual USD.
let fixtures;
function getFixtures(){
 if(fixtures)return fixtures;
 const source=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {BinaryPlan} from './BinaryPlan.sol';
contract TEST_ONLY_PaidPointsBinary is BinaryPlan {
 constructor(address stable,address fti,address gov,address emergency,address dev,address[31] memory genesis) BinaryPlan(stable,fti,gov,emergency,dev,genesis) {}
 function TEST_ONLY_seedHistory(address who,uint256 points,uint8 rank) external {require(phase==0,'phase');cumulativePaidRankPoints[who]=points;members[who].rank=rank;for(uint256 r;r<rank;r++)rankReachedAt[who][r]=uint64(epochEnd-1);}
 function TEST_ONLY_seedMatch(address who,uint256 raw) external {require(phase==0,'phase');members[who].units=1;members[who].carryL=raw;members[who].carryR=raw;}
 function TEST_ONLY_setProtection(uint8 level) external {require(phase==0&&level<4,'phase');protectionLevel=level;}
}`;
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'TEST_ONLY_PaidPointsBinary.sol':{content:source},'HostileUSD.sol':{content:fs.readFileSync('test/fixtures/HostileUSD.sol','utf8')}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'TEST_ONLY_PaidPointsBinary.sol':{'TEST_ONLY_PaidPointsBinary':['abi','evm.bytecode.object']},'HostileUSD.sol':{'HostileUSD':['abi','evm.bytecode.object']}}}}),{import:name=>{for(const base of ['contracts','node_modules']){const file=path.join(base,name);if(fs.existsSync(file))return{contents:fs.readFileSync(file,'utf8')};}return{error:'Missing '+name};}}));
 assert(!output.errors?.some(e=>e.severity==='error'),output.errors?.map(e=>e.formattedMessage).join('\n'));
 fixtures={binary:output.contracts['TEST_ONLY_PaidPointsBinary.sol'].TEST_ONLY_PaidPointsBinary,usd:output.contracts['HostileUSD.sol'].HostileUSD};return fixtures;
}
async function fromArtifact(a,args,signer){const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;}

describe('BinaryPlan TEST ONLY boundary and hostile-collateral regression fixtures',()=>{
 let engine,p,signers,s,snapshot;
 before(async()=>{
  engine=ganache.provider(engineOptions);p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
  signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));
  const addresses=await Promise.all(signers.map(x=>x.getAddress())),a=getFixtures();
  const usd=await fromArtifact(a.usd,[],signers[0]); const council=await deployOne('Council',[addresses.slice(31,38)],signers[0]); const timelock=await deployOne('FTITimelock',[council.target],signers[0]); const token=await deployOne('FTIRetirementReviewToken',[usd.target,timelock.target,council.target,addresses[35]],signers[0]);
  const binary=await fromArtifact(a.binary,[usd.target,token.target,timelock.target,council.target,addresses[35],addresses.slice(0,31)],signers[0]);
  await(await token.bind(binary.target)).wait();s={usd,token,binary,addresses};
  for(const i of [0,1,2,3,4,5,6]){await(await usd.mint(addresses[i],E('1000000'))).wait();await(await usd.connect(signers[i]).approve(binary.target,MaxUint256)).wait();await(await usd.connect(signers[i]).approve(token.target,MaxUint256)).wait();}
  snapshot=await p.send('evm_snapshot',[]);
 });
 beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
 after(async()=>{await engine.disconnect();});
 const units=async(i,n)=>(await s.binary.connect(signers[i]).addUnits(n)).wait();

 for(const[rank,threshold]of [100n,200n,500n,1000n].entries())test(`TEST ONLY prior paid history: threshold ${threshold} advances only after funded allocation under rank ${rank}`,async()=>{
  const root=s.addresses[0],oldCap=capRows[0][rank];await units(0,1);
  await(await s.binary.TEST_ONLY_seedHistory(root,threshold-oldCap,rank)).wait();
  await(await s.binary.setAutoBuy(false)).wait();await units(1,30);await units(2,30); for(let level=0;level<4;level++)for(let rr=0;rr<5;rr++)assert.equal(await s.binary.cap(rr,level),capRows[level][rr]); await assert.rejects(s.binary.cap(5,0)); await assert.rejects(s.binary.cap(0,4));
  const oldLimit=E(String(rankRates[rank]))*await s.token.priceMultiplier();assert.equal(await s.binary.tokenBuyLimit(root),oldLimit);
  await(await s.token.buy(E('100'),0,MaxUint256)).wait();const spent=await s.binary.tokenBuySpent(root);
  await advanceToClose(s,p);await(await s.binary.processEpoch(100,{gasLimit:12000000})).wait();
  assert.equal(await s.binary.paidPoints(1,root),oldCap);assert.equal(await s.binary.rankOf(root),BigInt(rank));
  assert.equal(await s.binary.cumulativePaidRankPoints(root),threshold-oldCap);
  const pool=await s.binary.frozenPool();await(await s.binary.processEpoch(1,{gasLimit:12000000})).wait();
  assert.equal(await s.binary.pendingReward(root),pool);
  assert.equal(await s.binary.pendingAuto(root),0n);
  assert.equal(await s.binary.rankOf(root),BigInt(rank+1));assert.equal(await s.binary.cumulativePaidRankPoints(root),threshold);
  assert.equal(await s.binary.tokenBuyLimit(root),E(String(rankRates[rank+1]))*await s.token.priceMultiplier());
  assert.equal(await s.binary.tokenBuySpent(root),spent,'permanent gross spent survives rank upgrade');
  assert((await s.binary.rankReachedAt(root,rank))>0n);await finishEpoch(s);assert.equal(await s.binary.pointPool(),0n);await checkAccounting(s);
 });

 test('TEST ONLY dense matches: PV below $20 still settles all funds, changes next protection row, and preserves monthly buckets',async()=>{
  await units(0,5);
  for(let i=0;i<31;i++){
   await(await s.binary.TEST_ONLY_seedHistory(s.addresses[i],1000,4)).wait();
   await(await s.binary.TEST_ONLY_seedMatch(s.addresses[i],30)).wait();
  }
  const pool=await s.binary.pointPool(),dev=await s.binary.pendingReward(s.addresses[35]),builder=await s.binary.builderAccounted();
  await settle(s,p);assert.equal(await s.binary.totalPaidPoints(),775n);assert.equal(await s.binary.pointValue(),pool/775n);assert((await s.binary.pointValue())<E('20'));
  const each=pool*25n/775n,residual=pool-each*31n;
  for(let i=0;i<31;i++){assert.equal(await s.binary.pendingReward(s.addresses[i]),each);assert.equal(await s.binary.cumulativePaidRankPoints(s.addresses[i]),1025n);}
  assert.equal(await s.binary.pendingReward(s.addresses[35]),dev+residual);
  assert.equal(await s.binary.pointPool(),0n);assert.equal(await s.binary.protectionLevel(),1n);
  assert.equal(await s.binary.frozenLevel(),0n);assert.equal(await s.binary.builderAccounted(),builder);await checkAccounting(s);
  await units(0,5);await(await s.binary.TEST_ONLY_seedMatch(s.addresses[0],30)).wait();await settle(s,p);
  assert.equal(await s.binary.paidPoints(2,s.addresses[0]),20n,'next epoch uses protection row 1');
  assert.equal(await s.binary.protectionLevel(),0n,'PV above target relaxes only the following row');
  assert.equal(await s.binary.pointPool(),0n);await checkAccounting(s);
 });

 test('funding deficit blocks allocation and rank progress atomically; repairing collateral permits the same allocation',async()=>{
  const root=s.addresses[0];await units(0,1);await units(1,10);await units(2,10);
  await(await s.binary.TEST_ONLY_seedHistory(root,95,0)).wait();await advanceToClose(s,p);await(await s.binary.processEpoch(100,{gasLimit:12000000})).wait();
  const before={points:await s.binary.cumulativePaidRankPoints(root),rank:await s.binary.rankOf(root),pending:await s.binary.totalPending(),pool:await s.binary.pointPool(),cursor:await s.binary.cursor()};
  await(await s.usd.burn(s.binary.target,1)).wait();await fails(()=>s.binary.processEpoch(1,{gasLimit:12000000}));
  assert.deepEqual({points:await s.binary.cumulativePaidRankPoints(root),rank:await s.binary.rankOf(root),pending:await s.binary.totalPending(),pool:await s.binary.pointPool(),cursor:await s.binary.cursor()},before);
  assert.equal(await s.binary.settled(1,root),false);
  await(await s.usd.mint(s.binary.target,1)).wait();await finishEpoch(s);
  assert.equal(await s.binary.cumulativePaidRankPoints(root),100n);assert.equal(await s.binary.rankOf(root),1n);await checkAccounting(s);
 });

 test('sender and recipient taxed funding/claims revert atomically; collateral callback cannot process pending volume',async()=>{
  await units(0,1);await units(1,2);
  await(await s.usd.setCallback(s.binary.target,s.binary.interface.encodeFunctionData('processVolume',[1]))).wait();
  const cursor=await s.binary.jobCursor();await units(2,2);
  assert.equal(await s.usd.attempted(),true);assert.equal(await s.usd.succeeded(),false);assert.equal(await s.binary.jobCursor(),cursor);
  await(await s.usd.setCallback('0x0000000000000000000000000000000000000000','0x')).wait();await settle(s,p);
  const root=s.addresses[0],before={pool:await s.binary.pointPool(),reward:await s.binary.pendingReward(root),pending:await s.binary.totalPending(),points:await s.binary.cumulativePaidRankPoints(root),balance:await s.usd.balanceOf(root),plan:await s.usd.balanceOf(s.binary.target),units:await s.binary.unitsOf(root)};
  for(const mode of [1,2]){
   await(await s.usd.setFeeMode(mode)).wait();
   await fails(()=>s.binary.addUnits(1,{gasLimit:3000000}));await fails(()=>s.binary.claim({gasLimit:1000000}));
   assert.deepEqual({pool:await s.binary.pointPool(),reward:await s.binary.pendingReward(root),pending:await s.binary.totalPending(),points:await s.binary.cumulativePaidRankPoints(root),balance:await s.usd.balanceOf(root),plan:await s.usd.balanceOf(s.binary.target),units:await s.binary.unitsOf(root)},before);
  }
  await(await s.usd.setFeeMode(0)).wait();await(await s.binary.claim()).wait();assert.equal(await s.binary.cumulativePaidRankPoints(root),2n);await checkAccounting(s);
 });

 test('TEST ONLY six eligible builders retain equal monthly shares and later once-per-pool exclusion',async()=>{
  await units(0,5);
  for(let i=0;i<6;i++){
   await(await s.binary.TEST_ONLY_seedHistory(s.addresses[i],95,0)).wait();await(await s.binary.TEST_ONLY_seedMatch(s.addresses[i],5)).wait();
  }
  await settle(s,p);const month=await s.binary.nextBuilderMonth(),balance=await s.binary.monthFunding(month,0),before=await Promise.all(s.addresses.slice(0,6).map(a=>s.binary.pendingReward(a)));
  await runMonth(s,p);
  for(let i=0;i<6;i++){assert.equal(await s.binary.pendingReward(s.addresses[i])-before[i],balance/6n);assert.equal(await s.binary.builderClaimed(s.addresses[i],0),true);}
  assert.equal(await s.binary.builderCarry(0),balance-(balance/6n)*6n);await checkAccounting(s);
 });
});
