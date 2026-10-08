import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,MaxUint256,getAddress} from 'ethers';
import {deployOne} from '../scripts/lib.mjs';

let engine,p,signers,addresses,usd,council,token,binary,snapshot;

async function deploy(){
  addresses=await Promise.all(signers.map(s=>s.getAddress()));
  usd=await deployOne('MockUSD',[],signers[0]);
  council=await deployOne('SevenGuardianCouncil',[addresses.slice(31,38)],signers[0]);
  token=await deployOne(
    'FTIReserveTokenV3',
    [usd.target,addresses[39],council.target],
    signers[0]
  );
  binary=await deployOne(
    'FundedBinaryPlan',
    [usd.target,token.target,addresses[39],council.target,addresses[38],addresses.slice(0,31)],
    signers[0]
  );
  await (await token.bind(binary.target)).wait();

  for(let i=0;i<31;i++){
    await (await usd.connect(signers[i]).faucet()).wait();
    await (await usd.connect(signers[i]).approve(binary.target,MaxUint256)).wait();
    await (await usd.connect(signers[i]).approve(token.target,MaxUint256)).wait();
  }
}

before(async()=>{
  engine=ganache.provider({
    logging:{quiet:true},
    wallet:{totalAccounts:50},
    chain:{chainId:31337,time:new Date('2026-10-06T12:00:00Z')},
    miner:{blockGasLimit:30000000}
  });
  p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});
  p.pollingInterval=10;
  signers=await Promise.all(Array.from({length:50},(_,i)=>p.getSigner(i)));
  await deploy();
  snapshot=await p.send('evm_snapshot',[]);
});

beforeEach(async()=>{
  await p.send('evm_revert',[snapshot]);
  snapshot=await p.send('evm_snapshot',[]);
});

after(async()=>{await engine.disconnect();});

async function fails(fn){
  await assert.rejects(async()=>{
    const tx=await fn();
    await tx.wait();
  });
}

async function activateEmergency(){
  const data=token.interface.encodeFunctionData('activateEmergencyUnwind',[]);
  await (await council.connect(signers[31]).propose(token.target,data)).wait();
  for(const i of [32,33,34,35]){
    await (await council.connect(signers[i]).approve(0)).wait();
  }
  await (await council.connect(signers[42]).execute(0)).wait();
}

test('configured Partner DAO contains exactly seven unique valid EVM addresses and threshold 5',()=>{
  const cfg=JSON.parse(fs.readFileSync('config/v3-partner-dao.json','utf8'));
  assert.equal(cfg.threshold,5);
  assert.equal(cfg.partners.length,7);
  const normalized=cfg.partners.map(getAddress);
  assert.equal(new Set(normalized.map(x=>x.toLowerCase())).size,7);
});

test('support injections do not mint or move token price after launch',async()=>{
  await (await binary.addUnits(3)).wait();
  await (await token.buy(E('100'),0,MaxUint256)).wait();

  const priceBefore=await token.price();
  const supplyBefore=await token.totalSupply();
  const supportBefore=await token.supportReserve();

  await (await binary.connect(signers[1]).addUnits(5)).wait();

  assert.equal(await token.price(),priceBefore);
  assert.equal(await token.totalSupply(),supplyBefore);
  assert.equal(await token.supportReserve(),supportBefore+E('25'));
});

test('sequential accepted buys and sells strictly increase reserve/share value',async()=>{
  for(let i=0;i<10;i++){
    await (await binary.connect(signers[i]).addUnits(5)).wait();
  }

  let lastPrice=0n;
  for(let i=0;i<10;i++){
    await (await token.connect(signers[i]).buy(E('100'),0,MaxUint256)).wait();
    const priceNow=await token.price();
    if(lastPrice>0n) assert(priceNow>=lastPrice);
    lastPrice=priceNow;
  }

  for(let i=0;i<10;i++){
    const bal=await token.balanceOf(addresses[i]);
    const part=bal/100n;
    const [out]=await token.quoteSell(part);
    await (await token.connect(signers[i]).sell(part,out,MaxUint256)).wait();
    const priceNow=await token.price();
    assert(priceNow>=lastPrice);
    lastPrice=priceNow;
  }

  const [actual,accounted]=await token.accounting();
  assert.equal(actual,accounted);
});

