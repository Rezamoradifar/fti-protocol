import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import solc from 'solc';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256,ZeroAddress} from 'ethers';
import {deploySuite,checkAccounting,artifact} from '../scripts/lib.mjs';

// Local trade-size-only token checks. The 7% surcharge parameter remains
// provisional; splitting behavior is measured below, never claimed eliminated.
const W=10n**18n;
function exactFee(value,reserve){
 if(value===0n)return 0n;
 const threshold20=reserve>10000n*W?reserve:10000n*W,excess20=20n*value>threshold20?20n*value-threshold20:0n;
 const denominator=40000n*value,numerator=1200n*value*value+7n*excess20*excess20;
 return (numerator+denominator-1n)/denominator;
}
function indicativeImpact(value,reserve){
 const threshold20=reserve>10000n*W?reserve:10000n*W,excess20=20n*value>threshold20?20n*value-threshold20:0n;
 return value?700n*excess20*excess20/(400n*value*value):0n;
}

let engine,p,signers,s,snapshot;
before(async()=>{
 engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:42},chain:{chainId:31337,time:new Date('2026-10-04T00:00:00Z')},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 signers=await Promise.all(Array.from({length:42},(_,i)=>p.getSigner(i)));
 s=await deploySuite(signers,{tokenContract:'FTIReserveToken',binaryContract:'FundedBinaryPlan'});
 await(await s.usd.faucet()).wait();
 await(await s.usd.approve(s.binary.target,MaxUint256)).wait();
 await(await s.usd.approve(s.token.target,MaxUint256)).wait();
 snapshot=await p.send('evm_snapshot',[]);
});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{await engine.disconnect();});

async function seed(){await(await s.binary.addUnits(1)).wait();await(await s.token.buy(E('100'),0,MaxUint256)).wait();}
async function seedLarge(){await(await s.binary.addUnits(20)).wait();await(await s.token.buy(E('10000'),0,MaxUint256)).wait();}
async function state(){return Promise.all([
 s.token.reserve(),s.token.totalSupply(),s.token.price(),s.token.balanceOf(s.addresses[0]),
 s.usd.balanceOf(s.token.target),s.usd.balanceOf(s.addresses[0]),s.binary.tokenBuySpent(s.addresses[0]),
 s.token.pressureWad(),s.token.lastPartialSellAt(),s.token.referencePrice(),s.token.lifecycleClosed(),
 s.token.sellWindowGross()
]);}
function events(receipt,name){return receipt.logs.filter(x=>x.address.toLowerCase()===s.token.target.toLowerCase()).map(x=>{try{return s.token.interface.parseLog(x);}catch{return null;}}).filter(x=>x?.name===name);}
async function emergency(){const id=await s.council.count();await(await s.council.connect(signers[31]).propose(s.token.target,s.token.interface.encodeFunctionData('activateEmergencyExit'))).wait();for(const i of [32,33,34,35])await(await s.council.connect(signers[i]).approve(id)).wait();await(await s.council.connect(signers[31]).execute(id)).wait();}
async function assertGrowth(oldR,oldS,oldP){const r=await s.token.reserve(),supply=await s.token.totalSupply();assert(r*oldS>oldR*supply);assert((await s.token.price())>oldP);await checkAccounting(s);}

test('integrated: zero start, $0.10 reference, 3% buy fee and no charity ABI',async()=>{
 assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.token.price(),E('0.1'));
 assert.equal(await s.token.currentSellPressure(),0n);assert.equal(await s.token.previewSellPressure(0),0n);
 assert.equal(await s.token.PRESSURE_DECAY_PER_SECOND(),0n);
 assert.equal(await s.token.PRESSURE_HALF_LIFE(),0n);assert.equal(await s.token.MAX_SELL_FEE_BPS(),1000n);
 assert(!artifact('FTIReserveToken').abi.some(x=>/charity|animal/i.test(x.name??'')));
 await seed();assert.equal(await s.token.reserve(),E('100'));assert.equal(await s.token.unallocatedReserve(),E('5'));assert.equal(await s.token.totalSupply(),E('970'));
 const r=await s.token.reserve(),supply=await s.token.totalSupply(),price=await s.token.price();
 const expected=E('97')*W/price;assert.equal(await s.token.quoteBuy(E('100')),expected);
 await(await s.token.buy(E('100'),expected,MaxUint256)).wait();
 assert.equal(await s.token.reserve(),r+E('100'));assert.equal(await s.token.totalSupply(),supply+expected);
 await assertGrowth(r,supply,price);
});

