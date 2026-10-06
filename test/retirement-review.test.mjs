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
  import:name=>{const f=path.join('node_modules',name);return fs.existsSync(f)?{contents:fs.readFileSync(f,'utf8')}:{error:`Missing ${name}`};}
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
 s.token=await deploy(s,'FTIRetirementReviewToken',[s.usd.target,s.timelock.target,s.council.target,addresses[40]]);
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
async function closeBuys(s){await authorize(s,'closeBuysPermanently');return governance(s,s.token.target,s.token.interface.encodeFunctionData('closeBuysPermanently'));}
async function retire(s){await ready(s);await closeBuys(s);const op=await queueRetirement(s);return tx(execute(s,op));}
async function seed(s,amount=E('100'),support=E('500')){
 if(support)await tx(s.binary.inject(support,true));await tx(s.token.buy(amount,0,MaxUint256));
}
async function terminal(s){return tx(s.token.sell(await s.token.totalSupply(),0,MaxUint256));}
async function state(s){return Promise.all([
 s.token.reserve(),s.token.priceProtectionFund(),s.token.developmentFeeClaim(),s.token.totalSupply(),
 s.token.price(),s.token.referencePrice(),s.token.balanceOf(s.addresses[0]),s.token.cumulativeBuy(),s.token.cumulativeSell(),
 s.token.lifecycleClosed(),s.token.buysPermanentlyClosed(),s.token.permanentlyRetired(),s.token.paused(),s.token.emergencyExit(),s.token.walletClock(),
 s.token.lifecycleNonce(),s.token.referenceReserve(),s.token.referenceSupply(),s.token.councilApprovalAt(selector(s,'closeBuysPermanently')),
 s.usd.balanceOf(s.token.target),s.usd.balanceOf(s.binary.target),s.usd.balanceOf(s.addresses[0]),s.usd.balanceOf(s.addresses[40]),
 s.binary.tokenBuySpent(s.addresses[0]),s.token.councilApprovalAt(selector(s,'retirePermanently')),s.token.councilApprovalAt(selector(s,'recoverRetiredDonations')),
]);}
async function unchanged(s,method,args=[],reason){
 const before=await state(s);
 if(reason)await assert.rejects(method.staticCall(...args),{reason});
 await assert.rejects(async()=>tx(method(...args,{gasLimit:4000000})));
 assert.deepEqual(await state(s),before);
}
async function failedOperation(s,op){
 const before=await state(s);await assert.rejects(async()=>tx(execute(s,op,{gasLimit:4000000})));
 assert.deepEqual(await state(s),before);assert.equal(await s.timelock.isOperationDone(op.operation),false);
}
async function accounting(s,r,p,c,surplus=0n){
 assert.equal(await s.token.reserve(),r);assert.equal(await s.token.priceProtectionFund(),p);assert.equal(await s.token.developmentFeeClaim(),c);
 assert.deepEqual(Array.from(await s.token.accounting()),[r+p+c+surplus,r+p+c]);
}
function fee(value,reserve){
 const threshold20=reserve>E('500')*20n?reserve:E('500')*20n;
 const excess20=value*20n>threshold20?value*20n-threshold20:0n;
 const numerator=300n*400n*value*value+700n*excess20*excess20;
 const denominator=10000n*400n*value;return(numerator+denominator-1n)/denominator;
}
function events(s,receipt,name){return receipt.logs.filter(l=>l.address.toLowerCase()===s.token.target.toLowerCase()).map(l=>{try{return s.token.interface.parseLog(l);}catch{return null;}}).filter(e=>e?.name===name);}

// Artifact and source hashes make the precise review state reproducible. Run the
// production compiler immediately before this suite after source edits finish.
before(()=>{
 const files=['contracts/FTIRetirementReviewToken.sol','contracts/BinaryPlan.sol','contracts/Governance.sol','artifacts/FTIRetirementReviewToken.json','artifacts/BinaryPlan.json','test/retirement-review.test.mjs'];
 console.log('RETIREMENT_REVIEW_HASHES',JSON.stringify(Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))));
});

