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
 function TEST_ONLY_member(address who) external {unitsOf[who]=1000;}
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

async function advance(s,seconds){await s.p.send('evm_increaseTime',[seconds]);await s.p.send('evm_mine',[]);}
async function councilProposal(s,target,data,votes=5){
 const proposal=await s.council.count();await tx(s.council.connect(s.signers[31]).propose(target,data));
 for(let i=1;i<votes;i++)await tx(s.council.connect(s.signers[31+i]).approve(proposal));
 return proposal;
}
async function councilCall(s,target,data){const proposal=await councilProposal(s,target,data);await tx(s.council.connect(s.signers[8]).execute(proposal));return proposal;}
async function schedule(s,target,data){
 const salt=id(`retirement-review-${++s.salt}`);
 await councilCall(s,s.timelock.target,s.timelock.interface.encodeFunctionData('schedule',[target,0,data,ZeroHash,salt,DELAY]));
 return {target,data,salt,operation:await s.timelock.hashOperation(target,0,data,ZeroHash,salt)};
}
function execute(s,op,options={}){return s.timelock.connect(s.signers[8]).execute(op.target,0,op.data,ZeroHash,op.salt,options);}
async function governance(s,target,data){const op=await schedule(s,target,data);await advance(s,DELAY);await tx(execute(s,op));return op;}
function selector(s,name){return s.token.interface.getFunction(name).selector;}
async function authorize(s,name='retirePermanently'){
 await councilCall(s,s.token.target,s.token.interface.encodeFunctionData('approveRetirementAction',[selector(s,name),await s.token.lifecycleNonce()]));
}
async function ready(s){await tx(s.binary.TEST_ONLY_readiness(0,true,0,0,0,0,0));}
async function queueRetirement(s){await authorize(s);const op=await schedule(s,s.token.target,s.token.interface.encodeFunctionData('retirePermanently'));await advance(s,DELAY);return op;}
async function retire(s){await ready(s);const op=await queueRetirement(s);return tx(execute(s,op));}
let s,snapshot;
before(async()=>{s=await setup();snapshot=await s.p.send('evm_snapshot',[]);});
beforeEach(async()=>{await s.p.send('evm_revert',[snapshot]);snapshot=await s.p.send('evm_snapshot',[]);});
after(async()=>{await s.engine.disconnect();});
async function backed(){const actual=await s.usd.balanceOf(s.token.target);assert(actual>=(await s.token.reserve())+(await s.token.priceProtectionFund())+(await s.token.developmentFeeClaim()));}
async function sellAll(){await tx(s.token.sell(await s.token.balanceOf(s.addresses[0]),0,MaxUint256));}
async function bootstrap(){await tx(s.binary.inject(E('500'),true));await tx(s.token.buy(E('100'),0,MaxUint256));}
async function approveAction(name){await authorize(s,name);return schedule(s,s.token.target,s.token.interface.encodeFunctionData(name));}
async function close(){await ready(s);const op=await approveAction('closeBuysPermanently');await advance(s,DELAY);await tx(execute(s,op));}

