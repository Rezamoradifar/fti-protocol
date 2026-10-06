import {describe,test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256,id,ZeroHash} from 'ethers';
import {deployOne,settle,drainVolume,checkAccounting} from '../scripts/lib.mjs';
import {keeperStep} from '../scripts/keeper.mjs';
const tx=async p=>(await p).wait();
async function councilCall(target,data){const id=await s.council.count();await tx(s.council.connect(s.signers[31]).propose(target,data));for(let i=32;i<36;i++)await tx(s.council.connect(s.signers[i]).approve(id));await tx(s.council.connect(s.signers[8]).execute(id));}

let s,snapshot,trained;
let serial=0;
async function governedTokenAction(name){
 const data=s.token.interface.encodeFunctionData(name),selector=s.token.interface.getFunction(name).selector,salt=id('auto-shutdown-'+(++serial));
 await councilCall(s.token.target,s.token.interface.encodeFunctionData('approveRetirementAction',[selector,await s.token.lifecycleNonce()]));
 await councilCall(s.timelock.target,s.timelock.interface.encodeFunctionData('schedule',[s.token.target,0,data,ZeroHash,salt,259200]));
 await s.p.send('evm_increaseTime',[259200]);await s.p.send('evm_mine',[]);
 await tx(s.timelock.connect(s.signers[44]).execute(s.token.target,0,data,ZeroHash,salt));
}
async function units(i,n){await tx(s.binary.connect(s.signers[i]).addUnits(n));}
async function funding(){await units(3,10);await units(4,10);await units(2,20);}
async function begin(){await drainVolume(s);const b=await s.p.getBlock('latest');await s.p.send('evm_increaseTime',[Math.max(0,Number(await s.binary.epochEnd())-b.timestamp+1)]);await s.p.send('evm_mine',[]);await tx(s.binary.beginEpochClose());while(await s.binary.phase()===1n)await tx(s.binary.processEpoch(100,{gasLimit:12000000}));}
async function finish(batch=100){while(await s.binary.phase()>0n)await tx(s.binary.processEpoch(batch,{gasLimit:12000000}));await checkAccounting(s);}
async function activate(){await tx(s.binary.setAutoBuy(true));await settle(s,s.p);assert.equal(await s.binary.effectiveAutoEnabled(s.addresses[0]),true);}
async function setup(){
 const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:45,deterministic:true},chain:{chainId:31337,time:new Date('2026-10-06T00:00:00Z')},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 const signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i))),addresses=await Promise.all(signers.map(x=>x.getAddress()));
 const source=fs.readFileSync('test/fixtures/HostileUSD.sol','utf8').replace('contract HostileUSD is ERC20 {',`contract HostileUSD is ERC20 {
 address public denied;bool public exhaust;
 function deny(address target,bool gasExhaust) external {denied=target;exhaust=gasExhaust;}
 `).replace('if(callback!=address(0)){attempted=true;',`if(to==denied){if(exhaust){assembly {invalid()}}revert('test blocked');}
 if(callback!=address(0)){attempted=true;`);
 const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'HostileUSD.sol':{content:source}},settings:{evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:n=>({contents:fs.readFileSync('node_modules/'+n,'utf8')})}));
 assert(!out.errors?.some(e=>e.severity==='error'),JSON.stringify(out.errors));const a=out.contracts['HostileUSD.sol'].HostileUSD;
 const usd=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy();await usd.waitForDeployment();
 const council=await deployOne('Council',[addresses.slice(31,38)],signers[0]);const timelock=await deployOne('FTITimelock',[council.target],signers[0]);
 const token=await deployOne('FTIRetirementReviewToken',[usd.target,timelock.target,council.target,addresses[35]],signers[0]);
 const binary=await deployOne('BinaryPlan',[usd.target,token.target,timelock.target,council.target,addresses[35],addresses.slice(0,31)],signers[0]);await tx(token.bind(binary.target));
 s={engine,p,signers,addresses,usd,council,timelock,token,binary};
 for(const i of [0,1,2,3,4]){await tx(usd.mint(addresses[i],E('1000000')));await tx(usd.connect(signers[i]).approve(binary.target,MaxUint256));await tx(usd.connect(signers[i]).approve(token.target,MaxUint256));}
 await units(0,1);await units(1,1);
}
describe('Immediate auto candidate: real unseeded BinaryPlan and current precision token',()=>{
 before(async()=>{await setup();snapshot=await s.p.send('evm_snapshot',[]);});
 after(async()=>{await s?.engine.disconnect();});
 test('organic 20 epochs: default off, next-hour enable, rank threshold still old-rank snapshot',async()=>{
  assert.equal(await s.binary.effectiveAutoEnabled(s.addresses[0]),false);await tx(s.binary.setAutoBuy(true));
  for(let i=0;i<20;i++){await funding();await settle(s,s.p);assert.equal(await s.token.balanceOf(s.addresses[0]),0n);assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);}
  for(const i of [0,1]){assert.equal(await s.binary.rankOf(s.addresses[i]),1n);assert.equal(await s.binary.cumulativePaidRankPoints(s.addresses[i]),100n);}
  await tx(s.binary.setAutoBuy(false));trained=await s.p.send('evm_snapshot',[]);
 });
 beforeEach(async context=>{if(trained){await s.p.send('evm_revert',[trained]);trained=await s.p.send('evm_snapshot',[]);}});
 test('enable at 12:30 buys the next 13:00 settlement in the allocation transaction',async()=>{
  const now=(await s.p.getBlock('latest')).timestamp;await s.p.send('evm_increaseTime',[1800-now%3600]);await s.p.send('evm_mine',[]);
  await tx(s.binary.setAutoBuy(true));const scheduled=await s.binary.nextAutoSetting(s.addresses[0]);assert.equal(scheduled.effectiveAt,await s.binary.epochEnd());
  await funding();await begin();const cash=await s.binary.pendingReward(s.addresses[0]),other=await s.binary.pendingReward(s.addresses[1]);const quote=await s.token.quoteBuy(E('90'));
  const receipts=[];while(await s.binary.phase()>0n)receipts.push(await tx(s.binary.processEpoch(100,{gasLimit:12000000})));
  assert.equal(await s.token.balanceOf(s.addresses[0]),quote);assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);assert.equal(await s.binary.totalAuto(),0n);
  assert.equal(await s.binary.pendingReward(s.addresses[0])-cash,E('1710'));assert.equal(await s.binary.pendingReward(s.addresses[1])-other,E('1800'));
  assert.equal(await s.binary.tokenBuySpent(s.addresses[0]),0n);assert.equal(await s.token.reserve(),E('90'));await checkAccounting(s);
  assert(receipts.some(r=>r.logs.some(l=>{try{return s.binary.interface.parseLog(l)?.name==='AutoExecuted';}catch{return false;}})));
 });
 test('failed new allocation preserves funds, other rewards, rank and existing manual quota; keeper retries current price',async()=>{
  await activate();await tx(s.token.buy(E('100'),0,MaxUint256));await funding();await begin();const other=await s.binary.pendingReward(s.addresses[1]),spent=await s.binary.tokenBuySpent(s.addresses[0]);
  await tx(s.usd.deny(s.token.target,false));await finish();assert.equal(await s.binary.pendingAuto(s.addresses[0]),E('90'));assert.equal(await s.binary.pendingReward(s.addresses[1])-other,E('1800'));assert.equal(await s.binary.cumulativePaidRankPoints(s.addresses[0]),110n);
  await tx(s.usd.deny('0x0000000000000000000000000000000000000000',false));await tx(s.token.connect(s.signers[1]).buy(E('100'),0,MaxUint256));
  const quote=await s.token.quoteBuy(E('90')),bal=await s.token.balanceOf(s.addresses[0]);assert.equal(await keeperStep(s.binary,s.p),'auto-buy executed');
  assert.equal(await s.token.balanceOf(s.addresses[0])-bal,quote);assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);assert.equal(await s.binary.tokenBuySpent(s.addresses[0]),spent);await checkAccounting(s);
 });
 test('bounded gas exhaustion in token collateral cannot revert other member allocation',async()=>{
  await activate();await funding();await begin();await tx(s.usd.deny(s.token.target,true));const other=await s.binary.pendingReward(s.addresses[1]);
  await finish();assert.equal(await s.binary.pendingAuto(s.addresses[0]),E('90'));assert.equal(await s.binary.pendingReward(s.addresses[1])-other,E('1800'));assert.equal(await s.binary.phase(),0n);await checkAccounting(s);
 });
 test('old pending is not silently included in new immediate attempt',async()=>{
  await activate();await funding();await begin();await tx(s.usd.deny(s.token.target,false));await finish();assert.equal(await s.binary.pendingAuto(s.addresses[0]),E('90'));
  await tx(s.usd.deny('0x0000000000000000000000000000000000000000',false));await funding();await begin();const quote=await s.token.quoteBuy(E('90'));await finish();
  assert.equal(await s.token.balanceOf(s.addresses[0]),quote);assert.equal(await s.binary.pendingAuto(s.addresses[0]),E('90'));assert.equal(await s.token.reserve(),E('90'));await checkAccounting(s);
 });
 test('disable between matching and allocation stops buying immediately; owner cash release never enables wallet debit',async()=>{
  await activate();await funding();await begin();await tx(s.binary.setAutoBuy(false));await finish();assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.binary.pendingAuto(s.addresses[0]),E('90'));
  await assert.rejects(s.binary.executeAuto.staticCall(s.addresses[0],E('90')),{reason:'auto disabled'});const pending=await s.binary.pendingReward(s.addresses[0]);
  await tx(s.binary.releaseAutoToCash());assert.equal(await s.binary.pendingReward(s.addresses[0]),pending+E('90'));assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);await checkAccounting(s);
 });
 test('callbacks cannot reenter settlement or isolated helper; successful buy stays single',async()=>{
  await activate();await funding();await begin();await tx(s.usd.setCallback(s.binary.target,s.binary.interface.encodeFunctionData('processEpoch',[1])));await finish();
  assert.equal(await s.usd.attempted(),true);assert.equal(await s.usd.succeeded(),false);assert.equal(await s.token.reserve(),E('90'));assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);
  await assert.rejects(s.binary.executeImmediateAuto.staticCall(s.addresses[0],1),{reason:'self only'});await checkAccounting(s);
 });
 test('taxed auto failure is isolated and fully rolls back token mint and earmarked cash',async()=>{
  await activate();await funding();await begin();const tokenCash=await s.usd.balanceOf(s.token.target);await tx(s.usd.setFeeMode(1));await finish();
  assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.usd.balanceOf(s.token.target),tokenCash);assert.equal(await s.binary.pendingAuto(s.addresses[0]),E('90'));await checkAccounting(s);
 });
 test('enable during an old backlog excludes old earned hours and schedules the next wall-clock boundary',async()=>{
  await funding();await drainVolume(s);const b=await s.p.getBlock('latest');await s.p.send('evm_increaseTime',[Number(await s.binary.epochEnd())-b.timestamp+7200]);await s.p.send('evm_mine',[]);
  const now=(await s.p.getBlock('latest')).timestamp;await tx(s.binary.setAutoBuy(true));assert.equal((await s.binary.nextAutoSetting(s.addresses[0])).effectiveAt,BigInt(Math.floor(now/3600)+1)*3600n);await begin();await finish();assert.equal(await s.token.totalSupply(),0n);
 });
 test('pause alone cannot convert; true closed-token permissionless bounded release preserves each beneficiary and cash',async()=>{
  await activate();await tx(s.binary.connect(s.signers[1]).setAutoBuy(true));await settle(s,s.p);
  await tx(s.token.buy(E('100'),0,MaxUint256));await funding();await begin();await tx(s.usd.deny(s.token.target,false));await finish();
  assert.equal(await s.binary.pendingAuto(s.addresses[0]),E('90'));assert.equal(await s.binary.pendingAuto(s.addresses[1]),E('90'));
  await councilCall(s.binary.target,s.binary.interface.encodeFunctionData('pause'));
  await assert.rejects(s.binary.releaseClosedTokenAutoToCash.staticCall(0,100),{reason:'token buys not closed'});
  await tx(s.usd.deny('0x0000000000000000000000000000000000000000',false));
  await tx(s.token.sell(await s.token.totalSupply(),0,MaxUint256));assert.equal(await s.token.lifecycleClosed(),true);assert.equal(await s.token.permanentlyRetired(),false);
  assert((await s.token.quoteBuy(E('1')))>0n,'ordinary empty cycle can restart');
  await assert.rejects(s.binary.releaseClosedTokenAutoToCash.staticCall(0,100),{reason:'token buys not closed'});
  await governedTokenAction('closeBuysPermanently');assert.equal(await s.token.buysPermanentlyClosed(),true);
  await assert.rejects(s.token.quoteBuy(E('1')));
  const total=await s.binary.totalPending()+await s.binary.totalAuto(),cash=await s.usd.balanceOf(s.binary.target),builder=await s.binary.builderAccounted(),pool=await s.binary.pointPool(),dev=await s.binary.pendingReward(s.addresses[35]),before=await s.binary.pendingReward(s.addresses[0]);
  await assert.rejects(s.binary.releaseClosedTokenAutoToCash.staticCall(0,101),{reason:'batch'});
  await assert.rejects(s.binary.releaseClosedTokenAutoToCash.staticCall(0,0),{reason:'batch'});
  await tx(s.binary.connect(s.signers[44]).releaseClosedTokenAutoToCash(0,1));assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);assert.equal(await s.binary.pendingAuto(s.addresses[1]),E('90'));assert.equal(await s.binary.totalAuto(),E('90'));assert.equal(await s.binary.pendingReward(s.addresses[0]),before+E('90'));
  await tx(s.binary.connect(s.signers[44]).releaseClosedTokenAutoToCash(0,1));assert.equal(await s.binary.pendingReward(s.addresses[0]),before+E('90'));
  await tx(s.binary.connect(s.signers[44]).releaseClosedTokenAutoToCash(1,100));assert.equal(await s.binary.totalAuto(),0n);assert.equal(await s.binary.pendingAutoAccountCount(),0n);
  assert.equal(await s.binary.totalPending()+await s.binary.totalAuto(),total);assert.equal(await s.usd.balanceOf(s.binary.target),cash);assert.equal(await s.binary.builderAccounted(),builder);assert.equal(await s.binary.pointPool(),pool);assert.equal(await s.binary.pendingReward(s.addresses[35]),dev);
  await tx(s.token.claimDevelopmentFees());await governedTokenAction('retirePermanently');assert.equal(await s.token.permanentlyRetired(),true);
  const wallet=await s.usd.balanceOf(s.addresses[0]),claim=await s.binary.pendingReward(s.addresses[0]);await tx(s.binary.claim());assert.equal(await s.usd.balanceOf(s.addresses[0])-wallet,claim);await checkAccounting(s);
 });

 test('default gas estimate advances allocation cursor instead of successful zero-progress loops',async()=>{
  await activate();await funding();await begin();const cursor=await s.binary.cursor();await tx(s.binary.processEpoch(100));
  assert((await s.binary.phase())===0n||(await s.binary.cursor())>cursor);await finish();
 });

 test('failed pending auto restarts an ordinary empty cycle at current exact reference, never captures support or development claim',async()=>{
  await activate();await tx(s.token.buy(E('100'),0,MaxUint256));await funding();await begin();await tx(s.usd.deny(s.token.target,false));await finish();
  await tx(s.usd.deny('0x0000000000000000000000000000000000000000',false));await tx(s.token.sell(await s.token.totalSupply(),0,MaxUint256));
  const support=await s.token.priceProtectionFund(),claim=await s.token.developmentFeeClaim(),quote=await s.token.quoteBuy(E('90'));
  assert.equal(await s.token.lifecycleClosed(),true);assert.equal(await keeperStep(s.binary,s.p),'auto-buy executed');
  assert.equal(await s.token.lifecycleClosed(),false);assert.equal(await s.token.balanceOf(s.addresses[0]),quote);assert.equal(await s.token.reserve(),E('90'));assert.equal(await s.token.priceProtectionFund(),support);assert.equal(await s.token.developmentFeeClaim(),claim);await checkAccounting(s);
 });

 test('estimated minimum gas survives fully exhausted child and persists progress plus pending liability',async()=>{
  await activate();await funding();await begin();await tx(s.usd.deny(s.token.target,true));const cursor=await s.binary.cursor();
  const estimate=await s.binary.processEpoch.estimateGas(100);await tx(s.binary.processEpoch(100,{gasLimit:estimate}));
  assert((await s.binary.phase())===0n||(await s.binary.cursor())>cursor);assert.equal(await s.binary.pendingAuto(s.addresses[0]),E('90'));await finish();
 });
 test('keeper preflight does not spend a transaction on disabled pending accounts',async()=>{
  await activate();await funding();await begin();await tx(s.usd.deny(s.token.target,false));await finish();await tx(s.binary.setAutoBuy(false));
  const nonce=await s.p.getTransactionCount(s.addresses[0]);assert.equal(await keeperStep(s.binary,s.p),'idle');assert.equal(await s.p.getTransactionCount(s.addresses[0]),nonce);assert.equal(await s.binary.pendingAuto(s.addresses[0]),E('90'));
 });

 test('12:59 enable buys at 13; request exactly 13 schedules 14; redundant enables and off/on keep exact boundary',async()=>{
  const end=Number(await s.binary.epochEnd()),now=(await s.p.getBlock('latest')).timestamp;
  await s.p.send('evm_increaseTime',[end-now-1]);await s.p.send('evm_mine',[]);await tx(s.binary.setAutoBuy(true));assert.equal((await s.binary.nextAutoSetting(s.addresses[0])).effectiveAt,BigInt(end));
  await tx(s.binary.setAutoBuy(true));assert.equal((await s.binary.nextAutoSetting(s.addresses[0])).effectiveAt,BigInt(end));
  await tx(s.binary.setAutoBuy(false));assert.equal(await s.binary.effectiveAutoEnabled(s.addresses[0]),false);
  await s.p.send('evm_increaseTime',[1]);await s.p.send('evm_mine',[]);await tx(s.binary.setAutoBuy(true));assert.equal((await s.binary.nextAutoSetting(s.addresses[0])).effectiveAt,BigInt(end+3600));
  assert.equal(await s.binary.effectiveAutoEnabled(s.addresses[0]),false);await settle(s,s.p);
  await funding();await begin();await finish();assert.equal(await s.token.reserve(),E('90'));
  const from=await s.binary.autoEnabledFrom(s.addresses[0]);await tx(s.binary.setAutoBuy(true));assert.equal(await s.binary.autoEnabledFrom(s.addresses[0]),from);assert.equal(await s.binary.effectiveAutoEnabled(s.addresses[0]),true);
 });

});