describe('Permanent-retirement review: isolated EVM lifecycle and failure guards',()=>{
 let s,snapshot;
 before(async()=>{s=await setup();snapshot=await s.p.send('evm_snapshot',[]);});
 beforeEach(async()=>{await s.p.send('evm_revert',[snapshot]);snapshot=await s.p.send('evm_snapshot',[]);});
 after(async()=>{await s?.engine.disconnect();});

 test('fixture binds the exact token, collateral, council, timelock and immutable development fund',async()=>{
  for(const [getter,wanted]of [['token',s.token.target],['usd',s.usd.target],['governance',s.timelock.target],['guardian',s.council.target],['development',s.addresses[40]]])assert.equal(await s.binary[getter](),wanted);
  assert.equal(await s.token.developmentFund(),s.addresses[40]);assert.equal(await s.timelock.getMinDelay(),BigInt(DELAY));
  assert.equal(await s.council.OWNER_COUNT(),7n);assert.equal(await s.council.THRESHOLD(),5n);
  assert.equal(await s.timelock.hasRole(await s.timelock.PROPOSER_ROLE(),s.council.target),true);
  for(const name of ['closeBuysPermanently','retirePermanently','recoverRetiredDonations','claimDevelopmentFees'])assert.equal(s.token.interface.getFunction(name).inputs.length,0,'fixed destination only');
  await assert.rejects(s.token.bind.staticCall(s.binary.target));
 });

 test('constructor rejects an EOA governor/guardian and zero or collateral-token development destination',async()=>{
  for(const args of [
   [s.usd.target,s.addresses[0],s.council.target,s.addresses[40]],
   [s.usd.target,s.timelock.target,s.addresses[0],s.addresses[40]],
   [s.usd.target,s.timelock.target,s.council.target,ZeroAddress],
   [s.usd.target,s.timelock.target,s.council.target,s.usd.target],
  ])await assert.rejects(()=>deploy(s,'FTIRetirementReviewToken',args));
  const unrelated=await deploy(s,'Council',[s.addresses.slice(0,7)]);
  await assert.rejects(()=>deploy(s,'FTIRetirementReviewToken',[s.usd.target,s.timelock.target,unrelated.target,s.addresses[40]]));
 });

 test('fixed recipient rejects the token itself and the future bound binary, while a separate contract fund is allowed',async()=>{
  let nonce=await s.p.getTransactionCount(s.addresses[0]);const ownAddress=getCreateAddress({from:s.addresses[0],nonce});
  await assert.rejects(()=>deploy(s,'FTIRetirementReviewToken',[s.usd.target,s.timelock.target,s.council.target,ownAddress]));
  nonce=await s.p.getTransactionCount(s.addresses[0]);const predictedBinary=getCreateAddress({from:s.addresses[0],nonce:nonce+1});
  const token=await deploy(s,'FTIRetirementReviewToken',[s.usd.target,s.timelock.target,s.council.target,predictedBinary]);
  const binary=await deploy(s,'TEST_ONLY_RetirementMembership',[token.target,s.usd.target,s.timelock.target,s.council.target,predictedBinary,s.addresses[0]]);
  assert.equal(binary.target,predictedBinary);await assert.rejects(async()=>tx(token.bind(binary.target,{gasLimit:1000000})));assert.equal(await token.binary(),ZeroAddress);
  const separateFund=await deploy(s,'TEST_ONLY_RetirementUSD');
  const accepted=await deploy(s,'FTIRetirementReviewToken',[s.usd.target,s.timelock.target,s.council.target,separateFund.target]);assert.equal(await accepted.developmentFund(),separateFund.target);
 });

 test('bind rejects each mismatched dependency individually and never replaces a valid binding',async()=>{
  for(let mismatch=0;mismatch<5;mismatch++){
   const token=await deploy(s,'FTIRetirementReviewToken',[s.usd.target,s.timelock.target,s.council.target,s.addresses[40]]);
   const args=[token.target,s.usd.target,s.timelock.target,s.council.target,s.addresses[40],s.addresses[0]];
   // An alternate real collateral contract is used for its approval interface.
   args[mismatch]=mismatch===1?(await deploy(s,'TEST_ONLY_RetirementUSD')).target:s.addresses[39];
   const bad=await deploy(s,'TEST_ONLY_RetirementMembership',args);
   await assert.rejects(async()=>tx(token.bind(bad.target,{gasLimit:1000000})));
   assert.equal(await token.binary(),ZeroAddress);
  }
  await assert.rejects(async()=>tx(s.token.connect(s.signers[1]).bind(s.binary.target,{gasLimit:1000000})));
 });

 for(const amount of [E('100'),E('500'),E('500')+1n,E('1000'),E('12345.678901234567890123')]){
  test(`normal terminal q=S quotes and reserves the exact current-trade fee at V=${amount} atoms`,async()=>{
   await seed(s,amount);const supply=await s.token.totalSupply(),r=await s.token.reserve(),f=fee(r,r);
   assert.deepEqual(Array.from(await s.token.sellFeeQuote(supply)),[f,r-f,r]);
   const seller=await s.usd.balanceOf(s.addresses[0]),dev=await s.usd.balanceOf(s.addresses[40]),historical=await s.token.price();
   const receipt=await terminal(s);
   assert.equal(await s.usd.balanceOf(s.addresses[0])-seller,r-f);assert.equal(await s.usd.balanceOf(s.addresses[40]),dev);
   assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.token.lifecycleClosed(),true);assert.equal(await s.token.price(),historical);
   await accounting(s,0n,E('500'),f);assert.equal(events(s,receipt,'TerminalDevelopmentFeeCredited')[0].args.amount,f);
   assert.equal(events(s,receipt,'LifecycleClosed')[0].args.residualReserve,0n);
   // Seller payout plus the reserved fee exactly exhausts pretrade live R.
   assert.equal((await s.usd.balanceOf(s.addresses[0])-seller)+await s.token.developmentFeeClaim(),r);
  });
 }

 test('permissionless fee claim pays only the immutable fund and preserves protected support',async()=>{
  await seed(s);await terminal(s);const support=await s.token.priceProtectionFund(),claim=await s.token.developmentFeeClaim();
  const caller=await s.usd.balanceOf(s.addresses[41]),dev=await s.usd.balanceOf(s.addresses[40]);
  const receipt=await tx(s.token.connect(s.signers[41]).claimDevelopmentFees());
  await accounting(s,0n,support,0n);assert.equal(await s.usd.balanceOf(s.addresses[40])-dev,claim);assert.equal(await s.usd.balanceOf(s.addresses[41]),caller);
  assert.equal(events(s,receipt,'DevelopmentFeeClaimPaid')[0].args.destination,s.addresses[40]);
  await unchanged(s,s.token.claimDevelopmentFees,[],'no development claim');
 });

 test('emergency partial and terminal redemption stay fee-free and separate from normal terminal claims',async()=>{
  await seed(s,E('1000'));await councilCall(s,s.token.target,s.token.interface.encodeFunctionData('activateEmergencyExit'));
  const half=(await s.token.totalSupply())/2n;let r=await s.token.reserve(),supply=await s.token.totalSupply(),gross=half*r/supply;
  assert.deepEqual(Array.from(await s.token.sellFeeQuote(half)),[0n,gross,gross]);await tx(s.token.sell(half,gross,MaxUint256));
  r=await s.token.reserve();supply=await s.token.totalSupply();assert.deepEqual(Array.from(await s.token.sellFeeQuote(supply)),[0n,r,r]);
  const receipt=await terminal(s);await accounting(s,0n,E('500'),0n);assert.equal(events(s,receipt,'TerminalDevelopmentFeeCredited').length,0);
  assert.equal(await s.token.lifecycleClosed(),true);assert.equal(await s.token.emergencyExit(),true);
 });

 test('ordinary zero-supply lifecycles restart manually and automatically without consuming protected support or owed fees',async()=>{
  await seed(s);await terminal(s);await tx(s.binary.inject(E('17'),false));
  await accounting(s,0n,E('517'),E('3'));
  for(const automatic of [false,true]){
   const oldNonce=await s.token.lifecycleNonce(),claim=await s.token.developmentFeeClaim();
   const referenceR=await s.token.referenceReserve(),referenceS=await s.token.referenceSupply();
   const spent=await s.binary.tokenBuySpent(s.addresses[0]),quote=await s.token.quoteBuy(E('1'));
   assert.equal(quote,(E('1')-E('0.03'))*referenceS/referenceR);
   if(automatic)await tx(s.binary.autoBuy(s.addresses[0],E('1'),quote));else await tx(s.token.buy(E('1'),quote,MaxUint256));
   assert.equal(await s.token.lifecycleClosed(),false);assert.equal(await s.token.buysPermanentlyClosed(),false);
   assert.equal(await s.token.lifecycleNonce(),oldNonce+1n);assert.equal(await s.token.totalSupply(),quote);
   assert((await s.token.reserve())*referenceS>referenceR*quote,'exact restart ratio strictly grows');
   assert.equal(await s.binary.tokenBuySpent(s.addresses[0]),spent+(automatic?0n:E('1')));
   await accounting(s,E('1'),E('517'),claim);await terminal(s);
   await accounting(s,0n,E('517'),claim+E('0.03'));
  }
 });

 test('four council votes cannot authorize retirement; fifth vote can and unauthorized callers cannot',async()=>{
  const selected=selector(s,'retirePermanently');
  await unchanged(s,s.token.approveRetirementAction,[selected,await s.token.lifecycleNonce()]);await unchanged(s,s.token.retirePermanently);await unchanged(s,s.token.recoverRetiredDonations);
  const proposal=await councilProposal(s,s.token.target,s.token.interface.encodeFunctionData('approveRetirementAction',[selected,await s.token.lifecycleNonce()]),4);
  await assert.rejects(async()=>tx(s.council.execute(proposal,{gasLimit:1000000})));
  assert.equal(await s.token.councilApprovalAt(selected),0n);assert.equal((await s.council.proposal(proposal))[3],false);
  await tx(s.council.connect(s.signers[35]).approve(proposal));await tx(s.council.execute(proposal));
  assert((await s.token.councilApprovalAt(selected))>0n);
  const direct=await councilProposal(s,s.token.target,s.token.interface.encodeFunctionData('retirePermanently'));
  await assert.rejects(async()=>tx(s.council.execute(direct,{gasLimit:1000000})));
  assert.equal(await s.token.permanentlyRetired(),false);
 });

 test('each retirement action requires its own council approval and at least 72 hours after that approval',async()=>{
  await ready(s);await tx(s.binary.inject(E('500'),false));await closeBuys(s);
  const op=await schedule(s,s.token.target,s.token.interface.encodeFunctionData('retirePermanently'));
  await advance(s,DELAY);await failedOperation(s,op);
  const premature=await councilProposal(s,s.token.target,s.token.interface.encodeFunctionData('approveRetirementAction',[selector(s,'recoverRetiredDonations'),await s.token.lifecycleNonce()]));
  await assert.rejects(async()=>tx(s.council.execute(premature,{gasLimit:1000000})));await failedOperation(s,op);
  await authorize(s);await failedOperation(s,op);await advance(s,DELAY-1);await failedOperation(s,op);
  await advance(s,1);const before=await s.usd.balanceOf(s.addresses[40]);await tx(execute(s,op));
  assert.equal(await s.token.permanentlyRetired(),true);assert.equal(await s.token.councilApprovalAt(selector(s,'retirePermanently')),0n);
  assert.equal(await s.usd.balanceOf(s.addresses[40])-before,E('500'));await accounting(s,0n,0n,0n);
 });

 test('Council revocation clears a mature approval and a replacement approval must mature again',async()=>{
  await ready(s);await closeBuys(s);const op=await queueRetirement(s),action=selector(s,'retirePermanently');
  await unchanged(s,s.token.revokeRetirementAction,[action]);
  await councilCall(s,s.token.target,s.token.interface.encodeFunctionData('revokeRetirementAction',[action]));
  assert.equal(await s.token.councilApprovalAt(action),0n);await failedOperation(s,op);
  await authorize(s);await failedOperation(s,op);await advance(s,DELAY-1);await failedOperation(s,op);await advance(s,1);await tx(execute(s,op));
  assert.equal(await s.token.permanentlyRetired(),true);
 });

 test('Council approval cannot authorize arbitrary selectors or silently preserve an older approval time',async()=>{
  const invalid=await councilProposal(s,s.token.target,s.token.interface.encodeFunctionData('approveRetirementAction',[selector(s,'unpause'),await s.token.lifecycleNonce()]));
  await assert.rejects(async()=>tx(s.council.execute(invalid,{gasLimit:1000000})));
  await ready(s);await closeBuys(s);await authorize(s);const first=await s.token.councilApprovalAt(selector(s,'retirePermanently'));
  const op=await schedule(s,s.token.target,s.token.interface.encodeFunctionData('retirePermanently'));await advance(s,DELAY);
  await authorize(s);assert((await s.token.councilApprovalAt(selector(s,'retirePermanently')))>first);await failedOperation(s,op);
  await advance(s,DELAY);await tx(execute(s,op));
 });

 test('the timelock itself rejects execution before its 72-hour operation delay',async()=>{
  await ready(s);await closeBuys(s);await authorize(s);const op=await schedule(s,s.token.target,s.token.interface.encodeFunctionData('retirePermanently'));
  await failedOperation(s,op);await advance(s,DELAY-1);await failedOperation(s,op);await advance(s,1);await tx(execute(s,op));
  assert.equal(await s.timelock.isOperationDone(op.operation),true);
 });

 test('active backing blocks permanent buy closure and owed terminal fees independently prohibit retirement',async()=>{
  await seed(s);await ready(s);await authorize(s,'closeBuysPermanently');
  const closure=await schedule(s,s.token.target,s.token.interface.encodeFunctionData('closeBuysPermanently'));
  const op=await queueRetirement(s);await failedOperation(s,closure);await failedOperation(s,op);
  assert.equal(await s.token.buysPermanentlyClosed(),false);
  await terminal(s);assert.equal(await s.token.developmentFeeClaim(),E('3'));await failedOperation(s,op);
  await tx(execute(s,closure));assert.equal(await s.token.buysPermanentlyClosed(),true);await failedOperation(s,op);
  await tx(s.token.claimDevelopmentFees());const before=await s.usd.balanceOf(s.addresses[40]);await tx(execute(s,op));
  assert.equal(await s.usd.balanceOf(s.addresses[40])-before,E('500'));await accounting(s,0n,0n,0n);
 });

 for(const [name,values]of [
  ['pending auto liability',[1,true,0,0,0,0,0]],
  ['unpaused binary',[0,false,0,0,0,0,0]],
  ['matching phase',[0,true,1,0,0,0,0]],
  ['allocation phase',[0,true,2,0,0,0,0]],
  ['builder-month matching',[0,true,0,1,0,0,0]],
  ['builder-month allocation',[0,true,0,2,0,0,0]],
  ['unsettled current-hour units',[0,true,0,0,1,0,0]],
  ['undrained volume jobs',[0,true,0,0,0,0,1]],
 ])test(`retirement guard separately rejects ${name} in clearly marked TEST_ONLY membership`,async()=>{
  await tx(s.binary.inject(E('500'),false));await ready(s);await closeBuys(s);const op=await queueRetirement(s);await tx(s.binary.TEST_ONLY_readiness(...values));
  await failedOperation(s,op);await ready(s);await tx(execute(s,op));assert.equal(await s.token.permanentlyRetired(),true);
 });

 test('missing binary binding blocks permanent closure and retirement even with real approval and delay',async()=>{
  const old=s.token;s.token=await deploy(s,'FTIRetirementReviewToken',[s.usd.target,s.timelock.target,s.council.target,s.addresses[40]]);
  try{await authorize(s,'closeBuysPermanently');const closure=await schedule(s,s.token.target,s.token.interface.encodeFunctionData('closeBuysPermanently'));const op=await queueRetirement(s);await failedOperation(s,closure);await failedOperation(s,op);}finally{s.token=old;}
 });

 test('blocked seller or taxed collateral atomically rolls back the complete normal terminal transition',async()=>{
  await seed(s);await tx(s.usd.setBlocked(s.addresses[0],true));await unchanged(s,s.token.sell,[await s.token.totalSupply(),0,MaxUint256]);
  await tx(s.usd.setBlocked(s.addresses[0],false));
  for(const mode of [1,2]){await tx(s.usd.setFeeMode(mode));await unchanged(s,s.token.sell,[await s.token.totalSupply(),0,MaxUint256],'unsupported USD');}
  await tx(s.usd.setFeeMode(0));await terminal(s);await accounting(s,0n,E('500'),E('3'));
 });

 test('blocked or taxed development-fee transfer restores the owed claim and all cash accounting',async()=>{
  await seed(s);await terminal(s);await tx(s.usd.setBlocked(s.addresses[40],true));await unchanged(s,s.token.claimDevelopmentFees);
  await tx(s.usd.setBlocked(s.addresses[40],false));
  for(const mode of [1,2]){await tx(s.usd.setFeeMode(mode));await unchanged(s,s.token.claimDevelopmentFees,[],'unsupported USD');}
  await tx(s.usd.setFeeMode(0));await tx(s.token.claimDevelopmentFees());await accounting(s,0n,E('500'),0n);
 });

 test('blocked or taxed retirement transfer preserves support, closure flags, approval and the pending timelock operation',async()=>{
  await tx(s.binary.inject(E('500'),false));await ready(s);await closeBuys(s);const op=await queueRetirement(s);
  await tx(s.usd.setBlocked(s.addresses[40],true));await failedOperation(s,op);await tx(s.usd.setBlocked(s.addresses[40],false));
  // Recipient tax fails the exact-delta check; sender tax may instead fail
  // its own balance check. Either failure must roll the whole action back.
  for(const mode of [1,2]){await tx(s.usd.setFeeMode(mode));await failedOperation(s,op);}
  await tx(s.usd.setFeeMode(0));await tx(execute(s,op));assert.equal(await s.token.permanentlyRetired(),true);await accounting(s,0n,0n,0n);
 });

 test('terminal seller payout rejects a nested fee claim while preserving the newly credited development claim',async()=>{
  await seed(s);const seller=await s.usd.balanceOf(s.addresses[0]),dev=await s.usd.balanceOf(s.addresses[40]);
  await tx(s.usd.setCallback(s.token.target,s.token.interface.encodeFunctionData('claimDevelopmentFees'),false));
  await terminal(s);assert.equal(await s.usd.attempted(),true);assert.equal(await s.usd.succeeded(),false);
  assert.equal((await s.usd.callbackResult()).slice(0,10),id('ReentrancyGuardReentrantCall()').slice(0,10));
  assert.equal(await s.usd.balanceOf(s.addresses[0])-seller,E('97'));assert.equal(await s.usd.balanceOf(s.addresses[40]),dev);
  await accounting(s,0n,E('500'),E('3'));assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.token.lifecycleClosed(),true);
 });

 test('development-fee payout rejects nested entry and pays the fixed fund exactly once',async()=>{
  await seed(s);await terminal(s);const dev=await s.usd.balanceOf(s.addresses[40]);
  await tx(s.usd.setCallback(s.token.target,s.token.interface.encodeFunctionData('claimDevelopmentFees'),false));
  await tx(s.token.claimDevelopmentFees());assert.equal(await s.usd.attempted(),true);assert.equal(await s.usd.succeeded(),false);
  assert.equal((await s.usd.callbackResult()).slice(0,10),id('ReentrancyGuardReentrantCall()').slice(0,10));
  assert.equal(await s.usd.balanceOf(s.addresses[40])-dev,E('3'));await accounting(s,0n,E('500'),0n);
 });

 test('permanent-retirement payout rejects nested entry without duplicating or losing protected cash',async()=>{
  await tx(s.binary.inject(E('500'),false));const dev=await s.usd.balanceOf(s.addresses[40]);
  await tx(s.usd.setCallback(s.token.target,s.token.interface.encodeFunctionData('retirePermanently'),false));
  await retire(s);assert.equal(await s.usd.attempted(),true);assert.equal(await s.usd.succeeded(),false);
  assert.equal((await s.usd.callbackResult()).slice(0,10),id('ReentrancyGuardReentrantCall()').slice(0,10));
  assert.equal(await s.usd.balanceOf(s.addresses[40])-dev,E('500'));await accounting(s,0n,0n,0n);
  assert.equal(await s.token.permanentlyRetired(),true);assert.equal(await s.token.councilApprovalAt(selector(s,'retirePermanently')),0n);
 });

 test('delayed-donation payout rejects nested recovery and leaves retirement permanent',async()=>{
  await retire(s);await tx(s.usd.mint(s.token.target,E('18')));await authorize(s,'recoverRetiredDonations');
  const op=await schedule(s,s.token.target,s.token.interface.encodeFunctionData('recoverRetiredDonations'));await advance(s,DELAY);
  const dev=await s.usd.balanceOf(s.addresses[40]);await tx(s.usd.setCallback(s.token.target,s.token.interface.encodeFunctionData('recoverRetiredDonations'),false));
  await tx(execute(s,op));assert.equal(await s.usd.attempted(),true);assert.equal(await s.usd.succeeded(),false);
  assert.equal((await s.usd.callbackResult()).slice(0,10),id('ReentrancyGuardReentrantCall()').slice(0,10));
  assert.equal(await s.usd.balanceOf(s.addresses[40])-dev,E('18'));await accounting(s,0n,0n,0n);
  assert.equal(await s.token.permanentlyRetired(),true);assert.equal(await s.token.councilApprovalAt(selector(s,'recoverRetiredDonations')),0n);
 });

 test('propagated callback failures atomically restore terminal sale, fee claim, retirement and donation recovery',async()=>{
  const payload=s.token.interface.encodeFunctionData('claimDevelopmentFees');await seed(s);
  await tx(s.usd.setCallback(s.token.target,payload,true));await unchanged(s,s.token.sell,[await s.token.totalSupply(),0,MaxUint256],'TEST_ONLY callback rejected');
  assert.equal(await s.usd.attempted(),false);assert.equal(await s.usd.callbackResult(),'0x');
  await tx(s.usd.setCallback(ZeroAddress,'0x',false));await terminal(s);
  await tx(s.usd.setCallback(s.token.target,payload,true));await unchanged(s,s.token.claimDevelopmentFees,[],'TEST_ONLY callback rejected');
  assert.equal(await s.usd.attempted(),false);assert.equal(await s.usd.callbackResult(),'0x');
  await tx(s.usd.setCallback(ZeroAddress,'0x',false));await tx(s.token.claimDevelopmentFees());await ready(s);await closeBuys(s);const retirement=await queueRetirement(s);
  await tx(s.usd.setCallback(s.token.target,payload,true));await failedOperation(s,retirement);assert.equal(await s.usd.attempted(),false);
  await tx(s.usd.setCallback(ZeroAddress,'0x',false));await tx(execute(s,retirement));
  await tx(s.usd.mint(s.token.target,E('18')));await authorize(s,'recoverRetiredDonations');
  const recovery=await schedule(s,s.token.target,s.token.interface.encodeFunctionData('recoverRetiredDonations'));await advance(s,DELAY);
  await tx(s.usd.setCallback(s.token.target,payload,true));await failedOperation(s,recovery);assert.equal(await s.usd.attempted(),false);
  await tx(s.usd.setCallback(ZeroAddress,'0x',false));await tx(execute(s,recovery));await accounting(s,0n,0n,0n);
 });

 test('retirement routes only tracked support; raw donations require a fresh distinct council vote and delay',async()=>{
  await seed(s);await tx(s.usd.mint(s.token.target,E('7')));await terminal(s);
  await accounting(s,0n,E('500'),E('3'),E('7'));await tx(s.token.claimDevelopmentFees());
  const dev=await s.usd.balanceOf(s.addresses[40]),receipt=await retire(s);
  assert.equal(await s.usd.balanceOf(s.addresses[40])-dev,E('500'));
  await accounting(s,0n,0n,0n,E('7'));
  const retired=events(s,receipt,'PermanentlyRetired')[0];assert.equal(retired.args.protectedSupport,E('500'));assert.equal(retired.args.untrackedSurplusRemaining,E('7'));
  await tx(s.usd.mint(s.token.target,E('11')));await accounting(s,0n,0n,0n,E('18'));
  const op=await schedule(s,s.token.target,s.token.interface.encodeFunctionData('recoverRetiredDonations'));await advance(s,DELAY);await failedOperation(s,op);
  await authorize(s,'recoverRetiredDonations');await failedOperation(s,op);await advance(s,DELAY-1);await failedOperation(s,op);await advance(s,1);
  const before=await s.usd.balanceOf(s.addresses[40]),recovered=await tx(execute(s,op));
  assert.equal(await s.usd.balanceOf(s.addresses[40])-before,E('18'));assert.equal(events(s,recovered,'RetiredDonationRecovered')[0].args.amount,E('18'));
  assert.equal(await s.token.councilApprovalAt(selector(s,'recoverRetiredDonations')),0n);await accounting(s,0n,0n,0n);
  assert.equal(await s.token.permanentlyRetired(),true);assert.equal(await s.token.lifecycleClosed(),true);assert.equal(await s.token.paused(),true);
  // A new timelock operation cannot replay the already-consumed Council vote.
  await tx(s.usd.mint(s.token.target,E('1')));const again=await schedule(s,s.token.target,s.token.interface.encodeFunctionData('recoverRetiredDonations'));
  await advance(s,DELAY);await failedOperation(s,again);await authorize(s,'recoverRetiredDonations');await advance(s,DELAY);await tx(execute(s,again));
  await accounting(s,0n,0n,0n);
 });

 test('blocked or taxed delayed-donation recovery preserves approval, retirement flags and exact surplus',async()=>{
  await retire(s);await tx(s.usd.mint(s.token.target,E('18')));await authorize(s,'recoverRetiredDonations');
  const op=await schedule(s,s.token.target,s.token.interface.encodeFunctionData('recoverRetiredDonations'));await advance(s,DELAY);
  await tx(s.usd.setBlocked(s.addresses[40],true));await failedOperation(s,op);await tx(s.usd.setBlocked(s.addresses[40],false));
  for(const mode of [1,2]){await tx(s.usd.setFeeMode(mode));await failedOperation(s,op);}
  await tx(s.usd.setFeeMode(0));await tx(execute(s,op));await accounting(s,0n,0n,0n);
 });

 test('a later expanded timelock proposer role cannot bypass the independent Council approval',async()=>{
  await ready(s);await closeBuys(s);const role=await s.timelock.PROPOSER_ROLE();
  await governance(s,s.timelock.target,s.timelock.interface.encodeFunctionData('grantRole',[role,s.addresses[8]]));
  assert.equal(await s.timelock.hasRole(role,s.addresses[8]),true);
  const target=s.token.target,data=s.token.interface.encodeFunctionData('retirePermanently'),salt=id('untrusted-new-proposer');
  await tx(s.timelock.connect(s.signers[8]).schedule(target,0,data,ZeroHash,salt,DELAY));
  const op={target,data,salt,operation:await s.timelock.hashOperation(target,0,data,ZeroHash,salt)};
  await advance(s,DELAY);await failedOperation(s,op);assert.equal(await s.token.councilApprovalAt(selector(s,'retirePermanently')),0n);
  await authorize(s);await advance(s,DELAY);await tx(execute(s,op));assert.equal(await s.token.permanentlyRetired(),true);
 });

 test('partial-sale fee remains live backing and terminal routing conserves all tracked and donated cash',async()=>{
  await seed(s,E('1000'));await tx(s.usd.mint(s.token.target,E('7')));
  const q=(await s.token.totalSupply())/2n,initialR=await s.token.reserve(),f=fee(E('500'),initialR),seller=await s.usd.balanceOf(s.addresses[0]);
  await tx(s.token.sell(q,0,MaxUint256));assert.equal(await s.token.developmentFeeClaim(),0n);await accounting(s,initialR-E('500')+f,E('500'),0n,E('7'));
  await tx(s.binary.inject(E('25'),false));const finalR=await s.token.reserve(),terminalFee=fee(finalR,finalR);await terminal(s);
  assert.equal(await s.token.developmentFeeClaim(),terminalFee);assert.equal(await s.usd.balanceOf(s.addresses[0])-seller+terminalFee,initialR+E('25'));
  await accounting(s,0n,E('500'),terminalFee,E('7'));await tx(s.token.claimDevelopmentFees());await retire(s);await accounting(s,0n,0n,0n,E('7'));
 });

 test('retirement never permits rescue of collateral or governance to reopen any token funding path',async()=>{
  await tx(s.binary.inject(E('500'),false));await retire(s);
  await unchanged(s,s.token.buy,[E('1'),0,MaxUint256]);await unchanged(s,s.binary.autoBuy,[s.addresses[0],E('1'),0]);
  await unchanged(s,s.binary.inject,[E('1'),true],'permanently retired');
  for(const name of ['unpause','deactivateEmergencyExit','activateEmergencyExit']){
   const op=await schedule(s,s.token.target,s.token.interface.encodeFunctionData(name));await advance(s,DELAY);await failedOperation(s,op);
  }
  const rescue=await schedule(s,s.token.target,s.token.interface.encodeFunctionData('rescue',[s.usd.target,s.addresses[0],1]));await advance(s,DELAY);await failedOperation(s,rescue);
  assert.equal(await s.token.paused(),true);assert.equal(await s.token.lifecycleClosed(),true);assert.equal(await s.token.totalSupply(),0n);
 });

 test('a collateral deficit cannot be hidden by fee-claim payment or permanent retirement',async()=>{
  await seed(s);await terminal(s);await tx(s.usd.burn(s.token.target,1));await unchanged(s,s.token.claimDevelopmentFees,[],'reserve deficit');
  await tx(s.usd.mint(s.token.target,1));await tx(s.token.claimDevelopmentFees());await ready(s);await closeBuys(s);const op=await queueRetirement(s);
  await tx(s.usd.burn(s.token.target,1));await failedOperation(s,op);await tx(s.usd.mint(s.token.target,1));await tx(execute(s,op));
 });

 test('ordinary precision dust is explicitly rejected rather than promising that every terminal dust state can close',async()=>{
  await seed(s);await unchanged(s,s.token.sell,[1,0,MaxUint256],'dust');
  // The same production guard is intentionally retained for terminal redemption.
  // This source-level assertion records the unresolved terminal-dust policy; it
  // does not claim an organically reachable 1-atom live reserve was generated.
  const source=fs.readFileSync('contracts/FTIRetirementReviewToken.sol','utf8');
  assert(source.includes("require(gross>feeAmount,'dust')"));
  console.log('UNRESOLVED_TERMINAL_DUST','Gross <= rounded fee remains rejected; no approved fee waiver, dust write-off, or alternate terminal payout has been inferred.');
 });
});

