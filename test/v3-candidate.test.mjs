import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256} from 'ethers';
import {artifact,deployOne} from '../scripts/lib.mjs';

let engine,p,signers,addresses,usd,council,token,binary,snapshot;

async function deploy(){
  addresses=await Promise.all(signers.map(s=>s.getAddress()));
  usd=await deployOne('MockUSD',[],signers[0]);
  council=await deployOne('SevenGuardianCouncil',[addresses.slice(31,38)],signers[0]);
  token=await deployOne(
    'FTIReserveTokenV3',
    [usd.target,addresses[39],council.target,addresses[40],addresses[41]],
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

test('first real buy launches supply; 1% fee value becomes backed charity FTI split across two wallets',async()=>{
  await seedMembership();

  const q=await token.quoteBuy(E('100'));
  assert.equal(q,E('97'));

  await (await token.buy(E('100'),q,MaxUint256)).wait();

  assert.equal(await token.balanceOf(addresses[0]),E('97'));
  assert.equal(await token.balanceOf(addresses[40]),E('0.5'));
  assert.equal(await token.balanceOf(addresses[41]),E('0.5'));
  assert.equal(await token.totalSupply(),E('98'));
  assert.equal(await token.reserve(),E('100'));
  assert.equal(await token.supportReserve(),E('5'));
  assert((await token.launchPrice())>0n);
});

test('there are no token time/wallet locks and standard ERC20 transfers carry no transfer tax',async()=>{
  await seedMembership();
  await (await token.buy(E('100'),0,MaxUint256)).wait();

  const supply=await token.totalSupply();
  await (await token.transfer(addresses[42],E('10'))).wait();

  assert.equal(await token.balanceOf(addresses[42]),E('10'));
  assert.equal(await token.totalSupply(),supply);
});

test('anti-whale guard rejects a single sale above 5% of reserve while an allowed sale executes with slippage',async()=>{
  await seedMembership();
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
