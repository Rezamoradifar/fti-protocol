import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,Contract,MaxUint256,parseEther as E} from 'ethers';
import {deployOne,artifact} from '../scripts/lib.mjs';

test('small sells cannot bypass the hourly outflow limit by transaction splitting',{timeout:120000},async()=>{
 const engine=ganache.provider({chain:{chainId:31337},logging:{quiet:true},wallet:{totalAccounts:45},miner:{blockGasLimit:30000000}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 try{
  const w=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));
  const a=await Promise.all(w.map(s=>s.getAddress()));
  const send=async tx=>{const r=await(await tx).wait();assert.equal(r.status,1);return r;};

  const usd=await deployOne('MockUSD',[],w[0]);
  const council=await deployOne('SevenGuardianCouncil',[a.slice(31,38)],w[0]);
  const timelock=await deployOne('FTITimelock',[council.target],w[0]);

  const tokenImpl=await deployOne('FTIReserveTokenUpgradeable',[],w[0]);
  const tokenInit=tokenImpl.interface.encodeFunctionData('initialize',[usd.target,timelock.target,council.target]);
  const tokenProxy=await deployOne('FTIProxy',[tokenImpl.target,tokenInit],w[0]);
  const token=new Contract(tokenProxy.target,artifact('FTIReserveTokenUpgradeable').abi,w[0]);

  const binaryImpl=await deployOne('FundedBinaryPlanUpgradeable',[],w[0]);
  const binaryArgs=[usd.target,token.target,timelock.target,council.target,a[44],a.slice(0,31)];
  const binaryInit=binaryImpl.interface.encodeFunctionData('initialize',binaryArgs);
  const binaryProxy=await deployOne('FTIProxy',[binaryImpl.target,binaryInit],w[0]);
  const binary=new Contract(binaryProxy.target,artifact('FundedBinaryPlanUpgradeable').abi,w[0]);

  await send(token.bind(binary.target));
  await send(usd.faucet());
  await send(usd.approve(binary.target,MaxUint256));
  await send(usd.approve(token.target,MaxUint256));
  await send(binary.addUnits(100));
  await send(token.buy(E('10000'),0,MaxUint256));

  const originalBalance=await token.balanceOf(a[0]);
  const chunk=originalBalance/40n;
  assert(chunk>0n);

  let rejected=false;
  let successful=0;
  for(let i=0;i<40;i++){
   const [payout,gross]=await token.quoteSell(chunk);
   assert(gross<=await token.SMALL_SELL_EXEMPTION(),'fixture must remain inside the small-sell exemption');
   const start=await token.sellWindowStart();
   const opening=await token.sellWindowOpeningReserve();
   const outflow=await token.sellWindowOutflow();
   const max=start===0n?0n:opening*await token.MAX_HOURLY_OUTFLOW_BPS()/10000n;

   if(start!==0n&&outflow+payout>max){
    const beforeReserve=await token.reserve();
    const beforeBalance=await token.balanceOf(a[0]);
    await assert.rejects(async()=>{const tx=await token.sell(chunk,0,MaxUint256);await tx.wait();});
    assert.equal(await token.sellWindowOutflow(),outflow);
    assert.equal(await token.reserve(),beforeReserve);
    assert.equal(await token.balanceOf(a[0]),beforeBalance);
    rejected=true;
    break;
   }

   await send(token.sell(chunk,0,MaxUint256));
   successful++;
   assert((await token.sellWindowOutflow())>0n);
  }

  assert(rejected,'repeated small sells must eventually hit the hourly outflow cap');
  assert(successful>1,'fixture must prove multiple individually exempt sells are aggregated');

  await p.send('evm_increaseTime',[3601]);
  await p.send('evm_mine',[]);
  const before=await token.sellWindowOutflow();
  await send(token.sell(chunk,0,MaxUint256));
  assert((await token.sellWindowOutflow())<before,'new hourly window must reset accumulated outflow');
 }finally{
  await engine.disconnect();
 }
});
