// Historical FTIToken regression paired with current BinaryPlan. Token locks/curve
// remain historical; auto setting, timing, immediate mint and retry use current policy.
import {deployPaidRankFeatureSuite,seedPaidRank} from './fixtures/paid-rank-feature-suite.mjs';
import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,MaxUint256,ZeroHash} from 'ethers';
import {drainVolume,settle,checkAccounting} from '../scripts/lib.mjs';
let engine,p,signers,s,snapshot;
before(async()=>{engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:45},chain:{chainId:31337,time:new Date('2026-10-04T00:00:00Z')},miner:{blockGasLimit:30000000,timestampIncrement:0}});p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));s=await deployPaidRankFeatureSuite(signers);snapshot=await p.send('evm_snapshot',[]);});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{await engine.disconnect();});
async function money(i){await(await s.usd.connect(signers[i]).faucet()).wait();await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();}
async function units(i,n){await money(i);await(await s.binary.connect(signers[i]).addUnits(n)).wait();}
async function advance(seconds){await p.send('evm_increaseTime',[seconds]);await p.send('evm_mine',[]);}
async function fails(fn){await assert.rejects(async()=>{const tx=await fn();if(tx?.wait)await tx.wait();});}
async function buy(i,a){return(await s.token.connect(signers[i]).buy(E(a),0,2n**64n-1n)).wait();}
// TEST ONLY paid-rank setup isolates auto-buy/monthly features from qualification.
async function eligibleRoot(){await units(0,1);await units(1,100);await units(2,100);await settle(s,p);await seedPaidRank(s.binary,s.addresses[0],1);}
test('31 unique Genesis positions contain no artificial cash, units or tokens',async()=>{assert.equal(await s.binary.memberCount(),31n);assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.binary.unitsOf(s.addresses[0]),0n);await checkAccounting(s);});
test('100 USDT is exactly split 90/5/4/1 without FTI mint',async()=>{await units(15,1);assert.equal(await s.binary.pointPool(),E('90'));assert.equal(await s.binary.builderAccounted(),E('4'));assert.equal(await s.binary.pendingReward(s.addresses[35]),E('1'));assert.equal(await s.token.buybackFund(),E('4'));assert.equal(await s.token.floorFund(),E('1'));assert.equal(await s.token.totalSupply(),0n);await checkAccounting(s);});
test('automatic left/right placement; third direct, duplicate and invalid sponsor rejected',async()=>{for(const i of [36,37,38])await money(i);await(await s.binary.connect(signers[36]).register(s.addresses[15],1)).wait();await(await s.binary.connect(signers[37]).register(s.addresses[15],1)).wait();const parent=await s.binary.members(s.addresses[15]);assert.equal(parent.left,s.addresses[36]);assert.equal(parent.right,s.addresses[37]);await fails(()=>s.binary.connect(signers[38]).register(s.addresses[15],1));await fails(()=>s.binary.connect(signers[36]).register(s.addresses[16],1));await fails(()=>s.binary.connect(signers[38]).register(s.addresses[39],1));});
test('bounded ancestor propagation includes every ancestor once',async()=>{await units(15,3);await drainVolume(s,1);const m=await s.binary.members(s.addresses[0]);assert.equal(m.lifetimeL,3n);assert.equal(m.lifetimeR,0n);const before=m.lifetimeL;await(await s.binary.processVolume(100)).wait();assert.equal((await s.binary.members(s.addresses[0])).lifetimeL,before);await fails(()=>s.binary.processVolume(101));});
test('hourly unit minimum: 3 then 2 in separate hours carry; 5 current-hour units settle all carried cash',async()=>{
 await units(0,1);await units(1,2);assert.equal(await s.binary.epochUnits(),3n);await settle(s,p);
 assert.equal(await s.binary.pointPool(),E('270'));assert.equal(await s.binary.pendingReward(s.addresses[0]),0n);
 await units(2,2);assert.equal(await s.binary.epochUnits(),2n);await settle(s,p);
 assert.equal(await s.binary.pointPool(),E('450'));assert.equal(await s.binary.pendingReward(s.addresses[0]),0n);
 assert.equal(await s.binary.pendingReward(s.addresses[35]),E('5'));await checkAccounting(s);
 await units(1,5);assert.equal(await s.binary.epochUnits(),5n);await settle(s,p);
 assert.equal(await s.binary.pendingReward(s.addresses[0]),E('900'));assert.equal(await s.binary.pointPool(),0n);
 assert.equal(await s.binary.pendingReward(s.addresses[35]),E('10'));assert.equal(await s.binary.builderAccounted(),E('40'));
 assert.equal(await s.binary.unitsSinceSettlement(),0n);await checkAccounting(s);
});
test('matched points above cap burn, only heavy-side imbalance carries',async()=>{await units(0,1);await units(1,30);await units(2,12);await settle(s,p);const m=await s.binary.members(s.addresses[0]);assert.equal(m.carryL,18n);assert.equal(m.carryR,0n);assert.equal(await s.binary.paidPoints(1,s.addresses[0]),5n);});
test('raw branch units do not grant rank; successful funded capped points accumulate before any claim',async()=>{await units(0,1);await units(1,100);await units(2,100);await settle(s,p);assert.equal(await s.binary.rankOf(s.addresses[0]),0n);assert.equal(await s.binary.paidPoints(1,s.addresses[0]),5n);assert.equal(await s.binary.cumulativePaidRankPoints(s.addresses[0]),5n);assert.equal((await s.binary.members(s.addresses[0])).lifetimeL,100n);await units(1,5);await units(2,5);await settle(s,p);assert.equal(await s.binary.rankOf(s.addresses[0]),0n);assert.equal(await s.binary.cumulativePaidRankPoints(s.addresses[0]),10n);});
test('cap and protection tables reproduce specification',async()=>{assert.equal(await s.binary.cap(4,0),25n);assert.equal(await s.binary.cap(2,1),12n);assert.equal(await s.binary.cap(3,3),10n);});
test('claims are pull payments and cannot be repeated',async()=>{await units(0,1);await units(1,2);await units(2,2);await settle(s,p);const before=await s.usd.balanceOf(s.addresses[0]);await(await s.binary.claim()).wait();assert.equal(await s.usd.balanceOf(s.addresses[0])-before,E('450'));await fails(()=>s.binary.claim());await checkAccounting(s);});
test('batch order/size leaves identical wallet economics',async()=>{await units(0,1);await units(1,30);await units(2,12);const id=await p.send('evm_snapshot',[]);await settle(s,p,1);const a=await s.binary.pendingReward(s.addresses[0]);const carryA=(await s.binary.members(s.addresses[0])).carryL;await p.send('evm_revert',[id]);await settle(s,p,100);assert.equal(await s.binary.pendingReward(s.addresses[0]),a);assert.equal((await s.binary.members(s.addresses[0])).carryL,carryA);});
test('buy uses actual stablecoin, increases price, respects lifetime allowance',async()=>{await units(15,1);const before=await s.token.price();await buy(15,'500');assert((await s.token.price())>before);assert.equal(await s.token.remainingAllowance(s.addresses[15]),0n);await fails(()=>s.token.connect(signers[15]).buy(E('1'),0,2n**64n-1n));await checkAccounting(s);});
test('holding cap and min output revert atomically',async()=>{await units(15,100);await fails(()=>s.token.connect(signers[15]).buy(E('50000'),0,2n**64n-1n));assert.equal(await s.token.totalSupply(),0n);await fails(()=>s.token.connect(signers[15]).buy(E('10'),E('1000000'),2n**64n-1n));await checkAccounting(s);});
test('locked tokens cannot sell; fallback deadline unlocks without new registrations',async()=>{await units(15,1);await buy(15,'100');const balance=await s.token.balanceOf(s.addresses[15]);assert.equal(await s.token.unlocked(s.addresses[15]),0n);await fails(()=>s.token.connect(signers[15]).sell(balance,0,2n**64n-1n));await advance(31*86400);assert.equal(await s.token.unlocked(s.addresses[15]),balance);await(await s.token.connect(signers[15]).sell(balance,0,2n**64n-1n)).wait();assert.equal(await s.token.totalSupply(),0n);await checkAccounting(s);});
test('transfer burns 3%, rejects self-transfer, unregistered recipient, and locked amount',async()=>{await units(15,1);await units(16,1);await buy(15,'100');await fails(()=>s.token.connect(signers[15]).transfer(s.addresses[16],E('1')));await advance(31*86400);const supply=await s.token.totalSupply();await(await s.token.connect(signers[15]).transfer(s.addresses[16],E('100'))).wait();assert.equal(await s.token.totalSupply(),supply-E('3'));assert.equal(await s.token.balanceOf(s.addresses[16]),E('97'));await fails(()=>s.token.connect(signers[15]).transfer(s.addresses[15],E('1')));await fails(()=>s.token.connect(signers[15]).transfer(s.addresses[36],E('1')));await checkAccounting(s);});
test('unauthorized auto buy, reserve injection, rebinding, pause and rescue rejected',async()=>{await fails(()=>s.token.autoBuy(s.addresses[0],E('1'),0,2n**64n-1n));await fails(()=>s.token.inject(E('5'),true));await fails(()=>s.token.bind(s.binary.target));await fails(()=>s.binary.pause());await fails(()=>s.binary.rescue(s.usd.target,s.addresses[0],1));await fails(()=>s.token.advancePriceMilestone());});
test('TEST ONLY legacy token fixture: bounded immediate attempt preserves actual rewards for a full retry',async()=>{
 await eligibleRoot();await(await s.binary.setAutoBuy(true)).wait();
 const manual=await s.token.lifetimeManualBuys(s.addresses[0]),before=await s.token.balanceOf(s.addresses[0]);
 await units(1,5);await units(2,5);await settle(s,p);
 // FTIToken's historical bisection/lock path exceeds the bounded immediate frame.
 // Preserve that historical model and prove deferral retains the exact liability.
 assert.equal(await s.binary.pendingAuto(s.addresses[0]),E('45'));assert.equal(await s.binary.totalAuto(),E('45'));
 assert.equal(await s.token.balanceOf(s.addresses[0]),before);
 const deferrals=await s.binary.queryFilter(s.binary.filters.ImmediateAutoDeferred());
 assert.equal(deferrals.at(-1).args[2],E('45'));
 const estimate=await s.binary.executeAuto.estimateGas(s.addresses[0],E('45'));
 assert(estimate>await s.binary.AUTO_ATTEMPT_GAS(),'historical curve requires more than bounded immediate gas');
 await(await s.binary.executeAuto(s.addresses[0],E('45'))).wait();
 assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);assert.equal(await s.binary.totalAuto(),0n);
 assert((await s.token.balanceOf(s.addresses[0]))>before);
 const executions=await s.binary.queryFilter(s.binary.filters.AutoExecuted());
 assert.equal(executions.at(-1).args[1],E('45'));
 assert.equal(await s.token.lifetimeManualBuys(s.addresses[0]),manual);await checkAccounting(s);
});
test('failed immediate auto and retry preserve claim and user can release it as USD',async()=>{
 await eligibleRoot();await(await s.binary.setAutoBuy(true)).wait();await units(1,5);await units(2,5);
 await(await s.usd.setBlocked(s.token.target,true)).wait();await settle(s,p);
 const amount=await s.binary.pendingAuto(s.addresses[0]);assert.equal(amount,E('45'));
 await fails(()=>s.binary.executeAuto(s.addresses[0],amount));assert.equal(await s.binary.pendingAuto(s.addresses[0]),amount);
 assert.equal(await s.token.balanceOf(s.addresses[0]),0n);
 const cash=await s.binary.pendingReward(s.addresses[0]);await(await s.binary.releaseAutoToCash()).wait();
 assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);assert.equal(await s.binary.totalAuto(),0n);
 assert.equal(await s.binary.pendingReward(s.addresses[0]),cash+amount);await checkAccounting(s);
});
test('TEST ONLY paid-rank fixture: monthly pool pays only 20% to sole eligible builder, one time',async()=>{await eligibleRoot();const d=new Date((await p.getBlock('latest')).timestamp*1000);const next=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000;await advance(next-(await p.getBlock('latest')).timestamp+3601);await settle(s,p);const before=await s.binary.pendingReward(s.addresses[0]);await(await s.binary.beginBuilderMonth()).wait();while(await s.binary.monthPhase()>0n)await(await s.binary.processBuilderMonth(9)).wait();assert.equal(await s.binary.pendingReward(s.addresses[0])-before,E('64.32'));assert.equal(await s.binary.builderClaimed(s.addresses[0],0),true);assert.equal(await s.binary.builderCarry(0),E('257.28'));await checkAccounting(s);});
test('5 of 7 council required for emergency pause; timelock starts at 72 hours',async()=>{assert.equal(await s.timelock.getMinDelay(),259200n);const data=s.binary.interface.encodeFunctionData('pause');await(await s.council.connect(signers[31]).propose(s.binary.target,data)).wait();for(const i of [32,33,34]){await(await s.council.connect(signers[i]).approve(0)).wait();await fails(()=>s.council.execute(0));}await(await s.council.connect(signers[35]).approve(0)).wait();await(await s.council.execute(0)).wait();assert.equal(await s.binary.paused(),true);await money(15);await fails(()=>s.binary.connect(signers[15]).addUnits(1));});
test('full unlock and complete sell-off pay from real reserve without new inflows',async()=>{for(const i of [15,16,17,18,19]){await units(i,5);await buy(i,'400');}await advance(91*86400);for(const i of [15,16,17,18,19]){const bal=await s.token.balanceOf(s.addresses[i]);await(await s.token.connect(signers[i]).sell(bal,0,2n**64n-1n)).wait();await checkAccounting(s);}assert.equal(await s.token.totalSupply(),0n);});
test('failed USD transfer leaves beneficiary claim intact and does not affect others',async()=>{await units(0,1);await units(1,2);await units(2,2);await settle(s,p);const amount=await s.binary.pendingReward(s.addresses[0]);await(await s.usd.setBlocked(s.addresses[0],true)).wait();await fails(()=>s.binary.claim());assert.equal(await s.binary.pendingReward(s.addresses[0]),amount);await(await s.binary.connect(signers[35]).claim()).wait();await checkAccounting(s);await(await s.usd.setBlocked(s.addresses[0],false)).wait();await(await s.binary.claim()).wait();});
test('5-of-7 council can rotate a compromised owner only through a self-governed proposal',async()=>{const data=s.council.interface.encodeFunctionData('replaceOwner',[s.addresses[37],s.addresses[42]]);await(await s.council.connect(signers[31]).propose(s.council.target,data)).wait();for(const i of [32,33,34,35])await(await s.council.connect(signers[i]).approve(0)).wait();await(await s.council.execute(0)).wait();assert.equal(await s.council.isOwner(s.addresses[37]),false);assert.equal(await s.council.isOwner(s.addresses[42]),true);});
test('72-hour timelock floor cannot be reduced even by a fully approved self-call',async()=>{const inner=s.timelock.interface.encodeFunctionData('updateDelay',[0]);const schedule=s.timelock.interface.encodeFunctionData('schedule',[s.timelock.target,0,inner,ZeroHash,ZeroHash,259200]);await(await s.council.connect(signers[31]).propose(s.timelock.target,schedule)).wait();for(const i of [32,33,34,35])await(await s.council.connect(signers[i]).approve(0)).wait();await(await s.council.execute(0)).wait();await advance(259201);await fails(()=>s.timelock.execute(s.timelock.target,0,inner,ZeroHash,ZeroHash));assert.equal(await s.timelock.getMinDelay(),259200n);});
test('five approvals cannot bypass timelock delay or replay execution',async()=>{const pause=s.binary.interface.encodeFunctionData('pause');await(await s.council.connect(signers[31]).propose(s.binary.target,pause)).wait();for(const i of [32,33,34,35])await(await s.council.connect(signers[i]).approve(0)).wait();await(await s.council.execute(0)).wait();const unpause=s.binary.interface.encodeFunctionData('unpause');const schedule=s.timelock.interface.encodeFunctionData('schedule',[s.binary.target,0,unpause,ZeroHash,ZeroHash,259200]);await(await s.council.connect(signers[31]).propose(s.timelock.target,schedule)).wait();for(const i of [32,33,34,35])await(await s.council.connect(signers[i]).approve(1)).wait();await(await s.council.execute(1)).wait();await fails(()=>s.timelock.execute(s.binary.target,0,unpause,ZeroHash,ZeroHash));await advance(259201);await(await s.timelock.execute(s.binary.target,0,unpause,ZeroHash,ZeroHash)).wait();assert.equal(await s.binary.paused(),false);await fails(()=>s.timelock.execute(s.binary.target,0,unpause,ZeroHash,ZeroHash));await fails(()=>s.council.execute(1));});
test('EVM integer buy quotes match independent BigInt model',async()=>{const {Curve}=await import('../core/reference.mjs');const model=new Curve();for(const amount of ['0.000001','1','100','500','1000000'])assert.equal(await s.token.quoteBuy(E(amount)),model.quoteBuy(E(amount)).minted);});
test('enabling during matching schedules the next hour without rewriting old settlement economics',async()=>{
 await eligibleRoot();await units(1,5);await units(2,5);await drainVolume(s);
 const oldEnd=await s.binary.epochEnd(),oldEpoch=await s.binary.epoch(),block=await p.getBlock('latest');
 await advance(Number(oldEnd)-block.timestamp+1);await(await s.binary.beginEpochClose()).wait();
 await(await s.binary.setAutoBuy(true)).wait();
 const pending=await s.binary.nextAutoSetting(s.addresses[0]);assert(pending.effectiveAt>oldEnd);
 while(await s.binary.phase()>0n)await(await s.binary.processEpoch(100,{gasLimit:12000000})).wait();
 assert.equal(await s.binary.autoSnapshot(oldEpoch,s.addresses[0]),false);
 assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);assert.equal(await s.token.balanceOf(s.addresses[0]),0n);
 await units(1,5);await units(2,5);await settle(s,p);
 assert.equal(await s.binary.autoSnapshot(await s.binary.epoch()-1n,s.addresses[0]),true);
 assert.equal(await s.binary.pendingAuto(s.addresses[0]),E('45'));
 await(await s.binary.executeAuto(s.addresses[0],E('45'))).wait();
 assert((await s.token.balanceOf(s.addresses[0]))>0n);assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);await checkAccounting(s);
});
