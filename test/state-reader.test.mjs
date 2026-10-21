import test from 'node:test';
import assert from 'node:assert/strict';
import {createStateReader,StateReadError} from '../scripts/state-reader.mjs';

const UNIT=10n**18n,A='0x'+'1'.repeat(40),B='0x'+'2'.repeat(40),ZERO='0x'+'0'.repeat(40),HASH='0x'+'a'.repeat(64);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
 const calls=[],state={now:2000000,head:{number:500,timestamp:2000,hash:HASH},chain:56n,active:0,peak:0,hook:async()=>{},canonicalHash:null};
 async function call(name,args,value){
  calls.push({name,args,at:Date.now()});state.active++;state.peak=Math.max(state.peak,state.active);
  try{await state.hook(name,args);await tick();return typeof value==='function'?value(...args):value;}
  finally{state.active--;}
 }
 const member=who=>({parent:ZERO,left:ZERO,right:ZERO,units:who===A?1n:2n,carryL:1n,carryR:2n,lifetimeL:3n,lifetimeR:4n,rank:0n,exists:true,autoEnabled:false,maxAutoPrice:0n});
 const binaryValues={memberCount:31n,epoch:1n,epochEnd:3000n,phase:0n,protectionLevel:0n,pointPool:100n*UNIT,totalPending:2n*UNIT,totalAuto:3n*UNIT,jobCursor:0n,jobCount:0n,cursor:0n,monthPhase:0n,nextBuilderMonth:24321n,paused:false,accounting:[500n*UNIT,499n*UNIT],recoveryFrozen:false,calculatedPointValue:20n*UNIT,candidatePoints:2n,pointValue:20n*UNIT,totalPaidPoints:2n,rewardAccountCount:1n,retainedPointReserve:50n*UNIT,retainedBuilderReserve:40n*UNIT,assignedPointCredit:10n*UNIT,dirtyCount:2n,
  members:member,pendingReward:who=>who===A?2n*UNIT:3n*UNIT,pendingAuto:who=>who===A?4n*UNIT:5n*UNIT,depth:1n,creditL:6n,creditR:7n,directReferrerOf:ZERO,directReferralCount:8n,autoBuyPercent:5n};
 const tokenValues={price:UNIT/10n,totalSupply:1000n*UNIT,reserve:100n*UNIT,supportReserve:15n*UNIT,ath:UNIT/10n,paused:false,accounting:[115n*UNIT,115n*UNIT],emergencyUnwind:false,builderMultiplier:1n,cycle:1n,cycleStartPrice:UNIT/10n,development:B,recoveryFrozen:false,
  balanceOf:who=>who===A?400707n*UNIT/1000n:9n*UNIT,remainingAllowance:who=>who===A?45869n*UNIT/100n:900n*UNIT,
  buybackFund:0n,floorFund:0n,walletClock:100n,anchorSupply:50n*UNIT,circulatingSupply:950n*UNIT,available:8n*UNIT,unlocked:7n*UNIT,lockInfo:[{amount:1n,clock:2n,deadline:3n}],lockCount:1n};
 const wrap=(prefix,values)=>Object.fromEntries(Object.entries(values).map(([name,value])=>[name,(...args)=>call(prefix+'.'+name,args,value)]));
 const contracts={binary:wrap('binary',binaryValues),token:wrap('token',tokenValues),usd:{balanceOf:(...args)=>call('usd.balanceOf',args,who=>who===A?41n*UNIT:77n*UNIT)}};
 const provider={getNetwork:(...args)=>call('network',args,()=>({chainId:state.chain})),getBlock:(...args)=>call('block',args,tag=>({...state.head,...(tag!=='latest'&&state.canonicalHash?{hash:state.canonicalHash}:{})}))};
 const cfg={chainId:56,mode:'bnb-mainnet',tokenContract:'FTIReserveTokenUpgradeable',binaryContract:'FundedBinaryPlanUpgradeable',batchedRewards:true,lockVersion:2,...options.cfg};
 const publicConfig={poolDistributionVersion:1,referralPlacementEnabled:true,selectableHourlyAutoBuy:true,...options.publicConfig};
 const reader=createStateReader({provider,contracts,cfg,publicConfig,minIntervalMs:0,now:()=>state.now,...options.reader});
 return {state,calls,contracts,provider,cfg,reader,count:name=>calls.filter(call=>call.name===name).length};
}

test('a full canonical snapshot preserves public accounting, membership, rewards and pause fields without writes',async()=>{
 const f=fixture(),s=await f.reader(A);
 assert.equal(s.block,500);assert.equal(s.blockHash,HASH);assert.equal(s.timestamp,2000);assert.equal(s.price,UNIT/10n);
 assert.deepEqual(s.account1,[500n*UNIT,499n*UNIT]);assert.notEqual(s.account1[0],s.account1[1]);
 assert.equal(s.rewardModel,'hourly-global-pool-v2');assert.equal(s.rewardQueue,1n);assert.equal(s.calculatedPointValue,20n*UNIT);
 assert.equal(s.paused,false);assert.equal(s.tokenPaused,false);assert.equal(s.binaryRecoveryFrozen,false);
 assert.equal(s.wallet.address,A);assert.equal(s.wallet.units,1n);assert.equal(s.wallet.claimable,2n*UNIT);assert.equal(s.wallet.autoPending,4n*UNIT);
 assert.equal(s.wallet.referrer,ZERO);assert.equal(s.wallet.directReferrals,8n);assert.equal(s.wallet.autoBuyPercent,5n);
 for(const {name,args}of f.calls)if(name!=='network'&&name!=='block')assert.deepEqual(args.at(-1),{blockTag:500},name);
});

