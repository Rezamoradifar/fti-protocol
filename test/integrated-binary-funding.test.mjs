import {deployPaidRankFeatureSuite,seedPaidRank} from './fixtures/paid-rank-feature-suite.mjs';
import {describe,test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,formatEther as F,MaxUint256} from 'ethers';
import {deployOne,settle,checkAccounting} from '../scripts/lib.mjs';

// Local integration evidence, not an approval of reserve ownership or allocation.
// Zero-supply support is quarantined; the explicit regression below proves the
// first sole holder cannot capture it. Its eventual ownership remains unresolved.
// Only the auto-buy feature uses a TEST ONLY paid-rank setup for canonical BinaryPlan.
let hostileArtifact;
function getHostileArtifact(){
 if(!hostileArtifact){
  const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'HostileUSD.sol':{content:fs.readFileSync('test/fixtures/HostileUSD.sol','utf8')}},settings:{evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:path=>({contents:fs.readFileSync('node_modules/'+path,'utf8')})}));
  assert(!output.errors?.some(error=>error.severity==='error'));
  hostileArtifact=output.contracts['HostileUSD.sol'].HostileUSD;
 }
 return hostileArtifact;
}
async function fails(action){await assert.rejects(async()=>{const tx=await action();await tx.wait();});}
const financialFields=['pointPool','builderAccounted','totalPending','totalAuto'];
const creditFields=['queuedPointCredit','assignedPointCredit','retainedPointReserve','queuedBuilderCredit','assignedBuilderCredit','retainedBuilderReserve'];

