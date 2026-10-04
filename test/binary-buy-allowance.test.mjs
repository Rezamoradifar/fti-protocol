import {deployPaidRankFeatureSuite,seedPaidRank} from './fixtures/paid-rank-feature-suite.mjs';
import {describe,test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256} from 'ethers';
import {deployOne,settle,checkAccounting} from '../scripts/lib.mjs';

let hostileArtifact;
function getHostileArtifact(){
 if(!hostileArtifact){
  const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'HostileUSD.sol':{content:fs.readFileSync('test/fixtures/HostileUSD.sol','utf8')}},settings:{evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:path=>({contents:fs.readFileSync('node_modules/'+path,'utf8')})}));
  assert(!output.errors?.some(error=>error.severity==='error'));
  hostileArtifact=output.contracts['HostileUSD.sol'].HostileUSD;
 }
 return hostileArtifact;
}

for(const binaryContract of ['BinaryPlan','FundedBinaryPlan'])describe(`${binaryContract}: binary-owned token allowance`,()=>{
 let engine,provider,signers,s,snapshot;
 before(async()=>{
  engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:45},chain:{chainId:31337,time:new Date('2026-10-04T00:00:00Z')},miner:{blockGasLimit:30000000}});
  provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
  signers=await Promise.all(Array.from({length:45},(_,i)=>provider.getSigner(i)));
  s=await deployPaidRankFeatureSuite(signers,{tokenContract:'FTIReserveToken',binaryContract});
  for(const i of [0,1,2,41]){
   await(await s.usd.connect(signers[i]).faucet()).wait();
   await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();
   await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();
  }
  snapshot=await provider.send('evm_snapshot',[]);
 });
 beforeEach(async()=>{await provider.send('evm_revert',[snapshot]);snapshot=await provider.send('evm_snapshot',[]);});
 after(async()=>{await engine.disconnect();});

 async function fails(action){await assert.rejects(async()=>{const tx=await action();await tx.wait();});}
 async function checkAllowance(who,limit,spent){
  assert.equal(await s.binary.tokenBuyLimit(who),limit);
  assert.equal(await s.binary.tokenBuySpent(who),spent);
  assert.equal(await s.binary.remainingTokenBuyAllowance(who),limit-spent);
  assert.equal(await s.token.buyLimit(who),limit);
  assert.equal(await s.token.lifetimeManualBuys(who),spent);
  assert.equal(await s.token.remainingAllowance(who),limit-spent);
 }
 async function buy(amount,signer=signers[0]){
  return(await s.token.connect(signer).buy(E(amount),0,MaxUint256)).wait();
 }

 test('unpaid genesis and nonmembers have no allowance; callers cannot forge or consume permission',async()=>{
  for(const who of [s.addresses[0],s.addresses[41]])await checkAllowance(who,0n,0n);
  assert.equal(await s.binary.registered(s.addresses[0]),true);
  assert.equal(await s.binary.registered(s.addresses[41]),false);
  await fails(()=>s.token.buy(E('1'),0,MaxUint256));
  await fails(()=>s.token.connect(signers[41]).buy(E('1'),0,MaxUint256));
  await(await s.binary.addUnits(1)).wait();
  for(const signer of [signers[0],signers[1],signers[41]]){
   await fails(()=>s.binary.connect(signer).authorizeTokenBuy(s.addresses[0],E('1')));
  }
  await checkAllowance(s.addresses[0],E('500'),0n);
  await checkAccounting(s);
 });

 test('100 USD registration grants 500 USD cumulative token purchases without spending quota on support',async()=>{
  await(await s.binary.connect(signers[41]).register(s.addresses[15],1)).wait();
  await checkAllowance(s.addresses[41],E('500'),0n);
  assert.equal(await s.token.totalSupply(),0n);
  assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.unallocatedReserve(),E('5'));
  for(const amount of ['100','125','275'])await buy(amount,signers[41]);
  await checkAllowance(s.addresses[41],E('500'),E('500'));
  await fails(()=>s.token.connect(signers[41]).buy(E('1'),0,MaxUint256));
  await checkAllowance(s.addresses[41],E('500'),E('500'));
  await checkAllowance(s.addresses[0],0n,0n);
  await checkAccounting(s);
 });

 test('200 USD cumulative membership authorizes 1,000 USD of total purchases',async()=>{
  await(await s.binary.addUnits(1)).wait();
  await buy('250');
  await(await s.binary.addUnits(1)).wait();
  await checkAllowance(s.addresses[0],E('1000'),E('250'));
  await buy('750');
  await checkAllowance(s.addresses[0],E('1000'),E('1000'));
  await fails(()=>s.token.buy(E('1'),0,MaxUint256));
  await checkAccounting(s);
 });

 test('100 USD plus 9,900 USD paid top-ups raises total quota to 50,000 USD without resetting spent',async()=>{
  await(await s.binary.addUnits(1)).wait();
  await buy('500');
  await checkAllowance(s.addresses[0],E('500'),E('500'));
  await(await s.binary.addUnits(99)).wait();
  await checkAllowance(s.addresses[0],E('50000'),E('500'));
  await buy('49500');
  await checkAllowance(s.addresses[0],E('50000'),E('50000'));
  await fails(()=>s.token.buy(E('1'),0,MaxUint256));
  await checkAccounting(s);
 });

 test('rejected purchases roll back binary quota and all token accounting',async()=>{
  await(await s.binary.addUnits(1)).wait();
  await buy('100');
  const oldReserve=await s.token.reserve(),oldSupply=await s.token.totalSupply();
  const quote=await s.token.quoteBuy(E('50'));
  await fails(()=>s.token.buy(E('50'),quote+1n,MaxUint256));
  await fails(()=>s.token.buy(E('50'),0,0));
  await fails(()=>s.token.buy(E('401'),0,MaxUint256));
  await fails(()=>s.token.buy(0,0,MaxUint256));
  // Force a mined collateral-transfer failure after the token has called authorizeTokenBuy.
  await(await s.usd.setBlocked(s.token.target,true)).wait();
  await fails(()=>s.token.buy(E('50'),0,MaxUint256,{gasLimit:2000000}));
  await checkAllowance(s.addresses[0],E('500'),E('100'));
  assert.equal(await s.token.reserve(),oldReserve);
  assert.equal(await s.token.totalSupply(),oldSupply);
  await(await s.usd.setBlocked(s.token.target,false)).wait();
  const receipt=await buy('50');
  const events=receipt.logs.filter(log=>log.address.toLowerCase()===s.binary.target.toLowerCase())
   .map(log=>s.binary.interface.parseLog(log)).filter(log=>log?.name==='TokenBuyAuthorized');
  assert.equal(events.length,1);
  assert.equal(events[0].args.wallet,s.addresses[0]);
  assert.equal(events[0].args.usdIn,E('50'));
  assert.equal(events[0].args.cumulativeSpent,E('150'));
  await checkAllowance(s.addresses[0],E('500'),E('150'));
  await checkAccounting(s);
 });

 test('selling and receiving token transfers never restore or transfer manual purchase allowance',async()=>{
  await(await s.binary.addUnits(1)).wait();
  await buy('100');
  await(await s.token.sell(E('1'),0,MaxUint256)).wait();
  await checkAllowance(s.addresses[0],E('500'),E('100'));
  await(await s.token.transfer(s.addresses[1],E('1'))).wait();
  await checkAllowance(s.addresses[0],E('500'),E('100'));
  await checkAllowance(s.addresses[1],0n,0n);
  await buy('50');
  await checkAllowance(s.addresses[0],E('500'),E('150'));
  await checkAccounting(s);
 });

 test('collateral callbacks cannot forge or double-consume quota; collateral failure rolls back authorization',async()=>{
  const artifact=getHostileArtifact();
  const usd=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signers[0]).deploy();
  await usd.waitForDeployment();
  const token=await deployOne('FTIReserveToken',[usd.target,s.addresses[0],s.addresses[0]],signers[0]);
  const binary=await deployOne(binaryContract,[usd.target,token.target,s.addresses[0],s.addresses[0],s.addresses[40],s.addresses.slice(0,31)],signers[0]);
  await(await token.bind(binary.target)).wait();
  await(await usd.mint(s.addresses[0],E('10000'))).wait();
  await(await usd.approve(binary.target,MaxUint256)).wait();
  await(await usd.approve(token.target,MaxUint256)).wait();
  await(await binary.addUnits(1)).wait();

  await(await usd.setCallback(binary.target,binary.interface.encodeFunctionData('authorizeTokenBuy',[s.addresses[0],E('1')]))).wait();
  await(await token.buy(E('100'),0,MaxUint256)).wait();
  assert.equal(await usd.attempted(),true);
  assert.equal(await usd.succeeded(),false);
  assert.equal(await binary.tokenBuySpent(s.addresses[0]),E('100'));

  await(await usd.setCallback(token.target,token.interface.encodeFunctionData('buy',[E('1'),0,MaxUint256]))).wait();
  await(await token.buy(E('50'),0,MaxUint256)).wait();
  assert.equal(await usd.attempted(),true);
  assert.equal(await usd.succeeded(),false);
  assert.equal(await binary.tokenBuySpent(s.addresses[0]),E('150'));

  const oldReserve=await token.reserve(),oldSupply=await token.totalSupply();
  await(await usd.setFeeMode(1)).wait();
  await fails(()=>token.buy(E('50'),0,MaxUint256,{gasLimit:2000000}));
  assert.equal(await binary.tokenBuySpent(s.addresses[0]),E('150'));
  assert.equal(await binary.remainingTokenBuyAllowance(s.addresses[0]),E('350'));
  assert.equal(await token.lifetimeManualBuys(s.addresses[0]),E('150'));
  assert.equal(await token.reserve(),oldReserve);
  assert.equal(await token.totalSupply(),oldSupply);
  await checkAccounting({usd,token,binary});
 });

 test('TEST ONLY paid-rank fixture: builder rank and price milestones expand total capacity without resetting spent; auto-buys consume no manual quota',async()=>{
  await(await s.binary.addUnits(1)).wait();
  await buy('100');
  for(const i of [1,2])await(await s.binary.connect(signers[i]).addUnits(100)).wait();
  await settle(s,provider);await seedPaidRank(s.binary,s.addresses[0],1);
  assert((await s.binary.rankOf(s.addresses[0]))>0n);
  assert((await s.token.priceMultiplier())>=2n);
  await checkAllowance(s.addresses[0],E('600')*(await s.token.priceMultiplier()),E('100'));
  await(await s.binary.setAutoBuy(true,E('1000000'))).wait();
  for(const i of [1,2])await(await s.binary.connect(signers[i]).addUnits(5)).wait();
  await settle(s,provider);
  const amount=await s.binary.pendingAuto(s.addresses[0]);
  assert(amount>0n);
  const previousTokens=await s.token.balanceOf(s.addresses[0]);
  await(await s.binary.executeAuto(s.addresses[0],amount)).wait();
  assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);
  assert((await s.token.balanceOf(s.addresses[0]))>previousTokens);
  await checkAllowance(s.addresses[0],E('600')*(await s.token.priceMultiplier()),E('100'));
  await checkAccounting(s);
 });
});
