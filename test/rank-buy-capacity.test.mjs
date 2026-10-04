import {describe,test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256} from 'ethers';
import {deployOne,settle,checkAccounting} from '../scripts/lib.mjs';
import {deployPaidRankFeatureSuite,deployFeatureBinary,seedPaidRank} from './fixtures/paid-rank-feature-suite.mjs';

const WAD=E('1');
const rankCapacity=[500n,600n,700n,800n,1000n];
const ceilDiv=(a,b)=>(a+b-1n)/b;
async function fails(action){await assert.rejects(async()=>{const tx=await action();await tx.wait();});}
function localEngine(){return ganache.provider({
 logging:{quiet:true},wallet:{totalAccounts:41},
 chain:{chainId:31337,time:new Date('2026-10-04T00:00:00Z')},
 miner:{blockGasLimit:30000000,timestampIncrement:0},
});}

// TEST ONLY: canonical BinaryPlan ranks are seeded with explicit paid-point
// fixtures so these tests isolate capacity, not rank qualification. The separate
// qualification suite covers real funded settlement. FundedBinaryPlan retains its
// historical raw-volume ranks. Membership payments and milestone support below
// are real; this token subclass is only for defensive/large-number boundaries.
// Neither test subclass may be deployed as a protocol contract.
let boundaryArtifact;
function getBoundaryArtifact(){
 if(!boundaryArtifact){
  const source=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {FTIReserveToken} from './FTIReserveToken.sol';
contract TEST_ONLY_RankCapacityToken is FTIReserveToken {
 constructor(address stable,address gov,address emergency) FTIReserveToken(stable,gov,emergency) {}
 function TEST_ONLY_setMultiplier(uint256 value) external {priceMultiplier=value;}
 function TEST_ONLY_setQuoteBoundary(uint256 quotedPrice,uint256 next,uint256 multiplier) external {
  if(totalSupply()==0)_mint(msg.sender,1e18);
  require(totalSupply()==1e18,'isolated boundary fixture only');
  reserve=quotedPrice;milestonePrice=next;priceMultiplier=multiplier;
 }
}`;
  const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'TEST_ONLY_RankCapacityToken.sol':{content:source}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'TEST_ONLY_RankCapacityToken.sol':{'TEST_ONLY_RankCapacityToken':['abi','evm.bytecode.object']}}}}),{
   import:name=>{for(const base of ['contracts','node_modules']){const file=path.join(base,name);if(fs.existsSync(file))return{contents:fs.readFileSync(file,'utf8')};}return{error:`Missing ${name}`};},
  }));
  assert(!output.errors?.some(error=>error.severity==='error'),output.errors?.map(error=>error.formattedMessage).join('\n'));
  boundaryArtifact=output.contracts['TEST_ONLY_RankCapacityToken.sol'].TEST_ONLY_RankCapacityToken;
 }
 return boundaryArtifact;
}
async function deployBoundaryToken(usd,signer,address){
 const a=getBoundaryArtifact();
 const token=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(usd.target,address,address);
 await token.waitForDeployment();return token;
}

for(const binaryContract of ['BinaryPlan','FundedBinaryPlan'])describe(`${binaryContract}: rank-based cumulative capacity${binaryContract==='BinaryPlan'?' (TEST ONLY paid-rank fixtures)':' (historical raw-volume ranks)'}`,()=>{
 let engine,provider,signers,s,snapshot;
 before(async()=>{
  engine=localEngine();provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
  signers=await Promise.all(Array.from({length:41},(_,i)=>provider.getSigner(i)));
  s=await deployPaidRankFeatureSuite(signers,{tokenContract:'FTIReserveToken',binaryContract});
  for(const i of [0,1,2,5,6,30]){
   await(await s.usd.connect(signers[i]).faucet()).wait();
   await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();
   await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();
  }
  snapshot=await provider.send('evm_snapshot',[]);
 });
 beforeEach(async()=>{await provider.send('evm_revert',[snapshot]);snapshot=await provider.send('evm_snapshot',[]);});
 after(async()=>{await engine.disconnect();});

 async function units(i,n,suite=s){
  n=BigInt(n);
  while(await suite.usd.balanceOf(s.addresses[i])<n*E('100'))await(await suite.usd.connect(signers[i]).faucet()).wait();
  return(await suite.binary.connect(signers[i]).addUnits(n)).wait();
 }
 async function buy(amount,i=0,suite=s){return(await suite.token.connect(signers[i]).buy(E(amount),0,MaxUint256)).wait();}
 async function allowance(who,limit,spent,suite=s){
  const remaining=limit>spent?limit-spent:0n;
  assert.equal(await suite.binary.tokenBuyLimit(who),limit,'binary cumulative limit');
  assert.equal(await suite.binary.tokenBuySpent(who),spent,'binary gross lifetime spent');
  assert.equal(await suite.binary.remainingTokenBuyAllowance(who),remaining,'binary remaining capacity');
  assert.equal(await suite.token.buyLimit(who),limit,'token delegates limit');
  assert.equal(await suite.token.lifetimeManualBuys(who),spent,'token delegates spent');
  assert.equal(await suite.token.remainingAllowance(who),remaining,'token delegates remaining');
 }
 async function accounting(suite=s){
  await checkAccounting(suite);
  if(binaryContract==='FundedBinaryPlan'){
   const [pointActual,pointAccounted,builderActual,builderAccounted]=await suite.binary.fundingAccounting();
   assert.equal(pointActual,pointAccounted);assert.equal(builderActual,builderAccounted);
  }
 }
 async function tradeState(suite=s){return{
  spent:await suite.binary.tokenBuySpent(s.addresses[0]),
  reserve:await suite.token.reserve(),unallocated:await suite.token.unallocatedReserve(),supply:await suite.token.totalSupply(),
  userTokens:await suite.token.balanceOf(s.addresses[0]),userUSD:await suite.usd.balanceOf(s.addresses[0]),
  multiplier:await suite.token.priceMultiplier(),milestone:await suite.token.milestonePrice(),
  totalPending:await suite.binary.totalPending(),pointPool:await suite.binary.pointPool(),
 };}

 test('all five rank rates apply to every paid unit; top-ups and rank changes never reset spent',async()=>{
  const who=s.addresses[0];
  await units(0,1);await units(1,99);await units(2,99);await settle(s,provider);
  assert.equal(await s.binary.rankOf(who),0n,'99 units on each branch is below Builder 1');
  await allowance(who,E('500'),0n);
  await buy('500');await allowance(who,E('500'),E('500'));
  await units(0,3); // Member-rank top-up also makes the next settlement eligible (>=5 units).
  await allowance(who,E('2000'),E('500'));
  // Add real circulating liquidity to keep the later raw-volume funding below
  // the fixed $1 milestone and isolate the rank-dependent quota in both plans.
  await buy('1000');
  await allowance(who,E('2000'),E('1500'));
  let paidUnits=4n,spent=E('1500');
  const branchIncrements=[1,100,300,500];
  const thresholds=[100n,200n,500n,1000n];
  for(let rank=1;rank<=4;rank++){
   await units(1,branchIncrements[rank-1]);await units(2,branchIncrements[rank-1]);
   await settle(s,provider);
   const member=await s.binary.members(who);
   assert.equal(member.lifetimeL,thresholds[rank-1]);assert.equal(member.lifetimeR,thresholds[rank-1]);
   if(binaryContract==='BinaryPlan'){
    assert.equal(await s.binary.rankOf(who),BigInt(rank-1),'raw branch thresholds cannot promote the canonical paid-point plan');
    assert((await s.binary.cumulativePaidRankPoints(who))<thresholds[rank-1]);
    await seedPaidRank(s.binary,who,rank);
    assert.equal(await s.binary.cumulativePaidRankPoints(who),thresholds[rank-1],'TEST ONLY explicit paid-rank state');
   }
   assert.equal(await s.binary.rankOf(who),BigInt(rank));
   assert((await s.binary.rankReachedAt(who,rank-1))>0n);
   assert.equal(await s.token.priceMultiplier(),1n,'this fixture isolates rank from price milestones');
   await allowance(who,paidUnits*rankCapacity[rank]*WAD,spent);
   const previousLimit=await s.binary.tokenBuyLimit(who);
   await units(0,1);paidUnits++;
   assert.equal(await s.binary.tokenBuyLimit(who)-previousLimit,rankCapacity[rank]*WAD,'new paid unit uses current rank');
   await buy('100');spent+=E('100');
   await allowance(who,paidUnits*rankCapacity[rank]*WAD,spent);
   await accounting();
  }
  // Empty/ineligible epochs do not demote permanent Builder 4 or reset history.
  await settle(s,provider);await settle(s,provider);
  assert.equal(await s.binary.rankOf(who),4n);
  await allowance(who,E('8000'),E('1900'));
  await accounting();
 });

 test('actual $5 support crosses 10x and 100x launch-price milestones for builders only, globally and automatically',async()=>{
  const root=s.addresses[0],member=s.addresses[30],laterBuilder=s.addresses[2];
  await units(0,1);await units(1,100);await units(2,100);await units(30,1);await settle(s,provider);
  if(binaryContract==='BinaryPlan'){
   assert.equal(await s.binary.rankOf(root),0n,'one real capped settlement does not qualify as Builder 1');
   await seedPaidRank(s.binary,root,1); // TEST ONLY: isolate multiplier eligibility.
  }
  assert.equal(await s.binary.rankOf(root),1n);
  assert.equal(await s.token.totalSupply(),0n);
  assert.equal(await s.token.reserve(),0n);
  const quarantined=E('1010');
  assert.equal(await s.token.unallocatedReserve(),quarantined,'all pre-mint membership support is protected');
  assert.equal(await s.token.launchPrice(),E('0.1'));assert.equal(await s.token.milestonePrice(),E('1'));
  await(await s.token.connect(signers[40]).syncPriceMilestone()).wait();
  assert.equal(await s.token.priceMultiplier(),1n,'support before any mint cannot create a milestone');
  await buy('100');
  const launch=await s.token.launchPrice();
  assert.equal(launch,await s.token.INITIAL_PRICE(),'first buy never resets the fixed $0.10 anchor');
  assert.equal(await s.token.reserve(),E('100'));
  assert.equal(await s.token.totalSupply(),E('970'));
  assert.equal(await s.token.unallocatedReserve(),quarantined,'first buyer cannot capture pre-mint support');
  assert.equal(await s.token.price(),E('100')*WAD/E('970'));
  assert.equal(await s.token.milestonePrice(),launch*10n);
  await accounting();
  await allowance(root,E('600'),E('100'));await allowance(member,E('500'),0n);

  const beforeFailure=await tradeState();
  await(await s.usd.setBlocked(s.token.target,true)).wait();
  await fails(()=>s.token.buy(E('50'),0,MaxUint256,{gasLimit:2000000}));
  assert.deepEqual(await tradeState(),beforeFailure,'collateral failure after authorization rolls back every captured field');
  await(await s.usd.setBlocked(s.token.target,false)).wait();
  const quote=await s.token.quoteBuy(E('50'));
  await fails(()=>s.token.buy(E('50'),quote+1n,MaxUint256));
  await fails(()=>s.token.buy(E('50'),0,0));
  assert.deepEqual(await tradeState(),beforeFailure);

  async function crossNext(expectedMultiplier,expectedMilestone){
   const next=await s.token.milestonePrice(),supply=await s.token.totalSupply(),reserve=await s.token.reserve();
   const requiredReserve=ceilDiv(next*supply,WAD);
   const fundingUnits=ceilDiv(requiredReserve-reserve,E('5'));
   assert(fundingUnits>1n);
   await units(1,fundingUnits-1n);
   assert((await s.token.price())<next,'last whole support unit below the threshold');
   const previous=await s.token.priceMultiplier();
   await(await s.token.connect(signers[40]).syncPriceMilestone()).wait();
   await(await s.token.connect(signers[40]).advancePriceMilestone()).wait();
   assert.equal(await s.token.priceMultiplier(),previous,'permissionless callers cannot force an early increase');
   const receipt=await units(1,1);
   assert.equal(await s.token.totalSupply(),supply,'membership support does not mint FTI');
   assert((await s.token.price())>=next);
   assert.equal(await s.token.priceMultiplier(),expectedMultiplier,'the funding transaction itself latches the increase');
   assert.equal(await s.token.milestonePrice(),expectedMilestone);
   const events=receipt.logs.filter(log=>log.address.toLowerCase()===s.token.target.toLowerCase())
    .map(log=>s.token.interface.parseLog(log)).filter(log=>log?.name==='MultiplierUpdated');
   assert.equal(events.length,1);assert.equal(events[0].args.multiplier,expectedMultiplier);
   await allowance(member,E('500'),0n);
   await allowance(laterBuilder,E('50000'),0n); // Still an ordinary member with 100 paid units.
   await accounting();
  }

  await crossNext(2n,launch*100n);
  await allowance(root,E('1200'),E('100'));
  await buy('1100'); // Newly granted capacity is usable; this exceeds the old $600 total.
  await allowance(root,E('1200'),E('1200'));
  const fullAtTen=await tradeState();
  await fails(()=>s.token.buy(1n,0,MaxUint256));
  assert.deepEqual(await tradeState(),fullAtTen);

  await crossNext(4n,launch*1000n);
  await allowance(root,E('2400'),E('1200'));
  await buy('1200');await allowance(root,E('2400'),E('2400'));
  const fullAtHundred=await tradeState();
  await fails(()=>s.token.buy(E('1'),0,MaxUint256));
  assert.deepEqual(await tradeState(),fullAtHundred);

  // A different wallet becomes a builder AFTER milestones already happened.
  // Its full existing paid-unit history receives the same global 4x multiplier.
  await units(5,100);await units(6,100);await settle(s,provider);
  if(binaryContract==='BinaryPlan'){
   assert.equal(await s.binary.rankOf(laterBuilder),0n,'raw branches do not replace funded paid-rank qualification');
   assert.equal(await s.binary.rankOf(root),1n);
   await seedPaidRank(s.binary,laterBuilder,1);
   await seedPaidRank(s.binary,root,2);
  }
  assert.equal(await s.binary.rankOf(laterBuilder),1n);
  await allowance(laterBuilder,E('240000'),0n);
  assert.equal(await s.binary.rankOf(root),2n);
  await allowance(root,E('2800'),E('2400'));
  await allowance(member,E('500'),0n);
  await buy('400');await allowance(root,E('2800'),E('2800'));

  const multiplier=await s.token.priceMultiplier();
  await(await s.token.sell(E('1'),0,MaxUint256)).wait();
  await(await s.token.transfer(s.addresses[40],E('1'))).wait();
  await(await s.token.connect(signers[40]).syncPriceMilestone()).wait();
  await(await s.token.connect(signers[40]).advancePriceMilestone()).wait();
  assert.equal(await s.token.priceMultiplier(),multiplier);
  await allowance(root,E('2800'),E('2800'));
  await allowance(s.addresses[40],0n,0n);
  await allowance(member,E('500'),0n);
  await accounting();
 });

 test('TEST ONLY defensive lowered-limit state saturates remaining allowance instead of underflowing or restoring spent',async()=>{
  const token=await deployBoundaryToken(s.usd,signers[0],s.addresses[0]);
  const binary=await deployFeatureBinary(binaryContract,[s.usd.target,token.target,s.addresses[0],s.addresses[0],s.addresses[35],s.addresses.slice(0,31)],signers[0]);
  const suite={usd:s.usd,token,binary,addresses:s.addresses};
  await(await token.bind(binary.target)).wait();
  for(const i of [0,1,2])await(await s.usd.connect(signers[i]).approve(binary.target,MaxUint256)).wait();
  await(await s.usd.approve(token.target,MaxUint256)).wait();
  await units(0,1,suite);await units(1,100,suite);await units(2,100,suite);await settle(suite,provider);
  if(binaryContract==='BinaryPlan')await seedPaidRank(binary,s.addresses[0],1);
  assert.equal(await binary.rankOf(s.addresses[0]),1n);
  await buy('600',0,suite);
  await(await token.TEST_ONLY_setMultiplier(2)).wait();
  await buy('600',0,suite);await allowance(s.addresses[0],E('1200'),E('1200'),suite);
  // Production multiplier never decreases. This deliberately models a hostile
  // or future-incompatible token response, rather than a reachable rank change.
  await(await token.TEST_ONLY_setMultiplier(1)).wait();
  await allowance(s.addresses[0],E('600'),E('1200'),suite);
  const old=await tradeState(suite);
  await fails(()=>token.buy(E('1'),0,MaxUint256,{gasLimit:2000000}));
  assert.deepEqual(await tradeState(suite),old);
  await allowance(s.addresses[0],E('600'),E('1200'),suite);
  await accounting(suite);
 });
});

test('TEST ONLY milestone arithmetic: exact inclusive boundaries, multi-decade catch-up, falling quote, and existing 1024 cap',async()=>{
 const engine=localEngine(),provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 try{
  const signer=await provider.getSigner(0),outsider=await provider.getSigner(40),address=await signer.getAddress();
  const usd=await deployOne('MockUSD',[],signer),token=await deployBoundaryToken(usd,signer,address);
  const seed=async(p,next,multiplier)=>{await(await token.TEST_ONLY_setQuoteBoundary(p,next,multiplier)).wait();};
  const sync=async()=>{await(await token.connect(outsider).syncPriceMilestone()).wait();};
  assert.equal(await token.launchPrice(),E('0.1'));
  assert.equal(await token.milestonePrice(),WAD);
  await sync();
  assert.equal(await token.priceMultiplier(),1n,'zero supply cannot qualify despite the fixed launch anchor');
  await seed(WAD-1n,WAD,1n);await sync();
  assert.equal(await token.priceMultiplier(),1n,'one price atom below does not qualify');
  assert.equal(await token.milestonePrice(),WAD);
  await seed(WAD,WAD,1n);await sync();
  assert.equal(await token.priceMultiplier(),2n,'the exact $1 threshold qualifies');
  assert.equal(await token.milestonePrice(),E('10'));
  await seed(WAD*10n**7n,WAD,1n);await sync();
  assert.equal(await token.priceMultiplier(),256n,'all crossed decades are caught up in one call');
  assert.equal(await token.milestonePrice(),WAD*10n**8n);
  await seed(WAD,await token.milestonePrice(),await token.priceMultiplier());await sync();
  assert.equal(await token.priceMultiplier(),256n,'a lower quote cannot undo a latched milestone');
  assert.equal(await token.milestonePrice(),WAD*10n**8n);
  await seed(WAD,WAD,1n);
  for(let decade=0n;decade<10n;decade++){
   await seed(WAD*10n**decade,await token.milestonePrice(),await token.priceMultiplier());await sync();
   assert.equal(await token.priceMultiplier(),2n**(decade+1n));
   assert.equal(await token.milestonePrice(),WAD*10n**(decade+1n));
  }
  const cappedMilestone=await token.milestonePrice();
  await seed(WAD*10n**12n,cappedMilestone,1024n);await sync();
  await(await token.connect(outsider).advancePriceMilestone()).wait();
  assert.equal(await token.priceMultiplier(),1024n,'existing protocol ceiling is retained');
  assert.equal(await token.milestonePrice(),cappedMilestone);
 }finally{await engine.disconnect();}
});
