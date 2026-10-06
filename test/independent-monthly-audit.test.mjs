import {test} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,MaxUint256,parseEther as E} from 'ethers';
import {deployPaidRankFeatureSuite,seedPaidRank} from './fixtures/paid-rank-feature-suite.mjs';
import {settle,checkAccounting} from '../scripts/lib.mjs';
const tx=async p=>(await p).wait();
async function month(s,p){const key=Number(await s.binary.nextBuilderMonth()),end=Date.UTC(Math.floor(key/12),key%12+1,1)/1000;const b=await p.getBlock('latest');await p.send('evm_increaseTime',[Math.max(0,end-b.timestamp+1)]);await p.send('evm_mine',[]);await settle(s,p);await tx(s.binary.beginBuilderMonth());while(await s.binary.monthPhase()>0n)await tx(s.binary.processBuilderMonth(100,{gasLimit:12000000}));await checkAccounting(s);}
for(const n of [1,6])test(`independent current pair: ${n} TEST_ONLY tier-four builders enforce each tier's 20% cap and lifetime one-time award`,async()=>{
 const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:45,deterministic:true},chain:{chainId:31337,time:new Date('2026-10-06T00:00:00Z')},miner:{blockGasLimit:30000000,timestampIncrement:0}});const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 try{
 const signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));const s=await deployPaidRankFeatureSuite(signers,{tokenContract:'FTIRetirementReviewToken',binaryContract:'BinaryPlan'});
 for(let i=0;i<n;i++){await tx(s.usd.connect(signers[i]).faucet());await tx(s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256));await tx(s.binary.connect(signers[i]).addUnits(n===1?5:1));await seedPaidRank(s.binary,s.addresses[i],4);}
 const totalUnits=BigInt(n===1?5:n),parts=[E('1.6'),E('1.2'),E('0.8'),E('0.4')];await settle(s,p);
 const before=await Promise.all(s.addresses.slice(0,n).map(a=>s.binary.pendingReward(a)));await month(s,p);
 let each=0n;for(let tier=0;tier<4;tier++){const pool=totalUnits*parts[tier],award=pool/BigInt(n)<pool/5n?pool/BigInt(n):pool/5n;each+=award;assert.equal(await s.binary.builderCarry(tier),pool-award*BigInt(n));for(let i=0;i<n;i++)assert.equal(await s.binary.builderClaimed(s.addresses[i],tier),true);}
 for(let i=0;i<n;i++)assert.equal(await s.binary.pendingReward(s.addresses[i])-before[i],each);
 const earned=await Promise.all(s.addresses.slice(0,n).map(a=>s.binary.pendingReward(a)));const accounted=await s.binary.builderAccounted();await month(s,p);
 for(let i=0;i<n;i++)assert.equal(await s.binary.pendingReward(s.addresses[i]),earned[i]);assert.equal(await s.binary.builderAccounted(),accounted);await checkAccounting(s);
 }finally{await engine.disconnect();}
});
