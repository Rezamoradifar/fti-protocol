import {describe,test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256} from 'ethers';
import {deployOne,deploySuite,settle,drainVolume,checkAccounting} from '../scripts/lib.mjs';
import {deployPaidRankFeatureSuite,seedPaidRank} from './fixtures/paid-rank-feature-suite.mjs';

// Current lifecycle coverage. Every token below is the compiled, unmodified
// FTIRetirementReviewToken and has a real 5-of-7 Council + 72h FTITimelock.
// The final describe block explicitly uses TEST_ONLY paid-rank state solely to
// isolate rank-dependent features. It is NOT organic rank qualification evidence.
const W=E('1'),ceil=(a,b)=>(a+b-1n)/b;
async function tx(promise){return(await promise).wait();}
function tradeFee(value,reserve){
 const threshold20=reserve>E('10000')?reserve:E('10000');
 const excess20=value*20n>threshold20?value*20n-threshold20:0n;
 return ceil(300n*400n*value*value+700n*excess20*excess20,10000n*400n*value);
}
async function setup({feature=false,hostile=false}={}){
 const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:45,deterministic:true},chain:{chainId:31337,time:new Date('2026-10-05T00:00:00Z')},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 const signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));
 let s;
 if(!hostile)s=await(feature?deployPaidRankFeatureSuite:deploySuite)(signers,{tokenContract:'FTIRetirementReviewToken',binaryContract:'BinaryPlan'});
 else{
  const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'HostileUSD.sol':{content:fs.readFileSync('test/fixtures/HostileUSD.sol','utf8')}},settings:{evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:name=>({contents:fs.readFileSync('node_modules/'+name,'utf8')})}));
  assert(!output.errors?.some(e=>e.severity==='error'),JSON.stringify(output.errors));
  const a=output.contracts['HostileUSD.sol'].HostileUSD,addresses=await Promise.all(signers.map(x=>x.getAddress()));
  const usd=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy();await usd.waitForDeployment();
  const council=await deployOne('Council',[addresses.slice(31,38)],signers[0]);
  const timelock=await deployOne('FTITimelock',[council.target],signers[0]);
  const token=await deployOne('FTIRetirementReviewToken',[usd.target,timelock.target,council.target,addresses[35]],signers[0]);
  const binary=await deployOne('BinaryPlan',[usd.target,token.target,timelock.target,council.target,addresses[35],addresses.slice(0,31)],signers[0]);
  await tx(token.bind(binary.target));s={usd,council,timelock,token,binary,addresses};
 }
 Object.assign(s,{engine,p,signers});
 for(const i of [0,1,2,3,4,15,30,40,41]){
  await tx(hostile?s.usd.mint(s.addresses[i],E('1000000')):s.usd.connect(signers[i]).faucet());
  await tx(s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256));
  await tx(s.usd.connect(signers[i]).approve(s.token.target,MaxUint256));
 }
 return s;
}
async function backed(s){
 await checkAccounting(s);
 const r=await s.token.reserve(),protectedFund=await s.token.priceProtectionFund(),claim=await s.token.developmentFeeClaim();
 assert.deepEqual(Array.from(await s.token.accounting()),[r+protectedFund+claim,r+protectedFund+claim]);
}
async function state(s){return Promise.all([
 s.token.reserve(),s.token.priceProtectionFund(),s.token.developmentFeeClaim(),s.token.totalSupply(),s.token.price(),
 s.token.lifecycleClosed(),s.token.cumulativeBuy(),s.token.cumulativeSell(),s.token.balanceOf(s.addresses[0]),s.token.balanceOf(s.addresses[1]),
 s.binary.tokenBuySpent(s.addresses[0]),s.binary.totalAuto(),s.binary.pendingAuto(s.addresses[0]),s.binary.totalPending(),s.binary.pointPool(),s.binary.builderAccounted(),
 s.usd.balanceOf(s.token.target),s.usd.balanceOf(s.binary.target),s.usd.balanceOf(s.addresses[0]),s.usd.balanceOf(s.addresses[35]),
]);}
async function rejected(s,method,args,reason){
 const before=await state(s);
 if(reason)await assert.rejects(method.staticCall(...args),{reason});
 await assert.rejects(async()=>tx(method(...args,{gasLimit:4000000})));
 assert.deepEqual(await state(s),before,'revert preserves cash buckets, claims, quota, shares and price');
}
const units=(s,i,n)=>tx(s.binary.connect(s.signers[i]).addUnits(n));
const buy=(s,i,value)=>tx(s.token.connect(s.signers[i]).buy(value,0,MaxUint256));
async function allowance(s,i,limit,spent){
 const who=s.addresses[i],remaining=limit>spent?limit-spent:0n;
 assert.equal(await s.binary.tokenBuyLimit(who),limit);assert.equal(await s.token.buyLimit(who),limit);
 assert.equal(await s.binary.tokenBuySpent(who),spent);assert.equal(await s.token.lifetimeManualBuys(who),spent);
 assert.equal(await s.binary.remainingTokenBuyAllowance(who),remaining);assert.equal(await s.token.remainingAllowance(who),remaining);
}