test('integrated: exact size surcharge uses current gross value; indicative bps never sets payout',async()=>{
 await seedLarge();const supply=await s.token.totalSupply(),r=await s.token.reserve();
 for(const q of [supply/100n,supply/20n,supply/4n,supply/2n,supply*9n/10n,supply-1n]){
  const gross=q*r/supply,fee=exactFee(gross,r),impact=indicativeImpact(gross,r),bps=300n+impact;
  assert.equal(await s.token.previewSellPressure(q),0n);assert.equal(await s.token.sellImpactBps(q),impact);
  assert(bps>=300n&&bps<1000n);
  assert.deepEqual(Array.from(await s.token.sellFeeQuote(q)),[fee,gross-fee,gross]);
  assert.deepEqual(Array.from(await s.token.quoteSell(q)),[gross-fee,bps,gross]);
 }
 assert.deepEqual(Array.from(await s.token.quoteSell(supply)),[r,0n,r]);
 assert.equal(await s.token.sellImpactBps(supply),0n);
 assert.deepEqual(Array.from(await s.token.quoteSell(0)),[0n,300n,0n]);
 await assert.rejects(s.token.previewSellPressure(supply+1n),{reason:'supply'});
 await assert.rejects(s.token.quoteSell(supply+1n),{reason:'supply'});
});

test('integrated: >5% immediate sales and same-hour outflow >15% succeed without capacity or age locks',async()=>{
 await seed();const initialR=await s.token.reserve(),initialS=await s.token.totalSupply();
 assert.equal(await s.token.SELL_CAPS_ACTIVE(),false);assert.equal(await s.token.MAX_SINGLE_SELL_BPS(),0n);assert.equal(await s.token.MAX_HOURLY_GROSS_SELL_BPS(),0n);
 assert.equal(await s.token.locked(s.addresses[0]),0n);assert.equal(await s.token.walletClock(),0n);
 let grossTotal=0n;
 for(let i=0;i<3;i++){
  const r=await s.token.reserve(),supply=await s.token.totalSupply(),price=await s.token.price(),q=supply/4n;
  const [out,bps,gross]=await s.token.quoteSell(q);grossTotal+=gross;
  const receipt=await(await s.token.sell(q,out,MaxUint256)).wait();
  assert.equal(events(receipt,'Sold')[0].args.baseFeeBps,300n);
  assert.equal(events(receipt,'Sold')[0].args.impactBps,bps-300n);
  await assertGrowth(r,supply,price);
 }
 assert(grossTotal>initialR*15n/100n);assert((await s.token.totalSupply())<initialS/2n);
 assert.equal(await s.token.sellWindowGross(),0n);assert.equal(await s.token.sellWindowStart(),0n);assert.equal(await s.token.sellWindowStartReserve(),0n);
});

test('integrated: consecutive same-block partial sales price only their own pretrade value',async()=>{
 await seedLarge();
 for(let i=0;i<2;i++){
  const supply=await s.token.totalSupply(),reserve=await s.token.reserve(),q=supply/2n,gross=q*reserve/supply;
  const out=gross-exactFee(gross,reserve);
  assert.equal((await s.token.quoteSell(q))[0],out);assert.equal(await s.token.previewSellPressure(q),0n);
  const receipt=await(await s.token.sell(q,out,MaxUint256)).wait();
  assert.equal(await s.token.pressureWad(),0n);assert.equal(await s.token.lastPartialSellAt(),0n);assert.equal(await s.token.currentSellPressure(),0n);
  assert.equal(events(receipt,'SellPressureUpdated').length,0);
 }
 await checkAccounting(s);
});