for(const binaryContract of ['BinaryPlan','FundedBinaryPlan'])describe(`${binaryContract}: integrated experimental reserve funding`,()=>{
 let engine,provider,signers,s,snapshot;
 const funded=binaryContract==='FundedBinaryPlan';
 before(async()=>{
  // Keep integration transactions deterministic. Decay-cost changes between gas
  // estimation and mining are covered explicitly below with an advanced clock.
  engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:45},chain:{chainId:31337,time:new Date('2026-10-04T00:00:00Z')},miner:{blockGasLimit:30000000,timestampIncrement:0}});
  provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
  signers=await Promise.all(Array.from({length:45},(_,i)=>provider.getSigner(i)));
  s=await deployPaidRankFeatureSuite(signers,{tokenContract:'FTIReserveToken',binaryContract});
  for(const i of [...Array(10).keys(),41]){
   await(await s.usd.connect(signers[i]).faucet()).wait();
   await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();
   await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();
  }
  snapshot=await provider.send('evm_snapshot',[]);
 });
 beforeEach(async()=>{await provider.send('evm_revert',[snapshot]);snapshot=await provider.send('evm_snapshot',[]);});
 after(async()=>{await engine.disconnect();});

 async function checks(suite=s){
  await checkAccounting(suite);
  assert.equal(await suite.token.buybackFund(),0n,'there is no separate token buyback bucket');
  assert.equal(await suite.token.floorFund(),0n,'there is no separate token floor bucket');
  if(funded){const[a,b,c,d]=await suite.binary.fundingAccounting();assert.equal(a,b,'point credit partitions');assert.equal(c,d,'builder credit partitions');}
 }
 async function allowance(who,limit,spent,suite=s){
  assert.equal(await suite.binary.tokenBuyLimit(who),limit);
  assert.equal(await suite.binary.tokenBuySpent(who),spent);
  assert.equal(await suite.binary.remainingTokenBuyAllowance(who),limit-spent);
  assert.equal(await suite.token.buyLimit(who),limit);
  assert.equal(await suite.token.lifetimeManualBuys(who),spent);
  assert.equal(await suite.token.remainingAllowance(who),limit-spent);
 }
 async function units(i,n){return(await s.binary.connect(signers[i]).addUnits(n)).wait();}
 async function buy(amount,i=0){return(await s.token.connect(signers[i]).buy(E(amount),0,MaxUint256)).wait();}
 async function binaryCash(suite=s){
  const names=[...financialFields,...(funded?creditFields:[])];
  return Object.fromEntries(await Promise.all([
   ...names.map(async name=>[name,await suite.binary[name]()]),
   (async()=>['actual',await suite.usd.balanceOf(suite.binary.target)])(),
   ...[0,1,2,35,41].map(async i=>[`reward${i}`,await suite.binary.pendingReward(s.addresses[i])]),
   ...[0,1,2,35,41].map(async i=>[`auto${i}`,await suite.binary.pendingAuto(s.addresses[i])]),
  ]));
 }
 async function tradeState(suite=s){
  return{binary:await binaryCash(suite),reserve:await suite.token.reserve(),unallocatedReserve:await suite.token.unallocatedReserve(),supply:await suite.token.totalSupply(),actual:await suite.usd.balanceOf(suite.token.target),spent:await suite.binary.tokenBuySpent(s.addresses[0]),userTokens:await suite.token.balanceOf(s.addresses[0]),userCash:await suite.usd.balanceOf(s.addresses[0]),closed:await suite.token.lifecycleClosed(),reference:await suite.token.referencePrice(),pressure:await suite.token.pressureWad(),lastPartial:await suite.token.lastPartialSellAt()};
 }

 test('$100 paid registration and each top-up protect $5 actual cash while zero supply, without any mint',async()=>{
  const user=s.addresses[41],beforeCash=await s.usd.balanceOf(user);
  const registration=await(await s.binary.connect(signers[41]).register(s.addresses[15],1)).wait();
  assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.unallocatedReserve(),E('5'));
  assert.equal(await s.usd.balanceOf(s.token.target),E('5'));
  assert.equal(await s.usd.balanceOf(s.binary.target),E('95'));
  assert.equal(await s.token.totalSupply(),0n);
  assert.equal(await s.token.walletClock(),1n);
  await allowance(user,E('500'),0n);
  const topup=await units(41,2);
  assert.equal(beforeCash-await s.usd.balanceOf(user),E('300'));
  assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.unallocatedReserve(),E('15'));
  assert.equal(await s.usd.balanceOf(s.token.target),E('15'));
  assert.equal(await s.usd.balanceOf(s.binary.target),E('285'));
  assert.equal(await s.binary.pointPool(),E('270'));
  assert.equal(await s.binary.builderAccounted(),E('12'));
  assert.equal(await s.binary.pendingReward(s.addresses[35]),E('3'));
  assert.equal(await s.binary.totalPending(),E('3'));
  assert.equal(await s.binary.totalAuto(),0n);
  assert.equal(await s.token.totalSupply(),0n);
  assert.equal(await s.token.balanceOf(user),0n);
  assert.equal(await s.token.walletClock(),1n,'top-ups are not new wallets');
  const month=await s.binary.nextBuilderMonth();
  for(const[i,amount]of ['4.8','3.6','2.4','1.2'].entries())assert.equal(await s.binary.monthFunding(month,i),E(amount));
  for(const receipt of [registration,topup]){
   const tokenEvents=receipt.logs.filter(log=>log.address.toLowerCase()===s.token.target.toLowerCase()).map(log=>s.token.interface.parseLog(log));
   assert.equal(tokenEvents.filter(log=>log?.name==='ReserveInjected').length,1);assert.equal(tokenEvents.filter(log=>log?.name==='ReserveQuarantined').length,1);
   assert.equal(tokenEvents.filter(log=>log?.name==='Transfer').length,0,'membership support must not mint tokens');
  }
  await allowance(user,E('1500'),0n);
  await checks();
 });

 test('unpaid genesis, nonmembers, direct callers and failed registration cannot acquire or consume quota',async()=>{
  for(const who of [s.addresses[0],s.addresses[41]])await allowance(who,0n,0n);
  assert.equal(await s.binary.registered(s.addresses[0]),true);
  assert.equal(await s.binary.registered(s.addresses[41]),false);
  await fails(()=>s.token.buy(E('1'),0,MaxUint256));
  await fails(()=>s.token.connect(signers[41]).buy(E('1'),0,MaxUint256));
  await fails(()=>s.binary.connect(signers[41]).addUnits(1));
  await units(0,1);
  const before=await tradeState(),memberCount=await s.binary.memberCount(),parent=Array.from(await s.binary.members(s.addresses[15]));
  for(const i of [0,1,41]){
   await fails(()=>s.binary.connect(signers[i]).authorizeTokenBuy(s.addresses[0],E('1')));
   await fails(()=>s.token.connect(signers[i]).inject(E('1'),false));
   await fails(()=>s.token.connect(signers[i]).autoBuy(s.addresses[0],E('1'),0,MaxUint256));
  }
  await(await s.usd.setBlocked(s.token.target,true)).wait();
  await fails(()=>s.binary.connect(signers[41]).register(s.addresses[15],1,{gasLimit:3000000}));
  assert.equal(await s.binary.registered(s.addresses[41]),false);
  assert.equal(await s.binary.memberCount(),memberCount);
  assert.deepEqual(Array.from(await s.binary.members(s.addresses[15])),parent,'failed support injection must restore sponsor placement');
  assert.deepEqual(await tradeState(),before);
  await allowance(s.addresses[0],E('500'),0n);
  await allowance(s.addresses[41],0n,0n);
  await checks();
 });

 test('Member-rank gross buy quota is cumulative 5x funding and stays consumed across transfers, sales and lifecycle closure',async()=>{
  await units(0,1);
  await buy('100');
  assert.equal(await s.token.totalSupply(),E('970'),'3% buy fee changes mint, not gross quota consumption');
  await allowance(s.addresses[0],E('500'),E('100'));
  await units(0,1);
  await allowance(s.addresses[0],E('1000'),E('100'));
  await buy('900');
  await allowance(s.addresses[0],E('1000'),E('1000'));
  const supply=await s.token.totalSupply();
  await(await s.token.sell(supply/5n,0,MaxUint256)).wait();
  await allowance(s.addresses[0],E('1000'),E('1000'));
  await(await s.token.transfer(s.addresses[41],(await s.token.balanceOf(s.addresses[0]))/4n)).wait();
  await allowance(s.addresses[0],E('1000'),E('1000'));
  await allowance(s.addresses[41],0n,0n);
  await fails(()=>s.token.connect(signers[41]).buy(E('1'),0,MaxUint256));
  await(await s.token.connect(signers[41]).sell(await s.token.balanceOf(s.addresses[41]),0,MaxUint256)).wait();
  await fails(()=>s.token.buy(E('1'),0,MaxUint256));
  const reserve=await s.token.reserve(),reference=await s.token.price(),cash=await s.usd.balanceOf(s.addresses[0]);
  await(await s.token.sell(await s.token.balanceOf(s.addresses[0]),reserve,MaxUint256)).wait();
  assert.equal((await s.usd.balanceOf(s.addresses[0]))-cash,reserve);
  assert.equal(await s.token.reserve(),0n);
  assert.equal(await s.token.totalSupply(),0n);
  assert.equal(await s.token.lifecycleClosed(),true);
  assert.equal(await s.token.referencePrice(),reference);
  assert.equal(await s.token.price(),reference,'zero supply exposes only a historical reference');
  await allowance(s.addresses[0],E('1000'),E('1000'));
  await allowance(s.addresses[41],0n,0n);
  await assert.rejects(()=>s.token.quoteBuy(E('1')));
  await fails(()=>s.token.buy(E('1'),0,MaxUint256,{gasLimit:2000000}));
  await checks();
 });

 test('GAS ESTIMATION RISK: elapsed decay can exhaust a stale gas quote; revert preserves state and sufficient gas succeeds',async()=>{
  await units(0,1);await buy('100');
  await(await s.token.sell(E('194'),0,MaxUint256)).wait();
  const amount=E('194'),estimated=await s.token.sell.estimateGas(amount,0,MaxUint256),before=await tradeState();
  await provider.send('evm_increaseTime',[300]);
  const tx=await s.token.sell(amount,0,MaxUint256,{gasLimit:estimated});
  let failedReceipt;
  await assert.rejects(async()=>{await tx.wait();},error=>{failedReceipt=error.receipt;return failedReceipt?.status===0;});
  assert.equal((await provider.getTransaction(tx.hash)).gasLimit,estimated);
  assert(failedReceipt.gasUsed<=estimated);
  assert.deepEqual(await tradeState(),before,'insufficient gas must not consume reserve, supply, pressure or quota');
  const staticPayout=await s.token.sell.staticCall(amount,0,MaxUint256);
  assert(staticPayout>0n,'the identical trade is economically valid in the failed transaction state');
  const freshEstimate=await s.token.sell.estimateGas(amount,0,MaxUint256);
  assert(freshEstimate>estimated,'executing the now-required decay loop costs more gas');
  const receipt=await(await s.token.sell(amount,0,MaxUint256,{gasLimit:estimated+1000000n})).wait();
  assert(receipt.gasUsed>estimated,'the original quote really was insufficient');
  await allowance(s.addresses[0],E('500'),E('100'));await checks();
  console.log('PRESSURE_DECAY_GAS_RISK',JSON.stringify({binaryContract,oldEstimate:estimated.toString(),failedGasUsed:failedReceipt.gasUsed.toString(),freshEstimate:freshEstimate.toString(),successfulGasUsed:receipt.gasUsed.toString(),staticCallPayout:F(staticPayout),failedStateRolledBack:true}));
 });

 test('failed purchases and failed final payouts atomically preserve quota, lifecycle and every cash bucket',async()=>{
  await units(0,1);await buy('100');
  const before=await tradeState();
  const quote=await s.token.quoteBuy(E('10'));
  await fails(()=>s.token.buy(E('10'),quote+1n,MaxUint256));
  await fails(()=>s.token.buy(E('10'),0,0));
  await fails(()=>s.token.buy(E('401'),0,MaxUint256));
  await fails(()=>s.token.buy(0,0,MaxUint256));
  await(await s.usd.approve(s.token.target,0)).wait();
  await fails(()=>s.token.buy(E('10'),0,MaxUint256,{gasLimit:2000000}));
  assert.deepEqual(await tradeState(),before,'a collateral failure after authorization must roll back binary quota');
  await(await s.usd.approve(s.token.target,MaxUint256)).wait();
  await(await s.usd.setBlocked(s.token.target,true)).wait();
  await fails(()=>s.token.buy(E('10'),0,MaxUint256,{gasLimit:2000000}));
  assert.deepEqual(await tradeState(),before);
  await(await s.usd.setBlocked(s.token.target,false)).wait();
  await fails(()=>s.token.sell(before.supply,before.reserve+1n,MaxUint256,{gasLimit:2000000}));
  await(await s.usd.setBlocked(s.addresses[0],true)).wait();
  await fails(()=>s.token.sell(before.supply,0,MaxUint256,{gasLimit:2000000}));
  assert.deepEqual(await tradeState(),before,'a final USD transfer failure cannot close the lifecycle or consume reserve');
  await(await s.usd.setBlocked(s.addresses[0],false)).wait();
  await buy('10');
  await allowance(s.addresses[0],E('500'),E('110'));
  await checks();
 });

 test('hostile collateral callbacks cannot forge/double-consume quota and either transfer tax rolls it back',async()=>{
  const artifact=getHostileArtifact();
  const usd=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signers[0]).deploy();await usd.waitForDeployment();
  const token=await deployOne('FTIReserveToken',[usd.target,s.addresses[0],s.addresses[0]],signers[0]);
  const binary=await deployOne(binaryContract,[usd.target,token.target,s.addresses[0],s.addresses[0],s.addresses[35],s.addresses.slice(0,31)],signers[0]);
  const suite={usd,token,binary};await(await token.bind(binary.target)).wait();
  await(await usd.mint(s.addresses[0],E('10000'))).wait();
  await(await usd.approve(binary.target,MaxUint256)).wait();await(await usd.approve(token.target,MaxUint256)).wait();
  await(await binary.addUnits(1)).wait();
  for(const[target,payload,amount,spent]of [
   [binary.target,binary.interface.encodeFunctionData('authorizeTokenBuy',[s.addresses[0],E('1')]),'100','100'],
   [token.target,token.interface.encodeFunctionData('buy',[E('1'),0,MaxUint256]),'50','150'],
  ]){
   await(await usd.setCallback(target,payload)).wait();
   await(await token.buy(E(amount),0,MaxUint256)).wait();
   assert.equal(await usd.attempted(),true);assert.equal(await usd.succeeded(),false);
   await allowance(s.addresses[0],E('500'),E(spent),suite);
  }
  const before=await tradeState(suite);
  for(const mode of [1,2]){
   await(await usd.setFeeMode(mode)).wait();
   await fails(()=>token.buy(E('50'),0,MaxUint256,{gasLimit:2000000}));
   assert.deepEqual(await tradeState(suite),before);
  }
  await checks(suite);
 });

 test('token trading/final redemption never spends binary cash and existing reward/development payouts remain identical',async()=>{
  await units(0,1);await units(1,2);await units(2,2);
  const beforeTrading=await binaryCash();
  assert.equal(beforeTrading.actual,E('475'));
  const clean=await provider.send('evm_snapshot',[]);
  await settle(s,provider);
  const baseline=await binaryCash(),reward=funded?E('40'):E('450');
  assert.equal(baseline.reward0,reward);assert.equal(baseline.reward35,E('5'));
  await provider.send('evm_revert',[clean]);
  await buy('100');
  await(await s.token.sell((await s.token.totalSupply())/5n,0,MaxUint256)).wait();
  await(await s.token.transfer(s.addresses[41],await s.token.balanceOf(s.addresses[0]))).wait();
  await(await s.token.connect(signers[41]).sell(await s.token.balanceOf(s.addresses[41]),0,MaxUint256)).wait();
  assert.deepEqual(await binaryCash(),beforeTrading,'all binary partitions survive token reserve exhaustion');
  assert.equal(await s.token.reserve(),0n);
  await settle(s,provider);
  assert.deepEqual(await binaryCash(),baseline,'settlement payouts must match the no-token-trading baseline');
  const rootCash=await s.usd.balanceOf(s.addresses[0]),devCash=await s.usd.balanceOf(s.addresses[35]);
  await(await s.binary.claim()).wait();await(await s.binary.connect(signers[35]).claim()).wait();
  assert.equal((await s.usd.balanceOf(s.addresses[0]))-rootCash,reward);
  assert.equal((await s.usd.balanceOf(s.addresses[35]))-devCash,E('5'));
  assert.equal(await s.usd.balanceOf(s.binary.target),E('475')-reward-E('5'));
  assert.equal(await s.binary.builderAccounted(),E('20'));
  assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.totalSupply(),0n);
  await checks();
 });

 test('TEST ONLY paid-rank fixture: reward auto-buy transfers only its earmarked cash, leaves manual quota and unrelated reward/builder buckets intact',async()=>{
  await units(0,1);await buy('100');await units(1,100);await units(2,100);
  await settle(s,provider);await seedPaidRank(s.binary,s.addresses[0],1);assert.equal(await s.binary.rankOf(s.addresses[0]),1n);
  assert.equal(await s.token.priceMultiplier(),2n);
  // A rank-1 builder receives $600 per paid unit times the milestone multiplier;
  // an ordinary Member receives $500 per unit even after that same price milestone.
  await allowance(s.addresses[0],E('1200'),E('100'));
  await allowance(s.addresses[1],E('50000'),0n);
  await(await s.binary.setAutoBuy(true,E('1000000'))).wait();
  await units(1,5);await units(2,5);await settle(s,provider);
  const amount=funded?E('5'):E('45');assert.equal(await s.binary.pendingAuto(s.addresses[0]),amount);
  const before=await binaryCash(),reserve=await s.token.reserve(),supply=await s.token.totalSupply();
  await(await s.binary.connect(signers[41]).executeAuto(s.addresses[0],amount)).wait();
  const after=await binaryCash();
  assert.equal(after.actual,before.actual-amount);assert.equal(after.totalAuto,before.totalAuto-amount);
  assert.equal(after.auto0,0n);
  for(const field of ['pointPool','builderAccounted','totalPending','reward0','reward35',...(funded?creditFields:[])])assert.equal(after[field],before[field],field);
  assert.equal(await s.token.reserve(),reserve+amount);
  assert((await s.token.totalSupply())>supply);
  await allowance(s.addresses[0],E('600')*await s.token.priceMultiplier(),E('100'));
  const cash=await s.usd.balanceOf(s.addresses[0]);await(await s.binary.claim()).wait();
  assert.equal((await s.usd.balanceOf(s.addresses[0]))-cash,before.reward0);
  assert.equal(await s.token.reserve(),reserve+amount,'cash reward claims do not draw on token reserve');
  await checks();
 });

 test('QUARANTINE REGRESSION: pre-mint $500 support cannot be captured by a sole $100 buyer',async()=>{
  // Fast fixture: ten distinct paid members contribute $1,000 each. The support
  // and supply state are cash-equivalent to 100 members contributing $100 each:
  // $10,000 memberships => protected=$500, live R=0, S=0.
  // Ownership remains unapproved; first mint must not assign these funds.
  for(let i=0;i<10;i++)await units(i,10);
  assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.unallocatedReserve(),E('500'));assert.equal(await s.token.totalSupply(),0n);
  const binaryBefore=await binaryCash(),buyerBefore=await s.usd.balanceOf(s.addresses[0]);
  assert.equal(binaryBefore.actual,E('9500'));
  await buy('100');
  assert.equal(await s.token.reserve(),E('100'));assert.equal(await s.token.unallocatedReserve(),E('500'));
  assert.equal(await s.token.totalSupply(),E('970'));
  const supply=await s.token.totalSupply(),reference=await s.token.price();
  const[payout,fee,gross]=await s.token.quoteSell(supply);
  assert.equal(payout,E('100'));assert.equal(fee,0n);assert.equal(gross,E('100'));
  await(await s.token.sell(supply,E('100'),MaxUint256)).wait();
  assert.equal((await s.usd.balanceOf(s.addresses[0]))-buyerBefore,0n,'only the buyer own gross cash is returned; no pre-mint support capture');
  assert.equal(await s.token.reserve(),0n);assert.equal(await s.usd.balanceOf(s.token.target),E('500'));assert.equal(await s.token.unallocatedReserve(),E('500'));assert.equal(await s.token.totalSupply(),0n);
  assert.equal(await s.token.referencePrice(),reference);assert.equal(await s.token.price(),reference);
  assert.equal(await s.token.lifecycleClosed(),true);
  assert.deepEqual(await binaryCash(),binaryBefore,'binary $9,500 remains segregated and intact');
  await allowance(s.addresses[0],E('5000'),E('100'));
  await checks();
  console.log('QUARANTINE_PREVENTS_SUPPORT_CAPTURE',JSON.stringify({binaryContract,fixture:'10 paid members x $1,000; cash-equivalent to 100 x $100',membershipCash:'10000',preMintSupply:'0',preMintSupport:'500',soleBuyerGrossPurchase:'100',allSupplyPayout:F(payout),capturedSupport:'0',protectedUnallocatedSupport:'500',remainingTokenReserve:'0',remainingTokenSupply:'0',binaryCashIntact:'9500',allocationApproved:false}));
 });

 test('DONATION OWNERSHIP BLOCKER: all-supply sale pays live reserve while protected support and raw surplus remain',async()=>{
  await units(0,1);await buy('100');
  const binaryBefore=await binaryCash(),reserve=await s.token.reserve(),donorCash=await s.usd.balanceOf(s.addresses[1]);
  await(await s.usd.connect(signers[1]).transfer(s.token.target,E('17'))).wait();
  assert.equal(donorCash-await s.usd.balanceOf(s.addresses[1]),E('17'));
  assert.equal(await s.token.reserve(),E('100'),'raw transfers do not become live backing');assert.equal(await s.token.unallocatedReserve(),E('5'));
  assert.deepEqual(Array.from(await s.token.accounting()),[E('122'),E('105')]);
  const supply=await s.token.totalSupply(),buyerCash=await s.usd.balanceOf(s.addresses[0]);
  const[payout,fee,gross]=await s.token.quoteSell(supply);
  assert.equal(payout,reserve);assert.equal(gross,reserve);assert.equal(fee,0n);
  await(await s.token.sell(supply,reserve,MaxUint256)).wait();
  assert.equal((await s.usd.balanceOf(s.addresses[0]))-buyerCash,E('100'));
  assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.totalSupply(),0n);
  const[actual,accounted]=await s.token.accounting();
  assert.equal(actual,E('22'));assert.equal(accounted,E('5'));assert.equal(actual-accounted,E('17'));assert(actual>=accounted);
  assert.deepEqual(await binaryCash(),binaryBefore,'unrelated binary cash is neither donated nor redeemed');
  const[binaryActual,binaryAccounted]=await s.binary.accounting();assert.equal(binaryActual,binaryAccounted);
  if(funded){const[a,b,c,d]=await s.binary.fundingAccounting();assert.equal(a,b);assert.equal(c,d);}
  await allowance(s.addresses[0],E('500'),E('100'));
  // Do not add a sync/rescue mechanism here: ownership of unsolicited surplus
  // is a separate unresolved decision, and actual==accounted is not promised.
  console.log('DONATION_OWNERSHIP_BLOCKER',JSON.stringify({binaryContract,liveReserveBeforeFinal:'100',protectedSupport:'5',rawUnaccountedDonation:'17',finalPayout:'100',liveReserveAfterFinal:'0',actualUsdAfterFinal:'22',binaryCashIntact:F(binaryActual),surplusAllocationApproved:false}));
 });

 test('LIFECYCLE REVIEW BLOCKER: support funding still enters a closed token while buys stay gated and spent quota never resets',async()=>{
  await units(0,1);await buy('100');
  await(await s.token.sell(await s.token.totalSupply(),0,MaxUint256)).wait();
  assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.lifecycleClosed(),true);
  await allowance(s.addresses[0],E('500'),E('100'));
  const reference=await s.token.referencePrice(),before=await binaryCash();
  await units(0,1);
  await(await s.binary.connect(signers[41]).register(s.addresses[15],1)).wait();
  assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.unallocatedReserve(),E('15'));
  assert.equal(await s.usd.balanceOf(s.token.target),E('15'));
  assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.token.lifecycleClosed(),true);
  assert.equal(await s.token.referencePrice(),reference);assert.equal(await s.token.price(),reference);
  assert.equal(await s.usd.balanceOf(s.binary.target),before.actual+E('190'));
  assert.equal(await s.binary.pointPool(),before.pointPool+E('180'));
  assert.equal(await s.binary.builderAccounted(),before.builderAccounted+E('8'));
  assert.equal(await s.binary.pendingReward(s.addresses[35]),before.reward35+E('2'));
  await allowance(s.addresses[0],E('1000'),E('100'));
  await allowance(s.addresses[41],E('500'),0n);
  const blocked=await tradeState();
  await assert.rejects(()=>s.token.quoteBuy(E('1')));
  await fails(()=>s.token.buy(E('1'),0,MaxUint256,{gasLimit:2000000}));
  await fails(()=>s.token.connect(signers[41]).buy(E('1'),0,MaxUint256,{gasLimit:2000000}));
  assert.deepEqual(await tradeState(),blocked,'the unapproved restart remains unavailable');
  await checks();
  console.log('LIFECYCLE_REVIEW_BLOCKER',JSON.stringify({binaryContract,postClosureFunding:'200',newProtectedSupportInClosedToken:'10',totalProtectedSupport:'15',newBinaryCash:'190',supply:'0',buysBlocked:true,priorGrossQuotaStillSpent:'100',automaticRestartApproved:false}));
 });
});
