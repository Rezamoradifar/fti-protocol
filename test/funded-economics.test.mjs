import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,formatEther as F,MaxUint256} from 'ethers';
import {deploySuite,settle,drainVolume,checkAccounting} from '../scripts/lib.mjs';
let engine,p,signers,s,snapshot;
before(async()=>{
 engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:110},chain:{chainId:31337,time:new Date('2026-09-15T12:00:00Z')},miner:{blockGasLimit:30000000}});
 p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 signers=await Promise.all(Array.from({length:110},(_,i)=>p.getSigner(i)));s=await deploySuite(signers,{tokenContract:'FTIReserveToken',binaryContract:'FundedBinaryPlan'});
 for(const i of [0,1,2,3,4,5,6,15,16,30,36,37,38,40,41,42])await prepare(i);
 snapshot=await p.send('evm_snapshot',[]);
});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{await engine.disconnect();});
async function prepare(i){await(await s.usd.connect(signers[i]).faucet()).wait();await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();}
async function units(i,n){await(await s.binary.connect(signers[i]).addUnits(n)).wait();}
async function register(i,parent,n){await(await s.binary.connect(signers[i]).register(s.addresses[parent],n)).wait();}
async function checks(){await checkAccounting(s);const[a,b,c,d]=await s.binary.fundingAccounting();assert.equal(a,b,'point budget partition');assert.equal(c,d,'builder budget partition');}
async function fails(fn){await assert.rejects(async()=>{const tx=await fn();await tx.wait();});}
async function selfTree(){await register(36,15,1);await register(37,36,2);await register(38,36,2);await settle(s,p);await checks();return s.binary.pendingReward(s.addresses[36]);}
async function advance(seconds){await p.send('evm_increaseTime',[seconds]);await p.send('evm_mine',[]);}
async function monthClose(){const key=Number(await s.binary.nextBuilderMonth()),end=Date.UTC(Math.floor(key/12),key%12+1,1)/1000;await advance(Math.max(0,end-(await p.getBlock('latest')).timestamp+1));await settle(s,p);await(await s.binary.beginBuilderMonth()).wait();while(await s.binary.monthPhase()>0n)await(await s.binary.processBuilderMonth(100)).wait();await checks();}

