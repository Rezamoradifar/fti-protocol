import {describe,test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256,ZeroAddress,ZeroHash,id,getCreateAddress} from 'ethers';

// Local review only. Ganache accounts are fixture identities, not deployment
// parameters. Production sources are never patched or instrumented by this file.
// TEST_ONLY contracts below compile in memory and never enter artifacts/.
const fixture=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {FTIRetirementReviewToken} from './FTIRetirementReviewToken.sol';
contract TEST_ONLY_PrecisionToken is FTIRetirementReviewToken {
 constructor(address a,address b,address c,address d) FTIRetirementReviewToken(a,b,c,d) {}
 function TEST_ONLY_seed(address who,uint256 r,uint256 s) external {require(totalSupply()==0&&reserve==0);reserve=r;_mint(who,s);}
}
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
interface TEST_ONLY_IToken {
 function inject(uint256,bool) external;
 function autoBuy(address,uint256,uint256,uint256) external returns(uint256);
}
contract TEST_ONLY_RetirementMembership {
 address public immutable token; address public immutable usd;
 address public immutable governance; address public immutable guardian;
 address public immutable development;
 mapping(address=>uint256) public unitsOf;
 mapping(address=>uint256) public tokenBuySpent;
 uint256 public totalAuto; uint8 public phase; uint8 public monthPhase;
 uint256 public epochUnits; uint256 public jobCursor; uint256 public jobCount;
 bool public paused;
 constructor(address t,address s,address g,address c,address d,address member) {
  token=t;usd=s;governance=g;guardian=c;development=d;unitsOf[member]=1000;
  IERC20(s).approve(t,type(uint256).max);
 }
 function tokenBuyLimit(address who) public view returns(uint256){return unitsOf[who]*500e18;}
 function remainingTokenBuyAllowance(address who) external view returns(uint256){return tokenBuyLimit(who)-tokenBuySpent[who];}
 function authorizeTokenBuy(address who,uint256 amount) external {
  require(msg.sender==token,'token only');
  require(tokenBuySpent[who]+amount<=tokenBuyLimit(who),'quota');tokenBuySpent[who]+=amount;
 }
 function inject(uint256 amount,bool newWallet) external {TEST_ONLY_IToken(token).inject(amount,newWallet);}
 function autoBuy(address who,uint256 amount,uint256 minimum) external {TEST_ONLY_IToken(token).autoBuy(who,amount,minimum,type(uint256).max);}
 function TEST_ONLY_readiness(uint256 a,bool p,uint8 h,uint8 m,uint256 e,uint256 j,uint256 n) external {
  totalAuto=a;paused=p;phase=h;monthPhase=m;epochUnits=e;jobCursor=j;jobCount=n;
 }
}
contract TEST_ONLY_RetirementUSD is ERC20 {
 uint256 public feeMode; mapping(address=>bool) public blocked;
 address public callback;bytes public callbackPayload;bytes public callbackResult;
 bool public requireCallback;bool public attempted;bool public succeeded;bool private inCallback;
 constructor() ERC20('Retirement fixture collateral','TEST'){}
 function mint(address who,uint256 amount) external {_mint(who,amount);}
 function burn(address who,uint256 amount) external {_burn(who,amount);}
 function setFeeMode(uint256 mode) external {feeMode=mode;}
 function setBlocked(address who,bool flag) external {blocked[who]=flag;}
 function setCallback(address target,bytes calldata payload,bool mustSucceed) external {
  callback=target;callbackPayload=payload;requireCallback=mustSucceed;attempted=false;succeeded=false;delete callbackResult;
 }
 function transfer(address to,uint256 amount) public override returns(bool){
  bool sent=super.transfer(to,amount);
  if(callback!=address(0)&&!inCallback){
   inCallback=true;attempted=true;(succeeded,callbackResult)=callback.call(callbackPayload);inCallback=false;
   require(!requireCallback||succeeded,'TEST_ONLY callback rejected');
  }
  return sent;
 }
 function _update(address from,address to,uint256 amount) internal override {
  require(!blocked[to],'TEST_ONLY blocked recipient');super._update(from,to,amount);
  if(from!=address(0)&&to!=address(0)&&amount>=100){
   if(feeMode==1)super._update(to,address(0),amount/100);
   if(feeMode==2)super._update(from,address(0),amount/100);
  }
 }
}`;
const DAY=86400,DELAY=3*DAY,WAD=E('1');
let fixtureArtifacts;
function compileFixtures(){
 if(fixtureArtifacts)return fixtureArtifacts;
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'TEST_ONLY_Retirement.sol':{content:fixture}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{
  import:name=>{for(const base of ['contracts','node_modules']){const f=path.join(base,name);if(fs.existsSync(f))return {contents:fs.readFileSync(f,'utf8')};}return {error:`Missing ${name}`};}
 }));
 assert(!output.errors?.some(e=>e.severity==='error'),output.errors?.map(e=>e.formattedMessage).join('\n'));
 fixtureArtifacts=output.contracts['TEST_ONLY_Retirement.sol'];return fixtureArtifacts;
}
async function tx(result){return(await result).wait();}
async function deploy(s,name,args=[]){
 const a=name.startsWith('TEST_ONLY_')?compileFixtures()[name]:JSON.parse(fs.readFileSync(`artifacts/${name}.json`));
 const c=await new ContractFactory(a.abi,a.bytecode??'0x'+a.evm.bytecode.object,s.signers[0]).deploy(...args);
 await c.waitForDeployment();return c;
}
async function setup(realBinary=false){
 const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:45,deterministic:true},chain:{chainId:31337,time:new Date('2026-10-05T00:00:00Z')},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 const signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));
 const addresses=await Promise.all(signers.map(x=>x.getAddress()));const s={engine,p,signers,addresses,salt:0};
 s.usd=await deploy(s,'TEST_ONLY_RetirementUSD');
 s.council=await deploy(s,'Council',[addresses.slice(31,38)]);
 s.timelock=await deploy(s,'FTITimelock',[s.council.target]);
 s.token=await deploy(s,'TEST_ONLY_PrecisionToken',[s.usd.target,s.timelock.target,s.council.target,addresses[40]]);
 s.binary=await deploy(s,realBinary?'BinaryPlan':'TEST_ONLY_RetirementMembership',realBinary?
  [s.usd.target,s.token.target,s.timelock.target,s.council.target,addresses[40],addresses.slice(0,31)]:
  [s.token.target,s.usd.target,s.timelock.target,s.council.target,addresses[40],addresses[0]]);
 await tx(s.token.bind(s.binary.target));
 for(const i of [0,1,2,41]){
  await tx(s.usd.mint(addresses[i],E('10000000')));
  await tx(s.usd.connect(signers[i]).approve(s.token.target,MaxUint256));
  await tx(s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256));
 }
 if(!realBinary)await tx(s.usd.mint(s.binary.target,E('10000000')));
 return s;
}
let s,snapshot;
before(async()=>{s=await setup();snapshot=await s.p.send('evm_snapshot',[]);});
beforeEach(async()=>{await s.p.send('evm_revert',[snapshot]);snapshot=await s.p.send('evm_snapshot',[]);});
after(async()=>{await s.engine.disconnect();});
async function seedExact(r,shares){await tx(s.usd.mint(s.token.target,r));await tx(s.token.TEST_ONLY_seed(s.addresses[0],r,shares));}
async function backed(){const actual=await s.usd.balanceOf(s.token.target);assert.equal(actual,(await s.token.reserve())+(await s.token.priceProtectionFund())+(await s.token.developmentFeeClaim()));}
async function grows(action){const r=await s.token.reserve(),n=await s.token.totalSupply(),p=await s.token.price();await action();assert((await s.token.reserve())*n>r*(await s.token.totalSupply()));assert((await s.token.price())>p);await backed();}
test('old overmint is removed; positive exact growth below one display atom executes with zero support',async()=>{
 const r=1900000000000000000n,n=5n*10n**35n,a=1000000n;await seedExact(r,n);
 const [f,net]=await s.token.buyFeeQuote(a),p=await s.token.price();
 const oldMint=net*WAD/p,newMint=await s.token.quoteBuy(a);
 assert.equal(newMint,net*n/r);assert(oldMint>newMint);assert((r+a)*n<r*(n+oldMint));assert((r+a)*n>r*(n+newMint));
 await tx(s.token.buy(a,newMint,MaxUint256));
 assert.equal(await s.token.price(),p,'getter can remain unchanged while the real ratio strictly grows');
 assert.equal(await s.token.reserve(),r+a);assert.equal(await s.token.totalSupply(),n+newMint);
 assert.equal(await s.binary.tokenBuySpent(s.addresses[0]),a);assert.equal(await s.token.priceProtectionFund(),0n);await backed();
});
test('one dollar at large reserve grows exact ratio below getter precision without support',async()=>{
 const r=10n**30n-WAD,n=5n*10n**35n,a=WAD;await seedExact(r,n);
 const p=await s.token.price(),minted=await s.token.quoteBuy(a);await tx(s.token.buy(a,minted,MaxUint256));
 assert.equal(await s.token.price(),p);assert((await s.token.reserve())*n>r*(await s.token.totalSupply()));
 assert.equal(await s.token.priceProtectionFund(),0n);await backed();
});
test('zero exact growth still rejects and rolls back the actual transaction',async()=>{
 // Deliberately unreachable normal-economic state tests the strict guard itself.
 await seedExact(0n,E('10000'));
 const before=[await s.token.totalSupply(),await s.token.balanceOf(s.addresses[0]),await s.token.balanceOf(s.addresses[1])];
 await assert.rejects(s.token.transfer.staticCall(s.addresses[1],E('100')),{reason:'price must increase'});
 await assert.rejects(async()=>tx(s.token.transfer(s.addresses[1],E('100'),{gasLimit:3000000})));
 assert.deepEqual([await s.token.totalSupply(),await s.token.balanceOf(s.addresses[0]),await s.token.balanceOf(s.addresses[1])],before);await backed();
});
test('normal and large actual buys use exact mint, fee and manual quota',async()=>{
 await seedExact(E('10000')+17n,E('100000')+31n);
 for(const a of [E('100'),E('500'),E('1000')]){
  const r=await s.token.reserve(),n=await s.token.totalSupply(),[f,net]=await s.token.buyFeeQuote(a),q=await s.token.quoteBuy(a),spent=await s.binary.tokenBuySpent(s.addresses[0]);
  assert.equal(q,net*n/r);if(a<=E('500'))assert.equal(f,a*3n/100n);else assert(f>a*3n/100n);
  await grows(()=>tx(s.token.buy(a,q,MaxUint256)));assert.equal(await s.binary.tokenBuySpent(s.addresses[0]),spent+a);
 }
});
test('auto buy uses identical quote and does not consume manual quota',async()=>{
 await seedExact(E('10000')+1n,E('100000')+7n);const a=E('500'),q=await s.token.quoteBuy(a),bal=await s.token.balanceOf(s.addresses[0]);
 await grows(()=>tx(s.binary.autoBuy(s.addresses[0],a,q)));assert.equal(await s.token.balanceOf(s.addresses[0]),bal+q);assert.equal(await s.binary.tokenBuySpent(s.addresses[0]),0n);
});
test('split purchases each use fresh exact ratio, preserve strict growth and total quota',async()=>{
 await seedExact(E('10000')+13n,E('100000')+19n);
 for(let i=0;i<20;i++){const a=E('25'),[f,net]=await s.token.buyFeeQuote(a);assert.equal(f,E('0.75'));assert.equal(await s.token.quoteBuy(a),net*(await s.token.totalSupply())/(await s.token.reserve()));await grows(()=>tx(s.token.buy(a,0,MaxUint256)));}
 assert.equal(await s.binary.tokenBuySpent(s.addresses[0]),E('500'));assert.equal(await s.token.priceProtectionFund(),0n);
});
test('partial sell and transfer maintain cash backing and exact/display growth',async()=>{
 await seedExact(E('10000')+11n,E('100000')+23n);
 await grows(()=>tx(s.token.sell(E('1000'),0,MaxUint256)));
 await grows(()=>tx(s.token.transfer(s.addresses[1],E('1000'))));
});
test('bootstrap and support routing remain unchanged, final redemption still closes',async()=>{
 await tx(s.binary.inject(E('500'),true));assert.equal(await s.token.quoteBuy(E('100')),E('970'));
 await tx(s.token.buy(E('100'),0,MaxUint256));assert.equal(await s.token.priceProtectionFund(),E('500'));
 await tx(s.binary.inject(E('5'),true));assert.equal(await s.token.reserve(),E('105'));
 await tx(s.token.sell(await s.token.totalSupply(),0,MaxUint256));assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.token.lifecycleClosed(),true);assert((await s.token.developmentFeeClaim())>0n);await backed();
});
test('tiny transfer and positive-payout sell both grow real ratio below display resolution',async()=>{
 await seedExact(1900000000000000000n,5n*10n**35n);
 for(const action of [()=>tx(s.token.transfer(s.addresses[1],2n)),()=>tx(s.token.sell(WAD,0,MaxUint256))]){
  const r=await s.token.reserve(),n=await s.token.totalSupply(),p=await s.token.price();await action();
  assert((await s.token.reserve())*n>r*(await s.token.totalSupply()));assert.equal(await s.token.price(),p);assert.equal(await s.token.priceProtectionFund(),0n);await backed();
 }
 await assert.rejects(s.token.sell.staticCall(1n,0,MaxUint256),{reason:'dust'});
 await assert.rejects(s.token.transfer.staticCall(s.addresses[1],1n),{reason:'transfer dust'});
});
