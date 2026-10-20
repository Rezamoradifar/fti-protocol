import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,Contract,MaxUint256} from 'ethers';
import {deployOne,artifact,checkAccounting} from '../scripts/lib.mjs';
import {firstOpenSlot} from '../core/referral-placement.mjs';

const sent=async tx=>{const receipt=await(await tx).wait();assert.equal(receipt.status,1);return receipt;};

test('proxy referrals: unlimited direct invitations, bounded ancestry, unchanged financed binary tree',{timeout:240000},async()=>{
 const engine=ganache.provider({chain:{chainId:31337},logging:{quiet:true},wallet:{totalAccounts:60},miner:{blockGasLimit:30000000}});
 const provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});provider.pollingInterval=20;
 try{
  const signers=await Promise.all(Array.from({length:60},(_,i)=>provider.getSigner(i))),addresses=await Promise.all(signers.map(s=>s.getAddress()));
  const usd=await deployOne('MockUSD',[],signers[0]);
  const council=await deployOne('SevenGuardianCouncil',[addresses.slice(31,38)],signers[0]);
  const timelock=await deployOne('FTITimelock',[council.target],signers[0]);
  const tokenImpl=await deployOne('FTIReserveTokenUpgradeable',[],signers[0]);
  const tokenProxy=await deployOne('FTIProxy',[tokenImpl.target,tokenImpl.interface.encodeFunctionData('initialize',[usd.target,timelock.target,council.target])],signers[0]);
  const token=new Contract(tokenProxy.target,artifact('FTIReserveTokenUpgradeable').abi,signers[0]);
  const binaryImpl=await deployOne('FundedBinaryPlanUpgradeable',[],signers[0]);
  const binaryProxy=await deployOne('FTIProxy',[binaryImpl.target,binaryImpl.interface.encodeFunctionData('initialize',[usd.target,token.target,timelock.target,council.target,addresses[38],addresses.slice(0,31)])],signers[0]);
  const binary=new Contract(binaryProxy.target,artifact('FundedBinaryPlanUpgradeable').abi,signers[0]);
  await sent(token.bind(binary.target));
  // Position 24 is a terminal leaf in the approved six-row genesis.
  const invite=addresses[23],participants=addresses.slice(39,49);
  for(let i=39;i<49;i++){
   await sent(usd.connect(signers[i]).faucet());
   await sent(usd.connect(signers[i]).approve(binary.target,MaxUint256));
  }
  for(let i=0;i<2;i++){
   const w=signers[39+i];await sent(binary.connect(w).register(invite,1));
   assert.equal(await binary.directReferrerOf(addresses[39+i]),invite);
  }
  const sponsorMember=await binary.members(invite);
  assert.equal(sponsorMember.left,participants[0]);assert.equal(sponsorMember.right,participants[1]);
  await assert.rejects(binary.connect(signers[41]).register.staticCall(invite,1));
  for(let i=41;i<49;i++){
   const target=addresses[i],placement=await firstOpenSlot(invite,a=>binary.members(a));
   await assert.rejects(binary.connect(signers[i]).registerWithPlacement.staticCall(invite,addresses[29],1),/InvalidOperation|execution reverted/);
   const receipt=await sent(binary.connect(signers[i]).registerWithPlacement(invite,placement.placementParent,1));
   assert.equal((await binary.members(target)).parent,placement.placementParent);
   assert.equal(await binary.directReferrerOf(target),invite);
   const log=receipt.logs.map(log=>{try{return binary.interface.parseLog(log);}catch{return null;}}).find(l=>l?.name==='ReferralPlacement');
   assert(log);assert.equal(log.args.referrer,invite);assert.equal(log.args.placementParent,placement.placementParent);
   const [actual,book]=await binary.accounting();assert(actual>=book,'binary collateral remains backed');
  }
  assert.equal(await binary.memberCount(),41n);
  assert.equal(await binary.directReferralCount(invite),10n);
  assert.equal((await binary.members(invite)).left,participants[0]);
  assert.equal((await binary.members(invite)).right,participants[1]);
  await assert.rejects(binary.connect(signers[39]).registerWithPlacement.staticCall(invite,addresses[43],1));
  await assert.rejects(binary.connect(signers[50]).registerWithPlacement.staticCall(invite,addresses[29],1));
  await assert.rejects(binary.connect(signers[50]).registerWithPlacement.staticCall(addresses[55],participants[0],1));
  await sent(binary.processVolume(100));
  await checkAccounting({usd,token,binary});
  console.log('FTI_REFERRAL_AUTO_LOCAL_TEST',JSON.stringify({scope:'LOCAL_GANACHE_ONLY',directInvites:10,genesisPositions:31,memberCount:41,binaryDepthUnchanged:true,collateralBacked:true,result:'PASS'}));
 }finally{await engine.disconnect();}
});