test('different first buyer restarts at exact last ratio; prior support, claims and donation are never allocated',async()=>{
 await bootstrap();await tx(s.usd.mint(s.token.target,E('77')));const rr=await s.token.reserve(),rs=await s.token.totalSupply();await sellAll();
 assert.equal(await s.token.referenceReserve(),rr);assert.equal(await s.token.referenceSupply(),rs);
 const claim=await s.token.developmentFeeClaim();await tx(s.binary.inject(E('5'),true));await tx(s.binary.TEST_ONLY_member(s.addresses[1]));
 const a=E('100'),[fee,net]=await s.token.buyFeeQuote(a),q=await s.token.quoteBuy(a);assert.equal(q,net*rs/rr);
 await tx(s.token.connect(s.signers[1]).buy(a,q,MaxUint256));assert.equal(await s.token.lifecycleClosed(),false);
 assert.equal(await s.token.reserve(),a);assert.equal(await s.token.totalSupply(),q);assert.equal(await s.token.priceProtectionFund(),E('505'));assert.equal(await s.token.developmentFeeClaim(),claim);
 assert(a*rs>rr*q);const cash=await s.usd.balanceOf(s.addresses[1]);await tx(s.token.connect(s.signers[1]).sell(q,0,MaxUint256));
 assert.equal(await s.usd.balanceOf(s.addresses[1])-cash,E('97'));assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.priceProtectionFund(),E('505'));await backed();
});
test('fractional historical anchor below display precision is preserved across restart',async()=>{
 const rr=1900000000000000000n,rs=5n*10n**35n;await tx(s.usd.mint(s.token.target,rr));await tx(s.token.TEST_ONLY_seed(s.addresses[0],rr,rs));await sellAll();
 assert.equal(await s.token.referencePrice(),3n);assert.equal(await s.token.referenceReserve(),rr);assert.equal(await s.token.referenceSupply(),rs);
 const a=1000000n,[fee,net]=await s.token.buyFeeQuote(a),q=await s.token.quoteBuy(a);assert.equal(q,net*rs/rr);assert(q<net*WAD/3n);
 await tx(s.token.buy(a,q,MaxUint256));assert(a*rs>rr*q);assert.equal(await s.token.priceProtectionFund(),0n);await backed();
});
test('repeated micro restart round trips cannot extract old support or terminal claims',async()=>{
 await bootstrap();await sellAll();const h=await s.token.priceProtectionFund(),oldClaim=await s.token.developmentFeeClaim(),cash=await s.usd.balanceOf(s.addresses[0]);
 let contributed=0n,received=0n;
 for(let i=0;i<20;i++){
  const a=1000000000000n;await tx(s.token.buy(a,0,MaxUint256));contributed+=a;
  const q=await s.token.balanceOf(s.addresses[0]),[fee,out]=await s.token.sellFeeQuote(q);await sellAll();received+=out;
  assert(out<a);assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.priceProtectionFund(),h);await backed();
 }
 assert(received<contributed);assert.equal((await s.usd.balanceOf(s.addresses[0]))-cash,received-contributed);assert.equal(await s.token.developmentFeeClaim(),oldClaim+contributed-received);
});
test('automatic buy restarts through the same exact quote without consuming manual authorization',async()=>{
 await bootstrap();await sellAll();const spent=await s.binary.tokenBuySpent(s.addresses[0]),q=await s.token.quoteBuy(E('10'));
 await tx(s.binary.autoBuy(s.addresses[0],E('10'),q));assert.equal(await s.token.balanceOf(s.addresses[0]),q);assert.equal(await s.binary.tokenBuySpent(s.addresses[0]),spent);assert.equal(await s.token.lifecycleClosed(),false);await backed();
});
test('pending retirement cannot sweep a restarted balance; closure needs separate approval and rechecks state',async()=>{
 await bootstrap();await sellAll();await ready(s);
 const shutdown=await approveAction('closeBuysPermanently'),retireOp=await approveAction('retirePermanently');await advance(s,DELAY);
 await tx(s.token.buy(E('10'),0,MaxUint256));const r=await s.token.reserve(),h=await s.token.priceProtectionFund();
 await assert.rejects(execute(s,shutdown).then(x=>x.wait()));await assert.rejects(execute(s,retireOp).then(x=>x.wait()));
 assert.equal(await s.token.reserve(),r);assert.equal(await s.token.priceProtectionFund(),h);assert.equal(await s.token.buysPermanentlyClosed(),false);assert.equal(await s.token.permanentlyRetired(),false);await backed();
 assert.equal(await s.token.councilApprovalAt(selector(s,'closeBuysPermanently')),0n);assert.equal(await s.token.councilApprovalAt(selector(s,'retirePermanently')),0n);
 await sellAll();await tx(s.token.claimDevelopmentFees());
 await assert.rejects(execute(s,shutdown).then(x=>x.wait()));await assert.rejects(execute(s,retireOp).then(x=>x.wait()));
 assert.equal(await s.token.buysPermanentlyClosed(),false);assert.equal(await s.token.priceProtectionFund(),h);

});
test('5/7 plus 72h permanent closure permits pending claims but blocks manual/auto/funding and reopening',async()=>{
 await bootstrap();await sellAll();await tx(s.binary.TEST_ONLY_readiness(E('10'),true,0,0,0,0,0));
 await assert.rejects(s.token.closeBuysPermanently.staticCall(),{reason:'governance'});
 const op=await approveAction('closeBuysPermanently');await assert.rejects(execute(s,op).then(x=>x.wait()));await advance(s,DELAY);await tx(execute(s,op));
 assert.equal(await s.token.buysPermanentlyClosed(),true);assert.equal(await s.token.permanentlyRetired(),false);assert((await s.token.developmentFeeClaim())>0n);assert.equal(await s.binary.totalAuto(),E('10'));
 await assert.rejects(s.token.quoteBuy(E('1')),{reason:'buys permanently closed'});await assert.rejects(s.binary.autoBuy.staticCall(s.addresses[0],E('1'),0));await assert.rejects(s.binary.inject.staticCall(E('1'),true),{reason:'buys permanently closed'});
 const undo=await schedule(s,s.token.target,s.token.interface.encodeFunctionData('unpause'));await advance(s,DELAY);await assert.rejects(execute(s,undo).then(x=>x.wait()));assert.equal(await s.token.buysPermanentlyClosed(),true);await backed();
});
test('closure authorization uses five council votes, delay, revocation, and cannot be reused',async()=>{
 await bootstrap();await sellAll();await ready(s);
 const data=s.token.interface.encodeFunctionData('approveRetirementAction',[selector(s,'closeBuysPermanently'),await s.token.lifecycleNonce()]);const proposal=await councilProposal(s,s.token.target,data,4);await assert.rejects(s.council.execute(proposal).then(x=>x.wait()));
 await tx(s.council.connect(s.signers[35]).approve(proposal));await tx(s.council.execute(proposal));
 const op=await schedule(s,s.token.target,s.token.interface.encodeFunctionData('closeBuysPermanently'));await advance(s,DELAY);
 await councilCall(s,s.token.target,s.token.interface.encodeFunctionData('revokeRetirementAction',[selector(s,'closeBuysPermanently')]));await assert.rejects(execute(s,op).then(x=>x.wait()));assert.equal(await s.token.buysPermanentlyClosed(),false);
 await authorize(s,'closeBuysPermanently');await advance(s,DELAY);await tx(execute(s,op));assert.equal(await s.token.councilApprovalAt(selector(s,'closeBuysPermanently')),0n);await assert.rejects(s.token.approveRetirementAction.staticCall(selector(s,'closeBuysPermanently'),await s.token.lifecycleNonce()));
});
test('permanent closure breaks pending-auto circularity; retirement still waits for all claims and quiescence',async()=>{
 await bootstrap();await sellAll();await tx(s.binary.TEST_ONLY_readiness(E('10'),true,0,0,0,0,0));
 const op=await approveAction('closeBuysPermanently');await advance(s,DELAY);await tx(execute(s,op));
 const retireOp=await approveAction('retirePermanently');await advance(s,DELAY);await assert.rejects(execute(s,retireOp).then(x=>x.wait()));
 await tx(s.token.claimDevelopmentFees());await assert.rejects(execute(s,retireOp).then(x=>x.wait()));
 // Converter ownership/accounting is exercised in the separate Binary candidate.
 await ready(s);const dev=await s.usd.balanceOf(s.addresses[40]);await tx(execute(s,retireOp));
 assert.equal(await s.token.permanentlyRetired(),true);assert.equal(await s.token.priceProtectionFund(),0n);assert.equal(await s.usd.balanceOf(s.addresses[40])-dev,E('500'));await backed();
});

test('unexecuted Council proposal from an earlier lifecycle cannot create fresh authorization',async()=>{
 await bootstrap();await sellAll();await ready(s);const old=await s.token.lifecycleNonce();
 const data=s.token.interface.encodeFunctionData('approveRetirementAction',[selector(s,'closeBuysPermanently'),old]);
 const proposal=await councilProposal(s,s.token.target,data,5);
 await tx(s.token.buy(E('10'),0,MaxUint256));assert.equal(await s.token.lifecycleNonce(),old+1n);await sellAll();
 await assert.rejects(s.council.execute(proposal).then(x=>x.wait()));assert.equal(await s.token.councilApprovalAt(selector(s,'closeBuysPermanently')),0n);
 await tx(s.token.claimDevelopmentFees());await close();assert.equal(await s.token.buysPermanentlyClosed(),true);
});
