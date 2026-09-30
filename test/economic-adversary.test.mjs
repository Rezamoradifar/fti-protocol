import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,MaxUint256,formatEther} from 'ethers';
import {deploySuite,settle,checkAccounting} from '../scripts/lib.mjs';
let engine,p,signers,s,snapshot;
before(async()=>{
 engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:45},chain:{chainId:31337},miner:{blockGasLimit:30000000}});
 p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));s=await deploySuite(signers);
 for(const i of [15,30,36,37,38]){await(await s.usd.connect(signers[i]).faucet()).wait();await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();}
 snapshot=await p.send('evm_snapshot',[]);
});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{await engine.disconnect();});
async function selfTree(){
 await(await s.binary.connect(signers[36]).register(s.addresses[15],1)).wait();
 await(await s.binary.connect(signers[37]).register(s.addresses[36],2)).wait();
 await(await s.binary.connect(signers[38]).register(s.addresses[36],2)).wait();
 await settle(s,p);
}
test('economic baseline: a self-funded three-wallet tree recovers 450 of 500 USD without outside pool',async()=>{
 await selfTree();assert.equal(await s.binary.pendingReward(s.addresses[36]),E('450'));
 assert.equal(await s.binary.paidPoints(1,s.addresses[36]),2n);await checkAccounting(s);
});
test('economic finding: a 500 USD self-controlled subtree captures 9450 USD from an unmatched carried pool',async()=>{
 await(await s.binary.connect(signers[30]).addUnits(100)).wait();await settle(s,p);
 assert.equal(await s.binary.pointPool(),E('9000'));
 const before=await s.usd.balanceOf(s.addresses[36]);
 await selfTree();const reward=await s.binary.pendingReward(s.addresses[36]);
 assert.equal(reward,E('9450'));assert.equal(await s.binary.paidPoints(2,s.addresses[36]),2n);
 await(await s.binary.connect(signers[36]).claim()).wait();
 assert.equal(await s.usd.balanceOf(s.addresses[36]),before-E('100')+reward);
 await checkAccounting(s);
 console.log('CONFIRMED carried-pool capture: group cost=500, payout=9450, group net=8950 test USD before gas; no accounting insolvency');
});
test('economic finding: splitting the same unlocked balance lowers whale fees and raises proceeds',async()=>{
 await(await s.binary.connect(signers[15]).addUnits(1)).wait();
 await(await s.token.connect(signers[15]).buy(E('400'),0,MaxUint256)).wait();
 await p.send('evm_increaseTime',[31*86400]);await p.send('evm_mine',[]);
 const balance=await s.token.balanceOf(s.addresses[15]);const initial=await s.usd.balanceOf(s.addresses[15]);
 const [,wholeFee]=await s.token.quoteSell(balance);const snap=await p.send('evm_snapshot',[]);
 await(await s.token.connect(signers[15]).sell(balance,0,MaxUint256)).wait();const whole=(await s.usd.balanceOf(s.addresses[15]))-initial;
 await p.send('evm_revert',[snap]);
 for(let i=0;i<10;i++){const amount=i===9?await s.token.balanceOf(s.addresses[15]):balance/10n;const [,fee]=await s.token.quoteSell(amount);assert.equal(fee,300n);await(await s.token.connect(signers[15]).sell(amount,0,MaxUint256)).wait();}
 const split=(await s.usd.balanceOf(s.addresses[15]))-initial;
 assert(wholeFee>300n);assert(split>whole);await checkAccounting(s);
 console.log('CONFIRMED sale splitting:',JSON.stringify({wholeFeeBps:wholeFee.toString(),wholeNet:formatEther(whole),splitNet:formatEther(split)}));
});
