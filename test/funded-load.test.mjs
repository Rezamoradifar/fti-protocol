import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,formatEther as F,MaxUint256} from 'ethers';
import {deploySuite,settle,checkAccounting} from '../scripts/lib.mjs';

test('funded binary and token V2: 100 registrations, buys, transfers and emergency full user exits',async()=>{
 const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:140},chain:{chainId:31337,time:new Date('2026-10-04T00:00:00Z')},miner:{blockGasLimit:30000000}});
 try{
  const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
  const signers=await Promise.all(Array.from({length:140},(_,i)=>p.getSigner(i)));
  const s=await deploySuite(signers,{tokenContract:'FTIReserveToken',binaryContract:'FundedBinaryPlan'});
  const ids=Array.from({length:100},(_,i)=>36+i),parents=Array.from({length:16},(_,i)=>15+i);
  let parentCursor=0,childSide=0,checks=0,previousR=0n,previousS=0n,previousPrice=0n;

  for(let i=0;i<31;i++){await(await s.usd.connect(signers[i]).faucet()).wait();await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();await(await s.binary.connect(signers[i]).addUnits(1)).wait();}

  async function check(strictGrowth=false){
    const r=await s.token.reserve(),supply=await s.token.totalSupply(),price=await s.token.price();
    if(strictGrowth&&previousS>0n)assert(r*previousS>previousR*supply);
    assert(price>=previousPrice);
    if(supply>0n){const[,,gross]=await s.token.quoteSell(supply);assert(gross<=r);}
    await checkAccounting(s);
    const[pointCredits,pointBook,builderCredits,builderBook]=await s.binary.fundingAccounting();
    assert.equal(pointCredits,pointBook);assert.equal(builderCredits,builderBook);
    previousR=r;previousS=supply;previousPrice=price;checks++;
  }
  async function activateEmergency(){
    const id=await s.council.count();
    const data=s.token.interface.encodeFunctionData('activateEmergencyExit');
    await(await s.council.connect(signers[31]).propose(s.token.target,data)).wait();
    for(const i of [32,33,34,35])await(await s.council.connect(signers[i]).approve(id)).wait();
    await(await s.council.connect(signers[31]).execute(id)).wait();
    assert.equal(await s.token.emergencyExit(),true);
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

  let usdIn=0n,usdOut=0n;
  for(const[j,i]of ids.entries()){
    const amount=E(String(10+j%17));
    const q=await s.token.connect(signers[i]).quoteBuy(amount);
    await(await s.token.connect(signers[i]).buy(amount,q,MaxUint256)).wait();
    usdIn+=amount;await check(true);
  }
  const buyPeak=await s.token.price();

  for(let j=0;j<20;j++){
    const from=ids[j],to=ids[(j+37)%ids.length],amount=(await s.token.balanceOf(s.addresses[from]))/10n;
    await(await s.token.connect(signers[from]).transfer(s.addresses[to],amount)).wait();
    await check(false);
  }

  await activateEmergency();

  for(let j=0;j<100;j++){
    const i=ids[(j*37)%100],balance=await s.token.balanceOf(s.addresses[i]);
    if(balance===0n)continue;
    const before=await s.usd.balanceOf(s.addresses[i]);
    const[out]=await s.token.quoteSell(balance);
    await(await s.token.connect(signers[i]).sell(balance,out,MaxUint256)).wait();
    assert.equal((await s.usd.balanceOf(s.addresses[i]))-before,out);
    usdOut+=out;await check(true);
  }

  for(const i of ids)assert.equal(await s.token.balanceOf(s.addresses[i]),0n);
  const animalA=await s.token.animalSupportA(),animalB=await s.token.animalSupportB();
  assert.equal(await s.token.totalSupply(),(await s.token.balanceOf(animalA))+(await s.token.balanceOf(animalB)));
  assert((await s.token.price())>=buyPeak);
  assert.equal(checks,321);
  console.log('FUNDED_V2_100_USERS',JSON.stringify({registered:100,pointRewardClaimed:F(reward),buys:100,transfers:20,sells:100,checks,usdIn:F(usdIn),usdOut:F(usdOut),priceAfterBuys:F(buyPeak),finalPrice:F(await s.token.price()),animalSupply:F(await s.token.totalSupply()),reserve:F(await s.token.reserve())}));
 }finally{await engine.disconnect();}
});