test('integrated: elapsed seconds never change live buy or sell quotes',async()=>{
 await seedLarge();await(await s.token.sell((await s.token.totalSupply())/4n,0,MaxUint256)).wait();
 const q=(await s.token.totalSupply())/2n,quote=Array.from(await s.token.sellFeeQuote(q)),buy=await s.token.quoteBuy(E('1000'));
 let previous=0;
 for(const elapsed of [1,2,299,300,600,1200,18000,19199,19200,1000000]){
  await p.send('evm_increaseTime',[elapsed-previous]);await p.send('evm_mine',[]);previous=elapsed;
  assert.deepEqual(Array.from(await s.token.sellFeeQuote(q)),quote);assert.equal(await s.token.quoteBuy(E('1000')),buy);
  assert.equal(await s.token.currentSellPressure(),0n);assert.equal(await s.token.pressureWad(),0n);assert.equal(await s.token.lastPartialSellAt(),0n);
 }
 await(await s.token.sell(q,quote[1],MaxUint256)).wait();await checkAccounting(s);
});

test('integrated: buys, binary injections, transfer burns and seller wallets add no history-dependent fees',async()=>{
 await seed();await(await s.token.sell((await s.token.totalSupply())/2n,0,MaxUint256)).wait();
 await(await s.token.buy(E('100'),0,MaxUint256)).wait();await(await s.binary.addUnits(1)).wait();
 const r=await s.token.reserve(),supply=await s.token.totalSupply(),price=await s.token.price();
 const cash=await s.usd.balanceOf(s.token.target),receipt=await(await s.token.transfer(s.addresses[1],E('100'))).wait();
 assert.equal(await s.token.balanceOf(s.addresses[1]),E('97'));assert.equal(await s.token.totalSupply(),supply-E('3'));
 assert.equal(await s.token.reserve(),r);assert.equal(await s.usd.balanceOf(s.token.target),cash);
 const transfers=events(receipt,'Transfer');assert.equal(transfers.length,2);assert.equal(transfers[0].args.to,ZeroAddress);assert.equal(transfers[0].args.value,E('3'));
 await assertGrowth(r,supply,price);
 assert.equal(await s.token.pressureWad(),0n);assert.equal(await s.token.lastPartialSellAt(),0n);assert.equal(await s.token.currentSellPressure(),0n);
 const q=E('50'),gross=q*r/await s.token.totalSupply(),expected=gross-exactFee(gross,r);
 assert.equal(await s.token.previewSellPressure(q),0n);assert.equal(await s.token.sellImpactBps(q),0n);
 assert.equal(await s.token.sell.staticCall(q,0,MaxUint256),expected);
 assert.equal(await s.token.connect(signers[1]).sell.staticCall(q,0,MaxUint256),expected);
 await(await s.token.connect(signers[1]).sell(q,expected,MaxUint256)).wait();
 assert.equal(await s.token.pressureWad(),0n);await checkAccounting(s);
});

test('integrated: normal full redemption pays exact reserve, freezes quote, preserves quota and keeps restart gated',async()=>{
 await seed();await(await s.token.sell((await s.token.totalSupply())/4n,0,MaxUint256)).wait();
 const old=await state(),spent=await s.token.lifetimeManualBuys(s.addresses[0]),remaining=await s.token.remainingAllowance(s.addresses[0]);
 assert.deepEqual(Array.from(await s.token.quoteSell(old[1])),[old[0],0n,old[0]]);
 const receipt=await(await s.token.sell(old[1],old[0],MaxUint256)).wait();
 assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.usd.balanceOf(s.token.target),await s.token.unallocatedReserve());assert.equal(await s.token.unallocatedReserve(),E('5'));
 assert.equal((await s.usd.balanceOf(s.addresses[0]))-old[5],old[0]);
 assert.equal(await s.token.referencePrice(),old[2]);assert.equal(await s.token.price(),old[2]);assert.equal(await s.token.lifecycleClosed(),true);
 assert.equal(await s.token.pressureWad(),old[7]);assert.equal(await s.token.lastPartialSellAt(),old[8]);
 assert.equal(await s.token.lifetimeManualBuys(s.addresses[0]),spent);assert.equal(await s.token.remainingAllowance(s.addresses[0]),remaining);
 const sold=events(receipt,'Sold')[0];assert.equal(sold.args.baseFeeBps,0n);assert.equal(sold.args.impactBps,0n);
 const closed=events(receipt,'LifecycleClosed')[0];assert.equal(closed.args.residualReserve,0n);assert.equal(closed.args.emergency,false);
 await assert.rejects(s.token.quoteBuy(E('1')),{reason:'restart policy pending'});
 await assert.rejects(s.token.buy.staticCall(E('1'),0,MaxUint256),{reason:'restart policy pending'});
 await checkAccounting(s);
});

