import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,formatEther as F,MaxUint256,ZeroHash,id} from 'ethers';
import {deploySuite,settle,checkAccounting} from '../scripts/lib.mjs';

// Real current lifecycle token + unmodified BinaryPlan, in-memory Ganache only.
// No TEST_ONLY rank seeding, emergency exits, EOA governance or storage mutation.
const DELAY=72*3600;
const tx=async promise=>(await promise).wait();
async function councilCall(s,signers,target,data){
 const proposal=await s.council.count();await tx(s.council.connect(signers[31]).propose(target,data));
 for(let i=32;i<=35;i++)await tx(s.council.connect(signers[i]).approve(proposal));
 await tx(s.council.connect(signers[39]).execute(proposal));
}

test('Retirement current lifecycle: 100 users mixed buys/transfers and complete normal exits, fee claim, then separately governed permanent closure and retirement',{timeout:600000},async()=>{
 const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:140,deterministic:true},chain:{chainId:31337,time:new Date('2026-10-05T00:00:00Z')},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 try{
  const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
  const signers=await Promise.all(Array.from({length:140},(_,i)=>p.getSigner(i)));
  const s=await deploySuite(signers,{tokenContract:'FTIRetirementReviewToken',binaryContract:'BinaryPlan'});
  assert.equal(s.binary.interface.hasFunction('TEST_ONLY_setPaidRank'),false);
  assert.equal(await s.token.developmentFund(),s.addresses[35]);assert.equal(await s.binary.development(),s.addresses[35]);
  assert.equal(await s.council.OWNER_COUNT(),7n);assert.equal(await s.council.THRESHOLD(),5n);assert.equal(await s.timelock.getMinDelay(),BigInt(DELAY));
  // These 100 user identities do not overlap the 31 genesis or 7 Council owners.
  const ids=Array.from({length:100},(_,i)=>40+i),parents=Array.from({length:16},(_,i)=>15+i);
  let parentCursor=0,side=0,checks=0,previousR=0n,previousS=0n,previousPrice=E('0.1');
  let usdIn=0n,usdOut=0n,liveSupport=0n,totalFeesPaid=0n,buys=0,sells=0;
  async function check(strictGrowth=false){
   const r=await s.token.reserve(),supply=await s.token.totalSupply(),price=await s.token.price();
   if(strictGrowth&&previousS>0n)assert(r*previousS>previousR*supply,'exact live reserve/share ratio strictly increases');
   assert(price>=previousPrice);await checkAccounting(s);
   const protectedFund=await s.token.priceProtectionFund(),devClaim=await s.token.developmentFeeClaim();
   assert.equal(await s.usd.balanceOf(s.token.target),r+protectedFund+devClaim,'live R + protected support + owed development claim exhaust tracked collateral');
   if(supply>0n){const[fee,payout,gross]=await s.token.sellFeeQuote(supply);assert.equal(gross,r);assert.equal(payout+fee,r);assert(payout<r,'normal full-supply quote is net of current fee');}
   previousR=r;previousS=supply;previousPrice=price;checks++;
  }
  async function purchase(i,amount){
   const quote=await s.token.quoteBuy(amount),spent=await s.binary.tokenBuySpent(s.addresses[i]);
   await tx(s.token.connect(signers[i]).buy(amount,quote,MaxUint256));usdIn+=amount;buys++;
   assert.equal(await s.binary.tokenBuySpent(s.addresses[i]),spent+amount);await check(true);
  }
  for(const i of ids){
   await tx(s.usd.connect(signers[i]).faucet());await tx(s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256));await tx(s.usd.connect(signers[i]).approve(s.token.target,MaxUint256));
   await tx(s.binary.connect(signers[i]).register(s.addresses[parents[parentCursor]],1));
   parents.push(i);if(++side===2){side=0;parentCursor++;}await check();
  }
  assert.equal(await s.binary.memberCount(),131n);assert.equal(await s.token.walletClock(),100n);
  assert.equal(await s.token.priceProtectionFund(),E('500'));await settle(s,p,100);await check();
  for(const[j,i]of ids.entries()){
   await purchase(i,E(String(10+j%17)));
   if(j%25===0){
    await tx(s.binary.connect(signers[i]).addUnits(1));liveSupport+=E('5');await check(true);
    // A funded extra unit authorizes this real size-fee trade beyond the $500 floor.
    const fee=(await s.token.buyFeeQuote(E('650')))[0];assert(fee>E('19.5'));
    await purchase(i,E('650'));
   }
  }
  const buyPeak=await s.token.price();
  for(let j=0;j<20;j++){
   const from=ids[j],to=ids[(j+37)%ids.length],amount=(await s.token.balanceOf(s.addresses[from]))/10n;
   const beforeTo=await s.token.balanceOf(s.addresses[to]),burn=(amount*3n+99n)/100n;
   await tx(s.token.connect(signers[from]).transfer(s.addresses[to],amount));
   assert.equal(await s.token.balanceOf(s.addresses[to])-beforeTo,amount-burn);await check(true);
  }
  assert.equal(await s.token.emergencyExit(),false);
  const sumShares=(await Promise.all(ids.map(i=>s.token.balanceOf(s.addresses[i])))).reduce((a,b)=>a+b,0n);
  assert.equal(sumShares,await s.token.totalSupply());
  let terminalFee=0n,terminalR=0n,terminalOut=0n;
  for(let j=0;j<100;j++){
   const i=ids[(j*37)%100],balance=await s.token.balanceOf(s.addresses[i]);assert(balance>0n);
   const before=await s.usd.balanceOf(s.addresses[i]),last=balance===await s.token.totalSupply(),spent=await s.binary.tokenBuySpent(s.addresses[i]);
   const[fee,out,gross]=await s.token.sellFeeQuote(balance);assert(fee>0n);assert.equal(out+fee,gross);
   if(last){terminalFee=fee;terminalR=await s.token.reserve();terminalOut=out;assert.equal(gross,terminalR);assert(out<terminalR);}
   await tx(s.token.connect(signers[i]).sell(balance,out,MaxUint256,{gasLimit:2000000}));
   assert.equal(await s.usd.balanceOf(s.addresses[i])-before,out);assert.equal(await s.binary.tokenBuySpent(s.addresses[i]),spent);
   usdOut+=out;sells++;await check(!last);
  }
  for(const i of ids)assert.equal(await s.token.balanceOf(s.addresses[i]),0n);
  assert.equal(sells,100);assert.equal(buys,104);assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.token.reserve(),0n);
  assert.equal(await s.token.lifecycleClosed(),true);assert.equal(await s.token.permanentlyRetired(),false);assert.equal(await s.token.emergencyExit(),false);
  assert.equal(await s.token.developmentFeeClaim(),terminalFee);assert.equal(terminalOut+terminalFee,terminalR);
  assert.equal(usdOut+terminalFee,usdIn+liveSupport,'normal holders receive net proceeds; residual terminal fee is a fixed development liability');
  assert.equal(await s.token.priceProtectionFund(),E('500'));assert.equal(await s.usd.balanceOf(s.token.target),E('500')+terminalFee);
  assert((await s.token.price())>=buyPeak);
  const dev=s.addresses[35],devBefore=await s.usd.balanceOf(dev),callerBefore=await s.usd.balanceOf(s.addresses[39]);
  await tx(s.token.connect(signers[39]).claimDevelopmentFees());totalFeesPaid+=terminalFee;
  assert.equal(await s.usd.balanceOf(dev)-devBefore,terminalFee);assert.equal(await s.usd.balanceOf(s.addresses[39]),callerBefore);
  assert.equal(await s.token.developmentFeeClaim(),0n);await check();
  // Quiesce real membership activity, including four live-support top-up jobs.
  await councilCall(s,signers,s.binary.target,s.binary.interface.encodeFunctionData('pause'));
  await settle(s,p,100);assert.equal(await s.binary.totalAuto(),0n);assert.equal(await s.binary.epochUnits(),0n);
  assert.equal(await s.binary.jobCursor(),await s.binary.jobCount());await check();
  const binaryBuckets=async()=>Promise.all([s.usd.balanceOf(s.binary.target),s.binary.totalPending(),s.binary.pointPool(),s.binary.builderAccounted(),s.binary.totalAuto()]);
  const cashBeforeRetirement=await binaryBuckets();assert(cashBeforeRetirement[0]>0n,'binary beneficiaries still own their separate cash');
  assert.equal(await s.token.buysPermanentlyClosed(),false);
  assert((await s.token.quoteBuy(E('1')))>0n,'ordinary fully redeemed lifecycle remains restartable before permanent closure');
  // Shutdown and retirement are distinct nonce-bound Council votes and delayed
  // timelock operations. Closing buys alone cannot sweep any protected support.
  for(const action of ['closeBuysPermanently','retirePermanently']){
   const selector=s.token.interface.getFunction(action).selector;
   await councilCall(s,signers,s.token.target,s.token.interface.encodeFunctionData('approveRetirementAction',[selector,await s.token.lifecycleNonce()]));
   const data=s.token.interface.encodeFunctionData(action),salt=id(`current-retirement-100-user-load-${action}`);
   await councilCall(s,signers,s.timelock.target,s.timelock.interface.encodeFunctionData('schedule',[s.token.target,0,data,ZeroHash,salt,DELAY]));
   await assert.rejects(s.timelock.connect(signers[39]).execute.staticCall(s.token.target,0,data,ZeroHash,salt));
   await p.send('evm_increaseTime',[DELAY]);await p.send('evm_mine',[]);
   await tx(s.timelock.connect(signers[39]).execute(s.token.target,0,data,ZeroHash,salt,{gasLimit:2000000}));
   assert.equal(await s.token.councilApprovalAt(selector),0n,'each action consumes only its own mature approval');
   assert.deepEqual(await binaryBuckets(),cashBeforeRetirement,'lifecycle governance preserves Binary cash buckets');
   if(action==='closeBuysPermanently'){
    assert.equal(await s.token.buysPermanentlyClosed(),true);assert.equal(await s.token.permanentlyRetired(),false);
    assert.equal(await s.token.priceProtectionFund(),E('500'));assert.equal(await s.usd.balanceOf(dev)-devBefore,terminalFee);
    await assert.rejects(s.token.quoteBuy(E('1')),{reason:'buys permanently closed'});await check();
   }
  }
  assert.equal(await s.token.permanentlyRetired(),true);assert.equal(await s.token.paused(),true);
  assert.equal(await s.token.priceProtectionFund(),0n);assert.equal(await s.usd.balanceOf(s.token.target),0n);
  assert.equal(await s.usd.balanceOf(dev)-devBefore,terminalFee+E('500'));assert.deepEqual(await binaryBuckets(),cashBeforeRetirement,'retirement never sweeps Binary beneficiary cash');
  assert.equal(usdOut+totalFeesPaid+E('500'),usdIn+liveSupport+E('500'),'every token-side dollar ends at holders or fixed development');await check();
  const owed=await s.binary.pendingReward(dev),beforeClaim=await s.usd.balanceOf(dev);assert(owed>0n);
  await tx(s.binary.connect(signers[35]).claim());assert.equal(await s.usd.balanceOf(dev)-beforeClaim,owed);await check();
  console.log('RETIREMENT_100_USER_CURRENT_LIFECYCLE',JSON.stringify({token:'FTIRetirementReviewToken',binary:'BinaryPlan',registered:100,buys,liveSupportTopups:4,transfers:20,sells,checks,exitMode:'normal-current-fee-then-paid-development-claim',usdIn:F(usdIn),liveSupport:F(liveSupport),holderProceeds:F(usdOut),terminalReserve:F(terminalR),terminalHolderPayout:F(terminalOut),terminalDevelopmentFee:F(terminalFee),retiredProtectedSupport:'500',separatelyGovernedPermanentClosure:true,permanentlyRetired:true,finalSupply:F(await s.token.totalSupply()),finalTokenCash:F(await s.usd.balanceOf(s.token.target)),binaryCashBeforeRetirement:F(cashBeforeRetirement[0]),binaryClaimAfterRetirement:F(owed)}));
 }finally{await engine.disconnect();}
});