test('V3 uses one token balance and its no-lock model even when an old config has lockVersion 2',async()=>{
 const f=fixture();f.contracts.token.lockCount=()=>assert.fail('V3 has no lockCount getter');f.contracts.token.lockInfo=()=>assert.fail('V3 has no lock tranches');
 const s=await f.reader(A);assert.equal(f.count('token.balanceOf'),1);assert.equal(s.wallet.unlocked,s.wallet.ftiBalance);assert.deepEqual(s.wallet.locks,[]);assert.equal(s.wallet.lockCount,0);
});

test('concurrent visitors share public reads while wallet data stays separate under one six-read limit',async()=>{
 const f=fixture(),[a,b,pub]=await Promise.all([f.reader(A),f.reader(B),f.reader()]);
 assert.equal(f.count('token.price'),1);assert.equal(f.calls.filter(c=>c.name==='block'&&c.args[0]==='latest').length,1);assert.equal(f.count('token.balanceOf'),2);
 assert.equal(a.wallet.usdBalance,41n*UNIT);assert.equal(b.wallet.usdBalance,77n*UNIT);assert.equal(a.wallet.units,1n);assert.equal(b.wallet.units,2n);assert.equal('wallet' in pub,false);
 assert.ok(f.state.peak<=6);assert.equal(f.state.peak,6);
});

test('only public values are cached for five seconds and callers cannot mutate shared accounting arrays',async()=>{
 const f=fixture(),first=await f.reader(A);assert.throws(()=>{first.account1[0]=0n;});first.price=99n;
 f.state.now+=1000;const second=await f.reader(A);assert.equal(second.price,UNIT/10n);assert.equal(f.count('token.price'),1);assert.equal(f.count('token.balanceOf'),2);
 f.state.now+=4001;f.state.head={number:501,timestamp:2005,hash:'0x'+'b'.repeat(64)};
 const third=await f.reader();assert.equal(third.block,501);assert.equal(f.count('token.price'),2);
});

test('required getter failures are safe 503 errors, stop queued work and use a bounded failure backoff',async()=>{
 const f=fixture();let fail=true;f.state.hook=async name=>{if(name==='token.price'&&fail)throw Error('private https://secret.invalid/key');};
 await assert.rejects(f.reader(),error=>error instanceof StateReadError&&error.status===503&&error.code==='FTI_STATE_UNAVAILABLE'&&error.field==='price'&&!error.message.includes('secret'));
 await tick();const reads=f.calls.length;assert.ok(reads<25);
 await assert.rejects(f.reader(),/Required state read failed/);assert.equal(f.calls.length,reads);
 fail=false;f.state.now+=2001;assert.equal((await f.reader()).price,UNIT/10n);assert.equal(f.count('token.price'),2);
});

test('a failed wallet getter invalidates the public anchor instead of reusing partial or old data',async()=>{
 const f=fixture();await f.reader();f.state.hook=async name=>{if(name==='binary.pendingAuto')throw Error('missing trie node');};
 await assert.rejects(f.reader(A),error=>error.field==='autoPending');
 const before=f.calls.filter(c=>c.name==='block'&&c.args[0]==='latest').length;
 await f.reader();assert.equal(f.calls.filter(c=>c.name==='block'&&c.args[0]==='latest').length,before+1);
});

test('wallet canonical failure discards the cached anchor so the next request obtains a fresh head',async()=>{
 const f=fixture();await f.reader();f.state.canonicalHash='0x'+'b'.repeat(64);
 await assert.rejects(f.reader(A),error=>error.field==='block');
 f.state.canonicalHash=null;f.state.head={number:501,timestamp:2000,hash:'0x'+'c'.repeat(64)};
 assert.equal((await f.reader()).block,501);assert.equal(f.count('token.price'),2);
});

test('wrong networks, stale or malformed blocks and malformed required flags never return state',async()=>{
 for(const mode of ['network','old','future','timestamp','hash','flag']){
  const f=fixture();if(mode==='network')f.state.chain=97n;if(mode==='old')f.state.head.timestamp=1900;if(mode==='future')f.state.head.timestamp=2100;if(mode==='timestamp')f.state.head.timestamp=0;if(mode==='hash')f.state.head.hash='bad';
  if(mode==='flag')f.contracts.binary.paused=async()=>0n;
  await assert.rejects(f.reader(),error=>error instanceof StateReadError&&error.status===503,mode);
 }
});