test('integrated: fee-free emergency partial and final exits keep disabled compatibility getters at zero and redeem every live reserve atom',async()=>{
 await seed();await(await s.token.sell((await s.token.totalSupply())/4n,0,MaxUint256)).wait();
 const pressure=await s.token.pressureWad(),timestamp=await s.token.lastPartialSellAt();await emergency();
 let supply=await s.token.totalSupply(),r=await s.token.reserve();const q=supply/2n,gross=q*r/supply;
 assert.equal(await s.token.sellImpactBps(q),0n);assert.deepEqual(Array.from(await s.token.quoteSell(q)),[gross,0n,gross]);
 await(await s.token.sell(q,gross,MaxUint256)).wait();
 assert.equal(await s.token.pressureWad(),pressure);assert.equal(await s.token.lastPartialSellAt(),timestamp);
 supply=await s.token.totalSupply();r=await s.token.reserve();const price=await s.token.price();
 await(await s.token.sell(supply,r,MaxUint256)).wait();
 assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.token.price(),price);
 assert.equal(await s.token.pressureWad(),pressure);assert.equal(await s.token.lastPartialSellAt(),timestamp);assert.equal(await s.token.emergencyExit(),true);
 await assert.rejects(s.token.buy.staticCall(E('1'),0,MaxUint256));await checkAccounting(s);
});

test('integrated: quote deadlines/minOut and dust reverts are atomic including disabled compatibility getters and buy quota',async()=>{
 await(await s.binary.addUnits(2000)).wait();await(await s.token.buy(E('500000'),0,MaxUint256)).wait();
 const old=await state();
 const failures=[
  [s.token.sell,[1n,0,MaxUint256],'dust'],
  [s.token.sell,[1000000n,0,MaxUint256],'price step too small'],
  [s.token.buy,[2000000n,0,MaxUint256],'price step too small'],
  [s.token.sell,[E('1'),MaxUint256,MaxUint256],'slippage/dust'],
  [s.token.sell,[E('1'),0,0],'sell input']
 ];
 for(const [method,args,reason] of failures){
  await assert.rejects(method.staticCall(...args),{reason});
  await assert.rejects(async()=>{await(await method(...args,{gasLimit:3000000})).wait();});
  assert.deepEqual(await state(),old);
 }
 await checkAccounting(s);
});

test('integrated: same-time splitting can reduce size surcharge; no anti-splitting claim is made',async()=>{
 await seedLarge();const initialS=await s.token.totalSupply(),start=await p.send('evm_snapshot',[]);
 const amount=initialS/2n,[bulkOut]=await s.token.quoteSell(amount);
 await(await s.token.sell(amount,bulkOut,MaxUint256)).wait();
 await p.send('evm_revert',[start]);
 const q=initialS/4n;let splitOut=0n;
 for(let i=0;i<2;i++){const [out]=await s.token.quoteSell(q);splitOut+=out;await(await s.token.sell(q,out,MaxUint256)).wait();}
 assert.equal(await s.token.pressureWad(),0n);assert(splitOut>bulkOut);
 console.log('EXPERIMENTAL_SIZE_SPLIT_LIMITATION',JSON.stringify({bulkOut:bulkOut.toString(),splitOut:splitOut.toString(),extraPayout:(splitOut-bulkOut).toString(),pressureActive:false}));
 await checkAccounting(s);
});