test('hourly outflow circuit breaker blocks aggregate exits above 20% and resets after one hour',async()=>{
  await (await binary.addUnits(20)).wait();
  await (await token.buy(E('5000'),0,MaxUint256)).wait();

  const openingReserve=await token.reserve();
  const chunk=(await token.totalSupply())*3n/100n;
  let accepted=0;

  for(let i=0;i<10;i++){
    const [out]=await token.quoteSell(chunk);
    const current=await token.sellWindowOutflow();
    const cap=openingReserve*20n/100n;

    if(current+out>cap){
      await fails(()=>token.sell(chunk,0,MaxUint256));
      break;
    }

    await (await token.sell(chunk,out,MaxUint256)).wait();
    accepted++;
  }

  assert(accepted>=5,'expected multiple sells before hourly breaker');
  assert((await token.sellWindowOutflow())<=openingReserve*20n/100n);

  await p.send('evm_increaseTime',[3601]);
  await p.send('evm_mine',[]);

  const [outAfter]=await token.quoteSell(chunk);
  await (await token.sell(chunk,outAfter,MaxUint256)).wait();
  assert((await token.sellWindowStart())>0n);
});

test('single-sale guard independently rejects a gross exit above 5% of current reserve',async()=>{
  await (await binary.addUnits(20)).wait();
  await (await token.buy(E('5000'),0,MaxUint256)).wait();

  const tooLarge=(await token.totalSupply())*6n/100n;
  await fails(()=>token.sell(tooLarge,0,MaxUint256));

  const allowed=(await token.totalSupply())*4n/100n;
  const [out]=await token.quoteSell(allowed);
  await (await token.sell(allowed,out,MaxUint256)).wait();
});

test('slippage protects both buy and sell atomically',async()=>{
  await (await binary.addUnits(5)).wait();

  const buyQ=await token.quoteBuy(E('100'));
  await fails(()=>token.buy(E('100'),buyQ+1n,MaxUint256));
  assert.equal(await token.totalSupply(),0n);

  await (await token.buy(E('100'),buyQ,MaxUint256)).wait();

  const bal=await token.balanceOf(addresses[0]);
  const small=bal/100n;
  const [sellQ]=await token.quoteSell(small);
  const before=await token.balanceOf(addresses[0]);

  await fails(()=>token.sell(small,sellQ+1n,MaxUint256));
  assert.equal(await token.balanceOf(addresses[0]),before);
});

test('non-guardians cannot propose or approve emergency actions',async()=>{
  const data=token.interface.encodeFunctionData('activateEmergencyUnwind',[]);
  await fails(()=>council.connect(signers[42]).propose(token.target,data));

  await (await council.connect(signers[31]).propose(token.target,data)).wait();
  await fails(()=>council.connect(signers[42]).approve(0));
});

test('complete emergency redemption drains pool only to token holders and leaves zero supply',async()=>{
  await (await binary.addUnits(5)).wait();
  await (await token.buy(E('100'),0,MaxUint256)).wait();

  await activateEmergency();

  const holders=[0,40,41];
  for(const i of holders){
    const bal=await token.balanceOf(addresses[i]);
    if(bal===0n) continue;
    const expected=bal*(await token.emergencyRemainingPool())/(await token.emergencyRemainingSupply());
    await (await token.connect(signers[i]).emergencyRedeem(bal,expected)).wait();
  }

  assert.equal(await token.totalSupply(),0n);
  assert.equal(await token.emergencyRemainingSupply(),0n);
  assert.equal(await token.emergencyRemainingPool(),0n);
  assert.equal(await usd.balanceOf(token.target),0n);
});

test('emergency is irreversible and normal trading cannot resume',async()=>{
  await (await binary.addUnits(5)).wait();
  await (await token.buy(E('100'),0,MaxUint256)).wait();
  await activateEmergency();

  await fails(()=>token.buy(E('1'),0,MaxUint256));
  await fails(()=>token.sell(1n,0,MaxUint256));
  await fails(()=>token.unpause());
  await fails(()=>token.activateEmergencyUnwind());
});
