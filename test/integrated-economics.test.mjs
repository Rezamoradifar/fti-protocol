import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import solc from 'solc';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256,ZeroAddress} from 'ethers';
import {deploySuite,checkAccounting,artifact} from '../scripts/lib.mjs';

// Local experimental token checks. This is not an audit, a price guarantee or a
// claim that the endpoint pressure fee eliminates splitting or delayed sales.
const W=10n**18n, DECAY=997692176527023318n;
const fee=(gross,bps)=>(gross*bps+9999n)/10000n;
const nextPressure=(p0,q,supply)=>W-(W-p0)*(supply-q)/supply;
const impact=p1=>700n*(p1*p1/W)/W;
function decayed(value,seconds){
 if(seconds>=19200n)return 0n;
 let factor=W,base=DECAY;
 for(let n=seconds;n>0n;n>>=1n){
  if(n&1n)factor=factor*base/W;
  if(n>1n)base=base*base/W;
 }
 return value*factor/W;
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
 assert.equal(await s.token.PRESSURE_DECAY_PER_SECOND(),DECAY);
 assert.equal(await s.token.PRESSURE_HALF_LIFE(),300n);assert.equal(await s.token.MAX_SELL_FEE_BPS(),1000n);
 assert(!artifact('FTIReserveToken').abi.some(x=>/charity|animal/i.test(x.name??'')));
 await seed();assert.equal(await s.token.reserve(),E('100'));assert.equal(await s.token.unallocatedReserve(),E('5'));assert.equal(await s.token.totalSupply(),E('970'));
 const r=await s.token.reserve(),supply=await s.token.totalSupply(),price=await s.token.price();
 const expected=E('97')*W/price;assert.equal(await s.token.quoteBuy(E('100')),expected);
 await(await s.token.buy(E('100'),expected,MaxUint256)).wait();
 assert.equal(await s.token.reserve(),r+E('100'));assert.equal(await s.token.totalSupply(),supply+expected);
 await assertGrowth(r,supply,price);
});

