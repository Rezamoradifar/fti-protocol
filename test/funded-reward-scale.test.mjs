import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,Interface,AbiCoder,keccak256,toBeHex,getAddress,parseEther as E} from 'ethers';
import {deployOne,settle} from '../scripts/lib.mjs';
import {FundedLedger,WAD} from '../core/funded-reference.mjs';
import {keeperStep} from '../scripts/keeper.mjs';

// Production bytecode, compiler-derived storage slots, deterministic valid ledger
// fixture. Seeding replaces registration transactions, NOT settlement or payout.
// This is an EVM settlement/payout stress test, not 10k end-to-end registrations.
const sources=Object.fromEntries(fs.readdirSync('contracts').filter(f=>f.endsWith('.sol')).map(f=>[f,{content:fs.readFileSync('contracts/'+f,'utf8')}]));
const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{outputSelection:{'*':{'*':['storageLayout']}}}}),{import:p=>({contents:fs.readFileSync('node_modules/'+p,'utf8')})}));
assert(!out.errors?.some(e=>e.severity==='error'));
// Batch storage writes only during fixture creation, then restore exact runtime.
// Avoid 145k state-root commits from one RPC call per word.
const fixtureOutput=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Fixture.sol':{content:`pragma solidity 0.8.30;
contract Fixture {
 function seed(uint256[] calldata slots,uint256[] calldata values) external {
  require(block.chainid==31337 && slots.length==values.length);
  for(uint256 i;i<slots.length;i++){uint256 slot=slots[i];uint256 value=values[i];assembly {sstore(slot,value)}}
 }
}`}},settings:{evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.deployedBytecode.object']}}}})));
assert(!fixtureOutput.errors?.some(e=>e.severity==='error'));
const fixture=fixtureOutput.contracts['Fixture.sol'].Fixture;
const fixtureInterface=new Interface(fixture.abi);
const layout=out.contracts['FundedBinaryPlan.sol'].FundedBinaryPlan.storageLayout;
const abi=AbiCoder.defaultAbiCoder();
const map=(type,key,slot)=>BigInt(keccak256(abi.encode([type,'uint256'],[key,slot])));
const array=slot=>BigInt(keccak256(toBeHex(slot,32)));
const addressFor=id=>getAddress(toBeHex(BigInt(id)+0x100000n,20));

for(const positions of [1000,10000])test(`production EVM settles and pays ${positions} seeded binary positions with restart and exact ledgers`,{timeout:1800000},async()=>{
 const engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:40},chain:{chainId:31337,time:new Date('2026-10-06T12:00:00Z')},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 try{
  const signers=await Promise.all(Array.from({length:40},(_,i)=>p.getSigner(i))),addresses=await Promise.all(signers.map(s=>s.getAddress()));
  const genesis=Array.from({length:31},(_,i)=>addressFor(i));
  const usd=await deployOne('MockUSD',[],signers[0]);
  const token=await deployOne('FTIReserveTokenV3',[usd.target,addresses[39],addresses[39]],signers[0]);
  const binary=await deployOne('FundedBinaryPlan',[usd.target,token.target,addresses[39],addresses[39],addresses[38],genesis],signers[0]);
  await(await token.bind(binary.target)).wait();
  const ledger=new FundedLedger();for(let i=0;i<31;i++)ledger.fund(i,1);
  for(let i=31;i<positions;i++){ledger.place(Math.floor((i-1)/2));ledger.fund(i,1+(i*17)%5);}
  ledger.check(true);
  const rows=new Map(),fields=Object.fromEntries(layout.storage.map(f=>[f.label,f]));
  const set=(slot,value,offset=0,bytes=32)=>{slot=BigInt(slot);const bits=BigInt(bytes*8),shift=BigInt(offset*8),mask=((1n<<bits)-1n)<<shift;rows.set(slot,((rows.get(slot)||0n)&~mask)|(BigInt(value)<<shift));};
  const top=(label,value)=>{const f=fields[label];set(f.slot,value,f.offset,Number(layout.types[f.type].numberOfBytes));};
  const mapping=(label,type,key,value)=>set(map(type,key,BigInt(fields[label].slot)),value);
  const arr=(label,values,base=BigInt(fields[label].slot))=>{set(base,values.length);values.forEach((v,i)=>set(array(base)+BigInt(i),v));};
  const memberType=layout.types[layout.types[fields.members.type].value];
  const members=Object.fromEntries(memberType.members.map(f=>[f.label,f]));
  const dirty=[...ledger.dirty],month=[...ledger.monthAccounts];
  top('pointPool',ledger.pointBook);top('builderAccounted',ledger.builderBook);
  top('assignedPointCredit',ledger.pointAssigned);top('retainedPointReserve',ledger.pointRetained);
  top('assignedBuilderCredit',ledger.builderAssigned);top('retainedBuilderReserve',ledger.builderRetained);
  top('totalPending',ledger.development);mapping('pendingReward','address',addresses[38],ledger.development);
  mapping('rewardIndex','address',addresses[38],1);arr('rewardAccounts',[BigInt(addresses[38])]);
  top('dirtyCount',dirty.length);top('unitsSinceSettlement',ledger.unitsSinceSettlement);
  arr('memberList',ledger.users.map((_,i)=>BigInt(addressFor(i))));
  for(const [i,u]of ledger.users.entries()){
   const who=addressFor(i),base=map('address',who,BigInt(fields.members.slot));
   const values={parent:u.parent<0?0n:BigInt(addressFor(u.parent)),left:u.children[0]===undefined?0n:BigInt(addressFor(u.children[0])),right:u.children[1]===undefined?0n:BigInt(addressFor(u.children[1])),units:u.units,carryL:u.left,carryR:u.right,lifetimeL:u.lifeLeft,lifetimeR:u.lifeRight,rank:u.rank,exists:1};
   for(const[label,value]of Object.entries(values)){const f=members[label];set(base+BigInt(f.slot),value,f.offset,Number(layout.types[f.type].numberOfBytes));}
   if(u.creditLeft)mapping('creditL','address',who,u.creditLeft);if(u.creditRight)mapping('creditR','address',who,u.creditRight);
  }
  for(const[i,id]of dirty.entries()){mapping('dirtyMembers','uint256',i,BigInt(addressFor(id)));mapping('dirty','address',addressFor(id),1);}
  const monthKey=await binary.nextBuilderMonth(),mf=map('uint256',monthKey,BigInt(fields.monthFunding.slot));
  ledger.monthFunds.forEach((v,i)=>set(mf+BigInt(i),v));
  arr(null,month.map(id=>BigInt(addressFor(id))),map('uint256',monthKey,BigInt(fields.builderAccounts.slot)));
  for(const id of month){const bc=map('address',addressFor(id),map('uint256',monthKey,BigInt(fields.builderCredit.slot)));ledger.users[id].builder.forEach((v,i)=>set(bc+BigInt(i),v));}
  const writes=[...rows],productionCode=await p.getCode(binary.target);
  await engine.request({method:'evm_setAccountCode',params:[binary.target,'0x'+fixture.evm.deployedBytecode.object]});
  for(let i=0;i<writes.length;i+=1000){const chunk=writes.slice(i,i+1000);
   await(await signers[0].sendTransaction({to:binary.target,data:fixtureInterface.encodeFunctionData('seed',[chunk.map(x=>x[0]),chunk.map(x=>x[1])]),gasLimit:25000000})).wait();
  }
  await engine.request({method:'evm_setAccountCode',params:[binary.target,productionCode]});
  assert.equal(await p.getCode(binary.target),productionCode,'exact production runtime must be restored before validation');
  const collateral=ledger.pointBook+ledger.builderBook+ledger.development;for(let i=0n;i<collateral;i+=E('1000000'))await(await usd.faucet()).wait();await(await usd.transfer(binary.target,collateral)).wait();
  ledger.closeEpoch();ledger.closeMonth();ledger.check(true);
  const gas={epoch:[],month:[],payout:[]};
  const check=async()=>{const[a,b]=await binary.accounting();assert.equal(a,b);const[c,d,e,f]=await binary.fundingAccounting();assert.equal(c,d);assert.equal(e,f);};
  await check();
  const epochBinary=new Proxy(binary,{get(target,key){
   if(key==='processEpoch')return async(batch,overrides)=>{
    assert(batch<=25);assert.equal(overrides.gasLimit,12000000);
    await assert.rejects(()=>binary.payRewards.staticCall(100));
    const tx=await binary.processEpoch(batch,overrides);
    return{wait:async()=>{const r=await tx.wait();gas.epoch.push(r.gasUsed);assert(r.gasUsed<12000000n);return r;}};
   };return Reflect.get(target,key);
  }});
  // The shared helper used to send 100-item funded batches with a 12M cap,
  // while the benchmark measured up to 17.24M. Exercise its bounded fix.
  await settle({binary:epochBinary,token,usd},p);
  await check();assert.equal(await binary.pointPool(),ledger.pointBook);
  // Close the actual UTC month, then process attributed monthly rewards.
  const now=(await p.getBlock('latest')).timestamp,end=Date.UTC(2026,10,1)/1000;
  await p.send('evm_increaseTime',[end-now+1]);await p.send('evm_mine',[]);await(await binary.beginEpochClose()).wait();
  await(await binary.beginBuilderMonth()).wait();await assert.rejects(()=>binary.payRewards.staticCall(100));
  while(await binary.monthPhase()>0n){const r=await(await binary.processBuilderMonth(100,{gasLimit:25000000})).wait();gas.month.push(r.gasUsed);assert(r.gasUsed<25000000n);}
  await check();assert.equal(await binary.builderAccounted(),ledger.builderBook);
  const expected=new Map([[addresses[38],ledger.development]]);
  for(const[id,u]of ledger.users.entries())if(u.reward+u.builderReward>0n)expected.set(addressFor(id),u.reward+u.builderReward);
  assert.equal(await binary.rewardAccountCount(),BigInt(expected.size));
  assert.equal(await binary.totalPending(),[...expected.values()].reduce((s,v)=>s+v,0n));
  const deferred=[...expected.keys()][2],blockedAmount=expected.get(deferred);
  await(await usd.setBlocked(deferred,true)).wait();
  const sent=new Map();const note=receipt=>{
   gas.payout.push(receipt.gasUsed);assert(receipt.gasUsed<12000000n);
   for(const log of receipt.logs){let event;try{event=binary.interface.parseLog(log);}catch{continue;}
    if(event?.name==='Claimed'){const who=event.args.wallet;assert(!sent.has(who),'duplicate payment');assert.equal(event.args.amount,expected.get(who));sent.set(who,event.args.amount);}
   }
  };
  // Stop after one batch. A second caller/keeper resumes from persisted state.
  note(await(await binary.payRewards(100,{gasLimit:12000000})).wait());await check();
  const afterStop=await binary.rewardAccountCount();assert(afterStop>0n);
  const caller=binary.connect(signers[1]);const observed=new Proxy(caller,{get(target,key){if(key==='payRewards')return async batch=>{const tx=await caller.payRewards(batch,{gasLimit:12000000});return{wait:async()=>{const r=await tx.wait();note(r);return r;}};};return Reflect.get(target,key);}});
  while(await binary.rewardAccountCount()>1n){assert.equal(await keeperStep(observed,p),'reward payout batch');await check();}
  assert.equal(await binary.pendingReward(deferred),blockedAmount);assert.equal(await usd.balanceOf(deferred),0n);
  note(await(await binary.payRewards(100,{gasLimit:12000000})).wait());assert.equal(await binary.rewardAccountCount(),1n);
  await(await usd.setBlocked(deferred,false)).wait();note(await(await binary.payRewards(100,{gasLimit:12000000})).wait());
  assert.equal(await binary.rewardAccountCount(),0n);assert.equal(await binary.totalPending(),0n);assert.equal(sent.size,expected.size);
  note(await(await binary.payRewards(100,{gasLimit:12000000})).wait());await check();
  // Reconcile every actual transfer event; sample wallet storage across the tree.
  for(const who of [...expected.keys()].filter((_,i)=>i%Math.max(1,Math.floor(expected.size/20))===0))assert.equal(await usd.balanceOf(who),expected.get(who));
  const report={positions,seededStorageWords:writes.length,scope:'Production EVM bytecode with independently calculated seeded network; registration/RPC load excluded',beneficiaries:expected.size,stoppedQueue:afterStop.toString(),gas:Object.fromEntries(Object.entries(gas).map(([k,v])=>[k,{batches:v.length,max:Math.max(...v.map(Number)),total:v.reduce((s,x)=>s+x,0n).toString()}])),paidWei:[...sent.values()].reduce((s,v)=>s+v,0n).toString(),assertions:'ledger, backing, calendar/epoch gates, bounded gas, deferred recipient, restart, duplicate payment, fixed beneficiaries'};
  console.log('FUNDED_REWARD_SCALE',JSON.stringify(report));
  if(process.env.FTI_SCALE_REPORT_DIR){fs.mkdirSync(process.env.FTI_SCALE_REPORT_DIR,{recursive:true});fs.writeFileSync(process.env.FTI_SCALE_REPORT_DIR+`/reward-scale-${positions}.json`,JSON.stringify(report,null,2)+'\n');}
 }finally{p.destroy();await engine.disconnect();}
});
