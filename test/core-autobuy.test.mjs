// Historical FTIToken regression paired with current BinaryPlan. Token locks/curve
// remain historical; auto setting, timing, immediate mint and retry use current policy.
import {deployPaidRankFeatureSuite,seedPaidRank} from './fixtures/paid-rank-feature-suite.mjs';
import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,MaxUint256} from 'ethers';
import {settle,checkAccounting} from '../scripts/lib.mjs';
let engine,p,signers,s,snapshot;
before(async()=>{
 engine=ganache.provider({logging:{quiet:true},chain:{chainId:31337,time:new Date('2026-09-15T12:00:00Z')},wallet:{totalAccounts:45},miner:{blockGasLimit:30000000}});
 p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));s=await deployPaidRankFeatureSuite(signers);
 for(const i of [0,1,2]){await(await s.usd.connect(signers[i]).faucet()).wait();await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();}
 for(const[i,n]of [[0,1],[1,100],[2,100]])await(await s.binary.connect(signers[i]).addUnits(n)).wait();await settle(s,p);
 // TEST ONLY paid-rank fixture for authorization/price/queue feature coverage.
 await seedPaidRank(s.binary,s.addresses[0],1);
 await(await s.binary.setAutoBuy(true)).wait();for(const i of [1,2])await(await s.binary.connect(signers[i]).addUnits(5)).wait();
 // Exercise pending retry through an actual failed immediate collateral transfer.
 await(await s.usd.setBlocked(s.token.target,true)).wait();await settle(s,p);await(await s.usd.setBlocked(s.token.target,false)).wait();
 assert.equal(await s.binary.pendingAuto(s.addresses[0]),E('45'));snapshot=await p.send('evm_snapshot',[]);
});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{await engine.disconnect();});
async function fails(fn){await assert.rejects(async()=>{const tx=await fn();await tx.wait();});}
async function unchangedAuto(fn){const before=await s.binary.pendingAuto(s.addresses[0]),total=await s.binary.totalAuto(),balance=await s.token.balanceOf(s.addresses[0]);await fails(fn);assert.equal(await s.binary.pendingAuto(s.addresses[0]),before);assert.equal(await s.binary.totalAuto(),total);assert.equal(await s.token.balanceOf(s.addresses[0]),balance);await checkAccounting(s);}
test('a stranger cannot fragment a beneficiary pending reward into dust locks',async()=>{
 await unchangedAuto(()=>s.binary.connect(signers[44]).executeAuto(s.addresses[0],E('0.000001')));
 assert.equal((await s.token.lockInfo(s.addresses[0])).length,0);
 // Rejection leaves manual purchases available, rather than filling lock slots.
 await(await s.token.buy(E('10'),0,MaxUint256)).wait();assert.equal((await s.token.lockInfo(s.addresses[0])).length,1);await checkAccounting(s);
});
test('the beneficiary may intentionally choose a partial auto purchase',async()=>{
 await(await s.binary.executeAuto(s.addresses[0],E('5'))).wait();assert.equal(await s.binary.pendingAuto(s.addresses[0]),E('40'));assert.equal((await s.token.lockInfo(s.addresses[0])).length,1);await checkAccounting(s);
});
test('an unrelated keeper can execute the complete pending amount only for its owner',async()=>{
 const attackerUSD=await s.usd.balanceOf(s.addresses[44]);await(await s.binary.connect(signers[44]).executeAuto(s.addresses[0],E('45'))).wait();
 assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);assert.equal(await s.token.balanceOf(s.addresses[44]),0n);assert.equal(await s.usd.balanceOf(s.addresses[44]),attackerUSD);assert((await s.token.balanceOf(s.addresses[0]))>0n);await checkAccounting(s);
});
test('disabling auto-buy revokes keeper execution and preserves cash release',async()=>{
 await(await s.binary.setAutoBuy(false)).wait();await unchangedAuto(()=>s.binary.connect(signers[44]).executeAuto(s.addresses[0],E('45')));
 const cash=await s.binary.pendingReward(s.addresses[0]);await(await s.binary.releaseAutoToCash()).wait();assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);assert.equal(await s.binary.pendingReward(s.addresses[0]),cash+E('45'));await checkAccounting(s);
});
test('current Binary has no user maximum-price ABI and retries the full current quote',async()=>{
 assert.equal(s.binary.interface.hasFunction('setAutoBuy(bool,uint256)'),false);
 assert.equal(s.binary.interface.hasFunction('setAutoBuy(bool)'),true);
 const quote=await s.token.quoteBuy(E('45')),before=await s.token.balanceOf(s.addresses[0]);
 await(await s.binary.connect(signers[44]).executeAuto(s.addresses[0],E('45'))).wait();
 assert.equal(await s.token.balanceOf(s.addresses[0])-before,quote);
 assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);await checkAccounting(s);
});
test('a pending retry reprices after intervening manual trading without a user price ceiling',async()=>{
 const amount=E('45'),oldQuote=await s.token.quoteBuy(amount);
 await(await s.token.connect(signers[1]).buy(E('100'),0,MaxUint256)).wait();
 const quote=await s.token.quoteBuy(amount);assert(quote<oldQuote);
 const before=await s.token.balanceOf(s.addresses[0]),spent=await s.token.lifetimeManualBuys(s.addresses[0]);
 await(await s.binary.connect(signers[44]).executeAuto(s.addresses[0],amount)).wait();
 assert.equal(await s.token.balanceOf(s.addresses[0])-before,quote);
 assert.equal(await s.token.lifetimeManualBuys(s.addresses[0]),spent);
 assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);await checkAccounting(s);
});
test('a failed collateral transfer restores pending balances and all token state',async()=>{
 await(await s.usd.setBlocked(s.token.target,true)).wait();await unchangedAuto(()=>s.binary.connect(signers[44]).executeAuto(s.addresses[0],E('45')));
 assert.equal((await s.token.lockInfo(s.addresses[0])).length,0);await(await s.usd.setBlocked(s.token.target,false)).wait();await(await s.binary.connect(signers[44]).executeAuto(s.addresses[0],E('45'))).wait();await checkAccounting(s);
});
test('release cannot be repeated to create cash or leave an executable stale auto balance',async()=>{
 await(await s.binary.releaseAutoToCash()).wait();const cash=await s.binary.pendingReward(s.addresses[0]);await(await s.binary.releaseAutoToCash()).wait();assert.equal(await s.binary.pendingReward(s.addresses[0]),cash);
 await unchangedAuto(()=>s.binary.connect(signers[44]).executeAuto(s.addresses[0],E('45')));await checkAccounting(s);
});
