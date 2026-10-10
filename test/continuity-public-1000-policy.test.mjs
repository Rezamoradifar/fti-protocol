import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,MaxUint256,Contract} from 'ethers';
import {deployOne,checkAccounting,artifact} from '../scripts/lib.mjs';
import {scenario,sellAmount,N,amounts} from '../tools/testnet-continuity-1000.mjs';

test('1000 public-chain schedule is funded; actual continuity proxies enforces cap and sale exemptions', {timeout:120000},async()=>{
 const scenarios=Array.from({length:N},(_,i)=>scenario(i));
 assert.equal(scenarios.length,1000);assert.deepEqual([...new Set(scenarios.map(s=>s.buy))],amounts);
 assert(scenarios.every(s=>Number.isInteger(s.units)&&s.units>=1&&s.buy<=500*s.units));
 const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:40},chain:{chainId:97},miner:{blockGasLimit:30000000}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 try{
  const signers=await Promise.all(Array.from({length:40},(_,i)=>p.getSigner(i))),addresses=await Promise.all(signers.map(s=>s.getAddress()));
  const sent=async t=>{const r=await(await t).wait();assert.equal(r.status,1);return r;};
  const usd=await deployOne('MockUSD',[],signers[0]),council=await deployOne('SevenGuardianCouncil',[addresses.slice(0,7)],signers[0]),timelock=await deployOne('FTITimelock',[council.target],signers[0]);
  const ti=await deployOne('FTIReserveTokenUpgradeable',[],signers[0]);
  const tp=await deployOne('FTIProxy',[ti.target,ti.interface.encodeFunctionData('initialize',[usd.target,timelock.target,council.target])],signers[0]);
  const token=new Contract(tp.target,artifact('FTIReserveTokenUpgradeable').abi,signers[0]);
  const bi=await deployOne('FundedBinaryPlanUpgradeable',[],signers[0]);
  const bp=await deployOne('FTIProxy',[bi.target,bi.interface.encodeFunctionData('initialize',[usd.target,token.target,timelock.target,council.target,addresses[39],addresses.slice(0,31)])],signers[0]);
  const binary=new Contract(bp.target,artifact('FundedBinaryPlanUpgradeable').abi,signers[0]);
  await sent(token.bind(binary.target));const contracts={usd,token,binary};
  for(let i=31;i<=33;i++){
   const w=signers[i];await sent(usd.connect(w).faucet());await sent(usd.connect(w).approve(binary.target,MaxUint256));await sent(usd.connect(w).approve(token.target,MaxUint256));
   if(i===31)await assert.rejects(()=>binary.connect(w).register.staticCall(addresses[15],0));
   await sent(binary.connect(w).register(addresses[i===33?16:15],i===31?1:20));
  }
  assert.equal(await token.supportReserve(),E('205'));assert.equal(await token.reserve(),0n);
  assert.equal(await binary.pointPool(),E('3690'));assert.equal(await binary.builderAccounted(),E('164'));assert.equal(await binary.pendingReward(addresses[39]),E('41'));
  const deadline=(await p.getBlock('latest')).timestamp+1200;
  await assert.rejects(()=>token.connect(signers[31]).buy.staticCall(E('501'),0,deadline),/allowance/);
  for(const [i,amount]of [[31,1],[32,10000],[33,10000]]){
   const before=await token.balanceOf(addresses[i]),quote=await token.quoteBuy(E(String(amount)));
   await sent(token.connect(signers[i]).buy(E(String(amount)),quote,deadline));
   assert.equal((await token.balanceOf(addresses[i]))-before,quote);await checkAccounting(contracts);
  }
  assert.equal(await token.reserve(),E('20001'));
  const held=await token.balanceOf(addresses[32]),large=sellAmount(E('10000'),held,await token.totalSupply(),await token.reserve());
  await assert.rejects(()=>token.connect(signers[32]).sell.staticCall(large,0,deadline),/single sell protection/);
  const small=sellAmount(E('499'),held,await token.totalSupply(),await token.reserve()),[quote,gross]=await token.quoteSell(small);
  assert(gross<=E('500'));const cash=await usd.balanceOf(addresses[32]),oldPrice=await token.price();
  await sent(token.connect(signers[32]).sell(small,quote,deadline));
  assert.equal((await usd.balanceOf(addresses[32]))-cash,quote);assert(await token.price()>=oldPrice);await checkAccounting(contracts);
 }finally{await engine.disconnect();}
});
