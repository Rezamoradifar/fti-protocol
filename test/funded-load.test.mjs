import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,formatEther as F,MaxUint256} from 'ethers';
import {deploySuite,settle,checkAccounting} from '../scripts/lib.mjs';

test('funded binary and reserve token: 100 registrations, buys and full exits with source-credit accounting',async()=>{
 const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:136},chain:{chainId:31337,time:new Date('2026-09-15T12:00:00Z')},miner:{blockGasLimit:30000000}});
 try{
  const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
  const signers=await Promise.all(Array.from({length:136},(_,i)=>p.getSigner(i))),s=await deploySuite(signers,{tokenContract:'FTIReserveToken',binaryContract:'FundedBinaryPlan'});
  const ids=Array.from({length:100},(_,i)=>36+i),parents=Array.from({length:16},(_,i)=>15+i);let parentCursor=0,childSide=0,checks=0;
  for(let i=0;i<31;i++){await(await s.usd.connect(signers[i]).faucet()).wait();await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();await(await s.binary.connect(signers[i]).addUnits(1)).wait();}
  let previousR=0n,previousS=0n,previousPrice=E('0.1');
  async function check(grew){const r=await s.token.reserve(),supply=await s.token.totalSupply(),price=await s.token.price();if(grew&&previousS)assert(r*previousS>previousR*supply);assert(price>=previousPrice);const cir=await s.token.circulatingSupply(),[,,gross]=await s.token.quoteSell(cir);assert(gross<=r);assert.equal(await s.token.balanceOf(s.token.target),await s.token.anchorSupply());await checkAccounting(s);const[pointCredits,pointBook,builderCredits,builderBook]=await s.binary.fundingAccounting();assert.equal(pointCredits,pointBook);assert.equal(builderCredits,builderBook);previousR=r;previousS=supply;previousPrice=price;checks++;}
  for(const i of ids){
   await(await s.usd.connect(signers[i]).faucet()).wait();await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();
   const sponsor=parents[parentCursor];await(await s.binary.connect(signers[i]).register(s.addresses[sponsor],1)).wait();parents.push(i);if(++childSide===2){childSide=0;parentCursor++;}await check(true);
  }
  assert.equal(await s.binary.memberCount(),131n);assert.equal(await s.token.walletClock(),100n);assert.equal(await s.token.reserve(),E('655'));await settle(s,p,25);await check(false);
  const reward=await s.binary.pendingReward(s.addresses[0]);assert(reward>0n);const cashBefore=await s.usd.balanceOf(s.addresses[0]);await(await s.binary.claim()).wait();assert.equal((await s.usd.balanceOf(s.addresses[0]))-cashBefore,reward);
  let usdIn=0n,usdOut=0n;
  for(const[j,i]of ids.entries()){const amount=E(String(10+j%17));await(await s.token.connect(signers[i]).buy(amount,await s.token.quoteBuy(amount),MaxUint256)).wait();usdIn+=amount;await check(true);}
  const buyPeak=await s.token.price();await p.send('evm_increaseTime',[91*86400]);await p.send('evm_mine',[]);
  for(let j=0;j<20;j++){const from=ids[j],to=ids[(j+37)%ids.length],amount=(await s.token.balanceOf(s.addresses[from]))/10n;await(await s.token.connect(signers[from]).transfer(s.addresses[to],amount)).wait();await check(true);}
  // Coprime stride exercises a non-registration exit ordering.
  for(let j=0;j<100;j++){const i=ids[(j*37)%100],balance=await s.token.balanceOf(s.addresses[i]),before=await s.usd.balanceOf(s.addresses[i]);const[out]=await s.token.quoteSell(balance);await(await s.token.connect(signers[i]).sell(balance,out,MaxUint256)).wait();assert.equal((await s.usd.balanceOf(s.addresses[i]))-before,out);usdOut+=out;await check(true);}
  assert.equal(await s.token.circulatingSupply(),0n);assert.equal(await s.token.totalSupply(),await s.token.anchorSupply());assert(usdOut<=usdIn);assert((await s.token.price())>buyPeak);assert.equal(checks,321);
  console.log('FUNDED_100_USERS',JSON.stringify({registered:100,activatedGenesis:31,pointRewardClaimed:F(reward),buys:100,transfers:20,sells:100,checks,usdIn:F(usdIn),usdOut:F(usdOut),priceAfterBuys:F(buyPeak),finalPrice:F(await s.token.price()),anchorReserve:F(await s.token.reserve()),finalCirculating:'0'}));
 }finally{await engine.disconnect();}
});
