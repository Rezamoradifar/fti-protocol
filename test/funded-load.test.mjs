import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,formatEther as F,MaxUint256} from 'ethers';
import {deploySuite,settle,checkAccounting} from '../scripts/lib.mjs';

test('funded binary and token V2: 100 registrations, buys, transfers and normal full user exits without emergency or waiting caps',async()=>{
 const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:140},chain:{chainId:31337,time:new Date('2026-10-04T00:00:00Z')},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 try{
  const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
  const signers=await Promise.all(Array.from({length:140},(_,i)=>p.getSigner(i)));
  const s=await deploySuite(signers,{tokenContract:'FTIReserveToken',binaryContract:'FundedBinaryPlan'});
  const ids=Array.from({length:100},(_,i)=>36+i),parents=Array.from({length:16},(_,i)=>15+i);
  let parentCursor=0,childSide=0,checks=0,previousR=0n,previousS=0n,previousPrice=E('0.1');

  for(let i=0;i<31;i++){await(await s.usd.connect(signers[i]).faucet()).wait();await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();await(await s.binary.connect(signers[i]).addUnits(1)).wait();}

  async function check(strictGrowth=false){
    const r=await s.token.reserve(),supply=await s.token.totalSupply(),price=await s.token.price();
    if(strictGrowth&&previousS>0n)assert(r*previousS>previousR*supply);
    assert(price>=previousPrice); // Initial and fully redeemed states retain their reference price.
    if(strictGrowth&&previousS>0n)assert(price>previousPrice);
    if(supply>0n){const[,,gross]=await s.token.quoteSell(supply);assert(gross<=r);}
    await checkAccounting(s);
    const[pointCredits,pointBook,builderCredits,builderBook]=await s.binary.fundingAccounting();
    assert.equal(pointCredits,pointBook);assert.equal(builderCredits,builderBook);
    previousR=r;previousS=supply;previousPrice=price;checks++;
  }


  for(const i of ids){
    await(await s.usd.connect(signers[i]).faucet()).wait();
    await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();
    await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();
    const sponsor=parents[parentCursor];
    await(await s.binary.connect(signers[i]).register(s.addresses[sponsor],1)).wait();
    parents.push(i);if(++childSide===2){childSide=0;parentCursor++;}
    await check(false);
  }
  assert.equal(await s.binary.memberCount(),131n);
  assert.equal(await s.token.walletClock(),100n);
  await settle(s,p,25);await check(false);
  
  const reward=await s.binary.pendingReward(s.addresses[0]);assert(reward>0n);
  const cashBefore=await s.usd.balanceOf(s.addresses[0]);await(await s.binary.claim()).wait();
  assert.equal((await s.usd.balanceOf(s.addresses[0]))-cashBefore,reward);

  let usdIn=0n,usdOut=0n,liveSupport=0n;
  for(const[j,i]of ids.entries()){
    const amount=E(String(10+j%17));
    const q=await s.token.connect(signers[i]).quoteBuy(amount);
    await(await s.token.connect(signers[i]).buy(amount,q,MaxUint256)).wait();
    usdIn+=amount;await check(true);
    if(j===49){
      // Support after shares exist is owned live backing, unlike pre-mint support.
      await(await s.binary.connect(signers[i]).addUnits(1)).wait();
      liveSupport+=E('5');await check(true);
    }
  }
  const buyPeak=await s.token.price();

  for(let j=0;j<20;j++){
    const from=ids[j],to=ids[(j+37)%ids.length],amount=(await s.token.balanceOf(s.addresses[from]))/10n;
    await(await s.token.connect(signers[from]).transfer(s.addresses[to],amount)).wait();
    await check(true);
  }

  assert.equal(await s.token.emergencyExit(),false);

  for(let j=0;j<100;j++){
    const i=ids[(j*37)%100],balance=await s.token.balanceOf(s.addresses[i]);
    if(balance===0n)continue;
    const before=await s.usd.balanceOf(s.addresses[i]),finalRedemption=balance===(await s.token.totalSupply());
    const[out]=await s.token.quoteSell(balance);
    await(await s.token.connect(signers[i]).sell(balance,out,MaxUint256,{gasLimit:2000000})).wait();
    assert.equal((await s.usd.balanceOf(s.addresses[i]))-before,out);
    usdOut+=out;await check(!finalRedemption);
  }

  for(const i of ids)assert.equal(await s.token.balanceOf(s.addresses[i]),0n);
  assert.equal(await s.token.totalSupply(),0n);
  assert.equal(await s.token.reserve(),0n);
  assert.equal(await s.token.emergencyExit(),false);
  assert.equal(await s.token.lifecycleClosed(),true);
  assert.equal(usdOut,usdIn+liveSupport,'complete normal exit returns buys plus live-supply support; pre-mint support remains protected');
  assert.equal(await s.token.unallocatedReserve(),E('655'));assert.equal(await s.usd.balanceOf(s.token.target),E('655'));
  assert((await s.token.price())>=buyPeak);
  assert((await s.token.price())>0n);
  assert.equal(checks,322);
  console.log('FUNDED_V2_100_USERS',JSON.stringify({registered:100,pointRewardClaimed:F(reward),buys:100,transfers:20,sells:100,exitMode:'normal-pressure-fees-final-full-refund',checks,usdIn:F(usdIn),liveSupport:F(liveSupport),usdOut:F(usdOut),priceAfterBuys:F(buyPeak),finalPrice:F(await s.token.price()),finalSupply:F(await s.token.totalSupply()),reserve:F(await s.token.reserve()),protectedUnallocated:F(await s.token.unallocatedReserve())}));
 }finally{await engine.disconnect();}
});