async function settle(s){
 while(await s.binary.jobCursor()<await s.binary.jobCount())await tx(s.binary.processVolume(100,{gasLimit:12000000}));
 const latest=await s.p.getBlock('latest');await advance(s,Math.max(0,Number(await s.binary.epochEnd())-latest.timestamp+1));
 await tx(s.binary.beginEpochClose());while(await s.binary.phase()>0n)await tx(s.binary.processEpoch(100,{gasLimit:12000000}));
 const [actual,accounted]=await s.binary.accounting();assert.equal(actual,accounted);
}
async function binaryState(s){return Promise.all([
 s.binary.unitsOf(s.addresses[0]),s.binary.unitsOf(s.addresses[41]),s.binary.registered(s.addresses[41]),s.binary.memberCount(),
 s.binary.epochUnits(),s.binary.unitsSinceSettlement(),s.binary.pointPool(),s.binary.builderAccounted(),s.binary.totalPending(),s.binary.totalAuto(),
 s.binary.jobCursor(),s.binary.jobCount(),s.binary.pendingReward(s.addresses[40]),s.binary.monthFunding(await s.binary.nextBuilderMonth(),0),
 s.binary.monthFunding(await s.binary.nextBuilderMonth(),1),s.binary.monthFunding(await s.binary.nextBuilderMonth(),2),s.binary.monthFunding(await s.binary.nextBuilderMonth(),3),
 s.usd.balanceOf(s.addresses[41]),s.binary.members(s.addresses[15]).then(member=>Array.from(member)),
]);}

