import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,MaxUint256} from 'ethers';
import {deploySuite,checkAccounting} from '../scripts/lib.mjs';

let engine,p,signers,s,snapshot;
before(async()=>{
 engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:60},chain:{chainId:31337,time:new Date('2026-10-04T00:00:00Z')},miner:{blockGasLimit:30000000}});
 p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 signers=await Promise.all(Array.from({length:60},(_,i)=>p.getSigner(i)));
 s=await deploySuite(signers,{tokenContract:'FTIReserveToken',binaryContract:'FundedBinaryPlan'});
 for(const i of [0,1]){
   await(await s.usd.connect(signers[i]).faucet()).wait();
   await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();
   await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();
 }
 await(await s.binary.addUnits(1)).wait();
 snapshot=await p.send('evm_snapshot',[]);
});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{await engine.disconnect();});

async function fails(fn){await assert.rejects(async()=>{const tx=await fn();await tx.wait();});}

test('repeated purchases create no time or wallet-count locks',async()=>{
 for(let i=0;i<80;i++)await(await s.token.buy(E('1'),0,MaxUint256)).wait();
 const bal=await s.token.balanceOf(s.addresses[0]);
 assert(bal>0n);
 assert.equal(await s.token.locked(s.addresses[0]),0n);
 assert.equal(await s.token.unlocked(s.addresses[0]),bal);
 assert.equal(await s.token.lockCount(s.addresses[0]),0n);
 assert.equal((await s.token.lockInfo(s.addresses[0])).length,0);
 assert.equal((await s.token.lockPage(s.addresses[0],0,64)).length,0);
 await checkAccounting(s);
});

test('user minOut replaces vesting as the immediate buy/sell execution guard',async()=>{
 const q=await s.token.quoteBuy(E('100'));
 await fails(()=>s.token.buy(E('100'),q+1n,MaxUint256));
 await(await s.token.buy(E('100'),q,MaxUint256)).wait();
 const [out]=await s.token.quoteSell(E('1'));
 await fails(()=>s.token.sell(E('1'),out+1n,MaxUint256));
 const before=await s.usd.balanceOf(s.addresses[0]);
 await(await s.token.sell(E('1'),out,MaxUint256)).wait();
 assert((await s.usd.balanceOf(s.addresses[0]))>before);
 await checkAccounting(s);
});

test('anti-whale guard rejects a sudden oversized normal redemption without locking the wallet',async()=>{
 await(await s.token.buy(E('100'),0,MaxUint256)).wait();
 assert.equal(await s.token.locked(s.addresses[0]),0n);
 assert((await s.token.sellImpactBps(E('2')))>0n);
 await fails(()=>s.token.sell(E('6'),0,MaxUint256));
 // A smaller redemption is still immediately available.
 await(await s.token.sell(E('4'),0,MaxUint256)).wait();
 await checkAccounting(s);
});
