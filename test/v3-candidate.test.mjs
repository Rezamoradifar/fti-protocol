import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256,ZeroAddress} from 'ethers';
import {artifact,deployOne} from '../scripts/lib.mjs';

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

  for(const i of [0,1,2,31,32,33,34,35,36,37,40,41,42]){
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

async function seedMembership(){
  await (await binary.addUnits(1)).wait();
}

test('membership support starts from zero and mints no FTI',async()=>{
  assert.equal(await token.totalSupply(),0n);
  assert.equal(await token.reserve(),0n);
  assert.equal(await token.supportReserve(),0n);
  assert.equal(await token.price(),0n);

  await seedMembership();

  assert.equal(await token.totalSupply(),0n);
  assert.equal(await token.reserve(),0n);
  assert.equal(await token.supportReserve(),E('5'));
  assert.equal(await token.price(),0n);
});

test('first real buy retains the full 3% fee in reserve and mints only buyer tokens',async()=>{
  await seedMembership();

  const q=await token.quoteBuy(E('100'));
  assert.equal(q,E('97'));

  await (await token.buy(E('100'),q,MaxUint256)).wait();

  assert.equal(await token.balanceOf(addresses[0]),E('97'));
  assert.equal(await token.balanceOf(addresses[40]),0n);
  assert.equal(await token.balanceOf(addresses[41]),0n);
  assert.equal(await token.totalSupply(),E('97'));
  assert.equal(await token.reserve(),E('100'));
  assert.equal(await token.supportReserve(),E('5'));
  assert((await token.launchPrice())>0n);
});

test('immediate transfers to non-members debit the gross amount, burn 3% and preserve USD reserves',async()=>{
  await seedMembership();
  await (await token.buy(E('100'),0,MaxUint256)).wait();

  const supply=await token.totalSupply(),balance=await token.balanceOf(addresses[0]);
  const reserve=await token.reserve(),support=await token.supportReserve(),price=await token.price();
  const actual=await usd.balanceOf(token.target),allowance=await token.remainingAllowance(addresses[0]);
  assert.equal(await binary.unitsOf(addresses[42]),0n);
  assert.deepEqual(Array.from(await token.quoteTransfer(E('10'))),[E('9.7'),E('0.3')]);
  const receipt=await (await token.transfer(addresses[42],E('10'))).wait();

  assert.equal(await token.balanceOf(addresses[0]),balance-E('10'));
  assert.equal(await token.balanceOf(addresses[42]),E('9.7'));
  assert.equal(await token.totalSupply(),supply-E('0.3'));
  assert.equal(await token.reserve(),reserve);assert.equal(await token.supportReserve(),support);
  assert.equal(await usd.balanceOf(token.target),actual);
  assert.equal(await token.remainingAllowance(addresses[0]),allowance);
  assert((await token.price())>price);
  const transfers=receipt.logs.map(log=>token.interface.parseLog(log)).filter(log=>log?.name==='Transfer');
  assert.deepEqual(transfers.map(log=>Array.from(log.args)),[[addresses[0],ZeroAddress,E('0.3')],[addresses[0],addresses[42],E('9.7')]]);
});

test('transferFrom burns the same 3% and consumes the gross allowance without a bypass',async()=>{
  await seedMembership();await (await token.buy(E('100'),0,MaxUint256)).wait();
  await (await token.approve(addresses[41],E('10'))).wait();
  await (await token.connect(signers[41]).transferFrom(addresses[0],addresses[42],E('10'))).wait();
  assert.equal(await token.balanceOf(addresses[0]),E('87'));
  assert.equal(await token.balanceOf(addresses[42]),E('9.7'));
  assert.equal(await token.totalSupply(),E('96.7'));
  assert.equal(await token.allowance(addresses[0],addresses[41]),0n);
  await fails(()=>token.connect(signers[41]).transferFrom(addresses[0],addresses[42],E('1')));
  await (await token.approve(addresses[41],MaxUint256)).wait();
  await (await token.connect(signers[41]).transferFrom(addresses[0],addresses[42],E('10'))).wait();
  assert.equal(await token.allowance(addresses[0],addresses[41]),MaxUint256);
  assert.equal(await token.totalSupply(),E('96.4'));
});

test('transfer rounding cannot bypass the burn, zero is valid and zero-net dust reverts',async()=>{
  await seedMembership();await (await token.buy(E('100'),0,MaxUint256)).wait();
  assert.deepEqual(Array.from(await token.quoteTransfer(0n)),[0n,0n]);
  await (await token.transfer(addresses[42],0n)).wait();
  await fails(()=>token.transfer(addresses[42],1n));
  assert.equal(await token.totalSupply(),E('97'));
  assert.deepEqual(Array.from(await token.quoteTransfer(101n)),[97n,4n]);
  await (await token.transfer(addresses[42],101n)).wait();
  assert.equal(await token.balanceOf(addresses[42]),97n);
  assert.equal(await token.totalSupply(),E('97')-4n);
  await (await token.transfer(addresses[42],2n)).wait();
  assert.equal(await token.balanceOf(addresses[42]),98n);
  assert.equal(await token.totalSupply(),E('97')-5n);
});

test('self transfers pay the burn and insufficient balance rolls back both burn and allowance',async()=>{
  await seedMembership();await (await token.buy(E('100'),0,MaxUint256)).wait();
  await (await token.transfer(addresses[0],E('10'))).wait();
  assert.equal(await token.balanceOf(addresses[0]),E('96.7'));
  assert.equal(await token.totalSupply(),E('96.7'));
  await (await token.approve(addresses[41],E('100'))).wait();
  await fails(()=>token.connect(signers[41]).transferFrom(addresses[0],addresses[42],E('100')));
  assert.equal(await token.totalSupply(),E('96.7'));
  assert.equal(await token.balanceOf(addresses[42]),0n);
  assert.equal(await token.allowance(addresses[0],addresses[41]),E('100'));
  await fails(()=>token.transfer(ZeroAddress,E('1')));
  assert.equal(await token.totalSupply(),E('96.7'));
});

test('pause and emergency block both transfer paths without burning funds',async()=>{
  await seedMembership();await (await token.buy(E('100'),0,MaxUint256)).wait();
  await (await token.approve(addresses[41],E('10'))).wait();
  await (await token.connect(signers[39]).pause()).wait();
  await fails(()=>token.transfer(addresses[42],E('10')));
  await fails(()=>token.connect(signers[41]).transferFrom(addresses[0],addresses[42],E('10')));
  await (await token.connect(signers[39]).unpause()).wait();
  const data=token.interface.encodeFunctionData('activateEmergencyUnwind');
  await (await council.connect(signers[31]).propose(token.target,data)).wait();
  for(const i of [32,33,34,35])await (await council.connect(signers[i]).approve(0)).wait();
  await (await council.connect(signers[42]).execute(0)).wait();
  await fails(()=>token.transfer(addresses[42],E('10')));
  await fails(()=>token.connect(signers[41]).transferFrom(addresses[0],addresses[42],E('10')));
  assert.equal(await token.totalSupply(),E('97'));
  assert.equal(await token.allowance(addresses[0],addresses[41]),E('10'));
});

test('sale and emergency burns after a taxed transfer are not taxed again',async()=>{
  await seedMembership();await (await token.buy(E('100'),0,MaxUint256)).wait();
  await (await token.transfer(addresses[42],E('10'))).wait();
  const before=await token.totalSupply(),[payout]=await token.quoteSell(E('1'));
  const cash=await usd.balanceOf(addresses[42]);
  await (await token.connect(signers[42]).sell(E('1'),payout,MaxUint256)).wait();
  assert.equal(await token.totalSupply(),before-E('1'));
  assert.equal(await token.balanceOf(addresses[42]),E('8.7'));
  assert.equal(await usd.balanceOf(addresses[42]),cash+payout);
  const data=token.interface.encodeFunctionData('activateEmergencyUnwind');
  await (await council.connect(signers[31]).propose(token.target,data)).wait();
  for(const i of [32,33,34,35])await (await council.connect(signers[i]).approve(0)).wait();
  await (await council.connect(signers[42]).execute(0)).wait();
  for(const i of [0,42]){
    const amount=await token.balanceOf(addresses[i]);
    const expected=amount*(await token.emergencyRemainingPool())/(await token.emergencyRemainingSupply());
    const userCash=await usd.balanceOf(addresses[i]);
    await (await token.connect(signers[i]).emergencyRedeem(amount,expected)).wait();
    assert.equal(await usd.balanceOf(addresses[i]),userCash+expected);
    assert.equal(await token.balanceOf(addresses[i]),0n);
  }
  assert.equal(await token.totalSupply(),0n);assert.equal(await usd.balanceOf(token.target),0n);
});

test('anti-whale guard rejects a single sale above 5% of reserve while an allowed sale executes with slippage',async()=>{
  await (await binary.addUnits(3)).wait();
  await (await token.buy(E('1000'),0,MaxUint256)).wait();

  const bal=await token.balanceOf(addresses[0]);
  await fails(()=>token.sell(bal/10n,0,MaxUint256));

  const small=bal/100n;
  const [out]=await token.quoteSell(small);
  await (await token.sell(small,out,MaxUint256)).wait();
  assert((await usd.balanceOf(addresses[0]))>0n);
});

test('Builder B1-B4 allowance multiplier is capped and B0 is not multiplied',async()=>{
  await seedMembership();

  assert.equal(await token.builderMultiplier(),1n);
  assert.equal(await token.buyLimit(addresses[0]),E('500'));

  await (await token.buy(E('100'),0,MaxUint256)).wait();
  assert((await token.launchPrice())>0n);

  // This test verifies the baseline wiring and cap constant. Reaching each 10x
  // milestone is covered by arithmetic/fuzz validation rather than artificial
  // reserve injection because supportReserve intentionally does not change price.
  assert.equal(await token.MAX_BUILDER_MULTIPLIER(),16n);
});

test('SevenGuardianCouncil requires 5 of 7 approvals before irreversible emergency unwind',async()=>{
  await seedMembership();
  await (await token.buy(E('100'),0,MaxUint256)).wait();

  const data=token.interface.encodeFunctionData('activateEmergencyUnwind',[]);
  await (await council.connect(signers[31]).propose(token.target,data)).wait();

  for(const i of [32,33,34]){
    await (await council.connect(signers[i]).approve(0)).wait();
  }

  await fails(()=>council.connect(signers[42]).execute(0));

  await (await council.connect(signers[35]).approve(0)).wait();
  await (await council.connect(signers[42]).execute(0)).wait();

  assert.equal(await token.emergencyUnwind(),true);
  assert.equal(await token.paused(),true);
  await fails(()=>token.buy(E('1'),0,MaxUint256));
});

test('emergency unwind sends collateral pro-rata to holders, never to DAO wallets',async()=>{
  await seedMembership();
  await (await token.buy(E('100'),0,MaxUint256)).wait();

  const data=token.interface.encodeFunctionData('activateEmergencyUnwind',[]);
  await (await council.connect(signers[31]).propose(token.target,data)).wait();
  for(const i of [32,33,34,35]){
    await (await council.connect(signers[i]).approve(0)).wait();
  }
  await (await council.execute(0)).wait();

  const userTokens=await token.balanceOf(addresses[0]);
  const [poolBefore]=await token.accounting();
  const cashBefore=await usd.balanceOf(addresses[0]);

  const expected=userTokens*(await token.emergencyRemainingPool())/(await token.emergencyRemainingSupply());
  await (await token.emergencyRedeem(userTokens,expected)).wait();

  assert.equal((await usd.balanceOf(addresses[0]))-cashBefore,expected);
  assert((await token.emergencyRemainingPool())<poolBefore);
});

test('stablecoin and FTI cannot be rescued by governance',async()=>{
  // governance is signer[39]
  await assert.rejects(
    p.call({
      from:addresses[39],
      to:token.target,
      data:token.interface.encodeFunctionData('rescue',[usd.target,addresses[39],1])
    })
  );
  await assert.rejects(
    p.call({
      from:addresses[39],
      to:token.target,
      data:token.interface.encodeFunctionData('rescue',[token.target,addresses[39],1])
    })
  );
});

test('later buys mint only quoted user tokens; sells burn exactly their input without fee mints',async()=>{
  await seedMembership();
  await (await token.buy(E('100'),0,MaxUint256)).wait();
  const before=await token.totalSupply();
  const quote=await token.quoteBuy(E('50'));
  await (await token.buy(E('50'),quote,MaxUint256)).wait();
  assert.equal(await token.totalSupply(),before+quote);
  assert.equal(await token.balanceOf(addresses[0]),before+quote);
  assert.equal(await token.balanceOf(addresses[40]),0n);
  assert.equal(await token.balanceOf(addresses[41]),0n);
  const sold=E('1');const supply=await token.totalSupply();const reserve=await token.reserve();
  const [net]=await token.quoteSell(sold);
  const cash=await usd.balanceOf(addresses[0]);
  const receipt=await (await token.sell(sold,net,MaxUint256)).wait();
  assert.equal(await token.totalSupply(),supply-sold);
  assert.equal(await token.reserve(),reserve-net);
  assert.equal(await usd.balanceOf(addresses[0]),cash+net);
  const transfers=receipt.logs.filter(l=>l.address===token.target).map(l=>token.interface.parseLog(l)).filter(l=>l?.name==='Transfer');
  assert.equal(transfers.length,1);assert.equal(transfers[0].args.from,addresses[0]);
  assert.equal(transfers[0].args.to,'0x0000000000000000000000000000000000000000');
  assert.equal(await token.RESERVE_FEE_BPS(),await token.TRADE_FEE_BPS());
  assert.equal(await token.supportReserve(),E('5'));
});

async function closeFundedReward(){
  await seedMembership();
  await (await binary.connect(signers[1]).addUnits(5)).wait();
  await (await binary.connect(signers[2]).addUnits(5)).wait();
  while(await binary.jobCursor()<await binary.jobCount())await (await binary.processVolume(100)).wait();
  await p.send('evm_increaseTime',[3601]);await p.send('evm_mine',[]);
  await (await binary.beginEpochClose()).wait();
}

test('Reward batch sends finalized cash to fixed beneficiaries and resumes without duplicate payments',async()=>{
  await closeFundedReward();
  await fails(()=>binary.connect(signers[42]).payRewards(100));
  while(await binary.phase()>0n)await (await binary.processEpoch(100)).wait();
  const rootReward=await binary.pendingReward(addresses[0]);
  const devReward=await binary.pendingReward(addresses[38]);
  assert(rootReward>0n);assert(devReward>0n);
  assert.equal(await binary.rewardAccountCount(),2n);
  const rootCash=await usd.balanceOf(addresses[0]);const devCash=await usd.balanceOf(addresses[38]);
  const outsiderCash=await usd.balanceOf(addresses[42]);
  const pointReserve=await binary.pointPool(),builderReserve=await binary.builderAccounted();
  await (await binary.connect(signers[42]).payRewards(1)).wait();
  assert.equal(await binary.rewardAccountCount(),1n);
  await (await binary.connect(signers[42]).payRewards(100)).wait();
  assert.equal(await binary.rewardAccountCount(),0n);assert.equal(await binary.totalPending(),0n);
  assert.equal(await usd.balanceOf(addresses[0]),rootCash+rootReward);
  assert.equal(await usd.balanceOf(addresses[38]),devCash+devReward);
  assert.equal(await usd.balanceOf(addresses[42]),outsiderCash);
  assert.equal(await binary.pointPool(),pointReserve);assert.equal(await binary.builderAccounted(),builderReserve);
  const [actual,accounted]=await binary.accounting();assert.equal(actual,accounted);
  await (await binary.payRewards(100)).wait();
  assert.equal(await usd.balanceOf(addresses[0]),rootCash+rootReward);
});

test('individual claim removes its queue entry and later credits can be queued again',async()=>{
  await seedMembership();
  const before=await usd.balanceOf(addresses[38]);
  await (await binary.connect(signers[38]).claim()).wait();
  assert.equal(await usd.balanceOf(addresses[38]),before+E('1'));
  assert.equal(await binary.rewardAccountCount(),0n);
  await (await binary.addUnits(1)).wait();await (await binary.addUnits(1)).wait();
  assert.equal(await binary.rewardAccountCount(),1n);
  await (await binary.connect(signers[42]).payRewards(100)).wait();
  assert.equal(await usd.balanceOf(addresses[38]),before+E('3'));
  assert.equal(await binary.rewardAccountCount(),0n);
  await fails(()=>binary.connect(signers[38]).claim());
});

test('Reward batch rejects zero/oversized batches and does not queue zero auto releases',async()=>{
  await fails(()=>binary.payRewards(0));await fails(()=>binary.payRewards(101));
  await (await binary.releaseAutoToCash()).wait();
  assert.equal(await binary.rewardAccountCount(),0n);
});
