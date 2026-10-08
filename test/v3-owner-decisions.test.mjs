import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256} from 'ethers';
import {deployOne,settle,checkAccounting} from '../scripts/lib.mjs';
import {keeperStep} from '../scripts/keeper.mjs';
let engine,p,signers,addresses,usd,council,token,binary,snapshot;
before(async()=>{
  const name='test/fixtures/SupportStressV3.sol';
  const input={language:'Solidity',sources:{[name]:{content:fs.readFileSync(name,'utf8')}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
  const output=JSON.parse(solc.compile(JSON.stringify(input),{import:file=>{for(const candidate of [file,path.join('node_modules',file)])if(fs.existsSync(candidate))return{contents:fs.readFileSync(candidate,'utf8')};return{error:'Missing '+file};}}));
  assert.deepEqual((output.errors||[]).filter(e=>e.severity==='error'),[]);
  const a=output.contracts[name].SupportStressV3;
  engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:50},chain:{chainId:31337,time:new Date('2026-10-08T12:00:00Z')},miner:{blockGasLimit:30000000}});
  p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
  signers=await Promise.all(Array.from({length:50},(_,i)=>p.getSigner(i)));
  addresses=await Promise.all(signers.map(s=>s.getAddress()));
  usd=await deployOne('MockUSD',[],signers[0]);
  council=await deployOne('SevenGuardianCouncil',[addresses.slice(31,38)],signers[0]);
  token=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(usd.target,addresses[39],council.target);await token.waitForDeployment();
  binary=await deployOne('FundedBinaryPlan',[usd.target,token.target,addresses[39],council.target,addresses[38],addresses.slice(0,31)],signers[0]);
  await(await token.bind(binary.target)).wait();
  for(const i of [0,1,2,3,4,15,38]){
    await(await usd.connect(signers[i]).faucet()).wait();
    await(await usd.connect(signers[i]).approve(binary.target,MaxUint256)).wait();
    await(await usd.connect(signers[i]).approve(token.target,MaxUint256)).wait();
  }
  snapshot=await p.send('evm_snapshot',[]);
});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{if(engine)await engine.disconnect();});
const fails=async fn=>assert.rejects(async()=>{const tx=await fn();await tx.wait();});
const suite=()=>({usd,token,binary});
async function seed(units=1,amount='100'){await(await binary.addUnits(units)).wait();await(await token.buy(E(amount),0,MaxUint256)).wait();}
const ceil=(a,b)=>(a+b-1n)/b;
test('healthy support stays separate before and after launch, including later membership',async()=>{
  await(await binary.addUnits(1)).wait();assert.equal(await token.reserve(),0n);assert.equal(await token.supportReserve(),E('5'));
  assert.equal(await token.totalSupply(),0n);assert.equal(await token.quoteBuy(E('100')),E('970'));
  await(await token.buy(E('100'),0,MaxUint256)).wait();
  const price=await token.price(),supply=await token.totalSupply();
  await(await binary.connect(signers[1]).addUnits(2)).wait();
  assert.equal(await token.supportReserve(),E('15'));assert.equal(await token.reserve(),E('100'));
  assert.equal(await token.price(),price);assert.equal(await token.totalSupply(),supply);assert.equal(await token.ath(),price);
  await(await token.repair()).wait();assert.equal(await token.supportReserve(),E('15'));await checkAccounting(suite());
});
test('even tiny price loss consumes exactly the minimum support and advances ATH by one price unit',async()=>{
  await seed();const oldATH=await token.ath(),supply=await token.totalSupply();
  const support=await token.supportReserve();await(await token.stressReserve(10000n)).wait();
  assert((await token.price())<oldATH);
  const reserve=await token.reserve(),needed=ceil((oldATH+1n)*supply,E('1'))-reserve;
  await(await token.repair()).wait();
  assert.equal(await token.supportReserve(),support-needed);
  assert.equal(await token.reserve(),reserve+needed);assert((await token.price())>oldATH);
  assert.equal(await token.totalSupply(),supply);assert.equal(await token.ath(),await token.price());
  const remaining=await token.supportReserve();await(await token.repair()).wait();assert.equal(await token.supportReserve(),remaining);
  await checkAccounting(suite());
});
test('exhausted support tops up the shared reserve once, benefits all holdings and adds no sale veto',async()=>{
  await seed();await(await token.transfer(addresses[1],E('100'))).wait();
  const supply=await token.totalSupply(),held=await token.balanceOf(addresses[1]),ath=await token.ath();
  await(await token.stressReserve(E('20'))).wait();
  const reserve=await token.reserve(),support=await token.supportReserve();
  const before=await token.quoteSell(held);
  await(await token.repair()).wait();
  assert.equal(await token.reserve(),reserve+support);assert.equal(await token.supportReserve(),0n);
  assert.equal(await token.totalSupply(),supply);assert((await token.price())<ath);
  const after=await token.quoteSell(held);
  assert(after[1]>before[1]); // Shared R/S uplift; no stable paid directly to any holder.
  const quote=await token.quoteSell(E('1'));await(await token.sell(E('1'),quote[0],MaxUint256)).wait();
  assert.equal(await token.supportReserve(),0n);await checkAccounting(suite());
});
test('ordinary sales at exactly $500 bypass both limits; $500 plus one unit retains protection',async()=>{
  await seed(2,'1000');const half=(await token.totalSupply())/2n;
  assert.equal((await token.quoteSell(half))[1],E('500'));
  const above=ceil((E('500')+1n)*(await token.totalSupply()),await token.reserve());
  assert((await token.quoteSell(above))[1]>E('500'));await fails(()=>token.sell(above,0,MaxUint256));
  const before=await token.balanceOf(addresses[0]);await(await token.sell(half,0,MaxUint256)).wait();
  assert.equal(await token.balanceOf(addresses[0]),before-half);assert.equal(await token.sellWindowOutflow(),0n);
  await checkAccounting(suite());
});
test('final complete exit bypasses limits, pays cash/fee/support correctly and restarts every cycle at $0.20',async()=>{
  await seed(2,'1000');assert.equal(await token.development(),addresses[38]);
  const sellerBefore=await usd.balanceOf(addresses[0]),devBefore=await usd.balanceOf(addresses[38]);
  const supply=await token.totalSupply(),reserve=await token.reserve(),support=await token.supportReserve();
  const [out,gross]=await token.quoteSell(supply);assert.equal(gross,reserve);
  await(await token.sell(supply,out,MaxUint256)).wait();
  assert.equal(await usd.balanceOf(addresses[0]),sellerBefore+out);
  assert.equal(await usd.balanceOf(addresses[38]),devBefore+gross-out+support);
  assert.equal(await token.reserve(),0n);assert.equal(await token.supportReserve(),0n);assert.equal(await usd.balanceOf(token.target),0n);
  assert.equal(await token.totalSupply(),0n);assert.equal(await token.ath(),0n);assert.equal(await token.cycle(),2n);
  assert.equal(await token.cycleStartPrice(),E('0.2'));assert.equal(await token.remainingAllowance(addresses[0]),E('1000'));
  assert.equal(await token.quoteBuy(E('100')),E('485'));
  await(await token.buy(E('100'),E('485'),MaxUint256)).wait();
  assert.equal(await token.launchPrice(),E('0.2'));assert.equal(await token.balanceOf(addresses[0]),E('485'));
  await(await token.sell(await token.totalSupply(),0,MaxUint256)).wait();
  assert.equal(await token.cycle(),3n);assert.equal(await token.cycleStartPrice(),E('0.2'));
  await checkAccounting(suite());
});
test('a partial sale by the sole holder is not a final-exit exemption',async()=>{
  await seed(20,'10000');
  const amount=(await token.totalSupply())/2n;await fails(()=>token.sell(amount,0,MaxUint256));
  assert.equal(await token.cycle(),1n);
});
test('a blocked development transfer rolls back the final sale, support sweep and cycle reset atomically',async()=>{
  await seed();const supply=await token.totalSupply(),reserve=await token.reserve(),support=await token.supportReserve(),cash=await usd.balanceOf(addresses[0]);
  await(await usd.setBlocked(addresses[38],true)).wait();
  await fails(()=>token.sell(supply,0,MaxUint256));
  assert.equal(await token.totalSupply(),supply);assert.equal(await token.reserve(),reserve);assert.equal(await token.supportReserve(),support);
  assert.equal(await usd.balanceOf(addresses[0]),cash);assert.equal(await token.cycle(),1n);await checkAccounting(suite());
});
test('$20 is a V3 protection threshold, not a hard point reward ceiling; low funding advances protection',async()=>{
  await(await binary.addUnits(1)).wait();await(await binary.connect(signers[1]).addUnits(5)).wait();await(await binary.connect(signers[2]).addUnits(5)).wait();
  await settle(suite(),p);
  assert.equal(await binary.pointValueIsTarget(),true);assert.equal(await binary.pointValue(),E('180'));
  assert.equal(await binary.pendingReward(addresses[0]),E('900'));assert.equal(await binary.protectionLevel(),0n);
  // Build a depth-9 active parent. Its depth-10 children fund exactly $18/point.
  let parent=addresses[15];
  for(const i of [40,41,42,43,44]){
    await(await usd.connect(signers[i]).faucet()).wait();
    await(await usd.connect(signers[i]).approve(binary.target,MaxUint256)).wait();
    await(await binary.connect(signers[i]).register(parent,1)).wait();parent=addresses[i];
  }
  for(const i of [45,46]){
    await(await usd.connect(signers[i]).faucet()).wait();
    await(await usd.connect(signers[i]).approve(binary.target,MaxUint256)).wait();
    await(await binary.connect(signers[i]).register(parent,3)).wait();
  }
  await settle(suite(),p);
  assert.equal(await binary.pointValue(),E('18'));assert.equal(await binary.protectionLevel(),1n);
  const [pc,pb,bc,bb]=await binary.fundingAccounting();assert.equal(pc,pb);assert.equal(bc,bb);await checkAccounting(suite());
});
test('ranked hourly rewards split 95/5; auto failures preserve ownership and keeper retries using ordinary allowance',async()=>{
  await(await binary.addUnits(1)).wait();for(const i of [1,2])await(await binary.connect(signers[i]).addUnits(100)).wait();
  await settle(suite(),p);assert.equal(await binary.rankOf(addresses[0]),1n);
  await(await binary.payRewards(100)).wait();
  await(await binary.setAutoBuy(true,E('10'))).wait();
  await(await token.buy(E('600'),0,MaxUint256)).wait();
  for(const i of [1,2])await(await binary.connect(signers[i]).addUnits(5)).wait();
  await settle(suite(),p);
  assert.equal(await binary.pendingReward(addresses[0]),E('855'));assert.equal(await binary.pendingAuto(addresses[0]),E('45'));
  const walletUSD=await usd.balanceOf(addresses[0]);await(await binary.payRewards(100)).wait();
  assert.equal(await usd.balanceOf(addresses[0]),walletUSD+E('855'));
  const tokens=await token.balanceOf(addresses[0]);
  await fails(()=>binary.connect(signers[42]).executeAuto(addresses[0],E('45')));
  assert.equal(await binary.pendingAuto(addresses[0]),E('45'));assert.equal(await token.balanceOf(addresses[0]),tokens);
  await(await binary.addUnits(1)).wait();await(await binary.payRewards(100)).wait();
  assert.equal(await keeperStep(binary,p), 'auto-buy executed');
  assert.equal(await binary.pendingAuto(addresses[0]),0n);assert((await token.balanceOf(addresses[0]))>tokens);
  assert.equal(await token.cyclePurchases(addresses[0]),E('645'));assert.equal(await token.remainingAllowance(addresses[0]),E('555'));
  const minted=await token.balanceOf(addresses[0]);await fails(()=>binary.executeAuto(addresses[0],E('45')));
  assert.equal(await token.balanceOf(addresses[0]),minted);await checkAccounting(suite());
});
test('two independent holders exit in order with conserved cash, unchanged binary liabilities and a fresh cycle',async()=>{
  await seed(2,'1000');await(await binary.connect(signers[1]).addUnits(1)).wait();
  await(await token.connect(signers[1]).buy(E('300'),0,MaxUint256)).wait();
  const initialCash=await usd.balanceOf(token.target);
  const binaryBook=await binary.accounting(),devBefore=await usd.balanceOf(addresses[38]);
  const before0=await usd.balanceOf(addresses[0]),before1=await usd.balanceOf(addresses[1]);
  for(let i=0;i<4;i++){
    const balance=await token.balanceOf(addresses[0]),amount=i===3?balance:balance/2n;
    // Choose a small enough first chunk; each ordinary quote must remain exempt.
    const part=i===0?balance/4n:amount;
    const [out,gross]=await token.quoteSell(part);assert(gross<=E('500'));
    await(await token.sell(part,out,MaxUint256)).wait();await checkAccounting(suite());
    assert.equal(await token.cycle(),1n);
  }
  assert.equal(await token.balanceOf(addresses[0]),0n);
  const last=await token.balanceOf(addresses[1]);assert.equal(last,await token.totalSupply());
  const [out]=await token.quoteSell(last);await(await token.connect(signers[1]).sell(last,out,MaxUint256)).wait();
  const paid=(await usd.balanceOf(addresses[0]))-before0+(await usd.balanceOf(addresses[1]))-before1+(await usd.balanceOf(addresses[38]))-devBefore;
  assert.equal(paid,initialCash);assert.equal(await usd.balanceOf(token.target),0n);
  assert.deepEqual(Array.from(await binary.accounting()),Array.from(binaryBook));
  assert.equal(await token.cycle(),2n);assert.equal(await token.cycleStartPrice(),E('0.2'));
  await checkAccounting(suite());
});