describe('Permanent-retirement review: real BinaryPlan integration, no seeded ranks or liabilities',()=>{
 let s;
 before(async()=>{s=await setup(true);});after(async()=>{await s?.engine.disconnect();});
 test('organic pending-auto ownership, cash release, retirement and post-retirement funding rollback',async()=>{
  await tx(s.binary.addUnits(1));await tx(s.binary.setAutoBuy(true));
  // Twenty actual hourly allocations attain Builder 1. No production state
  // setter, impersonation, evm_setStorageAt, or synthetic pendingAuto is used.
  for(let epoch=0;epoch<20;epoch++){
   await tx(s.binary.connect(s.signers[1]).addUnits(10));await tx(s.binary.connect(s.signers[2]).addUnits(10));await settle(s);
  }
  assert.equal(await s.binary.rankOf(s.addresses[0]),1n);assert.equal(await s.binary.cumulativePaidRankPoints(s.addresses[0]),100n);
  assert.equal(await s.binary.totalAuto(),0n);
  await tx(s.token.buy(E('100'),0,MaxUint256));
  await tx(s.binary.connect(s.signers[1]).addUnits(12));await tx(s.binary.connect(s.signers[2]).addUnits(12));
  // Immediate allocation attempts the buy; rejected collateral leaves an owned retry liability.
  await tx(s.usd.setBlocked(s.token.target,true));await settle(s);await tx(s.usd.setBlocked(s.token.target,false));
  const automatic=await s.binary.pendingAuto(s.addresses[0]);assert.equal(automatic,E('108'));assert.equal(await s.binary.totalAuto(),automatic);
  await terminal(s);await tx(s.token.claimDevelopmentFees());
  await councilCall(s,s.binary.target,s.binary.interface.encodeFunctionData('pause'));
  await assert.rejects(s.binary.releaseClosedTokenAutoToCash.staticCall(0,100),{reason:'token buys not closed'});
  assert((await s.token.quoteBuy(E('1')))>0n,'ordinary empty cycle is restartable');
  await closeBuys(s);assert.equal(await s.token.buysPermanentlyClosed(),true);
  const op=await queueRetirement(s);await failedOperation(s,op);
  const ownerBefore=await s.binary.pendingReward(s.addresses[0]),totalBefore=await s.binary.totalPending(),binaryCash=await s.usd.balanceOf(s.binary.target);
  // The owner-only API cannot release another wallet's balance; the permanent
  // marker enables a bounded permissionless conversion to that same beneficiary.
  await tx(s.binary.connect(s.signers[41]).releaseAutoToCash());assert.equal(await s.binary.pendingAuto(s.addresses[0]),automatic);
  const pendingState=await state(s);await assert.rejects(async()=>tx(s.binary.executeAuto(s.addresses[0],automatic,{gasLimit:4000000})));
  assert.deepEqual(await state(s),pendingState);assert.equal(await s.binary.pendingAuto(s.addresses[0]),automatic);
  await tx(s.binary.connect(s.signers[41]).releaseClosedTokenAutoToCash(0,1));assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);assert.equal(await s.binary.totalAuto(),0n);
  await tx(s.binary.connect(s.signers[41]).releaseClosedTokenAutoToCash(0,1));assert.equal(await s.binary.pendingAutoAccountCount(),0n);
  assert.equal(await s.binary.pendingReward(s.addresses[0]),ownerBefore+automatic);assert.equal(await s.binary.totalPending(),totalBefore+automatic);
  assert.equal(await s.usd.balanceOf(s.binary.target),binaryCash);
  const ownerCash=await s.usd.balanceOf(s.addresses[0]);await tx(s.binary.claim());
  assert.equal(await s.usd.balanceOf(s.addresses[0])-ownerCash,ownerBefore+automatic);
  const protectedBinary=await binaryState(s),fund=await s.usd.balanceOf(s.addresses[40]),support=await s.token.priceProtectionFund();
  await tx(execute(s,op));assert.equal(await s.token.permanentlyRetired(),true);assert.equal(await s.usd.balanceOf(s.addresses[40])-fund,support);
  assert.deepEqual(await binaryState(s),protectedBinary,'retirement does not consume BinaryPlan pending/builder/pool cash');
  assert.deepEqual(Array.from(await s.binary.accounting()),[await s.usd.balanceOf(s.binary.target),await s.usd.balanceOf(s.binary.target)]);
  const devClaim=await s.binary.pendingReward(s.addresses[40]),fundBeforeClaim=await s.usd.balanceOf(s.addresses[40]),builderBeforeClaim=await s.binary.builderAccounted();
  assert(devClaim>0n);await tx(s.binary.connect(s.signers[40]).claim());
  assert.equal(await s.usd.balanceOf(s.addresses[40])-fundBeforeClaim,devClaim);assert.equal(await s.binary.builderAccounted(),builderBeforeClaim);
  assert.equal(await s.binary.pendingReward(s.addresses[40]),0n,'existing BinaryPlan cash claims remain callable after token retirement');
  // BinaryPlan may be unpaused by existing governance, but cannot fund the
  // permanently retired token. Every prior membership/cash write must revert.
  await governance(s,s.binary.target,s.binary.interface.encodeFunctionData('unpause'));await settle(s);
  for(const [method,args]of [[s.binary.addUnits,[1]],[s.binary.connect(s.signers[41]).register,[s.addresses[15],1]]]){
   const t=await state(s),b=await binaryState(s);await assert.rejects(async()=>tx(method(...args,{gasLimit:5000000})));
   assert.deepEqual(await state(s),t);assert.deepEqual(await binaryState(s),b);
  }
  assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.lifecycleClosed(),true);
  console.log('REAL_BINARY_RETIREMENT_PATH',JSON.stringify({fundedEpochs:21,organicRank:1,pendingAutoUSD:'108',release:'permanent-marker-gated permissionless same-beneficiary conversion',cashClaimsPreserved:true,fundingRollback:true}));
 });
});
