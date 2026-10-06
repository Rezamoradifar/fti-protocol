import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,formatEther as F,MaxUint256} from 'ethers';
import {deploySuite,checkAccounting} from '../scripts/lib.mjs';
import {sellQuote} from '../core/reserve-reference.mjs';

let engine,p,signers,s,snapshot;
before(async()=>{
 engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:60},chain:{chainId:31337,time:new Date('2026-10-04T00:00:00Z')},miner:{blockGasLimit:30000000}});
 p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 signers=await Promise.all(Array.from({length:60},(_,i)=>p.getSigner(i)));
 s=await deploySuite(signers,{tokenContract:'FTIReserveToken',binaryContract:'FundedBinaryPlan'});
 for(const i of [0,41]){
   await(await s.usd.connect(signers[i]).faucet()).wait();
   await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();
   await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();
 }
 snapshot=await p.send('evm_snapshot',[]);
});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{await engine.disconnect();});

async function activateEmergency(){
 const id=await s.council.count();
 const data=s.token.interface.encodeFunctionData('activateEmergencyExit');
 await(await s.council.connect(signers[31]).propose(s.token.target,data)).wait();
 for(const i of [32,33,34,35])await(await s.council.connect(signers[i]).approve(id)).wait();
 await(await s.council.connect(signers[31]).execute(id)).wait();
 assert.equal(await s.token.emergencyExit(),true);
}
async function seedAndBuy(amount='100'){
 await(await s.binary.addUnits(1)).wait(); // 5 USD support, zero FTI mint
 assert.equal(await s.token.totalSupply(),0n);
 await(await s.token.buy(E(amount),0,MaxUint256)).wait();
}

test('starts with zero reserve and supply, and a $0.10 bootstrap reference',async()=>{
 assert.equal(await s.token.reserve(),0n);
 assert.equal(await s.token.totalSupply(),0n);
 assert.equal(await s.token.circulatingSupply(),0n);
 assert.equal(await s.token.anchorSupply(),0n);
 assert.equal(await s.token.price(),E('0.1'));
 await checkAccounting(s);
});

test('binary registration/funding supports reserve but never mints the first FTI',async()=>{
 await(await s.binary.addUnits(1)).wait();
 assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.unallocatedReserve(),E('5'));
 assert.equal(await s.token.totalSupply(),0n);
 assert.equal(await s.token.price(),E('0.1'));
 assert.equal(await s.token.walletClock(),0n);
 await(await s.binary.connect(signers[41]).register(s.addresses[15],1)).wait();
 assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.unallocatedReserve(),E('10'));
 assert.equal(await s.token.totalSupply(),0n);
 assert.equal(await s.token.walletClock(),1n);
 await checkAccounting(s);
});

test('first $100 buy mints 970 user tokens and retains the entire payment as backing',async()=>{
 await(await s.binary.addUnits(1)).wait();
 const q=await s.token.quoteBuy(E('100'));
 assert.equal(q,E('970'));
 await(await s.token.buy(E('100'),q,MaxUint256)).wait();
 assert.equal(await s.token.balanceOf(s.addresses[0]),E('970'));
 assert.equal(await s.token.totalSupply(),E('970'));
 assert.equal(await s.token.reserve(),E('100'));assert.equal(await s.token.unallocatedReserve(),E('5'));
 assert((await s.token.price())>E('0.1'));
 await checkAccounting(s);
});

test('tokens are immediately unlocked; transfers burn 3%, credit 97% and never move USD',async()=>{
 await seedAndBuy();
 assert.equal(await s.token.locked(s.addresses[0]),0n);
 assert.equal(await s.token.unlocked(s.addresses[0]),E('970'));
 assert.equal(await s.token.lockCount(s.addresses[0]),0n);
 const supply=await s.token.totalSupply(),reserve=await s.token.reserve(),price=await s.token.price();
 const usdBefore=await Promise.all([s.usd.balanceOf(s.addresses[0]),s.usd.balanceOf(s.addresses[1]),s.usd.balanceOf(s.token.target)]);
 await(await s.token.transfer(s.addresses[1],E('1'))).wait();
 assert.equal(await s.token.balanceOf(s.addresses[1]),E('0.97'));
 assert.equal(await s.token.balanceOf(s.addresses[0]),E('969'));
 assert.equal(await s.token.totalSupply(),supply-E('0.03'));
 assert.equal(await s.token.reserve(),reserve);
 assert((await s.token.price())>price);
 assert.deepEqual(await Promise.all([s.usd.balanceOf(s.addresses[0]),s.usd.balanceOf(s.addresses[1]),s.usd.balanceOf(s.token.target)]),usdBefore);
 // A small immediate sale works without a 30/90-day or wallet-count unlock.
 const before=await s.usd.balanceOf(s.addresses[0]);
 await(await s.token.sell(E('4'),0,MaxUint256)).wait();
 assert((await s.usd.balanceOf(s.addresses[0]))>before);
 await checkAccounting(s);
});