describe('Retirement current-token integrations with canonical BinaryPlan',()=>{
 let s,snapshot;
 before(async()=>{s=await setup();snapshot=await s.p.send('evm_snapshot',[]);});
 beforeEach(async()=>{await s.p.send('evm_revert',[snapshot]);snapshot=await s.p.send('evm_snapshot',[]);});
 after(async()=>{await s?.engine.disconnect();});
 test('shared helper binds the current token and matching immutable development fund to real governance',async()=>{
  assert.equal(await s.token.pricingModel(),'0x'+Buffer.from('RETIREMENT_REVIEW_SIZE_FEE').toString('hex').padEnd(64,'0'));
  assert.equal(await s.token.developmentFund(),s.addresses[35]);assert.equal(await s.binary.development(),s.addresses[35]);
  assert.equal(await s.binary.token(),s.token.target);assert.equal(await s.token.governance(),s.timelock.target);
  assert.equal(await s.token.guardian(),s.council.target);assert.equal(await s.council.THRESHOLD(),5n);assert.equal(await s.council.OWNER_COUNT(),7n);
  assert.equal(await s.timelock.getMinDelay(),72n*3600n);assert.equal(s.binary.interface.hasFunction('TEST_ONLY_setPaidRank'),false);
  await backed(s);
 });
 for(const reserveText of ['100','1000','20000'])test(`current-token fee floor and 5% threshold quote boundaries at live R=${reserveText}`,async()=>{
  await units(s,0,80);await buy(s,0,E(reserveText));
  const r=await s.token.reserve(),supply=await s.token.totalSupply(),threshold=r/20n>E('500')?r/20n:E('500');
  for(const amount of [E('1'),E('499.999999999999999999'),E('500'),E('500')+1n,threshold-1n,threshold,threshold+1n,threshold+E('0.01'),threshold*2n]){
   const fee=tradeFee(amount,r);assert.deepEqual(Array.from(await s.token.buyFeeQuote(amount)),[fee,amount-fee]);
   if(amount<=threshold)assert.equal(fee,ceil(amount*3n,100n));
   if(amount<r){
    const q=ceil(amount*supply,r),gross=q*r/supply,quoted=await s.token.sellFeeQuote(q);
    assert.deepEqual(Array.from(quoted),[tradeFee(gross,r),gross-tradeFee(gross,r),gross]);
   }
  }
  assert.equal(await s.token.priceProtectionFund(),E('400'),'pre-mint support never changes trade threshold');
  assert.equal(await s.token.developmentFeeClaim(),0n);await backed(s);
 });
 test('current-token actual large buys retain gross cash, mint net assets at pretrade price and consume gross manual quota',async()=>{
  await units(s,0,10);await buy(s,0,E('1000'));
  const r=await s.token.reserve(),supply=await s.token.totalSupply(),price=await s.token.price(),amount=E('1000');
  const fee=tradeFee(amount,r),minted=(amount-fee)*supply/r;assert.equal(fee,E('47.5'));
  await tx(s.token.buy(amount,minted,MaxUint256));
  assert.equal(await s.token.reserve(),r+amount);assert.equal(await s.token.totalSupply(),supply+minted);
  assert((await s.token.reserve())*supply>r*(await s.token.totalSupply()),'exact live reserve/share ratio grows');
  assert((await s.token.price())>=price);await allowance(s,0,E('5000'),E('2000'));
  assert.equal((await s.token.buyFeeQuote(E('400')))[0],E('12'),'a large trade does not penalize the next small trade');
  await backed(s);
 });
 test('current-token partial sales retain exact fee, transfers burn 3%, and neither restores manual quota',async()=>{
  await units(s,0,10);await buy(s,0,E('2000'));const r=await s.token.reserve(),supply=await s.token.totalSupply(),q=supply/2n;
  const gross=q*r/supply,fee=tradeFee(gross,r),before=await s.usd.balanceOf(s.addresses[0]);
  await tx(s.token.sell(q,gross-fee,MaxUint256));
  assert.equal(await s.token.reserve(),r-gross+fee);assert.equal(await s.token.totalSupply(),supply-q);
  assert.equal(await s.usd.balanceOf(s.addresses[0])-before,gross-fee);assert.equal(await s.token.developmentFeeClaim(),0n);
  const transfer=E('100'),beforeSupply=await s.token.totalSupply(),beforeR=await s.token.reserve();
  await tx(s.token.transfer(s.addresses[1],transfer));assert.equal(await s.token.balanceOf(s.addresses[1]),E('97'));
  assert.equal(await s.token.totalSupply(),beforeSupply-E('3'));assert.equal(await s.token.reserve(),beforeR);
  await allowance(s,0,E('5000'),E('2000'));await allowance(s,1,0n,0n);await backed(s);
 });
 test('current-token real registration grants cumulative gross quota and paid top-ups do not reset spent',async()=>{
  await allowance(s,0,0n,0n);await allowance(s,40,0n,0n);
  await rejected(s,s.token.buy,[E('1'),0,MaxUint256],'buy input');
  await tx(s.binary.connect(s.signers[40]).register(s.addresses[15],1));await allowance(s,40,E('500'),0n);
  await buy(s,40,E('500'));await allowance(s,40,E('500'),E('500'));
  await rejected(s,s.token.connect(s.signers[40]).buy,[E('1'),0,MaxUint256],'allowance');
  await units(s,40,1);await allowance(s,40,E('1000'),E('500'));await buy(s,40,E('500'));
  await allowance(s,40,E('1000'),E('1000'));await backed(s);
 });
 test('current-token minOut, deadline, dust, allowance and collateral failures roll back real Binary authorization',async()=>{
  await units(s,0,1);await buy(s,0,E('100'));
  await rejected(s,s.token.buy,[E('50'),await s.token.quoteBuy(E('50'))+1n,MaxUint256],'slippage/dust');
  await rejected(s,s.token.buy,[E('50'),0,0],'buy input');
  await rejected(s,s.token.buy,[1n,0,MaxUint256],'dust');
  await rejected(s,s.token.buy,[E('401'),0,MaxUint256],'allowance');
  await tx(s.usd.setBlocked(s.token.target,true));await rejected(s,s.token.buy,[E('50'),0,MaxUint256],'mock recipient blocked');
  await tx(s.usd.setBlocked(s.token.target,false));await buy(s,0,E('400'));await allowance(s,0,E('500'),E('500'));await backed(s);
 });
 test('unranked Members cannot create auto allocations merely by enabling auto on the new token',async()=>{
  await units(s,0,1);await buy(s,0,E('100'));await tx(s.binary.setAutoBuy(true));
  await units(s,1,2);await units(s,2,2);await settle(s,s.p);
  assert.equal(await s.binary.rankOf(s.addresses[0]),0n);assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);
  assert.equal(await s.binary.pendingReward(s.addresses[0]),E('450'));assert.equal(await s.binary.cumulativePaidRankPoints(s.addresses[0]),2n);
  await allowance(s,0,E('500'),E('100'));await backed(s);
 });
 test('current-token hourly gate: four units then one in another hour carry fully; one-wallet five-unit top-up settles',async()=>{
  const root=s.addresses[0],dev=s.addresses[35];await units(s,0,1);await units(s,1,1);await units(s,2,2);await drainVolume(s);
  const carry=await s.binary.members(root);await settle(s,s.p);
  assert.equal(await s.binary.pointPool(),E('360'));assert.equal(await s.binary.pendingReward(root),0n);
  assert.equal((await s.binary.members(root)).carryL,carry.carryL);assert.equal((await s.binary.members(root)).carryR,carry.carryR);
  await units(s,2,1);await settle(s,s.p);assert.equal(await s.binary.pointPool(),E('450'));
  await settle(s,s.p);assert.equal(await s.binary.pointPool(),E('450'),'empty hour cannot divert carried cash');
  assert.equal(await s.binary.pendingReward(dev),E('5'));assert.equal(await s.binary.cumulativePaidRankPoints(root),0n);
  const count=await s.binary.memberCount();await units(s,2,5);const epoch=await s.binary.epoch();await settle(s,s.p);
  assert.equal(await s.binary.memberCount(),count);assert.equal(await s.binary.paidPoints(epoch,root),1n);
  assert.equal(await s.binary.pendingReward(root),E('900'));assert.equal(await s.binary.pointPool(),0n);
  assert.equal(await s.binary.pendingReward(dev),E('10'));assert.equal(await s.binary.builderAccounted(),E('40'));
  assert.equal(await s.token.priceProtectionFund(),E('50'));assert.equal(await s.token.reserve(),0n);await backed(s);
 });
 test('current-token five-unit registration with no eligible points carries the entire pool and protects all buckets',async()=>{
  await tx(s.binary.connect(s.signers[40]).register(s.addresses[15],5));await settle(s,s.p);
  assert.equal(await s.binary.totalPaidPoints(),0n);assert.equal(await s.binary.pointPool(),E('450'));
  assert.equal(await s.binary.pendingReward(s.addresses[35]),E('5'));assert.equal(await s.binary.builderAccounted(),E('20'));
  assert.equal(await s.token.priceProtectionFund(),E('25'));await settle(s,s.p);assert.equal(await s.binary.pointPool(),E('450'));await backed(s);
 });
 test('current-token proportional rewards assign only exact rounding residual to development',async()=>{
  for(const[i,n]of [[0,1],[1,1],[2,4],[3,3],[4,4]])await units(s,i,n);
  const epoch=await s.binary.epoch(),pool=await s.binary.pointPool(),dev=await s.binary.pendingReward(s.addresses[35]);await settle(s,s.p);
  assert.equal(await s.binary.totalPaidPoints(),7n);assert.equal(await s.binary.paidPoints(epoch,s.addresses[0]),4n);
  assert.equal(await s.binary.paidPoints(epoch,s.addresses[1]),3n);
  const reward0=pool*4n/7n,reward1=pool*3n/7n,residual=pool-reward0-reward1;assert.equal(residual,1n);
  assert.equal(await s.binary.pendingReward(s.addresses[0]),reward0);assert.equal(await s.binary.pendingReward(s.addresses[1]),reward1);
  assert.equal(await s.binary.pendingReward(s.addresses[35]),dev+residual);assert.equal(await s.binary.pointPool(),0n);await backed(s);
 });
});