test('integrated: endpoint surcharge follows p1 squared, bounded by total 10%; final exit has no fee',async()=>{
 await seed();const supply=await s.token.totalSupply(),r=await s.token.reserve();
 for(const [q,expectedImpact] of [[supply/4n,43n],[supply/2n,175n],[supply*9n/10n,567n],[supply-10000n,699n],[supply-1n,700n]]){
  const p1=nextPressure(0n,q,supply),bps=300n+impact(p1),gross=q*r/supply;
  assert.equal(await s.token.previewSellPressure(q),p1);assert.equal(await s.token.sellImpactBps(q),expectedImpact);
  assert(bps>=300n&&bps<=1000n);
  assert.deepEqual(Array.from(await s.token.quoteSell(q)),[gross-fee(gross,bps),bps,gross]);
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

test('integrated: global pressure compounds across successive same-block partial sales',async()=>{
 await seed();let supply=await s.token.totalSupply();
 await(await s.token.sell(supply/2n,0,MaxUint256)).wait();assert.equal(await s.token.pressureWad(),W/2n);
 supply=await s.token.totalSupply();const [out,bps]=await s.token.quoteSell(supply/2n);
 assert.equal(await s.token.previewSellPressure(supply/2n),3n*W/4n);assert.equal(bps,693n);
 const receipt=await(await s.token.sell(supply/2n,out,MaxUint256)).wait();
 assert.equal(await s.token.pressureWad(),3n*W/4n);assert.equal(await s.token.currentSellPressure(),3n*W/4n);
 assert.equal(events(receipt,'SellPressureUpdated').length,1);
 await checkAccounting(s);
});

test('integrated: deterministic decay closely approximates a 300-second half-life and terminates at 64 half-lives',async()=>{
 await seed();await(await s.token.sell((await s.token.totalSupply())/2n,0,MaxUint256)).wait();
 const timestamp=await s.token.lastPartialSellAt();let previous=0n,last=W/2n;
 for(const elapsed of [1n,2n,299n,300n,600n,1200n,18000n,19199n,19200n,1000000n]){
  await p.send('evm_increaseTime',[Number(elapsed-previous)]);await p.send('evm_mine',[]);previous=elapsed;
  const actual=await s.token.currentSellPressure();assert.equal(actual,decayed(W/2n,elapsed));assert(actual<=last);last=actual;
  if(elapsed===300n){assert.equal(actual,249999999999999904n);assert(W/4n-actual<1000n);}
  if(elapsed===600n){assert.equal(actual,124999999999999904n);assert(W/8n-actual<1000n);}
 }
 assert.equal(await s.token.currentSellPressure(),0n);assert.equal(await s.token.pressureWad(),W/2n);assert.equal(await s.token.lastPartialSellAt(),timestamp);
 // The next quote uses zero decayed pressure; the old stored snapshot is not a lock.
 const supply=await s.token.totalSupply();assert.equal(await s.token.sellImpactBps(supply/2n),175n);
 await(await s.token.sell(supply/2n,0,MaxUint256)).wait();assert.equal(await s.token.pressureWad(),W/2n);
});

test('integrated: buys, binary injections, transfer burns and switching seller wallets never reset global pressure',async()=>{
 await seed();await(await s.token.sell((await s.token.totalSupply())/2n,0,MaxUint256)).wait();
 const snapshotPressure=await s.token.pressureWad(),timestamp=await s.token.lastPartialSellAt();
 await(await s.token.buy(E('100'),0,MaxUint256)).wait();
 await(await s.binary.addUnits(1)).wait();
 const r=await s.token.reserve(),supply=await s.token.totalSupply(),price=await s.token.price();
 const cash=await s.usd.balanceOf(s.token.target),receipt=await(await s.token.transfer(s.addresses[1],E('100'))).wait();
 assert.equal(await s.token.balanceOf(s.addresses[1]),E('97'));assert.equal(await s.token.totalSupply(),supply-E('3'));
 assert.equal(await s.token.reserve(),r);assert.equal(await s.usd.balanceOf(s.token.target),cash);
 const transfers=events(receipt,'Transfer');assert.equal(transfers.length,2);assert.equal(transfers[0].args.to,ZeroAddress);assert.equal(transfers[0].args.value,E('3'));
 await assertGrowth(r,supply,price);
 assert.equal(await s.token.pressureWad(),snapshotPressure);assert.equal(await s.token.lastPartialSellAt(),timestamp);
 assert.equal(await s.token.currentSellPressure(),snapshotPressure);
 const q=E('50'),p1=nextPressure(snapshotPressure,q,await s.token.totalSupply());
 assert.equal(await s.token.previewSellPressure(q),p1);assert((await s.token.sellImpactBps(q))>=175n);
 await(await s.token.connect(signers[1]).sell(q,0,MaxUint256)).wait();assert.equal(await s.token.pressureWad(),p1);
 await checkAccounting(s);
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

test('integrated: fee-free emergency partial and final exits keep pressure untouched and redeem every live reserve atom',async()=>{
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

test('integrated: quote deadlines/minOut and dust reverts are atomic including pressure snapshots and buy quota',async()=>{
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

test('integrated: same-time splitting can reduce endpoint surcharge and increase payout; it is not anti-splitting proof',async()=>{
 await seed();const initialS=await s.token.totalSupply(),start=await p.send('evm_snapshot',[]);
 const amount=initialS/2n,[bulkOut]=await s.token.quoteSell(amount);
 await(await s.token.sell(amount,bulkOut,MaxUint256)).wait();const bulkPressure=await s.token.pressureWad();
 await p.send('evm_revert',[start]);
 const q=initialS/4n;let splitOut=0n;
 for(let i=0;i<2;i++){const [out]=await s.token.quoteSell(q);splitOut+=out;await(await s.token.sell(q,out,MaxUint256)).wait();}
 assert.equal(await s.token.pressureWad(),bulkPressure);assert.equal(bulkPressure,W/2n);
 assert(splitOut>bulkOut);
 console.log('EXPERIMENTAL_SPLIT_LIMITATION',JSON.stringify({bulkOut:bulkOut.toString(),splitOut:splitOut.toString(),extraPayout:(splitOut-bulkOut).toString(),sameEndPressure:bulkPressure.toString()}));
 await checkAccounting(s);
});

test('integrated: waiting a half-life lowers the next fee but immediate redemption remains available',async()=>{
 await seed();await(await s.token.sell((await s.token.totalSupply())/2n,0,MaxUint256)).wait();
 const q=(await s.token.totalSupply())/2n,[nowOut,nowFee]=await s.token.quoteSell(q);
 assert((await s.token.sell.staticCall(q,nowOut,MaxUint256))>0n);
 await p.send('evm_increaseTime',[300]);await p.send('evm_mine',[]);
 const [laterOut,laterFee]=await s.token.quoteSell(q);assert(laterFee<nowFee);assert(laterOut>nowOut);
 await(await s.token.sell(q,laterOut,MaxUint256)).wait();await checkAccounting(s);
});

test('integrated: buffered same-second gas estimate covers sampled later pressure-decay branches',async()=>{
 await seed();await(await s.token.sell(E('100'),0,MaxUint256)).wait();
 const q=E('100'),estimated=await s.token.sell.estimateGas(q,0,MaxUint256),buffered=estimated*125n/100n+30000n;
 let checkpoint=await p.send('evm_snapshot',[]),exceededUnbuffered=false;
 for(const elapsed of [1,300,8191,19199,19200]){
  await p.send('evm_revert',[checkpoint]);checkpoint=await p.send('evm_snapshot',[]);
  await p.send('evm_increaseTime',[elapsed]);
  const receipt=await(await s.token.sell(q,0,MaxUint256,{gasLimit:buffered})).wait();
  assert(receipt.gasUsed<buffered);if(receipt.gasUsed>estimated)exceededUnbuffered=true;
  await checkAccounting(s);
 }
 // The estimate's timestamp matters: a stale unbuffered value is not a promise
 // that a later block can execute the same bounded-decay path at that gas limit.
 assert(exceededUnbuffered);
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
     reserve=assets;pressureWad=WAD/2;lastPartialSellAt=block.timestamp;
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

test('integrated: recipient-tax collateral reverts partial pressure changes and final lifecycle changes atomically',async()=>{
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
