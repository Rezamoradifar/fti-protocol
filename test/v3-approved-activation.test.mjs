import {test} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,MaxUint256,parseEther as E} from 'ethers';
import {loadWallets} from '../scripts/v3-wallets.mjs';
import {deployOne,settle,checkAccounting} from '../scripts/lib.mjs';

// Ganache impersonation uses only local test balances; no real wallet keys.
test('all 31 approved positions activate by normal paid purchases, settle and claim without role membership',async()=>{
const cfg=loadWallets();
const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:12,unlockedAccounts:cfg.genesis},chain:{chainId:31337,time:new Date('2026-10-15T12:00:00Z')},miner:{blockGasLimit:30000000}});
const provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
try {
 const accounts=await provider.listAccounts();
 const deployer=accounts[0];
 const usd=await deployOne('MockUSD',[],deployer);
 const council=await deployOne('SevenGuardianCouncil',[accounts.slice(1,8).map(s=>s.address)],deployer);
 const timelock=await deployOne('FTITimelock',[council.target],deployer);
 const token=await deployOne('FTIReserveTokenV3',[usd.target,timelock.target,council.target],deployer);
 const binary=await deployOne('FundedBinaryPlan',[usd.target,token.target,timelock.target,council.target,cfg.development,cfg.genesis],deployer);
 await(await token.bind(binary.target)).wait();
 const suite={usd,token,binary};
 for (const role of [cfg.owner,cfg.development]) assert.equal(await binary.registered(role),false);
 for(let i=0;i<31;i++) {
   assert.equal((await binary.memberList(i)).toLowerCase(),cfg.genesis[i].toLowerCase());
   assert.equal(await binary.unitsOf(cfg.genesis[i]),0n);
   assert.equal(await binary.activatedAtSerial(cfg.genesis[i]),0n);
 }
 console.log('PASS 31 exact ordered unpaid positions; independent roles excluded');
 const signers=[];
 for(const a of cfg.genesis){await provider.send('evm_setAccountBalance',[a,'0x56bc75e2d63100000']);signers.push(await provider.getSigner(a));}
 for(let i=0;i<31;i++) {
   const s=signers[i];await(await usd.connect(s).faucet()).wait();await(await usd.connect(s).approve(binary.target,MaxUint256)).wait();
   const before=await usd.balanceOf(cfg.genesis[i]);
   await(await binary.connect(s).addUnits(1)).wait();
   assert.equal(before-await usd.balanceOf(cfg.genesis[i]),E('100'));
   assert.equal(await binary.unitsOf(cfg.genesis[i]),1n);
   assert.equal(await binary.activatedAtSerial(cfg.genesis[i]),BigInt(i+1));
   await assert.rejects(()=>binary.connect(s).addUnits.staticCall(0));
 }
 console.log('PASS all 31 approved wallets paid the ordinary 100-unit activation price');
 const normal=accounts[8];await(await usd.connect(normal).faucet()).wait();await(await usd.connect(normal).approve(binary.target,MaxUint256)).wait();
 const before=await usd.balanceOf(normal.address);
 await(await binary.connect(normal).register(cfg.genesis[15],1)).wait();
 assert.equal(before-await usd.balanceOf(normal.address),E('100'));
 assert.equal(await binary.unitsOf(normal.address),1n);
 assert.equal(await binary.activatedAtSerial(normal.address),32n);
 assert.equal(await binary.pendingReward(cfg.development),E('32'));
 assert.equal(await token.supportReserve(),E('160'));
 assert.equal(await token.totalSupply(),0n);
 assert.equal(await binary.pointPool(),E('2880'));
 assert.equal(await binary.builderAccounted(),E('128'));
 await checkAccounting(suite);
 await settle(suite,provider);
 assert.equal(await binary.jobCursor(),await binary.jobCount());
 for(const role of [cfg.owner,cfg.development]){assert.equal(await binary.registered(role),false);assert.equal(await binary.unitsOf(role),0n);}
 assert.equal(await binary.pendingReward(cfg.owner),0n);
 const pending=await binary.pendingReward(cfg.genesis[0]);assert(pending>0n);
 const balance=await usd.balanceOf(cfg.genesis[0]);await(await binary.connect(signers[0]).claim()).wait();
 assert.equal(await usd.balanceOf(cfg.genesis[0])-balance,pending);
 await assert.rejects(()=>binary.connect(signers[0]).claim.staticCall());
 await checkAccounting(suite);
 const out={status:'PASS',environment:'local Ganache only; no real transactions',genesisPaid:31,ordinaryUserPaid:1,unitPrice:'100 test USD',totalPaid:'3200',developmentAllocation:'32',supportAllocation:'160',builderAllocation:'128',pointAllocation:'2880',rootRewardClaimed:pending.toString(),duplicateClaimRejected:true,ownerAndDevelopmentWithoutPositions:true};
 console.log('APPROVED_WALLET_FLOW',JSON.stringify(out));
}finally{provider.destroy();await engine.disconnect()}
});