test('normal partial sales have no 5% hard cap and exact trade-size-only fees',async()=>{
 await seedAndBuy();
 assert.equal(await s.token.MAX_SINGLE_SELL_BPS(),0n);assert.equal(await s.token.MAX_HOURLY_GROSS_SELL_BPS(),0n);
 assert.equal(await s.token.SELL_CAPS_ACTIVE(),false);
 const reserve=await s.token.reserve(),supply=await s.token.totalSupply();
 for(const amount of ['1','20','60','485','969','970']){
  const tokens=E(amount),expected=sellQuote(tokens,reserve,supply);
  assert.equal(await s.token.sellImpactBps(tokens),expected.impactBps);
  assert.deepEqual(Array.from(await s.token.quoteSell(tokens)),[expected.payout,expected.feeBps,expected.gross]);
  assert(expected.feeBps<=1000n);
 }
 const amount=E('485'),expected=sellQuote(amount,reserve,supply);
 assert.equal(expected.feeBps,300n);
 await(await s.token.sell(amount,expected.payout,MaxUint256)).wait();
 assert.equal(await s.token.reserve(),reserve-expected.payout);assert.equal(await s.token.totalSupply(),supply-amount);
 assert.equal(await s.token.pressureWad(),0n);
 await checkAccounting(s);
});

test('5-of-7 council vote activates redemption-only emergency mode without an admin liquidity transfer',async()=>{
 await seedAndBuy();
 await activateEmergency();
 assert.equal(await s.token.paused(),true);
 await assert.rejects(async()=>{const tx=await s.token.buy(E('1'),0,MaxUint256);await tx.wait();});
 const before=await s.usd.balanceOf(s.addresses[0]);
 const bal=await s.token.balanceOf(s.addresses[0]),priceBefore=await s.token.price();
 const[out,fee]=await s.token.quoteSell(bal);assert.equal(fee,0n);
 await(await s.token.sell(bal,out,MaxUint256)).wait(); // Exact final redemption is also fee-free in emergency mode
 assert.equal((await s.usd.balanceOf(s.addresses[0]))-before,out);
 assert.equal(await s.token.totalSupply(),0n);
 assert.equal(await s.token.reserve(),0n);
 assert.equal(await s.token.price(),priceBefore);
 assert.equal(await s.token.lifecycleClosed(),true);
 assert.equal(await s.token.emergencyExit(),true);
 await checkAccounting(s);
});

test('a 10x milestone does not multiply base Member binary-owned purchase quota',async()=>{
 await seedAndBuy();
 const launch=await s.token.launchPrice();
 assert(launch>0n);
 assert.equal(await s.token.priceMultiplier(),1n);
 // 200 membership units inject 1,000 support USD without minting FTI.
 await(await s.binary.addUnits(200)).wait();
 assert((await s.token.price())>=launch*10n);
 assert.equal(await s.token.priceMultiplier(),2n);
 assert.equal(await s.token.buyLimit(s.addresses[0]),E('100500'));
 assert.equal(await s.token.remainingAllowance(s.addresses[0]),E('100400'));
});

test('partial sells burn the full sale amount and retain every fee dollar for remaining holders',async()=>{
 await seedAndBuy();
 const oldR=await s.token.reserve(),oldS=await s.token.totalSupply(),oldPrice=await s.token.price();
 const tokens=E('40'),[out,fee,gross]=await s.token.quoteSell(tokens);
 const expected=sellQuote(tokens,oldR,oldS);
 assert.equal(fee,expected.feeBps);assert.equal(fee,300n);
 assert.equal(gross,tokens*oldR/oldS);
 assert.equal(out,expected.payout);
 await(await s.token.sell(tokens,out,MaxUint256)).wait();
 const newR=await s.token.reserve(),newS=await s.token.totalSupply();
 assert.equal(newR,oldR-out);
 assert.equal(newS,oldS-tokens);
 assert.equal(await s.token.balanceOf(s.addresses[0]),newS);
 assert(newR*oldS>oldR*newS);
 assert((await s.token.price())>oldPrice);
 await checkAccounting(s);
 console.log('FTI_V2_FEE_CHECK',JSON.stringify({price:F(await s.token.price()),retainedUSD:F(gross-out)}));
});


