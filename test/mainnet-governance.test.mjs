// Local EVM only. Uses the production UUPS contracts and no public RPC or keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,Contract,MaxUint256,parseEther as E} from 'ethers';
import {deployOne,artifact,checkAccounting} from '../scripts/lib.mjs';

test('current proxy release: council-only roles, five votes, holder redemption and final exit',{timeout:180000},async t=>{
 const engine=ganache.provider({chain:{chainId:31337},logging:{quiet:true},wallet:{totalAccounts:46},miner:{blockGasLimit:30000000}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 try{
  const w=await Promise.all(Array.from({length:46},(_,i)=>p.getSigner(i))),a=await Promise.all(w.map(s=>s.getAddress()));
  const send=async tx=>{const r=await(await tx).wait();assert.equal(r.status,1);return r;};
  const usd=await deployOne('MockUSD',[],w[0]),council=await deployOne('SevenGuardianCouncil',[a.slice(31,38)],w[0]),lock=await deployOne('FTITimelock',[council.target],w[0]);
  const ti=await deployOne('FTIReserveTokenUpgradeable',[],w[0]),bi=await deployOne('FundedBinaryPlanUpgradeable',[],w[0]);
  const tp=await deployOne('FTIProxy',[ti.target,ti.interface.encodeFunctionData('initialize',[usd.target,lock.target,council.target])],w[0]);
  const bp=await deployOne('FTIProxy',[bi.target,bi.interface.encodeFunctionData('initialize',[usd.target,tp.target,lock.target,council.target,a[45],a.slice(0,31)])],w[0]);
  const token=new Contract(tp.target,artifact('FTIReserveTokenUpgradeable').abi,w[0]),binary=new Contract(bp.target,artifact('FundedBinaryPlanUpgradeable').abi,w[0]),suite={usd,token,binary};
  await send(token.bind(binary.target));
  const isolated=async fn=>{const s=await p.send('evm_snapshot',[]);try{await fn();}finally{await p.send('evm_revert',[s]);}};
  const fund=async()=>{await send(usd.faucet());await send(usd.approve(binary.target,MaxUint256));await send(usd.approve(token.target,MaxUint256));await send(binary.addUnits(1));await send(token.buy(E('100'),0,MaxUint256));};
  await t.test('seven council wallets have no initial position, activation, rank or plan reward',()=>isolated(async()=>{
   assert.equal(await binary.memberCount(),31n);assert.equal(await lock.getMinDelay(),259200n);
   for(const who of a.slice(31,38)){
    assert.equal(await binary.registered(who),false);assert.equal(await binary.unitsOf(who),0n);
    assert.equal(await binary.activatedAtSerial(who),0n);assert.equal(await binary.rankOf(who),0n);assert.equal(await binary.pendingReward(who),0n);
   }
   for(let i=0;i<31;i++)assert.equal(await binary.unitsOf(a[i]),0n);
   assert.equal(await binary.registered(a[45]),false);assert.equal(await binary.registered(a[44]),false);
   await fund();
   assert.equal(await binary.pendingReward(a[45]),E('1'));
   for(const who of a.slice(31,38))assert.equal(await binary.pendingReward(who),0n);
   await checkAccounting(suite);
  }));
  await t.test('four votes and duplicate approvals fail; five allow irreversible pro-rata holder redemption',()=>isolated(async()=>{
   await fund();const held=await token.balanceOf(a[0]);await send(token.transfer(a[40],held/4n));
   for(const action of [()=>token.connect(w[31]).pause.staticCall(),()=>binary.connect(w[31]).pause.staticCall(),()=>token.connect(w[31]).activateEmergencyUnwind.staticCall(),()=>token.connect(w[44]).upgradeToAndCall.staticCall(ti.target,'0x')])await assert.rejects(action);
   const data=token.interface.encodeFunctionData('activateEmergencyUnwind');
   await assert.rejects(()=>council.connect(w[40]).propose.staticCall(token.target,data));
   await send(council.connect(w[31]).propose(token.target,data));
   await assert.rejects(()=>council.connect(w[31]).approve.staticCall(0));
   for(let i=32;i<=34;i++)await send(council.connect(w[i]).approve(0));
   await assert.rejects(()=>council.execute.staticCall(0),/5 of 7/);
   await send(council.connect(w[35]).approve(0));
   const councilCash=await Promise.all(a.slice(31,38).map(x=>usd.balanceOf(x)));
   await send(council.execute(0));assert.equal(await token.emergencyUnwind(),true);
   await assert.rejects(()=>council.execute.staticCall(0),/executed/);
   await assert.rejects(()=>token.buy.staticCall(E('1'),0,MaxUint256));
   for(const i of [0,40]){
    const balance=await token.balanceOf(a[i]),expected=balance*await token.emergencyRemainingPool()/await token.emergencyRemainingSupply(),before=await usd.balanceOf(a[i]);
    await send(token.connect(w[i]).emergencyRedeem(balance,expected));assert.equal(await usd.balanceOf(a[i])-before,expected);
   }
   assert.equal(await token.totalSupply(),0n);assert.equal(await token.emergencyRemainingPool(),0n);assert.equal(await usd.balanceOf(token.target),0n);
   assert.deepEqual(await Promise.all(a.slice(31,38).map(x=>usd.balanceOf(x))),councilCash);
   await checkAccounting(suite);
  }));
  await t.test('final normal exit pays 3% plus support to development and restarts at 0.20 without premint',()=>isolated(async()=>{
   await fund();const supply=await token.totalSupply(),reserve=await token.reserve(),support=await token.supportReserve(),[out,gross]=await token.quoteSell(supply);
   const before=await usd.balanceOf(a[0]),dev=await usd.balanceOf(a[45]);assert.equal(gross,reserve);
   await send(token.sell(supply,out,MaxUint256));
   assert.equal(await usd.balanceOf(a[0])-before,out);assert.equal(await usd.balanceOf(a[45])-dev,gross-out+support);
   assert.equal(await token.totalSupply(),0n);assert.equal(await token.reserve(),0n);assert.equal(await token.supportReserve(),0n);
   assert.equal(await token.cycle(),2n);assert.equal(await token.cycleStartPrice(),E('0.2'));assert.equal(await token.quoteBuy(E('100')),E('485'));
   await checkAccounting(suite);
  }));
 }finally{await engine.disconnect();}
});