test('freeze flags remain independent and cannot be replaced by false defaults',async()=>{
 const f=fixture();f.contracts.binary.recoveryFrozen=async()=>true;f.contracts.token.recoveryFrozen=async()=>true;
 const s=await f.reader();assert.equal(s.binaryRecoveryFrozen,true);assert.equal(s.tokenRecoveryFrozen,true);assert.equal(s.paused,true);assert.equal(s.tokenPaused,true);
});

test('legacy reserve locks retain their real getter and anchor/circulating-supply semantics',async()=>{
 const f=fixture({cfg:{tokenContract:'FTIReserveToken',binaryContract:'FundedBinaryPlan',liquidityVersion:1},publicConfig:{selectableHourlyAutoBuy:false,referralPlacementEnabled:false,poolDistributionVersion:null}});
 const s=await f.reader(A);assert.equal(s.totalSupply,1000n*UNIT);assert.equal(s.supply,950n*UNIT);assert.equal(s.anchorSupply,50n*UNIT);assert.equal(s.pricingModel,'real-reserve-v1');
 assert.equal(s.wallet.unlocked,8n*UNIT);assert.equal(s.wallet.lockCount,1n);assert.deepEqual(s.wallet.locks,[{amount:1n,clock:2n,deadline:3n}]);assert.equal(f.count('token.lockCount'),1);
});

test('a timeout returns within its budget and never restarts a public flight with unsettled native reads',async()=>{
 const f=fixture({reader:{timeoutMs:20}});let release,first=true;
 f.state.hook=async name=>{if(name==='token.price'&&first){first=false;await new Promise(resolve=>{release=resolve;});}};
 const started=Date.now();await assert.rejects(f.reader(),error=>error.field==='timeout');assert.ok(Date.now()-started<500);
 await new Promise(resolve=>setTimeout(resolve,5));const reads=f.calls.length;f.state.now+=3000;
 await assert.rejects(f.reader(),error=>error.field==='timeout');assert.equal(f.calls.length,reads);
 release();await tick();await tick();assert.equal((await f.reader()).price,UNIT/10n);
});

test('the shared scheduler paces actual read starts instead of releasing a burst of parallel calls',async()=>{
 const f=fixture({reader:{now:Date.now,minIntervalMs:15}});f.state.head.timestamp=Math.floor(Date.now()/1000);
 await f.reader();const times=f.calls.map(call=>call.at);
 for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]>=13,'paced start '+i);
 assert.ok(times.at(-1)-times[0]>500);assert.ok(f.state.peak<=6);
});

test('invalid wallet input fails before RPC reads and only explicit local mode permits fixture time travel',async()=>{
 const f=fixture();await assert.rejects(f.reader('invalid'),error=>error.status===400);assert.equal(f.calls.length,0);
 const local=fixture({cfg:{mode:'local'}});local.state.head.timestamp=100;assert.equal((await local.reader()).timestamp,100);
});

test('a chain change after wallet reads fails the final identity check and invalidates its anchor',async()=>{
 const f=fixture();await f.reader();let changed=false;
 f.state.hook=async name=>{if(name==='binary.autoBuyPercent'&&!changed){changed=true;f.state.chain=97n;}};
 await assert.rejects(f.reader(A),error=>error.field==='network');
 f.state.chain=56n;f.state.hook=async()=>{};f.state.head={number:501,timestamp:2000,hash:'0x'+'b'.repeat(64)};
 assert.equal((await f.reader()).block,501);assert.equal(f.count('token.price'),2);
});

test('malformed required wallet fields fail without inventing membership or balance defaults',async()=>{
 for(const [name,value,field]of [
  ['members',{parent:ZERO,left:ZERO,right:ZERO,units:1n,carryL:0n,carryR:0n,lifetimeL:0n,lifetimeR:0n,rank:0n,exists:true,maxAutoPrice:0n},'wallet.autoEnabled'],
  ['pendingAuto',-1n,'wallet.autoPending']
 ]){
  const f=fixture();f.contracts.binary[name]=async()=>value;
  await assert.rejects(f.reader(A),error=>error instanceof StateReadError&&error.field===field);
  assert.equal(f.count('token.balanceOf'),1);
 }
});

test('timed-out wallet reads retain native slots, cancel queued work and do not block another wallet indefinitely',async()=>{
 const f=fixture({reader:{timeoutMs:80,concurrency:1}});await f.reader();let release,entered;
 const started=new Promise(resolve=>{entered=resolve;});
 f.state.hook=async(name,args)=>{if(name==='usd.balanceOf'&&args[0]===A){entered();await new Promise(resolve=>{release=resolve;});}};
 const pending=f.reader(A);await started;
 await assert.rejects(pending,error=>error.field==='timeout');const stoppedAt=f.calls.length;
 await tick();assert.equal(f.calls.length,stoppedAt);
 release();await tick();await tick();
 const b=await f.reader(B);assert.equal(b.wallet.address,B);assert.equal(b.wallet.usdBalance,77n*UNIT);assert.equal(f.state.peak,1);
 assert.equal(f.calls.filter(c=>c.name==='token.balanceOf'&&c.args[0]===A).length,0);
});
