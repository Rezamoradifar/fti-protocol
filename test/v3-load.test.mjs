import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,JsonRpcProvider,Contract,parseEther as E,formatEther as F,MaxUint256,keccak256,ZeroHash,id} from 'ethers';
import {artifact,deployOne,drainVolume,settle,checkAccounting} from '../scripts/lib.mjs';
import {keeperStep} from '../scripts/keeper.mjs';

// Public-chain state is copied into Ganache. All transactions/time changes stay local.
// No real wallet keys, network writes or mainnet support.
test('V3 100 wallets: funded binary, trading, transfers, rewards, auto retry, cycles and council', {timeout:900000}, async()=>{
 const cfg=process.env.FTI_FORK_DEPLOYMENT?JSON.parse(fs.readFileSync(process.env.FTI_FORK_DEPLOYMENT)):null;
 let upstream,engine,p;let txs=0,checks=0,expectedReverts=0;
 const stats={mode:cfg?'BNB-testnet-state-fork':'local-real-V3-contracts',wallets:100,buys:0,sells:0,transfers:0,transferFrom:0,epochs:0,cashBatches:0};
 const sent=async promise=>{const tx=await promise;const r=await tx.wait();assert.equal(r.status,1);txs++;return r;};
 const fails=async(fn)=>{await assert.rejects(async()=>{await sent(fn());});expectedReverts++;};
 try {
  if(cfg){
   assert.equal(cfg.chainId,97);assert.equal(cfg.tokenContract,'FTIReserveTokenV3');assert.equal(cfg.binaryContract,'FundedBinaryPlan');
   const rpc=process.env.FTI_FORK_RPC||cfg.rpcUrl||'https://bsc-testnet-dataseed.bnbchain.org';
   upstream=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1});assert.equal((await upstream.getNetwork()).chainId,97n);
   for(const key of ['usd','council','timelock','token','binary'])assert.equal(keccak256(await upstream.getCode(cfg[key])),cfg.codeHashes[key],key+' public code hash');
   const block=await upstream.getBlock('latest');stats.forkBlock=block.number;
   engine=ganache.provider({logging:{quiet:true},fork:{url:rpc,blockNumber:block.number},wallet:{totalAccounts:69,unlockedAccounts:[...new Set([...cfg.genesis,...cfg.daoPartners,cfg.development])]},chain:{chainId:31337,time:new Date(block.timestamp*1000)},miner:{blockGasLimit:30000000}});
  }else engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:108},chain:{chainId:31337,time:new Date('2026-10-08T12:00:00Z')},miner:{blockGasLimit:30000000}});
  p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
  let signers,addresses,councilSigners,dev,s;
  if(cfg){
   for(const who of [...cfg.genesis,...cfg.daoPartners,cfg.development])await p.send('evm_setAccountBalance',[who,'0x3635c9adc5dea00000']);
   signers=[...await Promise.all(cfg.genesis.map(a=>p.getSigner(a))),...await Promise.all(Array.from({length:69},(_,i)=>p.getSigner(i)))];
   addresses=await Promise.all(signers.map(s=>s.getAddress()));councilSigners=await Promise.all(cfg.daoPartners.map(a=>p.getSigner(a)));dev=cfg.development;
   s=Object.fromEntries(Object.entries({usd:'MockUSD',council:'SevenGuardianCouncil',timelock:'FTITimelock',token:'FTIReserveTokenV3',binary:'FundedBinaryPlan'}).map(([key,name])=>[key,new Contract(cfg[key],artifact(name).abi,signers[0])]));
   assert.equal(await s.binary.memberCount(),31n,'Fork requires the fresh 31-genesis deployment; existing members must not be erased.');
   assert.equal(await s.token.totalSupply(),0n,'Fork requires a fresh zero-supply cycle; existing holders must not be erased.');
   if((await p.getBlock('latest')).timestamp>=Number(await s.binary.epochEnd()))await settle(s,p);
   for(const a of cfg.genesis)assert.equal(await s.binary.unitsOf(a),0n,'Fork requires inactive genesis');
  }else{
   const all=await Promise.all(Array.from({length:108},(_,i)=>p.getSigner(i)));signers=all.slice(0,100);addresses=await Promise.all(signers.map(s=>s.getAddress()));councilSigners=all.slice(100,107);dev=addresses[0];
   const guardians=await Promise.all(councilSigners.map(s=>s.getAddress()));
   const usd=await deployOne('MockUSD',[],signers[0]);const council=await deployOne('SevenGuardianCouncil',[guardians],signers[0]);const timelock=await deployOne('FTITimelock',[council.target],signers[0]);
   const token=await deployOne('FTIReserveTokenV3',[usd.target,timelock.target,council.target],signers[0]);
   const binary=await deployOne('FundedBinaryPlan',[usd.target,token.target,timelock.target,council.target,dev,addresses.slice(0,31)],signers[0]);
   s={usd,council,timelock,token,binary};await sent(token.bind(binary.target));
  }
  const {usd,token,binary,council,timelock}=s;
  assert.equal(new Set(addresses.map(a=>a.toLowerCase())).size,100);assert.equal(await token.POINT_VALUE_TARGET(),E('20'));assert.equal(await binary.pointValueIsTarget(),true);
  async function check(){await checkAccounting(s);const[pc,pb,bc,bb]=await binary.fundingAccounting();assert.equal(pc,pb);assert.equal(bc,bb);assert.equal(await token.balanceOf(token.target),0n);checks++;}
  async function progress(stage){await check();console.log('V3_100_STAGE',JSON.stringify({stage,txs,checks}));}
  async function closeEpoch(){
   await drainVolume(s,17);
   const expected=[];const level=Number(await binary.protectionLevel());
   const caps=[[5,10,15,20,25],[5,10,12,16,20],[5,10,10,12,15],[5,10,10,10,10]];
   for(const who of addresses){const m=await binary.members(who),l=m.carryL,r=m.carryR,raw=l<r?l:r,paid=raw<BigInt(caps[level][Number(m.rank)])?raw:BigInt(caps[level][Number(m.rank)]),taken=raw===0n?0n:(await binary.creditL(who))*raw/l+(await binary.creditR(who))*raw/r,reward=raw===0n?0n:taken*paid/raw,automatic=m.autoEnabled&&m.rank>0n?reward*5n/100n:0n;expected.push({who,cash:await binary.pendingReward(who),auto:await binary.pendingAuto(who),reward,automatic,paid});}
   const shouldSettle=(await binary.unitsSinceSettlement())>=5n,epoch=await binary.epoch();await settle(s,p,17);stats.epochs++;
   if(shouldSettle)for(const e of expected){assert.equal(await binary.pendingReward(e.who),e.cash+e.reward-e.automatic);assert.equal(await binary.pendingAuto(e.who),e.auto+e.automatic);if(e.reward>0n)assert.equal(await binary.paidPoints(epoch,e.who),e.paid);}
   await check();
  }
  async function payout(){
   const people=[...new Map([...addresses,dev].map(a=>[a.toLowerCase(),a])).values()],before=await Promise.all(people.map(a=>usd.balanceOf(a))),pending=await Promise.all(people.map(a=>binary.pendingReward(a)));
   const binaryBefore=await usd.balanceOf(binary.target);let count=0;
   while((await binary.rewardAccountCount())>0n){await sent(binary.connect(signers[99]).payRewards(17));stats.cashBatches++;assert(++count<30);}
   let sum=0n;for(let i=0;i<people.length;i++){assert.equal((await usd.balanceOf(people[i]))-before[i],pending[i]);assert.equal(await binary.pendingReward(people[i]),0n);sum+=pending[i];}
   assert.equal(binaryBefore-(await usd.balanceOf(binary.target)),sum);await check();
  }
  for(let i=0;i<100;i++){await sent(usd.connect(signers[i]).faucet());await sent(usd.connect(signers[i]).approve(binary.target,MaxUint256));await sent(usd.connect(signers[i]).approve(token.target,MaxUint256));}
  for(let i=0;i<31;i++){await sent(binary.connect(signers[i]).addUnits(i===1||i===2?100:1));await check();}
  const parents=Array.from({length:16},(_,i)=>15+i);let cursor=0,side=0;
  for(let i=31;i<100;i++){await sent(binary.connect(signers[i]).register(addresses[parents[cursor]],1));parents.push(i);if(++side===2){side=0;cursor++;}await check();}
  assert.equal(await binary.memberCount(),100n);stats.registrations=69;stats.activatedGenesis=31;assert.equal(await token.reserve(),0n);assert.equal(await token.totalSupply(),0n);await progress('100 active wallets');
  await closeEpoch();assert((await binary.rankOf(addresses[0]))>0n);await payout();await progress('funded hourly rewards matched independent calculation');
  let lastPrice=0n;
  for(let i=0;i<100;i++){const amount=E(String(10+i%17)),before=await usd.balanceOf(addresses[i]),held=await token.balanceOf(addresses[i]),minted=await token.quoteBuy(amount);await sent(token.connect(signers[i]).buy(amount,minted,MaxUint256));assert.equal(before-(await usd.balanceOf(addresses[i])),amount);assert.equal((await token.balanceOf(addresses[i]))-held,minted);assert((await token.price())>lastPrice);lastPrice=await token.price();stats.buys++;await check();}
  await fails(()=>token.connect(signers[99]).buy(E('1000'),0,MaxUint256));await fails(()=>token.buy(E('1'),MaxUint256,MaxUint256));await fails(()=>token.buy(E('1'),0,1));
  await progress('100 buys and rejected allowance slippage deadline');
  for(let i=0;i<100;i++){
   const from=addresses[i],to=addresses[(i+37)%100],amount=(await token.balanceOf(from))/20n,[net,burn]=await token.quoteTransfer(amount),fromBefore=await token.balanceOf(from),toBefore=await token.balanceOf(to),supply=await token.totalSupply(),reserve=await token.reserve(),support=await token.supportReserve();
   await sent(token.connect(signers[i]).transfer(to,amount));stats.transfers++;
   assert.equal(fromBefore-(await token.balanceOf(from)),amount);assert.equal((await token.balanceOf(to))-toBefore,net);assert.equal(supply-(await token.totalSupply()),burn);assert.equal(await token.reserve(),reserve);assert.equal(await token.supportReserve(),support);await check();
   const delegated=(await token.balanceOf(from))/50n,[net2,burn2]=await token.quoteTransfer(delegated),heldFrom=await token.balanceOf(from),heldTo=await token.balanceOf(to),supply2=await token.totalSupply();
   await sent(token.connect(signers[i]).approve(addresses[99],delegated));await sent(token.connect(signers[99]).transferFrom(from,to,delegated));stats.transferFrom++;
   assert.equal(heldFrom-(await token.balanceOf(from)),delegated);assert.equal((await token.balanceOf(to))-heldTo,net2);assert.equal(supply2-(await token.totalSupply()),burn2);assert.equal(await token.allowance(from,addresses[99]),0n);await check();
  }
  await fails(()=>token.transfer(token.target,2n));await progress('100 transfers and 100 transferFrom burns');
  await sent(binary.setAutoBuy(true,1n));for(const i of [1,2])await sent(binary.connect(signers[i]).addUnits(5));await closeEpoch();await payout();
  const automatic=await binary.pendingAuto(addresses[0]);assert(automatic>0n);const held=await token.balanceOf(addresses[0]);await fails(()=>binary.connect(signers[99]).executeAuto(addresses[0],automatic));assert.equal(await binary.pendingAuto(addresses[0]),automatic);assert.equal(await token.balanceOf(addresses[0]),held);
  await sent(binary.setAutoBuy(true,E('10')));assert.equal(await keeperStep(binary,p),'auto-buy executed');assert.equal(await binary.pendingAuto(addresses[0]),0n);assert((await token.balanceOf(addresses[0]))>held);stats.autoRetry=true;await check();
  for(const i of [1,2])await sent(binary.connect(signers[i]).addUnits(5));await closeEpoch();await payout();const release=await binary.pendingAuto(addresses[0]);assert(release>0n);const beforeRelease=await token.balanceOf(addresses[0]);await sent(binary.releaseAutoToCash());assert.equal(await binary.pendingReward(addresses[0]),release);assert.equal(await token.balanceOf(addresses[0]),beforeRelease);await payout();stats.autoCashRelease=true;
  const month=Number(await binary.nextBuilderMonth()),end=Date.UTC(Math.floor(month/12),month%12+1,1)/1000;await p.send('evm_increaseTime',[end-(await p.getBlock('latest')).timestamp+1]);await p.send('evm_mine',[]);await closeEpoch();await payout();const autoBefore=await binary.totalAuto();await sent(binary.beginBuilderMonth());let batches=0;while((await binary.monthPhase())>0n){await sent(binary.processBuilderMonth(17));assert(++batches<30);}assert.equal(await binary.totalAuto(),autoBefore);await payout();stats.monthlyBuilder=true;await progress('auto retry cash release monthly Builder and source accounting');
  // Exercise the actual governance contracts, not only their constants.
  await fails(()=>council.connect(signers[99]).propose(token.target,token.interface.encodeFunctionData('pause',[])));
  const pauseId=await council.proposalCount();await sent(council.connect(councilSigners[0]).propose(token.target,token.interface.encodeFunctionData('pause',[])));
  for(let i=1;i<5;i++)await sent(council.connect(councilSigners[i]).approve(pauseId));await sent(council.connect(signers[99]).execute(pauseId));assert.equal(await token.paused(),true);
  await fails(()=>token.buy(E('1'),0,MaxUint256));await fails(()=>token.transfer(addresses[1],E('1')));await fails(()=>token.unpause());
  const data=token.interface.encodeFunctionData('unpause',[]),salt=id('V3-100-wallet-unpause'),schedule=timelock.interface.encodeFunctionData('schedule',[token.target,0,data,ZeroHash,salt,259200]);
  const normalId=await council.proposalCount();await sent(council.connect(councilSigners[0]).propose(timelock.target,schedule));for(let i=1;i<5;i++)await sent(council.connect(councilSigners[i]).approve(normalId));await sent(council.connect(signers[99]).execute(normalId));
  await fails(()=>timelock.execute(token.target,0,data,ZeroHash,salt));await p.send('evm_increaseTime',[259201]);await p.send('evm_mine',[]);await sent(timelock.execute(token.target,0,data,ZeroHash,salt,{gasLimit:1000000}));assert.equal(await token.paused(),false);await fails(()=>timelock.execute(token.target,0,data,ZeroHash,salt));stats.normalTimelock=true;
  await progress('pause role checks and 72-hour timelock with replay rejection');
  const snap=await p.send('evm_snapshot',[]);
  // Emergency uses the 100 actual holders; it runs on a disposable snapshot only.
  const emergency=token.interface.encodeFunctionData('activateEmergencyUnwind',[]);const proposal=await council.proposalCount();await sent(council.connect(councilSigners[0]).propose(token.target,emergency));for(let i=1;i<4;i++)await sent(council.connect(councilSigners[i]).approve(proposal));await fails(()=>council.connect(signers[99]).execute(proposal));await sent(council.connect(councilSigners[4]).approve(proposal));await sent(council.connect(signers[99]).execute(proposal));
  const pool=await token.emergencyRemainingPool();let paid=0n;for(let j=0;j<100;j++){const i=(j*37)%100,balance=await token.balanceOf(addresses[i]),expected=balance*(await token.emergencyRemainingPool())/(await token.emergencyRemainingSupply()),before=await usd.balanceOf(addresses[i]);await sent(token.connect(signers[i]).emergencyRedeem(balance,expected));assert.equal((await usd.balanceOf(addresses[i]))-before,expected);paid+=expected;}
  assert.equal(paid,pool);assert.equal(await token.emergencyRemainingPool(),0n);assert.equal(await token.totalSupply(),0n);assert.equal(await token.cycle(),1n);await fails(()=>token.buy(E('1'),0,MaxUint256));stats.emergencyRedeems=100;assert.equal(await p.send('evm_revert',[snap]),true);await progress('5-of-7 emergency and 100 proportional redemptions on reverted snapshot');
  // Full cash conservation for normal exits; include the final developer sweep.
  async function exitAll(){const book=Array.from(await binary.accounting()),poolBefore=await usd.balanceOf(token.target),devBefore=await usd.balanceOf(dev);let paid=0n,devSellerPayout=0n,parts=0;for(let j=0;j<100;j++){const i=(j*37)%100;while((await token.balanceOf(addresses[i]))>0n){assert(++parts<2000);const balance=await token.balanceOf(addresses[i]),supply=await token.totalSupply(),reserve=await token.reserve(),maxTokens=E('450')*supply/reserve,amount=balance===supply?balance:(balance<maxTokens?balance:maxTokens);assert(amount>0n);const[out,gross]=await token.quoteSell(amount);assert(amount===supply||gross<=E('500'));const before=await usd.balanceOf(addresses[i]),isDev=addresses[i].toLowerCase()===dev.toLowerCase(),extra=amount===supply&&isDev?reserve-out+(await token.supportReserve()):0n;await sent(token.connect(signers[i]).sell(amount,out,MaxUint256));assert.equal((await usd.balanceOf(addresses[i]))-before,out+extra);paid+=out;if(isDev)devSellerPayout+=out;stats.sells++;if((await token.totalSupply())>0n){assert((await token.price())>=lastPrice);lastPrice=await token.price();}await check();}}assert.equal(paid+(await usd.balanceOf(dev))-devBefore-devSellerPayout,poolBefore);assert.equal(await usd.balanceOf(token.target),0n);assert.equal(await token.reserve(),0n);assert.equal(await token.supportReserve(),0n);assert.equal(await token.totalSupply(),0n);assert.deepEqual(Array.from(await binary.accounting()),book);return{sellerPayout:F(paid),developmentSweep:F((await usd.balanceOf(dev))-devBefore-devSellerPayout)};}
  stats.firstExit=await exitAll();assert.equal(await token.cycle(),2n);assert.equal(await token.cycleStartPrice(),E('0.2'));assert.equal(await token.pendingSupportTarget(),0n);assert.equal(await binary.memberCount(),100n);await progress('100 holders exit and restart at 0.20');
  lastPrice=0n;for(let i=0;i<100;i++){assert((await token.remainingAllowance(addresses[i]))>=E('10'));await sent(token.connect(signers[i]).buy(E('10'),await token.quoteBuy(E('10')),MaxUint256));stats.buys++;assert((await token.price())>lastPrice);lastPrice=await token.price();await check();}
  stats.secondExit=await exitAll();assert.equal(await token.cycle(),3n);assert.equal(await token.cycleStartPrice(),E('0.2'));await progress('second 100-wallet cycle completed');
  assert.equal(await timelock.getMinDelay(),259200n);stats.accountingChecks=checks;stats.confirmedTransactions=txs;stats.expectedReverts=expectedReverts;stats.success=true;stats.publicTransactionsSent=0;stats.productionCreationHashes={token:keccak256(artifact('FTIReserveTokenV3').bytecode),binary:keccak256(artifact('FundedBinaryPlan').bytecode)};
  if(process.env.FTI_100_REPORT)fs.writeFileSync(process.env.FTI_100_REPORT,JSON.stringify(stats,null,2)+'\n');
  console.log('V3_100_RESULT',JSON.stringify(stats));
 }finally{upstream?.destroy();if(engine)await engine.disconnect();}
});
