import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256} from 'ethers';

// This is an isolated, local-only experiment. Quarantine prevents first-minter
// capture; it does not assign ownership or approve a future allocation policy.
// All harnesses compile in memory and never enter production artifacts.
const fixture=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {FTIReserveToken} from './FTIReserveToken.sol';
contract TEST_ONLY_QuarantineMembership {
 FTIReserveToken public immutable token;
 mapping(address=>uint256) public unitsOf;
 mapping(address=>uint256) public tokenBuySpent;
 constructor(address stable,address reserveToken,address member) {
  token=FTIReserveToken(reserveToken);unitsOf[member]=1000;
  IERC20(stable).approve(reserveToken,type(uint256).max);
 }
 function tokenBuyLimit(address who) public view returns(uint256){return unitsOf[who]*500e18;}
 function remainingTokenBuyAllowance(address who) external view returns(uint256){return tokenBuyLimit(who)-tokenBuySpent[who];}
 function authorizeTokenBuy(address who,uint256 amount) external {
  require(msg.sender==address(token),'token only');
  require(tokenBuySpent[who]+amount<=tokenBuyLimit(who),'quota');tokenBuySpent[who]+=amount;
 }
 function inject(uint256 amount,bool newWallet) external {token.inject(amount,newWallet);}
 function autoBuy(address who,uint256 amount,uint256 minOut) external {token.autoBuy(who,amount,minOut,type(uint256).max);}
}
contract TEST_ONLY_QuarantineUSD is ERC20 {
 uint256 public feeMode;address public callback;bytes public payload;
 bool public requireCallback;bool public attempted;bool public succeeded;
 constructor() ERC20('Quarantine fixture USD','TEST') {}
 function mint(address who,uint256 amount) external {_mint(who,amount);}
 function burn(address who,uint256 amount) external {_burn(who,amount);}
 function setFeeMode(uint256 mode) external {feeMode=mode;}
 function setCallback(address target,bytes calldata data,bool mustSucceed) external {
  callback=target;payload=data;requireCallback=mustSucceed;attempted=false;succeeded=false;
 }
 function transferFrom(address from,address to,uint256 amount) public override returns(bool){
  if(callback!=address(0)){attempted=true;(succeeded,)=callback.call(payload);require(!requireCallback||succeeded,'callback rejected');}
  return super.transferFrom(from,to,amount);
 }
 function _update(address from,address to,uint256 amount) internal override {
  super._update(from,to,amount);
  if(from!=address(0)&&to!=address(0)&&amount>=100){
   if(feeMode==1)super._update(to,address(0),amount/100);
   if(feeMode==2)super._update(from,address(0),amount/100);
  }
 }
}
contract TEST_ONLY_QuarantineBoundaryToken is FTIReserveToken {
 constructor(address stable,address owner) FTIReserveToken(stable,owner,owner) {}
 function TEST_ONLY_setHistoricalReference(uint256 p) external {require(msg.sender==governance&&totalSupply()==0,'test only');referencePrice=p;}
 function TEST_ONLY_seed(address who,uint256 assets,uint256 shares) external {
  require(msg.sender==governance&&totalSupply()==0&&reserve==0,'test only');reserve=assets;_mint(who,shares);
 }
}`;

let engine,p,signers,addresses,usd,token,binary,snapshot,compiled;
before(async()=>{
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'TEST_ONLY_Quarantine.sol':{content:fixture}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{
  import:name=>{for(const base of ['contracts','node_modules']){const file=path.join(base,name);if(fs.existsSync(file))return{contents:fs.readFileSync(file,'utf8')};}return{error:`Missing ${name}`};},
 }));
 assert(!output.errors?.some(error=>error.severity==='error'),output.errors?.map(error=>error.formattedMessage).join('\n'));
 compiled=Object.assign({},...Object.values(output.contracts));
 engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:4},chain:{chainId:31337,time:new Date('2026-10-04T00:00:00Z')},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 signers=await Promise.all([0,1,2,3].map(i=>p.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 usd=await deploy('TEST_ONLY_QuarantineUSD',[]);
 token=await deploy('FTIReserveToken',[usd.target,addresses[0],addresses[0]]);
 binary=await deploy('TEST_ONLY_QuarantineMembership',[usd.target,token.target,addresses[0]]);
 await tx(token.bind(binary.target));
 for(const who of [addresses[0],binary.target])await tx(usd.mint(who,E('10000000')));
 await tx(usd.approve(token.target,MaxUint256));
 snapshot=await p.send('evm_snapshot',[]);
});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{await engine.disconnect();});
async function deploy(name,args){const a=compiled[name];const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy(...args);await c.waitForDeployment();return c;}
async function tx(result){return(await result).wait();}
async function seed(){await tx(binary.inject(E('500'),true));await tx(token.buy(E('100'),0,MaxUint256));}
async function state(){return Promise.all([
 token.reserve(),token.unallocatedReserve(),token.totalSupply(),token.price(),token.referencePrice(),
 token.balanceOf(addresses[0]),token.balanceOf(addresses[1]),token.priceMultiplier(),token.milestonePrice(),
 token.cumulativeBuy(),token.cumulativeSell(),token.pressureWad(),token.lastPartialSellAt(),token.lifecycleClosed(),token.walletClock(),
 usd.balanceOf(token.target),usd.balanceOf(addresses[0]),usd.balanceOf(binary.target),binary.tokenBuySpent(addresses[0]),
]);}
async function backed(r,u,surplus=0n){
 assert.equal(await token.reserve(),r);assert.equal(await token.unallocatedReserve(),u);
 assert.deepEqual(Array.from(await token.accounting()),[r+u+surplus,r+u]);
}
async function unchanged(method,args,reason){
 const before=await state();
 if(reason)await assert.rejects(method.staticCall(...args),{reason});
 await assert.rejects(async()=>tx(method(...args,{gasLimit:3000000})));
 assert.deepEqual(await state(),before);
}
function events(receipt,name){return receipt.logs.filter(l=>l.address.toLowerCase()===token.target.toLowerCase()).map(l=>{try{return token.interface.parseLog(l);}catch{return null;}}).filter(l=>l?.name===name);}

test('quarantine: empty deployment has a fixed $0.10 anchor and a $1 first milestone',async()=>{
 await backed(0n,0n);assert.equal(await token.totalSupply(),0n);
 assert.equal(await token.price(),E('0.1'));assert.equal(await token.referencePrice(),E('0.1'));
 assert.equal(await token.launchPrice(),E('0.1'));assert.equal(await token.milestonePrice(),E('1'));
 assert.equal(await token.priceMultiplier(),1n);assert.equal(await token.lifecycleClosed(),false);
});

test('quarantine: membership-only cash stays protected, unowned and outside live reserve',async()=>{
 const beforeUser=await usd.balanceOf(addresses[0]);
 const receipt=await tx(binary.inject(E('500'),true));
 await backed(0n,E('500'));assert.equal(await token.totalSupply(),0n);
 assert.equal(await token.balanceOf(addresses[0]),0n);assert.equal(await token.price(),E('0.1'));
 assert.equal(await usd.balanceOf(addresses[0]),beforeUser);assert.equal(await token.walletClock(),1n);
 assert.equal(events(receipt,'Transfer').length,0);assert.equal(events(receipt,'ReserveQuarantined')[0].args.totalUnallocated,E('500'));
 await tx(token.syncPriceMilestone());await tx(token.advancePriceMilestone());
 assert.equal(await token.priceMultiplier(),1n);assert.equal(await token.milestonePrice(),E('1'));
 await unchanged(token.inject,[E('1'),true],'binary only');
});

test('quarantine: first $100 buyer mints 970 FTI and can redeem only $100, never the prior $500',async()=>{
 await tx(binary.inject(E('500'),true));assert.equal(await token.quoteBuy(E('100')),E('970'));
 await tx(token.buy(E('100'),E('970'),MaxUint256));
 await backed(E('100'),E('500'));assert.equal(await token.totalSupply(),E('970'));
 assert.equal(await token.launchPrice(),E('0.1'));assert((await token.price())>E('0.1'));
 assert.deepEqual(Array.from(await token.quoteSell(E('970'))),[E('100'),0n,E('100')]);
 const before=await usd.balanceOf(addresses[0]),lastPrice=await token.price();
 const receipt=await tx(token.sell(E('970'),E('100'),MaxUint256));
 assert.equal(await usd.balanceOf(addresses[0])-before,E('100'));
 await backed(0n,E('500'));assert.equal(await token.totalSupply(),0n);
 assert.equal(await token.price(),lastPrice);assert.equal(await token.referencePrice(),lastPrice);
 assert.equal(await token.lifecycleClosed(),true);assert.equal(events(receipt,'LifecycleClosed')[0].args.residualReserve,0n);
 assert.equal(events(receipt,'Sold')[0].args.baseFeeBps,0n);assert.equal(events(receipt,'Sold')[0].args.impactBps,0n);
 assert.equal(await token.lifetimeManualBuys(addresses[0]),E('100'));
});

test('quarantine: positive-supply injection adds redeemable support without minting or allocating prior cash',async()=>{
 await seed();const supply=await token.totalSupply();
 const receipt=await tx(binary.inject(E('25'),false));
 await backed(E('125'),E('500'));assert.equal(await token.totalSupply(),supply);
 assert.equal(events(receipt,'Transfer').length,0);assert.equal(events(receipt,'ReserveQuarantined').length,0);
 assert.deepEqual(Array.from(await token.quoteSell(supply)),[E('125'),0n,E('125')]);
 await tx(token.sell(supply,E('125'),MaxUint256));await backed(0n,E('500'));
});

test('quarantine: an authorized first automatic buy also cannot capture protected cash or consume manual quota',async()=>{
 await tx(binary.inject(E('500'),false));
 await tx(binary.autoBuy(addresses[0],E('100'),E('970')));
 await backed(E('100'),E('500'));assert.equal(await token.balanceOf(addresses[0]),E('970'));
 assert.equal(await binary.tokenBuySpent(addresses[0]),0n);
 await tx(token.sell(E('970'),E('100'),MaxUint256));await backed(0n,E('500'));
});

test('quarantine: post-closure injections remain protected, preserve the historical quote and cannot restart minting',async()=>{
 await seed();await tx(token.sell(await token.totalSupply(),0,MaxUint256));
 const historical=await token.price(),spent=await token.lifetimeManualBuys(addresses[0]);
 await tx(binary.inject(E('17'),true));await backed(0n,E('517'));
 assert.equal(await token.totalSupply(),0n);assert.equal(await token.price(),historical);
 assert.equal(await token.referencePrice(),historical);assert.equal(await token.lifecycleClosed(),true);
 await tx(token.syncPriceMilestone());assert.equal(await token.priceMultiplier(),1n);
 await assert.rejects(token.quoteBuy(E('1')),{reason:'restart policy pending'});
 await unchanged(token.buy,[E('1'),0,MaxUint256],'restart policy pending');
 await unchanged(binary.autoBuy,[addresses[0],E('1'),0],'restart policy pending');
 assert.equal(await token.lifetimeManualBuys(addresses[0]),spent);
});

test('quarantine: raw USD donations remain unaccounted surplus through first buy, injection and final redemption',async()=>{
 await tx(usd.mint(token.target,E('7')));await backed(0n,0n,E('7'));
 await tx(binary.inject(E('500'),false));await backed(0n,E('500'),E('7'));
 assert.equal(await token.price(),E('0.1'));
 await tx(token.buy(E('100'),E('970'),MaxUint256));await backed(E('100'),E('500'),E('7'));
 const price=await token.price();await tx(usd.mint(token.target,E('11')));
 assert.equal(await token.price(),price);await tx(token.syncPriceMilestone());assert.equal(await token.priceMultiplier(),1n);
 await tx(token.sell(E('970'),E('100'),MaxUint256));await backed(0n,E('500'),E('18'));
});

test('quarantine: emergency partial and full exits remain separately fee-free and leave protected cash intact',async()=>{
 await seed();await tx(token.sell(E('100'),0,MaxUint256));
 const pressure=await token.pressureWad(),timestamp=await token.lastPartialSellAt();
 await tx(token.activateEmergencyExit());
 const q=(await token.totalSupply())/2n,r=await token.reserve(),s=await token.totalSupply(),gross=q*r/s;
 assert.deepEqual(Array.from(await token.quoteSell(q)),[gross,0n,gross]);
 await tx(token.sell(q,gross,MaxUint256));await tx(token.sell(await token.totalSupply(),await token.reserve(),MaxUint256));
 await backed(0n,E('500'));assert.equal(await token.totalSupply(),0n);
 assert.equal(await token.pressureWad(),pressure);assert.equal(await token.lastPartialSellAt(),timestamp);
 await tx(token.deactivateEmergencyExit());await unchanged(token.buy,[E('1'),0,MaxUint256],'restart policy pending');
});

test('quarantine: trade-size-only partial-sale fees and 3% transfer burn do not touch protected cash',async()=>{
 await seed();const supply=await token.totalSupply(),q=supply/2n;
 assert.equal(await token.sellImpactBps(q),0n);
 const gross=E('50'),bps=300n,payout=gross-(gross*bps+9999n)/10000n;
 assert.deepEqual(Array.from(await token.quoteSell(q)),[payout,bps,gross]);
 await tx(token.sell(q,payout,MaxUint256));assert.equal(await token.pressureWad(),0n);
 const remainingR=await token.reserve(),remainingS=await token.totalSupply();
 await tx(token.transfer(addresses[1],E('100')));
 assert.equal(await token.balanceOf(addresses[1]),E('97'));assert.equal(await token.totalSupply(),remainingS-E('3'));
 await backed(remainingR,E('500'));assert.equal(await token.pressureWad(),0n);
 assert.equal(await token.FEE_BPS(),300n);assert.equal(await token.MAX_SELL_FEE_BPS(),1000n);
});

test('quarantine: failed buy/sell minOut and deadline checks roll back reserve, quarantine, quota and lifecycle',async()=>{
 await tx(binary.inject(E('500'),false));
 await unchanged(token.buy,[E('100'),E('970')+1n,MaxUint256],'slippage/dust');
 await unchanged(token.buy,[E('100'),0,0],'buy input');
 await tx(token.buy(E('100'),0,MaxUint256));
 await unchanged(token.sell,[E('970'),E('100')+1n,MaxUint256],'slippage/dust');
 await unchanged(token.sell,[E('1'),MaxUint256,MaxUint256],'slippage/dust');
 await unchanged(token.sell,[E('1'),0,0],'sell input');
 await backed(E('100'),E('500'));
});

test('quarantine: collateral sender/recipient taxes revert zero-supply injection and never fabricate protected accounting',async()=>{
 for(const mode of [1,2]){
  await tx(usd.setFeeMode(mode));await unchanged(binary.inject,[E('500'),true],'unsupported USD');
 }
 await backed(0n,0n);assert.equal(await token.totalSupply(),0n);
});

test('quarantine: taxed live injection, buys, partial sales and full redemption atomically preserve both buckets',async()=>{
 await seed();
 for(const mode of [1,2]){
  await tx(usd.setFeeMode(mode));
  await unchanged(binary.inject,[E('25'),true],'unsupported USD');
  await unchanged(token.buy,[E('10'),0,MaxUint256],'unsupported USD');
  await unchanged(token.sell,[E('100'),0,MaxUint256],'unsupported USD');
  await unchanged(token.sell,[E('970'),E('100'),MaxUint256],'unsupported USD');
 }
 await backed(E('100'),E('500'));
});

test('quarantine: backing checks protect unallocated cash even if actual USD still covers all live reserve',async()=>{
 await seed();await tx(usd.burn(token.target,E('1')));
 assert.equal(await usd.balanceOf(token.target),E('599'));assert((await usd.balanceOf(token.target))>await token.reserve());
 await unchanged(binary.inject,[E('25'),false],'reserve deficit');
 await unchanged(token.buy,[E('10'),0,MaxUint256],'reserve deficit');
 await unchanged(token.sell,[E('1'),0,MaxUint256],'reserve deficit');
 await unchanged(token.sell,[E('970'),0,MaxUint256],'reserve deficit');
 await unchanged(token.transfer,[addresses[1],E('1')],'reserve deficit');
});

test('quarantine: governance cannot rescue or allocate protected USD before or after lifecycle closure',async()=>{
 await seed();await unchanged(token.rescue,[usd.target,addresses[0],E('500')],'protected');
 await unchanged(token.rescue,[token.target,addresses[0],E('1')],'protected');
 await tx(token.sell(E('970'),0,MaxUint256));await unchanged(token.rescue,[usd.target,addresses[0],E('500')],'protected');
 assert(!token.interface.fragments.some(f=>f.type==='function'&&!['view','pure'].includes(f.stateMutability)&&/withdraw|allocate|treasury/i.test(f.name)));
 await backed(0n,E('500'));
});

test('quarantine: nested reentrant injection is rejected and outer injection accounts for its payment exactly once',async()=>{
 await tx(usd.setCallback(binary.target,binary.interface.encodeFunctionData('inject',[E('1'),true]),false));
 await tx(binary.inject(E('500'),true));
 assert.equal(await usd.attempted(),true);assert.equal(await usd.succeeded(),false);
 await backed(0n,E('500'));assert.equal(await token.walletClock(),1n);
});

test('quarantine: propagated callback failure rolls back zero-supply injection and manual-buy authorization',async()=>{
 await tx(usd.setCallback(binary.target,binary.interface.encodeFunctionData('inject',[E('1'),true]),true));
 await unchanged(binary.inject,[E('500'),true],'callback rejected');
 assert.equal(await usd.attempted(),false,'the collateral callback state is rolled back too');
 await tx(usd.setCallback(binary.target,binary.interface.encodeFunctionData('inject',[E('1'),true]),false));
 await tx(binary.inject(E('500'),false));
 await tx(usd.setCallback(binary.target,binary.interface.encodeFunctionData('inject',[E('1'),true]),true));
 await unchanged(token.buy,[E('100'),0,MaxUint256],'callback rejected');
 await backed(0n,E('500'));assert.equal(await binary.tokenBuySpent(addresses[0]),0n);
});

test('quarantine: callback transferFrom cannot burn FTI or consume its allowance during a priced buy',async()=>{
 await seed();await tx(token.approve(usd.target,E('1')));
 await tx(usd.setCallback(token.target,token.interface.encodeFunctionData('transferFrom',[addresses[0],addresses[1],E('1')]),false));
 const minted=await token.quoteBuy(E('10')),oldS=await token.totalSupply();
 await tx(token.buy(E('10'),minted,MaxUint256));
 assert.equal(await usd.succeeded(),false);assert.equal(await token.allowance(addresses[0],usd.target),E('1'));
 assert.equal(await token.balanceOf(addresses[1]),0n);assert.equal(await token.totalSupply(),oldS+minted);
 await backed(E('110'),E('500'));
});

test('quarantine: fixed $1 and $10 milestones are independent of the first post-fee quote and prior binary cash',async()=>{
 await seed();assert.equal(await token.totalSupply(),E('970'));
 assert.equal(await token.launchPrice(),E('0.1'));assert.notEqual(await token.price(),await token.launchPrice());
 await tx(binary.inject(E('870')-1n,false));assert((await token.price())<E('1'));
 await tx(token.syncPriceMilestone());assert.equal(await token.priceMultiplier(),1n);
 await tx(binary.inject(1n,false));assert.equal(await token.price(),E('1'));
 assert.equal(await token.priceMultiplier(),2n);assert.equal(await token.milestonePrice(),E('10'));
 await tx(binary.inject(E('8730'),false));assert.equal(await token.price(),E('10'));
 assert.equal(await token.priceMultiplier(),4n);assert.equal(await token.milestonePrice(),E('100'));
 assert.equal(await token.launchPrice(),E('0.1'));await backed(E('9700'),E('500'));
 await tx(token.sell(await token.totalSupply(),E('9700'),MaxUint256));
 await tx(binary.inject(E('10000'),false));await tx(token.syncPriceMilestone());
 assert.equal(await token.price(),E('10'));assert.equal(await token.priceMultiplier(),4n);assert.equal(await token.milestonePrice(),E('100'));
 await backed(0n,E('10500'));
});

test('quarantine: zero-supply historical references cannot trigger milestones, even in a TEST ONLY boundary fixture',async()=>{
 const boundary=await deploy('TEST_ONLY_QuarantineBoundaryToken',[usd.target,addresses[0]]);
 await tx(boundary.TEST_ONLY_setHistoricalReference(E('10000000000')));
 await tx(usd.mint(boundary.target,E('10000000000')));
 await tx(boundary.syncPriceMilestone());await tx(boundary.advancePriceMilestone());
 assert.equal(await boundary.totalSupply(),0n);assert.equal(await boundary.priceMultiplier(),1n);
 assert.equal(await boundary.milestonePrice(),E('1'));assert.equal(await boundary.reserve(),0n);
 assert.deepEqual(Array.from(await boundary.accounting()),[E('10000000000'),0n]);
});

test('quarantine: live milestone multiplier latches and remains capped at 1024',async()=>{
 const boundary=await deploy('TEST_ONLY_QuarantineBoundaryToken',[usd.target,addresses[0]]);
 await tx(usd.mint(boundary.target,E('10000000000')));
 await tx(boundary.TEST_ONLY_seed(addresses[0],E('10000000000'),E('1')));
 await tx(boundary.syncPriceMilestone());assert.equal(await boundary.priceMultiplier(),1024n);
 assert.equal(await boundary.milestonePrice(),E('10000000000'));
 await tx(boundary.advancePriceMilestone());assert.equal(await boundary.priceMultiplier(),1024n);
 await tx(boundary.sell(E('1'),E('10000000000'),MaxUint256));
 await tx(boundary.syncPriceMilestone());assert.equal(await boundary.priceMultiplier(),1024n);
});

test('quarantine: redeemable and unallocated cash share the reserve cap; raw donations are not silently counted',async()=>{
 const cap=await token.MAX_RESERVE();await tx(usd.mint(binary.target,cap));
 await tx(binary.inject(cap-E('100'),false));
 await tx(token.buy(E('100'),E('970'),MaxUint256));await backed(E('100'),cap-E('100'));
 await unchanged(binary.inject,[1n,false],'reserve range');
 await unchanged(token.buy,[E('1'),0,MaxUint256],'range');
 await tx(token.sell(E('970'),E('100'),MaxUint256));
 await tx(binary.inject(E('100'),false));await backed(0n,cap);
 await unchanged(binary.inject,[1n,true],'reserve range');
});