test('integrated: waiting 300 seconds changes neither fee nor immediately executable payout',async()=>{
 await seedLarge();await(await s.token.sell((await s.token.totalSupply())/2n,0,MaxUint256)).wait();
 const q=(await s.token.totalSupply())/2n,now=Array.from(await s.token.quoteSell(q));
 assert.equal(await s.token.sell.staticCall(q,now[0],MaxUint256),now[0]);
 await p.send('evm_increaseTime',[300]);await p.send('evm_mine',[]);
 assert.deepEqual(Array.from(await s.token.quoteSell(q)),now);
 await(await s.token.sell(q,now[0],MaxUint256)).wait();await checkAccounting(s);
});

test('integrated: unchanged trades use the same gas across sampled elapsed times',async()=>{
 await seedLarge();await(await s.token.sell(E('100'),0,MaxUint256)).wait();
 const q=E('10000'),estimated=await s.token.sell.estimateGas(q,0,MaxUint256),quoted=Array.from(await s.token.sellFeeQuote(q));
 let checkpoint=await p.send('evm_snapshot',[]),gasUsed;
 for(const elapsed of [1,300,8191,19199,19200]){
  await p.send('evm_revert',[checkpoint]);checkpoint=await p.send('evm_snapshot',[]);
  await p.send('evm_increaseTime',[elapsed]);await p.send('evm_mine',[]);
  assert.deepEqual(Array.from(await s.token.sellFeeQuote(q)),quoted);
  const receipt=await(await s.token.sell(q,0,MaxUint256,{gasLimit:estimated})).wait();
  assert(receipt.gasUsed<=estimated);if(gasUsed!==undefined)assert.equal(receipt.gasUsed,gasUsed);gasUsed=receipt.gasUsed;
  await checkAccounting(s);
 }
});

let edgeArtifacts;
async function edgeFixture(assets,shares){
 if(!edgeArtifacts){
  // Test-only subclass creates otherwise impractical integer-boundary states.
  // No seed function, setters or fixture bytecode are added to production artifacts.
  const harness=`pragma solidity 0.8.30;
   import {FTIReserveToken} from './FTIReserveToken.sol';
   contract ReserveEdgeHarness is FTIReserveToken {
    constructor(address stable,address owner) FTIReserveToken(stable,owner,owner) {}
    function seedEdge(address who,uint256 assets,uint256 shares) external {
     require(msg.sender==governance&&totalSupply()==0&&reserve==0,'test seed');
     reserve=assets;
     _mint(who,shares);
    }
    function seedSecondHolder(address who,uint256 shares) external {
     require(msg.sender==governance,'test seed');_mint(who,shares);
    }
   }`;
  const sources={
   'ReserveEdgeHarness.sol':{content:harness},
   'FTIReserveToken.sol':{content:fs.readFileSync('contracts/FTIReserveToken.sol','utf8')},
   'HostileUSD.sol':{content:fs.readFileSync('test/fixtures/HostileUSD.sol','utf8')}
  };
  const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:path=>({contents:fs.readFileSync('node_modules/'+path,'utf8')})}));
  assert(!output.errors?.some(e=>e.severity==='error'),JSON.stringify(output.errors));
  edgeArtifacts={usd:output.contracts['HostileUSD.sol'].HostileUSD,token:output.contracts['ReserveEdgeHarness.sol'].ReserveEdgeHarness};
 }
 const a=edgeArtifacts.usd,usd=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy();await usd.waitForDeployment();
 const b=edgeArtifacts.token,token=await new ContractFactory(b.abi,'0x'+b.evm.bytecode.object,signers[0]).deploy(usd.target,s.addresses[0]);await token.waitForDeployment();
 await(await usd.mint(token.target,assets)).wait();await(await token.seedEdge(s.addresses[0],assets,shares)).wait();
 const read=()=>Promise.all([token.reserve(),token.totalSupply(),token.pressureWad(),token.lastPartialSellAt(),token.referencePrice(),token.lifecycleClosed(),token.cumulativeSell(),token.balanceOf(s.addresses[0]),usd.balanceOf(token.target),usd.balanceOf(s.addresses[0])]);
 return {usd,token,read};
}

