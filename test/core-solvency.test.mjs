import {test} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,MaxUint256} from 'ethers';
import {deploySuite,checkAccounting} from '../scripts/lib.mjs';
// This checks the exact reserve inequality directly against EVM state, not a copy of quoteBuy.
test('seeded mixed trades, burns and full exit preserve exact integer reserve coverage',async()=>{
 const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:45},chain:{chainId:31337},miner:{blockGasLimit:30000000}});
 try{
  const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
  const signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i))),s=await deploySuite(signers),ids=[15,16,17,18,19,20,21,22];
  const V=await s.token.V(),S0=await s.token.S0();let seed=20260930,checks=0,sales=0,transfers=0;
  const rnd=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return Math.floor((seed>>>0)/4294967296*n);};
  async function invariant(){const supply=await s.token.totalSupply(),reserve=await s.token.reserve(),curve=S0+supply;assert((reserve+V)*S0**5n>=V*curve**5n,'reserve backing invariant');const[,,gross]=await s.token.quoteSell(supply);assert(gross<=reserve,'gross redemption exceeds real reserve');const balances=await Promise.all(ids.map(i=>s.token.balanceOf(s.addresses[i])));assert.equal(balances.reduce((a,b)=>a+b,0n),supply);await checkAccounting(s);checks++;}
  for(const i of ids){await(await s.usd.connect(signers[i]).faucet()).wait();await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();await(await s.binary.connect(signers[i]).addUnits(10)).wait();await invariant();}
  for(let j=0;j<32;j++){const i=j<ids.length?ids[j]:ids[rnd(ids.length)],amount=E(String(1+rnd(99)));await(await s.token.connect(signers[i]).buy(amount,0,MaxUint256)).wait();await invariant();}
  await p.send('evm_increaseTime',[91*86400]);await p.send('evm_mine',[]);
  for(let j=0;j<24;j++){const i=ids[rnd(ids.length)],balance=await s.token.unlocked(s.addresses[i]),amount=balance/BigInt(2+rnd(5));if(!amount)continue;if(rnd(2)){await(await s.token.connect(signers[i]).sell(amount,0,MaxUint256)).wait();sales++;}else{const to=ids[(ids.indexOf(i)+1+rnd(ids.length-1))%ids.length];await(await s.token.connect(signers[i]).transfer(s.addresses[to],amount)).wait();transfers++;}await invariant();}
  for(const i of ids){const balance=await s.token.balanceOf(s.addresses[i]);if(balance){await(await s.token.connect(signers[i]).sell(balance,0,MaxUint256)).wait();await invariant();}}
  assert.equal(await s.token.totalSupply(),0n);assert(sales>0&&transfers>0,'mixed phase must exercise both sales and burns');assert.equal(checks,72);console.log('EXACT_EVM_INVARIANT_CHECKS',checks,'mixed sales',sales,'transfers',transfers);
 }finally{await engine.disconnect();}
});