test('normal buys and sells strictly advance displayed price; sub-price-step dust reverts atomically',async()=>{
 await(await s.binary.addUnits(2000)).wait();
 await(await s.token.buy(E('500000'),0,MaxUint256)).wait();
 const r=await s.token.reserve(),supply=await s.token.totalSupply(),oldPrice=await s.token.price();
 const amount=2000000n,userMint=await s.token.quoteBuy(amount);
 assert(userMint>=await s.token.MIN_MINT());
 assert((r+amount)*supply>r*(supply+userMint));
 assert.equal((r+amount)*E('1')/(supply+userMint),oldPrice);
 const state=async()=>Promise.all([s.token.reserve(),s.token.totalSupply(),s.token.balanceOf(s.addresses[0]),s.token.remainingAllowance(s.addresses[0]),s.usd.balanceOf(s.addresses[0]),s.token.sellWindowGross(),s.token.pressureWad(),s.token.lastPartialSellAt()]);
 const before=await state();
 await assert.rejects(s.token.buy.staticCall(amount,0,MaxUint256),{reason:'price step too small'});
 await assert.rejects(async()=>{await(await s.token.buy(amount,0,MaxUint256,{gasLimit:3000000})).wait();});
 assert.deepEqual(await state(),before);
 await assert.rejects(s.token.sell.staticCall(1000000n,0,MaxUint256),{reason:'price step too small'});
 await assert.rejects(async()=>{await(await s.token.sell(1000000n,0,MaxUint256,{gasLimit:3000000})).wait();});
 assert.deepEqual(await state(),before);
 await(await s.token.buy(E('1'),0,MaxUint256)).wait();
 const afterBuy=await s.token.price();assert(afterBuy>oldPrice);
 await(await s.token.sell(E('1'),0,MaxUint256)).wait();
 assert((await s.token.price())>afterBuy);
 await checkAccounting(s);
});

test('normal sales exceed former hourly capacity without pressure or timer fees',async()=>{
 await seedAndBuy();
 const initialReserve=await s.token.reserve();let grossSold=0n;
 for(let i=0;i<6;i++){
  const reserve=await s.token.reserve(),supply=await s.token.totalSupply(),price=await s.token.price(),beforeUSD=await s.usd.balanceOf(s.addresses[0]);
  const expected=sellQuote(E('35'),reserve,supply);
  await(await s.token.sell(E('35'),expected.payout,MaxUint256,{gasLimit:3000000})).wait();
  assert.equal(await s.token.reserve(),reserve-expected.payout);assert.equal(await s.token.totalSupply(),supply-E('35'));
  assert.equal((await s.usd.balanceOf(s.addresses[0]))-beforeUSD,expected.payout);
  assert.equal(await s.token.pressureWad(),0n);assert.equal(await s.token.lastPartialSellAt(),0n);
  assert.equal(expected.feeBps,300n);grossSold+=expected.gross;
  assert((await s.token.price())>price);assert((await s.token.reserve())*supply>reserve*(await s.token.totalSupply()));
 }
 assert(grossSold>initialReserve*1500n/10000n);
 assert.equal(await s.token.sellWindowStart(),0n);assert.equal(await s.token.sellWindowStartReserve(),0n);assert.equal(await s.token.sellWindowGross(),0n);
 const quote=Array.from(await s.token.quoteSell(E('35')));
 await p.send('evm_increaseTime',[3600]);await p.send('evm_mine',[]);
 assert.deepEqual(Array.from(await s.token.quoteSell(E('35'))),quote);assert.equal(await s.token.currentSellPressure(),0n);
 await activateEmergency();
 const balance=await s.token.balanceOf(s.addresses[0]),reserve=await s.token.reserve();
 const[out,fee]=await s.token.quoteSell(balance);assert.equal(fee,0n);assert.equal(out,reserve);
 await(await s.token.sell(balance,out,MaxUint256)).wait();
 assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.totalSupply(),0n);
 assert.equal(await s.token.pressureWad(),0n);assert.equal(await s.token.lastPartialSellAt(),0n);
 await checkAccounting(s);
});