test('fresh subtree receives the same funded 40 USD with or without an unrelated 9,000 USD carried pool',async()=>{
 const snap=await p.send('evm_snapshot',[]),baseline=await selfTree();assert.equal(baseline,E('40'));await p.send('evm_revert',[snap]);
 await units(30,100);await settle(s,p);assert.equal(await s.binary.pointPool(),E('9000'));assert.equal(await s.binary.retainedPointReserve(),E('9000'));
 const reward=await selfTree();assert.equal(reward,baseline);assert((await s.binary.pointPool())>=E('9000'));const before=await s.usd.balanceOf(s.addresses[36]);await(await s.binary.connect(signers[36]).claim()).wait();assert.equal((await s.usd.balanceOf(s.addresses[36]))-before,reward);await fails(()=>s.binary.connect(signers[36]).claim());await checks();
 console.log('FIXED_CARRY_CAPTURE',JSON.stringify({groupCost:'500',legacyReward:'9450',newReward:F(reward),unrelatedCarry:'9000',carryCaptured:'0'}));
});
test('one branch cannot spend another branch unmatched funded credit',async()=>{
 await units(15,1);await register(36,15,20);await settle(s,p);const credit=await s.binary.creditL(s.addresses[15]);assert.equal(credit,E('360'));
 await register(40,30,1);await register(41,40,2);await register(42,40,2);await settle(s,p);assert.equal(await s.binary.pendingReward(s.addresses[40]),E('40'));assert.equal(await s.binary.creditL(s.addresses[15]),credit);assert.equal(await s.binary.pendingReward(s.addresses[15]),0n);await checks();
});
test('activating an ancestor after a purchase cannot retroactively earn queued volume or credits',async()=>{
 await register(36,15,2);await units(15,1);await register(37,15,2);await settle(s,p);
 const m=await s.binary.members(s.addresses[15]);assert.equal(m.lifetimeL,0n);assert.equal(m.carryL,0n);assert.equal(m.carryR,2n);assert.equal(await s.binary.creditL(s.addresses[15]),0n);assert.equal(await s.binary.creditR(s.addresses[15]),E('36'));assert.equal(await s.binary.pendingReward(s.addresses[15]),0n);await checks();
});
test('point cap consumes proportional matched credit, preserves heavy-side credit and caps USD per point',async()=>{
 await units(0,1);await units(1,30);await units(2,12);await settle(s,p);
 const m=await s.binary.members(s.addresses[0]);assert.equal(m.carryL,18n);assert.equal(m.carryR,0n);assert.equal(await s.binary.creditL(s.addresses[0]),E('1620'));assert.equal(await s.binary.creditR(s.addresses[0]),0n);assert.equal(await s.binary.pendingReward(s.addresses[0]),E('100'));assert.equal(await s.binary.paidPoints(1,s.addresses[0]),5n);await checks();
});
test('keeper batch sizes do not change allocation, carry, ranks or credit partitions',async()=>{
 for(const[i,n]of [[0,1],[1,1],[2,1],[3,30],[4,12],[5,11],[6,17]])await units(i,n);
 const snap=await p.send('evm_snapshot',[]);async function state(){return Promise.all(s.addresses.slice(0,7).map(async a=>({m:Array.from(await s.binary.members(a)),l:await s.binary.creditL(a),r:await s.binary.creditR(a),pay:await s.binary.pendingReward(a)})));}
 await settle(s,p,1);const a=await state();await checks();await p.send('evm_revert',[snap]);await settle(s,p,100);assert.deepEqual(await state(),a);await checks();
});
test('hourly close visits only touched active accounts and reuses dirty slots across epochs',async()=>{
 await units(0,1);await units(15,2);await units(16,2);await drainVolume(s);assert.equal(await s.binary.dirtyCount(),1n);assert.equal(await s.binary.memberCount(),31n);
 await advance(Number(await s.binary.epochEnd())-(await p.getBlock('latest')).timestamp+1);await(await s.binary.beginEpochClose()).wait();assert.equal(await s.binary.frozenMembers(),1n);const receipt=await(await s.binary.processEpoch(1)).wait();assert.equal(await s.binary.phase(),0n);assert.equal(await s.binary.dirtyCount(),0n);await units(15,3);await units(16,2);await drainVolume(s);assert.equal(await s.binary.dirtyCount(),1n);await settle(s,p);await checks();console.log('SPARSE_EPOCH_GAS',String(receipt.gasUsed));
});
test('monthly rewards use attributed current-month credits, never an unrelated prior-month carry',async()=>{
 await units(30,100);await monthClose();assert.equal(await s.binary.builderCarry(0),E('160'));
 await units(0,1);await units(1,100);await units(2,100);await settle(s,p);assert.equal(await s.binary.rankOf(s.addresses[0]),1n);
 const before=await s.binary.pendingReward(s.addresses[0]);await monthClose();assert.equal((await s.binary.pendingReward(s.addresses[0]))-before,E('64.32'));assert.equal(await s.binary.builderCarry(0),E('417.28'));assert.equal(await s.binary.builderClaimed(s.addresses[0],0),true);
 await units(1,5);await units(2,5);await settle(s,p);const next=await s.binary.pendingReward(s.addresses[0]);await monthClose();assert.equal(await s.binary.pendingReward(s.addresses[0]),next);await checks();
});
test('auto-buy queues contain only enabled funded accounts, preserve owner controls and remove completed entries',async()=>{
 for(const[i,n]of [[0,1],[1,100],[2,100]])await units(i,n);await settle(s,p);await(await s.binary.setAutoBuy(true,E('1000'))).wait();await units(1,5);await units(2,5);await settle(s,p);
 const amount=await s.binary.pendingAuto(s.addresses[0]);assert.equal(amount,E('5'));assert.equal(await s.binary.autoAccountCount(),1n);await fails(()=>s.binary.connect(signers[40]).executeAuto(s.addresses[0],1));await(await s.binary.setAutoBuy(false,0)).wait();assert.equal(await s.binary.autoAccountCount(),0n);await fails(()=>s.binary.connect(signers[40]).executeAuto(s.addresses[0],amount));await(await s.binary.setAutoBuy(true,E('1000'))).wait();assert.equal(await s.binary.autoAccountCount(),1n);await(await s.binary.connect(signers[40]).executeAuto(s.addresses[0],amount)).wait();assert.equal(await s.binary.autoAccountCount(),0n);assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);assert((await s.token.balanceOf(s.addresses[0]))>0n);await checks();
});
test('blocked cash claims restore the beneficiary liability and do not affect another claim',async()=>{
 await units(0,1);await units(1,2);await units(2,2);await settle(s,p);const amount=await s.binary.pendingReward(s.addresses[0]);await(await s.usd.setBlocked(s.addresses[0],true)).wait();await fails(()=>s.binary.claim());assert.equal(await s.binary.pendingReward(s.addresses[0]),amount);await(await s.binary.connect(signers[35]).claim()).wait();await(await s.usd.setBlocked(s.addresses[0],false)).wait();await(await s.binary.claim()).wait();await checks();
});
test('deep placement is rejected before funding or consuming a sponsor slot',async()=>{
 let parent=15;
 for(let i=36;i<96;i++){await prepare(i);await register(i,parent,1);parent=i;}
 assert.equal(await s.binary.depth(s.addresses[parent]),64n);await prepare(96);const before=await s.usd.balanceOf(s.addresses[96]),count=await s.binary.memberCount();await fails(()=>s.binary.connect(signers[96]).register(s.addresses[parent],1));assert.equal(await s.usd.balanceOf(s.addresses[96]),before);assert.equal(await s.binary.memberCount(),count);assert.equal((await s.binary.members(s.addresses[parent])).left,'0x0000000000000000000000000000000000000000');
 // No full-depth queue execution is needed to verify the admission bound.
 await checks();
});
