import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256} from 'ethers';

// LOCAL REVIEW ONLY. Numeric-state setters exist solely in this in-memory
// fixture; no harness enters the contracts directory or production artifacts.
const fixture=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {FTIReserveToken} from './FTIReserveToken.sol';
contract TEST_ONLY_SizeFeeUSD is ERC20 {
 bool public rejectTransfers;
 constructor() ERC20('Size fee fixture USD','TEST') {}
 function mint(address who,uint256 value) external {_mint(who,value);}
 function setRejectTransfers(bool reject) external {rejectTransfers=reject;}
 function _update(address from,address to,uint256 value) internal override {
  require(!rejectTransfers||from==address(0)||to==address(0),'fixture blocked');super._update(from,to,value);
 }
}
contract TEST_ONLY_SizeFeeUSD6 is TEST_ONLY_SizeFeeUSD {
 function decimals() public pure override returns(uint8){return 6;}
}
contract TEST_ONLY_SizeFeeToken is FTIReserveToken {
 constructor(address stable,address owner) FTIReserveToken(stable,owner,owner) {}
 function TEST_ONLY_seed(address who,uint256 assets,uint256 shares) external {
  require(msg.sender==governance&&totalSupply()==0&&reserve==0&&assets<=MAX_RESERVE&&shares<=MAX_SUPPLY,'test only');
  reserve=assets;_mint(who,shares);
 }
}
contract TEST_ONLY_SizeFeeMembership {
 FTIReserveToken public immutable token;
 mapping(address=>uint256) public unitsOf;
 mapping(address=>uint256) public tokenBuySpent;
 constructor(address stable,address reserveToken,address[] memory members) {
  token=FTIReserveToken(reserveToken);
  for(uint256 i;i<members.length;i++)unitsOf[members[i]]=10000;
  IERC20(stable).approve(reserveToken,type(uint256).max);
 }
 function tokenBuyLimit(address who) public view returns(uint256){return unitsOf[who]*500e18;}
 function remainingTokenBuyAllowance(address who) external view returns(uint256){return tokenBuyLimit(who)-tokenBuySpent[who];}
 function authorizeTokenBuy(address who,uint256 amount) external {
  require(msg.sender==address(token),'token only');
  require(tokenBuySpent[who]+amount<=tokenBuyLimit(who),'quota');tokenBuySpent[who]+=amount;
 }
 function inject(uint256 amount) external {token.inject(amount,false);}
 function autoBuy(address who,uint256 amount,uint256 minOut) external {token.autoBuy(who,amount,minOut,type(uint256).max);}
}`;

const W=10n**18n,MAX_R=10n**30n;
const ceil=(n,d)=>(n+d-1n)/d;
function fee(v,r,s=1n){
 const t20=r>10000n*W?r:10000n*W;
 if(!r||!s||20n*v<=t20)return ceil(3n*v,100n);
 const x=20n*v-t20;
 return ceil(120000n*v*v+700n*x*x,4000000n*v);
}
let engine,p,signers,addresses,usd,token,binary,snapshot,compiled;
before(async()=>{
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'TEST_ONLY_SizeFee.sol':{content:fixture}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}}),{
  import:name=>{for(const base of ['contracts','node_modules']){const file=path.join(base,name);if(fs.existsSync(file))return{contents:fs.readFileSync(file,'utf8')};}return{error:`Missing ${name}`};},
 }));
 assert(!output.errors?.some(e=>e.severity==='error'),output.errors?.map(e=>e.formattedMessage).join('\n'));
 compiled=Object.assign({},...Object.values(output.contracts));
 assert(compiled.FTIReserveToken.evm.deployedBytecode.object.length/2<=24576);
 engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:4},chain:{chainId:31337,time:new Date('2026-10-04T00:00:00Z')},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 signers=await Promise.all([0,1,2,3].map(i=>p.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 usd=await deploy('TEST_ONLY_SizeFeeUSD',[]);
 token=await deploy('TEST_ONLY_SizeFeeToken',[usd.target,addresses[0]]);
 binary=await deploy('TEST_ONLY_SizeFeeMembership',[usd.target,token.target,addresses]);
 await tx(token.bind(binary.target));
 for(const who of [...addresses,binary.target])await tx(usd.mint(who,MAX_R));
 for(const signer of signers)await tx(usd.connect(signer).approve(token.target,MaxUint256));
 snapshot=await p.send('evm_snapshot',[]);
});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{await engine.disconnect();});
async function deploy(name,args){const a=compiled[name];const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await c.waitForDeployment();return c;}
async function tx(result){return(await result).wait();}
async function seed(r=E('10000'),s=r*10n){await tx(usd.mint(token.target,r));await tx(token.TEST_ONLY_seed(addresses[0],r,s));}
async function state(){return Promise.all([
 token.reserve(),token.priceProtectionFund(),token.totalSupply(),token.price(),token.referencePrice(),
 token.balanceOf(addresses[0]),token.balanceOf(addresses[1]),token.priceMultiplier(),token.milestonePrice(),
 token.cumulativeBuy(),token.cumulativeSell(),token.pressureWad(),token.lastPartialSellAt(),token.lifecycleClosed(),
 usd.balanceOf(token.target),usd.balanceOf(addresses[0]),usd.balanceOf(addresses[1]),usd.balanceOf(binary.target),
 binary.tokenBuySpent(addresses[0]),binary.tokenBuySpent(addresses[1]),
]);}
async function unchanged(method,args,reason){
 const before=await state();
 if(reason)await assert.rejects(method.staticCall(...args),{reason});
 await assert.rejects(async()=>tx(method(...args,{gasLimit:3000000})));
 assert.deepEqual(await state(),before);
}
async function backed(){const r=await token.reserve(),f=await token.priceProtectionFund();assert.deepEqual(Array.from(await token.accounting()),[r+f,r+f]);assert.equal(await token.unallocatedReserve(),f);}
async function grows(action){const r=await token.reserve(),s=await token.totalSupply(),price=await token.price();await action();assert((await token.reserve())*s>r*(await token.totalSupply()));assert((await token.price())>price);await backed();}

// Deliberately focused proposal coverage; historical pressure suites are not
// asserted to validate this incompatible, unapproved local economic revision.
test('proposal settings and fixed launch/milestone anchors; no production state setter',async()=>{
 assert.equal(await token.LARGE_TRADE_MIN_USD(),E('500'));
 assert.equal(await token.LARGE_TRADE_THRESHOLD_BPS(),500n);assert.equal(await token.MAX_SIZE_FEE_BPS(),700n);
 assert.equal(await token.buyFeeBps(),300n);assert.equal(await token.TRANSFER_BURN_BPS(),300n);
 assert.equal(await token.launchPrice(),E('0.1'));assert.equal(await token.milestonePrice(),E('1'));
 assert.equal(await token.SELL_PRESSURE_ACTIVE(),false);assert.equal(await token.SELL_CAPS_ACTIVE(),false);
 assert.equal(await token.MAX_PRESSURE_FEE_BPS(),0n);assert.equal(await token.currentSellPressure(),0n);
 assert(!compiled.FTIReserveToken.abi.some(x=>x.name?.startsWith('TEST_ONLY_')));
});

test('R=10000: buys and partial sells at or below 500 have only the 3% base fee',async()=>{
 await seed();
 for(const v of [E('1'),E('100'),E('499.999999999999999999'),E('500')]){
  assert.deepEqual(Array.from(await token.buyFeeQuote(v)),[ceil(v*3n,100n),v-ceil(v*3n,100n)]);
  assert.deepEqual(Array.from(await token.sellFeeQuote(v*10n)),[ceil(v*3n,100n),v-ceil(v*3n,100n),v]);
  assert.equal((await token.quoteSell(v*10n))[1],300n);
 }
});

for(const reserveUSD of ['100','1000','9999.999999999999999999','10000.000000000000000001','20000','1000000']){
 test(`$500 floor: buy and valid partial sell quotes stay 3% for R=${reserveUSD}`,async()=>{
  const r=E(reserveUSD);await seed(r);
  for(const v of [E('1'),E('99'),E('499.999999999999999999'),E('500')]){
   const f=ceil(v*3n,100n);
   assert.deepEqual(Array.from(await token.buyFeeQuote(v)),[f,v-f]);
   if(v<r){
    assert.deepEqual(Array.from(await token.sellFeeQuote(v*10n)),[f,v-f,v]);
    assert.equal(await token.sellImpactBps(v*10n),0n);
   }
  }
 });
}

test('extra fee needs both conditions: above $500 and above 5% of live reserve',async()=>{
 await seed(E('20000'));
 for(const v of [E('500'),E('750'),E('1000')]){
  assert.equal((await token.buyFeeQuote(v))[0],ceil(3n*v,100n));
  assert.equal((await token.sellFeeQuote(v*10n))[0],ceil(3n*v,100n));
 }
 for(const v of [E('1000.01'),E('1500'),E('2000')]){
  assert.equal((await token.buyFeeQuote(v))[0],fee(v,E('20000')));
  assert((await token.buyFeeQuote(v))[0]>ceil(v*3n,100n));
  assert.equal((await token.sellFeeQuote(v*10n))[0],fee(v,E('20000')));
 }
});

test('small live reserve $500 boundary is smooth, and larger trades use only the excess',async()=>{
 await seed(E('1000'));
 const t=E('500');
 for(const v of [t-1n,t,t+1n,E('500.01'),E('600')]){
  assert.equal((await token.buyFeeQuote(v))[0],fee(v,E('1000')));
  assert.equal((await token.sellFeeQuote(v*10n))[0],fee(v,E('1000')));
 }
 assert.equal((await token.buyFeeQuote(t))[0],E('15'));
 assert((await token.buyFeeQuote(t+1n))[0]-(await token.buyFeeQuote(t))[0]<=1n);
 assert((await token.buyFeeQuote(E('500.01')))[0]>ceil(E('500.01')*3n,100n));
});

test('actual $500 buy against small reserve keeps all cash, mints at exactly the base fee and enforces minOut',async()=>{
 await seed(E('100'));const amount=E('500'),minted=E('4850');
 assert.equal(await token.quoteBuy(amount),minted);
 await unchanged(token.buy,[amount,minted+1n,MaxUint256],'slippage/dust');
 await grows(()=>tx(token.buy(amount,minted,MaxUint256)));
 assert.equal(await token.reserve(),E('600'));assert.equal(await token.totalSupply(),E('5850'));
 assert.equal(await binary.tokenBuySpent(addresses[0]),amount);
});

test('actual $500 partial sale from $1000 reserve burns q, retains $15 and enforces minOut',async()=>{
 await seed(E('1000'));const q=E('5000'),payout=E('485'),before=await usd.balanceOf(addresses[0]);
 await unchanged(token.sell,[q,payout+1n,MaxUint256],'slippage/dust');
 await grows(()=>tx(token.sell(q,payout,MaxUint256)));
 assert.equal(await token.reserve(),E('515'));assert.equal(await token.totalSupply(),E('5000'));
 assert.equal(await usd.balanceOf(addresses[0])-before,payout);
});

test('USD floor uses 18-decimal dollars; unsupported six-decimal collateral is rejected',async()=>{
 const other=await deploy('TEST_ONLY_SizeFeeUSD6',[]);
 await assert.rejects(deploy('FTIReserveToken',[other.target,addresses[0],addresses[0]]));
 assert.equal(await token.LARGE_TRADE_MIN_USD(),500n*10n**18n);
});

test('bootstrap retains the existing 3% review exception below and above $500, excluding protected cash',async()=>{
 await tx(binary.inject(E('900000')));
 for(const v of [E('100'),E('500'),E('1000'),E('100000')]){
  assert.deepEqual(Array.from(await token.buyFeeQuote(v)),[v*3n/100n,v*97n/100n]);
 }
 await tx(token.buy(E('1000'),E('9700'),MaxUint256));
 assert.equal(await token.reserve(),E('1000'));assert.equal(await token.priceProtectionFund(),E('900000'));
 // Once live, that same amount uses the dollar-floor size curve.
 assert.equal((await token.buyFeeQuote(E('1000')))[0],E('47.5'));
 await backed();
});

test('R=10000 T=500: both directions quote total fees 47.5 on 1000 and 433.5 on 5000',async()=>{
 await seed();
 for(const [v,f] of [[E('1000'),E('47.5')],[E('5000'),E('433.5')]]){
  assert.deepEqual(Array.from(await token.buyFeeQuote(v)),[f,v-f]);
  assert.deepEqual(Array.from(await token.sellFeeQuote(v*10n)),[f,v-f,v]);
  assert.equal(await token.quoteBuy(v),(v-f)*10n);
 }
});

test('curve has no threshold jump; ideal marginal fee is below 10%, with atom-level rounding disclosed',async()=>{
 await seed();const t=E('500');
 const left=(await token.buyFeeQuote(t-1n))[0],at=(await token.buyFeeQuote(t))[0],right=(await token.buyFeeQuote(t+1n))[0];
 assert(at-left<=1n);assert(right-at<=1n);
 for(const [lo,hi] of [[501n,502n],[1000n,1001n],[5000n,5001n],[100000n,100001n]]){
  const delta=(await token.buyFeeQuote(hi*W))[0]-(await token.buyFeeQuote(lo*W))[0];
  assert(delta>=E('0.03'));assert(delta<E('0.1'));
 }
});

test('large buy leaves a different wallet’s next small buy and sell at exactly base 3%',async()=>{
 await seed();await grows(()=>tx(token.buy(E('5000'),0,MaxUint256)));
 const r=await token.reserve(),s=await token.totalSupply(),amount=E('400');
 assert.equal((await token.buyFeeQuote(amount))[0],ceil(amount*3n,100n));
 await grows(()=>tx(token.connect(signers[1]).buy(amount,0,MaxUint256)));
 const q=await token.balanceOf(addresses[1]),gross=q*(await token.reserve())/(await token.totalSupply());
 assert(20n*gross<=await token.reserve());assert.equal((await token.sellFeeQuote(q))[0],ceil(gross*3n,100n));
 await grows(()=>tx(token.connect(signers[1]).sell(q,0,MaxUint256)));
 assert(s>0n);assert.equal(await token.pressureWad(),0n);assert.equal(await token.lastPartialSellAt(),0n);
});

test('large sell leaves small later transactions at base 3%, independent of elapsed time',async()=>{
 await seed();await grows(()=>tx(token.sell(E('50000'),0,MaxUint256)));
 let r=await token.reserve(),s=await token.totalSupply(),q=s/25n,gross=q*r/s;
 assert.equal((await token.sellFeeQuote(q))[0],ceil(gross*3n,100n));
 const amount=r/25n,before=Array.from(await token.buyFeeQuote(amount));
 assert.equal(before[0],ceil(amount*3n,100n));
 await p.send('evm_increaseTime',[7200]);await p.send('evm_mine',[]);
 assert.deepEqual(Array.from(await token.buyFeeQuote(amount)),before);
 assert.equal(await token.previewSellPressure(q),0n);
 await grows(()=>tx(token.connect(signers[1]).buy(amount,0,MaxUint256)));
 r=await token.reserve();s=await token.totalSupply();q=s/30n;gross=q*r/s;
 assert.equal((await token.sellFeeQuote(q))[0],ceil(gross*3n,100n));
 await grows(()=>tx(token.sell(q,0,MaxUint256)));
});

test('actual buy retains all gross cash and mints only net fee value at pretrade price',async()=>{
 await seed();const price=await token.price(),oldR=await token.reserve(),oldS=await token.totalSupply();
 const amount=E('1000'),feeAmount=E('47.5'),minted=(amount-feeAmount)*W/price;
 await grows(()=>tx(token.buy(amount,minted,MaxUint256)));
 assert.equal(await token.reserve(),oldR+amount);assert.equal(await token.totalSupply(),oldS+minted);
 assert.equal(await binary.tokenBuySpent(addresses[0]),amount);
});

test('actual partial sell burns gross tokens, pays V-F and retains F; transfer still burns 3%',async()=>{
 await seed();const oldS=await token.totalSupply(),beforeUSD=await usd.balanceOf(addresses[0]);
 await grows(()=>tx(token.sell(E('10000'),E('952.5'),MaxUint256)));
 assert.equal(await token.reserve(),E('9047.5'));assert.equal(await token.totalSupply(),oldS-E('10000'));
 assert.equal(await usd.balanceOf(addresses[0])-beforeUSD,E('952.5'));
 const r=await token.reserve(),s=await token.totalSupply();
 await grows(()=>tx(token.transfer(addresses[1],E('100'))));
 assert.equal(await token.balanceOf(addresses[1]),E('97'));assert.equal(await token.totalSupply(),s-E('3'));assert.equal(await token.reserve(),r);
});

test('bootstrap uses only 3% with protected fund excluded; final sale returns full live reserve and closes lifecycle',async()=>{
 await tx(binary.inject(E('500')));
 assert.equal(await token.priceProtectionFund(),E('500'));assert.equal(await token.reserve(),0n);
 assert.deepEqual(Array.from(await token.buyFeeQuote(E('100'))),[E('3'),E('97')]);
 assert.equal(await token.quoteBuy(E('100')),E('970'));
 await tx(token.buy(E('100'),E('970'),MaxUint256));await backed();
 const q=await token.totalSupply(),r=await token.reserve(),historical=await token.price();
 assert.deepEqual(Array.from(await token.sellFeeQuote(q)),[0n,r,r]);
 await tx(token.sell(q,r,MaxUint256));
 assert.equal(await token.reserve(),0n);assert.equal(await token.totalSupply(),0n);assert.equal(await token.priceProtectionFund(),E('500'));
 assert.equal(await token.referencePrice(),historical);assert.equal(await token.lifecycleClosed(),true);await backed();
 await unchanged(token.buy,[E('1'),0,MaxUint256],'restart policy pending');
 await unchanged(binary.autoBuy,[addresses[0],E('1'),0],'restart policy pending');
});

test('large fund is excluded from threshold, reserve, minting price and final redemptions',async()=>{
 await tx(binary.inject(E('900000')));await seed();
 assert.equal(await token.price(),E('0.1'));
 assert.equal((await token.buyFeeQuote(E('1000')))[0],E('47.5'));
 assert.equal((await token.sellFeeQuote(E('10000')))[0],E('47.5'));
 await grows(()=>tx(token.buy(E('1000'),0,MaxUint256)));
 await tx(token.sell(await token.totalSupply(),await token.reserve(),MaxUint256));
 assert.equal(await token.priceProtectionFund(),E('900000'));await backed();
 await tx(binary.inject(E('17')));assert.equal(await token.priceProtectionFund(),E('900017'));assert.equal(await token.reserve(),0n);
 assert.equal(await token.lifecycleClosed(),true);await backed();
});

test('one combined ceiling avoids charging a second atom for separately rounded base and surcharge',async()=>{
 await seed(E('1000'));
 const v=E('500')+51n,once=(await token.buyFeeQuote(v))[0];
 assert.equal(once,E('15')+2n);
 assert.equal(ceil(v*3n,100n)+ceil(7n*51n*51n,100n*v),E('15')+3n);
 assert.equal((await token.sellFeeQuote(v*10n))[0],once);
});

test('fractional-atom reserve threshold above the dollar floor stays exact',async()=>{
 const r=E('20000')+39n;await seed(r);
 for(let i=0n;i<400n;i++){
  const v=E('12000')+i;
  assert.equal((await token.buyFeeQuote(v))[0],fee(v,r));
 }
 const v=E('12000')+8n,b=v-r/20n;
 const earlyFloor=ceil(3n*v*v+7n*b*b,100n*v);
 assert.equal(fee(v,r),1065833333333333333334n);
 assert.equal(earlyFloor,fee(v,r)+1n,'flooring the threshold early would overcharge one atom');
 assert.equal((await token.sellFeeQuote(v*10n))[0],fee(v,r));
});

test('quote and execution dust, minOut and deadline failures atomically preserve quota and every cash bucket',async()=>{
 await tx(binary.inject(E('100')));await seed();
 await unchanged(token.buy,[1n,0,MaxUint256],'dust');
 await unchanged(token.buy,[100n,0,MaxUint256],'slippage/dust');
 await unchanged(token.sell,[10n,0,MaxUint256],'dust');
 await unchanged(token.buy,[E('1000'),(await token.quoteBuy(E('1000')))+1n,MaxUint256],'slippage/dust');
 await unchanged(token.sell,[E('10000'),E('952.5')+1n,MaxUint256],'slippage/dust');
 await unchanged(token.buy,[E('1000'),0,0],'buy input');
 await unchanged(token.sell,[E('10000'),0,0],'sell input');
});

test('failed collateral movement rolls back manual authorization and auto-buy/sell accounting',async()=>{
 await tx(binary.inject(E('100')));await seed();await tx(usd.setRejectTransfers(true));
 await unchanged(token.buy,[E('1000'),0,MaxUint256],'fixture blocked');
 await unchanged(binary.autoBuy,[addresses[0],E('1000'),0],'fixture blocked');
 await unchanged(token.sell,[E('10000'),0,MaxUint256],'fixture blocked');
 await backed();
});

test('MAX_RESERVE quote bounds and deterministic reference samples are overflow-safe',async()=>{
 await seed(MAX_R,MAX_R*10n);
 for(const value of [1n,MAX_R/20n,MAX_R/20n+1n,MAX_R/2n,MAX_R-1n,MAX_R]){
  assert.equal((await token.buyFeeQuote(value))[0],fee(value,MAX_R));
  const q=value*10n;if(q<MAX_R*10n&&value>1n)assert.equal((await token.sellFeeQuote(q))[0],fee(value,MAX_R));
 }
 await assert.rejects(token.buyFeeQuote(MAX_R+1n),{reason:'amount'});
 // Quotability does not authorize a buy that exceeds total tracked-cash limits.
 await unchanged(token.buy,[E('1000'),0,MaxUint256],'range');
 let v=123456789n;
 for(let i=0;i<40;i++){v=(v*6364136223846793005n+1442695040888963407n)%MAX_R+1n;assert.equal((await token.buyFeeQuote(v))[0],fee(v,MAX_R));}
});

test('splitting buys below their live threshold bypasses the extra fee: explicit limitation evidence',async()=>{
 await seed();assert.equal((await token.buyFeeQuote(E('1000')))[0],E('47.5'));
 let totalFees=0n;
 for(let i=0;i<2;i++){
  const amount=E('500'),f=(await token.buyFeeQuote(amount))[0];assert.equal(f,E('15'));totalFees+=f;
  await grows(()=>tx(token.buy(amount,0,MaxUint256)));
 }
 assert.equal(totalFees,E('30'));assert(totalFees<E('47.5'));
});

test('splitting sales can bypass the surcharge; retained base fees and changing prices still affect proceeds',async()=>{
 await seed();const totalTokens=E('10000'),oneShot=await token.sellFeeQuote(totalTokens);assert.equal(oneShot[0],E('47.5'));
 let paid=0n,fees=0n;
 for(let i=0;i<4;i++){
  const q=E('2500'),quote=await token.sellFeeQuote(q),r=await token.reserve();
  assert(20n*quote[2]<=r);assert.equal(quote[0],ceil(quote[2]*3n,100n));fees+=quote[0];paid+=quote[1];
  await grows(()=>tx(token.sell(q,quote[1],MaxUint256)));
 }
 assert(fees<oneShot[0]);assert(paid>oneShot[1]);assert.equal(await token.currentSellPressure(),0n);
});

test('auto-buy pays the same amount-based fee while only gross manual buys consume quota',async()=>{
 await seed();const amount=E('1000'),expected=await token.quoteBuy(amount),start=await token.balanceOf(addresses[1]);
 assert.equal((await token.buyFeeQuote(amount))[0],E('47.5'));
 await grows(()=>tx(binary.autoBuy(addresses[1],amount,expected)));
 assert.equal(await token.balanceOf(addresses[1])-start,expected);assert.equal(await binary.tokenBuySpent(addresses[1]),0n);
 const manualExpected=await token.quoteBuy(amount),current=await token.balanceOf(addresses[1]);
 await grows(()=>tx(token.connect(signers[1]).buy(amount,manualExpected,MaxUint256)));
 assert.equal(await token.balanceOf(addresses[1])-current,manualExpected);assert.equal(await binary.tokenBuySpent(addresses[1]),amount);
 await tx(token.connect(signers[1]).sell(await token.balanceOf(addresses[1]),0,MaxUint256));
 assert.equal(await binary.tokenBuySpent(addresses[1]),amount);
 assert.equal(await token.locked(addresses[1]),0n);assert.equal(await token.lockCount(addresses[1]),0n);
});

test('emergency partial and terminal exits retain their existing fee-free exception and protect the fund',async()=>{
 await tx(binary.inject(E('100')));await seed();await tx(token.activateEmergencyExit());
 const q=E('50000');assert.deepEqual(Array.from(await token.sellFeeQuote(q)),[0n,E('5000'),E('5000')]);
 await tx(token.sell(q,E('5000'),MaxUint256));
 await tx(token.sell(await token.totalSupply(),await token.reserve(),MaxUint256));
 assert.equal(await token.reserve(),0n);assert.equal(await token.priceProtectionFund(),E('100'));await backed();
 assert.equal(await token.currentSellPressure(),0n);assert.equal(await token.lifecycleClosed(),true);
});

test('indicative legacy bps never replace exact fee amounts; sub-bps surcharge is still charged',async()=>{
 await seed();const q=E('5010'),[feeAmount,payout,gross]=await token.sellFeeQuote(q),legacy=await token.quoteSell(q);
 assert(feeAmount>ceil(gross*3n,100n));assert.equal(legacy[0],payout);assert.equal(legacy[2],gross);
 assert.equal(legacy[1],300n);assert.equal(await token.sellImpactBps(q),0n);
});

test('real BinaryPlan integration: gross manual quota and Member auto eligibility remain unchanged',async()=>{
 const live=await deploy('FTIReserveToken',[usd.target,addresses[0],addresses[0]]);
 const artifact=JSON.parse(fs.readFileSync('artifacts/BinaryPlan.json','utf8'));
 const genesis=[...addresses,...Array.from({length:27},(_,i)=>'0x'+(0x1000+i).toString(16).padStart(40,'0'))];
 const plan=await new ContractFactory(artifact.abi,artifact.bytecode,signers[0]).deploy(usd.target,live.target,addresses[0],addresses[0],addresses[3],genesis);
 await plan.waitForDeployment();await tx(live.bind(plan.target));
 for(const signer of signers.slice(0,3)){
  await tx(usd.connect(signer).approve(plan.target,MaxUint256));
  await tx(usd.connect(signer).approve(live.target,MaxUint256));
 }
 await tx(plan.addUnits(1));assert.equal(await live.priceProtectionFund(),E('5'));
 assert.equal(await plan.tokenBuyLimit(addresses[0]),E('500'));
 await tx(live.buy(E('100'),0,MaxUint256));await tx(plan.setAutoBuy(true));
 for(const signer of signers.slice(1,3))await tx(plan.connect(signer).addUnits(2));
 while(await plan.jobCursor()<await plan.jobCount())await tx(plan.processVolume(100,{gasLimit:12000000}));
 const block=await p.getBlock('latest'),end=Number(await plan.epochEnd());
 await p.send('evm_increaseTime',[Math.max(0,end-block.timestamp+1)]);await p.send('evm_mine',[]);
 await tx(plan.beginEpochClose());while(await plan.phase()>0n)await tx(plan.processEpoch(100,{gasLimit:12000000}));
 // Real paid points preserve the existing rank rule: an unranked Member
 // cannot allocate auto rewards merely by enabling the setting.
 assert.equal(await plan.rankOf(addresses[0]),0n);
 assert.equal(await plan.pendingAuto(addresses[0]),0n);
 assert((await plan.pendingReward(addresses[0]))>0n);
 assert.equal(await plan.tokenBuySpent(addresses[0]),E('100'));
 assert.equal(await plan.remainingTokenBuyAllowance(addresses[0]),E('400'));
 const amount=E('400'),r=await live.reserve(),s=await live.totalSupply(),expected=await live.quoteBuy(amount),actualFee=(await live.buyFeeQuote(amount))[0];
 assert.equal(actualFee,fee(amount,r,s));assert.equal(actualFee,ceil(amount*3n,100n));
 await tx(live.buy(amount,expected,MaxUint256));
 assert.equal(await live.totalSupply(),s+expected);assert.equal(await live.reserve(),r+amount);
 assert.equal(await plan.tokenBuySpent(addresses[0]),E('500'));
 const oldR=await live.reserve(),oldS=await live.totalSupply();
 await assert.rejects(live.buy.staticCall(E('1'),0,MaxUint256),{reason:'allowance'});
 await assert.rejects(async()=>tx(live.buy(E('1'),0,MaxUint256,{gasLimit:3000000})));
 assert.equal(await live.reserve(),oldR);assert.equal(await live.totalSupply(),oldS);assert.equal(await plan.tokenBuySpent(addresses[0]),E('500'));
 for(const c of [plan,live]){const[actual,accounted]=await c.accounting();assert.equal(actual,accounted);}
});