test('integrated: one-atom final reserve is fully redeemable without fee dust; failed minOut is atomic',async()=>{
 const {token,usd,read}=await edgeFixture(1n,10n),before=await read(),oldPrice=await token.price();
 assert.deepEqual(Array.from(await token.quoteSell(10n)),[1n,0n,1n]);
 await assert.rejects(token.sell.staticCall(10n,2n,MaxUint256),{reason:'slippage/dust'});
 await assert.rejects(async()=>{await(await token.sell(10n,2n,MaxUint256,{gasLimit:3000000})).wait();});
 assert.deepEqual(await read(),before);
 await(await token.sell(10n,1n,MaxUint256)).wait();
 assert.equal(await token.reserve(),0n);assert.equal(await token.totalSupply(),0n);assert.equal(await usd.balanceOf(token.target),0n);
 assert.equal(await usd.balanceOf(s.addresses[0]),1n);assert.equal(await token.price(),oldPrice);assert.equal(await token.referencePrice(),oldPrice);
 assert.equal(await token.pressureWad(),before[2]);assert.equal(await token.lastPartialSellAt(),before[3]);assert.equal(await token.lifecycleClosed(),true);
});

test('integrated: recipient-tax collateral reverts partial reserve changes and final lifecycle changes atomically',async()=>{
 const {token,usd,read}=await edgeFixture(E('100'),E('1000'));
 await(await usd.setFeeMode(1)).wait();const before=await read();
 for(const q of [E('500'),E('1000')]){
  await assert.rejects(token.sell.staticCall(q,0,MaxUint256),{reason:'unsupported USD'});
  await assert.rejects(async()=>{await(await token.sell(q,0,MaxUint256,{gasLimit:3000000})).wait();});
  assert.deepEqual(await read(),before);
 }
 await(await usd.setFeeMode(0)).wait();await(await token.sell(E('1000'),E('100'),MaxUint256)).wait();
 assert.equal(await token.reserve(),0n);assert.equal(await token.totalSupply(),0n);assert.equal(await usd.balanceOf(s.addresses[0]),E('100'));
});

test('integrated: two-holder atom dust blocks normal exit and consolidation; only existing emergency path resolves fixture',async()=>{
 const {token,usd,read}=await edgeFixture(2n,1n);
 await(await token.seedSecondHolder(s.addresses[1],1n)).wait();
 assert.equal(await token.reserve(),2n);assert.equal(await token.totalSupply(),2n);
 assert.equal(await token.balanceOf(s.addresses[0]),1n);assert.equal(await token.balanceOf(s.addresses[1]),1n);
 const before=await read();
 await assert.rejects(token.quoteSell(1n),{reason:'dust'});
 // q=1, R=2, S=2 implies gross=1, and any positive ceil-rounded fee consumes it.
 // Neither holder can execute the otherwise fee-free all-supply q=2 redemption.
 assert.deepEqual(Array.from(await token.quoteSell(2n)),[2n,0n,2n]);
 for(const i of [0,1]){
  const connected=token.connect(signers[i]);
  await assert.rejects(connected.sell.staticCall(1n,0,MaxUint256),{reason:'dust'});
  await assert.rejects(connected.sell.staticCall(2n,0,MaxUint256),{reason:'sell input'});
  await assert.rejects(connected.transfer.staticCall(s.addresses[1-i],1n),{reason:'transfer dust'});
  await assert.rejects(async()=>{await(await connected.sell(1n,0,MaxUint256,{gasLimit:3000000})).wait();});
  await assert.rejects(async()=>{await(await connected.transfer(s.addresses[1-i],1n,{gasLimit:3000000})).wait();});
  assert.deepEqual(await read(),before);assert.equal(await token.balanceOf(s.addresses[1]),1n);
 }
 // No zero-payout burn, fee waiver, restart or forced consolidation policy is added.
 // The separately existing governance-controlled emergency mode is fee-free.
 await(await token.activateEmergencyExit()).wait();
 await(await token.sell(1n,1n,MaxUint256)).wait();
 await(await token.connect(signers[1]).sell(1n,1n,MaxUint256)).wait();
 assert.equal(await token.reserve(),0n);assert.equal(await token.totalSupply(),0n);
 assert.equal(await usd.balanceOf(s.addresses[0]),1n);assert.equal(await usd.balanceOf(s.addresses[1]),1n);
});
