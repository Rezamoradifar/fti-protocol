import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256} from 'ethers';
import {deployOne} from '../scripts/lib.mjs';
let engine,p,signers,usd,token,binary,addresses,snapshot;
before(async()=>{
 const sources={'ClockReserveToken.sol':{content:fs.readFileSync('test/fixtures/ClockReserveToken.sol','utf8')},'FTIReserveToken.sol':{content:fs.readFileSync('contracts/FTIReserveToken.sol','utf8')}};
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:path=>({contents:fs.readFileSync('node_modules/'+path,'utf8')})}));assert(!output.errors?.some(e=>e.severity==='error'),JSON.stringify(output.errors));const a=output.contracts['ClockReserveToken.sol'].ClockReserveToken;
 engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:36},chain:{chainId:31337,time:new Date('2026-09-15T12:00:00Z')},miner:{blockGasLimit:30000000}});p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;signers=await Promise.all(Array.from({length:36},(_,i)=>p.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 usd=await deployOne('MockUSD',[],signers[0]);token=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(usd.target,addresses[0],addresses[0]);await token.waitForDeployment();binary=await deployOne('FundedBinaryPlan',[usd.target,token.target,addresses[0],addresses[0],addresses[35],addresses.slice(0,31)],signers[0]);await(await token.bind(binary.target)).wait();
 await(await usd.faucet()).wait();await(await usd.approve(binary.target,MaxUint256)).wait();await(await usd.approve(token.target,MaxUint256)).wait();await(await binary.addUnits(5)).wait();snapshot=await p.send('evm_snapshot',[]);
});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{await engine.disconnect();});
async function advance(seconds){await p.send('evm_increaseTime',[seconds]);await p.send('evm_mine',[]);}
async function buy(amount,records,vest=false){await advance(2);const m=await token.quoteBuy(amount),clock=await token.walletClock();const receipt=await(await token.buy(amount,m,MaxUint256)).wait();const block=await p.getBlock(receipt.blockNumber);if(vest){const part=m/4n;for(let i=0;i<4;i++)records.push({amount:i===3?m-3n*part:part,clock:clock+20000n+8000n*BigInt(i),deadline:block.timestamp+90*86400});}else records.push({amount:m,clock:clock+5000n,deadline:block.timestamp+30*86400});}
async function check(records){const clock=await token.walletClock(),now=(await p.getBlock('latest')).timestamp;const live=records.filter(r=>clock<r.clock&&now<r.deadline),expected=live.reduce((a,r)=>a+r.amount,0n);assert.equal(await token.locked(addresses[0]),expected);assert.equal(await token.unlocked(addresses[0]),(await token.balanceOf(addresses[0]))-expected);let sum=0n;const count=Number(await token.lockCount(addresses[0]));for(let offset=0;offset<count;offset+=64){const page=await token.lockPage(addresses[0],offset,64);assert(page.length<=64);for(const row of page)sum+=row.amount;}assert.equal(sum,expected);assert.equal((await token.lockPage(addresses[0],count+1,64)).length,0);return count;}
test('more than 64 live purchases remain possible with exact deadlines and bounded lock pages',async()=>{
 const records=[];for(let i=0;i<80;i++)await buy(E('1'),records);const count=await check(records);assert(count>64);assert.equal((await token.lockInfo(addresses[0])).length,64);assert.equal(await token.unlocked(addresses[0]),0n);
 const gas=await token.locked.estimateGas(addresses[0]);assert(gas<200000n);await advance(31*86400);assert.equal(await check(records),0);const balance=await token.balanceOf(addresses[0]);await(await token.sell(balance,0,MaxUint256)).wait();assert.equal(await token.circulatingSupply(),0n);console.log('LOCK_QUEUE_80',JSON.stringify({liveCheckpoints:count,lockedReadGas:String(gas),fullExit:true}));
});
test('mixed holding and four vesting queues preserve both OR-unlock boundaries after hundreds of tranches',async()=>{
 const records=[];await buy(E('100'),records);await buy(E('400'),records,true);for(let i=0;i<65;i++)await buy(E('1'),records,true);assert((await check(records))>250);
 for(const clock of [4999,5000,19999,20000,28000,36000]){await(await token.advanceTestClock(clock)).wait();await check(records);}
 // The remaining stage is still clock-locked; the original 90-day deadline must release it exactly.
 const last=Math.max(...records.map(r=>r.deadline));await p.send('evm_mine',[last-1]);assert.equal((await p.getBlock('latest')).timestamp,last-1);await check(records);assert((await token.locked(addresses[0]))>0n);await p.send('evm_mine',[last]);await check(records);assert.equal(await token.locked(addresses[0]),0n);assert((await token.locked.estimateGas(addresses[0]))<200000n);
 console.log('LOCK_QUEUE_MIXED',JSON.stringify({issuedTranches:records.length,clockBoundaries:6,timeDeadline:'unchanged',clockSource:'test-only monotone clock harness'}));
});
test('a registration counter outside the encoded deadline range cannot wrap a fresh lock',async()=>{
 await(await token.advanceTestClock(2n**64n-44000n)).wait();await assert.rejects(token.buy(E('1'),0,MaxUint256));assert.equal(await token.circulatingSupply(),0n);
});