describe('Retirement current-token hostile collateral with canonical BinaryPlan',()=>{
 let s,snapshot;
 before(async()=>{s=await setup({hostile:true});await units(s,0,2);await units(s,1,2);await buy(s,0,E('100'));snapshot=await s.p.send('evm_snapshot',[]);});
 beforeEach(async()=>{await s.p.send('evm_revert',[snapshot]);snapshot=await s.p.send('evm_snapshot',[]);});
 after(async()=>{await s?.engine.disconnect();});
 test('current-token taxed buys, partial sells, terminal sells and membership funding fail atomically in both tax modes',async()=>{
  for(const mode of [1,2]){
   await tx(s.usd.setFeeMode(mode));
   await rejected(s,s.token.buy,[E('10'),0,MaxUint256],'unsupported USD');
   await rejected(s,s.token.sell,[E('1'),0,MaxUint256],'unsupported USD');
   await rejected(s,s.token.sell,[await s.token.totalSupply(),0,MaxUint256],'unsupported USD');
   await rejected(s,s.binary.addUnits,[1],'unsupported USD');await backed(s);
  }
 });
 test('current-token collateral callbacks cannot forge quota, reenter buy or transfer approved FTI',async()=>{
  await tx(s.token.approve(s.usd.target,E('1')));
  for(const[target,payload]of [
   [s.binary.target,s.binary.interface.encodeFunctionData('authorizeTokenBuy',[s.addresses[0],E('1')])],
   [s.token.target,s.token.interface.encodeFunctionData('buy',[E('1'),0,MaxUint256])],
   [s.token.target,s.token.interface.encodeFunctionData('transferFrom',[s.addresses[0],s.addresses[1],E('1')])],
  ]){
   await tx(s.usd.setCallback(target,payload));const spent=await s.binary.tokenBuySpent(s.addresses[0]),supply=await s.token.totalSupply(),quote=await s.token.quoteBuy(E('10'));
   await buy(s,0,E('10'));assert.equal(await s.usd.attempted(),true);assert.equal(await s.usd.succeeded(),false);
   assert.equal(await s.binary.tokenBuySpent(s.addresses[0]),spent+E('10'));assert.equal(await s.token.totalSupply(),supply+quote);
   assert.equal(await s.token.balanceOf(s.addresses[1]),0n);assert.equal(await s.token.allowance(s.addresses[0],s.usd.target),E('1'));await backed(s);
  }
 });
 test('current-token deficits block buys, sells and transfers without modifying claims or quota',async()=>{
  await tx(s.usd.burn(s.token.target,1));
  for(const[method,args]of [[s.token.buy,[E('10'),0,MaxUint256]],[s.token.sell,[E('1'),0,MaxUint256]],[s.token.transfer,[s.addresses[1],E('1')]]])await rejected(s,method,args,'reserve deficit');
  await tx(s.usd.mint(s.token.target,1));await backed(s);
 });
 test('current-token terminal claim is part of collateral liability and rejects taxed or underbacked payment',async()=>{
  const r=await s.token.reserve(),support=await s.token.priceProtectionFund(),supply=await s.token.totalSupply(),fee=tradeFee(r,r);
  await tx(s.token.sell(supply,r-fee,MaxUint256));assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.developmentFeeClaim(),fee);
  assert.deepEqual(Array.from(await s.token.accounting()),[support+fee,support+fee]);
  for(const mode of [1,2]){await tx(s.usd.setFeeMode(mode));await rejected(s,s.token.claimDevelopmentFees,[],'unsupported USD');}
  await tx(s.usd.setFeeMode(0));await tx(s.usd.burn(s.token.target,1));await rejected(s,s.token.claimDevelopmentFees,[],'reserve deficit');
  await tx(s.usd.mint(s.token.target,1));const before=await s.usd.balanceOf(s.addresses[35]),caller=await s.usd.balanceOf(s.addresses[41]);
  await tx(s.token.connect(s.signers[41]).claimDevelopmentFees());assert.equal(await s.usd.balanceOf(s.addresses[35])-before,fee);
  assert.equal(await s.usd.balanceOf(s.addresses[41]),caller);assert.equal(await s.token.developmentFeeClaim(),0n);
  assert.equal(await s.token.priceProtectionFund(),support);await backed(s);
 });
});

describe('Retirement current-token TEST_ONLY paid-rank feature isolation, not organic qualification',()=>{
 let s,snapshot;
 before(async()=>{s=await setup({feature:true});snapshot=await s.p.send('evm_snapshot',[]);});
 beforeEach(async()=>{await s.p.send('evm_revert',[snapshot]);snapshot=await s.p.send('evm_snapshot',[]);});
 after(async()=>{await s?.engine.disconnect();});
 test('TEST_ONLY rank features: all five rates cover full paid-unit history and top-ups retain gross spent',async()=>{
  await units(s,0,1);await buy(s,0,E('100'));let paid=1n,spent=E('100');
  await allowance(s,0,E('500'),spent);
  for(let rank=1;rank<=4;rank++){
   await seedPaidRank(s.binary,s.addresses[0],rank);const rate=[500n,600n,700n,800n,1000n][rank];
   await allowance(s,0,paid*rate*W,spent);await units(s,0,1);paid++;
   await buy(s,0,E('100'));spent+=E('100');await allowance(s,0,paid*rate*W,spent);
   assert((await s.binary.rankReachedAt(s.addresses[0],rank-1))>0n);assert.equal(await s.token.priceMultiplier(),1n);await backed(s);
  }
 });
 test('TEST_ONLY builder eligibility with real $5 support latches 10x and 100x price milestones, Members stay unmultiplied',async()=>{
  await units(s,0,1);await units(s,30,1);await units(s,1,100);await seedPaidRank(s.binary,s.addresses[0],1);
  await tx(s.token.syncPriceMilestone());assert.equal(await s.token.priceMultiplier(),1n,'protected pre-mint support cannot create a milestone');
  const protectedFund=await s.token.priceProtectionFund();await buy(s,0,E('100'));
  for(const[multiplier,next]of [[2n,E('10')],[4n,E('100')]]){
   const threshold=await s.token.milestonePrice(),supply=await s.token.totalSupply(),needed=ceil(threshold*supply,W)-await s.token.reserve();
   const n=ceil(needed,E('5'));await units(s,1,n-1n);assert((await s.token.price())<threshold);
   const before=await s.token.priceMultiplier();await tx(s.token.connect(s.signers[41]).advancePriceMilestone());assert.equal(await s.token.priceMultiplier(),before);
   await units(s,1,1);assert((await s.token.price())>=threshold);assert.equal(await s.token.priceMultiplier(),multiplier);
   assert.equal(await s.token.milestonePrice(),next);await allowance(s,0,E('600')*multiplier,E('100'));await allowance(s,30,E('500'),0n);
   assert.equal(await s.token.priceProtectionFund(),protectedFund);await backed(s);
  }
  await tx(s.token.sell(E('1'),0,MaxUint256));await tx(s.token.transfer(s.addresses[30],E('1')));await tx(s.token.syncPriceMilestone());
  assert.equal(await s.token.priceMultiplier(),4n);await allowance(s,0,E('2400'),E('100'));await backed(s);
 });
 test('TEST_ONLY builder auto: failed immediate allocation retries at current price without a cap or manual quota consumption',async()=>{
  await units(s,0,1);await buy(s,0,E('500'));await seedPaidRank(s.binary,s.addresses[0],1);
  await buy(s,0,E('100'));await allowance(s,0,E('600'),E('600'));await tx(s.binary.setAutoBuy(true));
  assert.equal(await s.binary.effectiveAutoEnabled(s.addresses[0]),false);
  assert.equal((await s.binary.nextAutoSetting(s.addresses[0])).effectiveAt,await s.binary.epochEnd());
  await units(s,1,5);await units(s,2,5);
  const supply=await s.token.totalSupply(),beforeReserve=await s.token.reserve();
  await tx(s.usd.setBlocked(s.token.target,true));await settle(s,s.p);
  const root=s.addresses[0],amount=await s.binary.pendingAuto(root);assert.equal(amount,E('49.5'));
  assert.equal(await s.token.totalSupply(),supply);assert.equal(await s.token.reserve(),beforeReserve);
  assert.equal(await s.binary.effectiveAutoEnabled(root),true);assert.equal((await s.binary.members(root)).maxAutoPrice,0n);
  await rejected(s,s.binary.executeAuto,[root,amount],'mock recipient blocked');
  await tx(s.usd.setBlocked(s.token.target,false));
  const originalQuote=await s.token.quoteBuy(amount);await buy(s,1,E('100'));
  const quote=await s.token.quoteBuy(amount);assert(quote<originalQuote,'retry quotes the higher current exact price');
  const beforeTokens=await s.token.balanceOf(root),r=await s.token.reserve(),fund=await s.token.priceProtectionFund();
  const protectedBuckets=await Promise.all([s.binary.totalPending(),s.binary.builderAccounted(),s.binary.pointPool()]);
  await tx(s.binary.connect(s.signers[41]).executeAuto(root,amount));
  assert.equal(await s.token.balanceOf(root)-beforeTokens,quote);assert.equal(await s.token.reserve(),r+amount);
  assert.equal(await s.binary.pendingAuto(root),0n);assert.equal(await s.binary.totalAuto(),0n);assert.equal(await s.token.priceProtectionFund(),fund);
  assert.deepEqual(await Promise.all([s.binary.totalPending(),s.binary.builderAccounted(),s.binary.pointPool()]),protectedBuckets);
  await allowance(s,0,E('600'),E('600'));assert.equal(await s.token.developmentFeeClaim(),0n);await backed(s);
 });
 test('TEST_ONLY builder auto: disabling and keeper partial execution reject; owner release remains cash owned by that wallet',async()=>{
  await units(s,0,1);await buy(s,0,E('100'));await seedPaidRank(s.binary,s.addresses[0],1);
  await tx(s.binary.setAutoBuy(true));await units(s,1,5);await units(s,2,5);
  await tx(s.usd.setBlocked(s.token.target,true));await settle(s,s.p);await tx(s.usd.setBlocked(s.token.target,false));
  const root=s.addresses[0],amount=await s.binary.pendingAuto(root),cash=await s.binary.pendingReward(root);assert.equal(amount,E('49.5'));
  await rejected(s,s.binary.connect(s.signers[41]).executeAuto,[root,amount/2n],'partial auto owner only');
  await tx(s.binary.setAutoBuy(false));await rejected(s,s.binary.executeAuto,[root,amount],'auto disabled');
  await tx(s.binary.connect(s.signers[41]).releaseAutoToCash());assert.equal(await s.binary.pendingAuto(root),amount,'outsider can only release its own balance');
  await tx(s.binary.releaseAutoToCash());assert.equal(await s.binary.pendingAuto(root),0n);assert.equal(await s.binary.pendingReward(root),cash+amount);
  const before=await s.usd.balanceOf(root);await tx(s.binary.claim());assert.equal(await s.usd.balanceOf(root)-before,cash+amount);
  await allowance(s,0,E('600'),E('100'));await backed(s);
 });
});
