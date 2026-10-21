import {isAddress} from 'ethers';

const UINT256=(1n<<256n)-1n,HASH=/^0x[0-9a-f]{64}$/i;
export class StateReadError extends Error{
 constructor(field){super('Required state read failed.');this.name='StateReadError';this.code='FTI_STATE_UNAVAILABLE';this.field=field;this.status=503;}
}
const failure=field=>new StateReadError(field);
function uint(value,field){
 if(!(typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value)||typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)))throw failure(field);
 const result=BigInt(value);if(result<0n||result>UINT256)throw failure(field);return result;
}
function bool(value,field){if(typeof value!=='boolean')throw failure(field);return value;}
function address(value,field){if(typeof value!=='string'||!isAddress(value))throw failure(field);return value;}
function tuple(value,field){if(!value||value.length!==2)throw failure(field);return Object.freeze([uint(value[0],field),uint(value[1],field)]);}
function block(value){
 if(!value||!Number.isSafeInteger(value.number)||value.number<0||!Number.isSafeInteger(value.timestamp)||value.timestamp<=0||!HASH.test(value.hash||''))throw failure('block');
 return {number:value.number,timestamp:value.timestamp,hash:value.hash.toLowerCase()};
}

// One scheduler is shared by every visitor and wallet. A timed-out RPC retains
// its slot until the underlying request settles; cancelled queued work never runs.
export function createStateReader({provider,contracts,cfg,publicConfig={},concurrency=6,minIntervalMs=100,cacheMs=5000,backoffMs=2000,timeoutMs=20000,now=Date.now}){
 if(!Number.isSafeInteger(cfg?.chainId)||cfg.chainId<=0||!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>16||!Number.isSafeInteger(minIntervalMs)||minIntervalMs<0||minIntervalMs>1000||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000||!Number.isFinite(cacheMs)||cacheMs<0||cacheMs>5000||!Number.isFinite(backoffMs)||backoffMs<0||backoffMs>2000||typeof now!=='function')throw Error('Invalid state reader configuration.');
 const tokenName=cfg.tokenContract||'FTIToken',binaryName=cfg.binaryContract||'BinaryPlan';
 const v3=['FTIReserveTokenV3','FTIReserveTokenUpgradeable'].includes(tokenName),reserveModel=tokenName==='FTIReserveToken';
 const funded=['FundedBinaryPlan','FundedBinaryPlanUpgradeable'].includes(binaryName),upgradeable=tokenName==='FTIReserveTokenUpgradeable';
 const {binary:b,token:t,usd}=contracts;
 let active=0,queue=[],paceTimer,nextStart=0,publicCache,publicFlight,publicFailure;
 function cancelQueued(ctx){const keep=[];for(const item of queue)if(item.ctx===ctx)item.reject(ctx.error);else keep.push(item);queue=keep;if(!queue.length&&paceTimer){clearTimeout(paceTimer);paceTimer=null;}}
 function context(){
  const ctx={error:null,pending:0,waiters:[]};
  ctx.fail=error=>{if(!ctx.error){ctx.error=error instanceof StateReadError?error:failure('state');cancelQueued(ctx);}return ctx.error;};
  ctx.drain=()=>ctx.pending?new Promise(resolve=>ctx.waiters.push(resolve)):Promise.resolve();
  return ctx;
 }
 function pump(){
  if(paceTimer||active>=concurrency||!queue.length)return;
  const wait=Math.max(0,nextStart-now());
  if(wait){paceTimer=setTimeout(()=>{paceTimer=null;pump();},wait);return;}
  const item=queue.shift(),{ctx}=item;if(ctx.error){item.reject(ctx.error);pump();return;}
  active++;ctx.pending++;nextStart=now()+minIntervalMs;
  Promise.resolve().then(()=>{if(ctx.error)throw ctx.error;return item.read();}).then(value=>{
   if(ctx.error)item.reject(ctx.error);else item.resolve(value);
  },()=>item.reject(ctx.fail(failure(item.field)))).finally(()=>{
   active--;ctx.pending--;if(!ctx.pending)for(const resolve of ctx.waiters.splice(0))resolve();pump();
  });
  pump();
 }
 function read(ctx,field,fn){if(ctx.error)return Promise.reject(ctx.error);return new Promise((resolve,reject)=>{queue.push({ctx,field,read:fn,resolve,reject});pump();});}
 function bounded(ctx,fn){
  let timer;const work=Promise.resolve().then(fn).catch(error=>{throw ctx.fail(error);});
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(ctx.fail(failure('timeout'))),timeoutMs);});
  return Promise.race([work,timeout]).finally(()=>clearTimeout(timer));
 }
 function fresh(anchor){if(cfg.mode!=='local'&&(now()/1000-anchor.timestamp>45||anchor.timestamp>now()/1000+15))throw failure('block.timestamp');}
 async function network(ctx){const actual=await read(ctx,'network',()=>provider.getNetwork());if(uint(actual?.chainId,'network')!==BigInt(cfg.chainId))throw failure('network');}
 async function canonical(ctx,anchor){
  const [current]=await Promise.all([read(ctx,'block',()=>provider.getBlock(anchor.number)),network(ctx)]);
  const checked=block(current);if(checked.number!==anchor.number||checked.hash!==anchor.hash||checked.timestamp!==anchor.timestamp)throw failure('block');fresh(checked);
 }
 async function values(ctx,anchor,specs){
  return Object.fromEntries(await Promise.all(specs.map(async([field,contract,method,args=[]])=>[field,await read(ctx,field,()=>contract[method](...args,{blockTag:anchor.number}))])));
 }
 async function buildPublic(ctx){
  await network(ctx);const anchor=block(await read(ctx,'block',()=>provider.getBlock('latest')));fresh(anchor);
  const specs=[['price',t,'price'],['supply',t,'totalSupply'],['reserve',t,'reserve'],['bb',t,v3?'supportReserve':'buybackFund'],['ath',t,'ath'],['count',b,'memberCount'],['epoch',b,'epoch'],['epochEnd',b,'epochEnd'],['phase',b,'phase'],['level',b,'protectionLevel'],['pointPool',b,'pointPool'],['pending',b,'totalPending'],['auto',b,'totalAuto'],['jobCursor',b,'jobCursor'],['jobCount',b,'jobCount'],['cursor',b,'cursor'],['monthPhase',b,'monthPhase'],['nextMonth',b,'nextBuilderMonth'],['paused',b,'paused'],['tokenPaused',t,'paused'],['account1',b,'accounting'],['account2',t,'accounting']];
  if(!v3)specs.push(['floor',t,'floorFund'],['clock',t,'walletClock']);
  if(v3)specs.push(['emergencyUnwind',t,'emergencyUnwind'],['builderMultiplier',t,'builderMultiplier'],['cycle',t,'cycle'],['cycleStartPrice',t,'cycleStartPrice'],['development',t,'development']);
  if(upgradeable)specs.push(['binaryRecoveryFrozen',b,'recoveryFrozen'],['tokenRecoveryFrozen',t,'recoveryFrozen'],['calculatedPointValue',b,'calculatedPointValue'],['candidatePoints',b,'candidatePoints'],['pointValue',b,'pointValue'],['totalPaidPoints',b,'totalPaidPoints']);
  if(cfg.batchedRewards)specs.push(['rewardQueue',b,'rewardAccountCount']);
  if(reserveModel)specs.push(['anchorSupply',t,'anchorSupply'],['circulatingSupply',t,'circulatingSupply']);
  if(funded)specs.push(['pointRetained',b,'retainedPointReserve'],['builderRetained',b,'retainedBuilderReserve'],['pointAssigned',b,'assignedPointCredit'],['dirtyMembers',b,'dirtyCount']);
  const raw=await values(ctx,anchor,specs),data={};
  for(const [key,value]of Object.entries(raw))data[key]=['paused','tokenPaused','emergencyUnwind','binaryRecoveryFrozen','tokenRecoveryFrozen'].includes(key)?bool(value,key):key==='development'?address(value,key):key==='account1'||key==='account2'?tuple(value,key):uint(value,key);
  if(v3){data.floor=0n;data.clock=0n;data.pricingModel='zero-start-reserve-v3';}
  if(upgradeable){data.paused=data.paused||data.binaryRecoveryFrozen;data.tokenPaused=data.tokenPaused||data.tokenRecoveryFrozen;}
  if(reserveModel){data.totalSupply=data.supply;data.supply=data.circulatingSupply;delete data.circulatingSupply;data.pricingModel='real-reserve-v1';}
  if(funded)data.rewardModel=publicConfig.poolDistributionVersion===1?'hourly-global-pool-v2':v3?'attributed-credit-target-v2':'attributed-credit-v1';
  await canonical(ctx,anchor);
  return {anchor,data:Object.freeze({...data,block:anchor.number,blockHash:anchor.hash,timestamp:anchor.timestamp})};
 }
 function sharedPublic(){
  if(publicFlight)return publicFlight.result;
  if(publicFailure&&now()<publicFailure.until)return Promise.reject(publicFailure.error);
  if(publicCache&&now()<publicCache.until)return Promise.resolve(publicCache.snapshot);
  const ctx=context(),flight={ctx};publicFlight=flight;
  flight.result=bounded(ctx,()=>buildPublic(ctx));
  const clean=()=>{void ctx.drain().then(()=>{if(publicFlight===flight)publicFlight=null;});};
  flight.result.then(snapshot=>{publicCache={snapshot,until:now()+cacheMs};publicFailure=null;clean();},error=>{publicCache=null;publicFailure={error,until:now()+backoffMs};clean();});
  return flight.result;
 }
 async function wallet(ctx,anchor,who){
  const specs=[['member',b,'members',[who]],['usdBalance',usd,'balanceOf',[who]],['ftiBalance',t,'balanceOf',[who]],['remaining',t,'remainingAllowance',[who]],['claimable',b,'pendingReward',[who]],['autoPending',b,'pendingAuto',[who]]];
  if(!v3){specs.push(['unlocked',t,cfg.liquidityVersion===1?'available':'unlocked',[who]],['locks',t,'lockInfo',[who]]);if(cfg.lockVersion===2)specs.push(['lockCount',t,'lockCount',[who]]);}
  if(funded){specs.push(['depth',b,'depth',[who]],['creditL',b,'creditL',[who]],['creditR',b,'creditR',[who]]);if(publicConfig.referralPlacementEnabled)specs.push(['referrer',b,'directReferrerOf',[who]],['directReferrals',b,'directReferralCount',[who]]);}
  if(publicConfig.selectableHourlyAutoBuy)specs.push(['autoBuyPercent',b,'autoBuyPercent',[who]]);
  const raw=await values(ctx,anchor,specs),m=raw.member;if(!m||typeof m!=='object')throw failure('wallet.member');
  const result={address:who};
  for(const key of ['parent','left','right'])result[key]=address(m[key],'wallet.'+key);
  for(const key of ['units','carryL','carryR','lifetimeL','lifetimeR','rank','maxAutoPrice'])result[key]=uint(m[key],'wallet.'+key);
  result.exists=bool(m.exists,'wallet.exists');result.autoEnabled=bool(m.autoEnabled,'wallet.autoEnabled');
  for(const [key,value]of Object.entries(raw))if(!['member','locks'].includes(key))result[key]=key==='referrer'?address(value,'wallet.referrer'):uint(value,'wallet.'+key);
  if(v3){result.unlocked=result.ftiBalance;result.locks=[];result.lockCount=0;}
  else{
   if(!Array.isArray(raw.locks))throw failure('wallet.locks');
   result.locks=raw.locks.map(lock=>({amount:uint(lock.amount,'wallet.locks.amount'),clock:uint(lock.clock,'wallet.locks.clock'),deadline:uint(lock.deadline,'wallet.locks.deadline')}));
   if(cfg.lockVersion!==2)result.lockCount=result.locks.length;
  }
  return result;
 }
 return async function readState(who){
  if(who&&!isAddress(who)){const error=Error('Invalid wallet address.');error.code='FTI_INVALID_WALLET';error.status=400;throw error;}
  const ctx=context();let snapshot;
  try{return await bounded(ctx,async()=>{
   snapshot=await sharedPublic();
   let account;if(who){await network(ctx);account=await wallet(ctx,snapshot.anchor,who);}
   await canonical(ctx,snapshot.anchor);
   return {...snapshot.data,...(account?{wallet:account}:{})};
  });}catch(error){
   if(snapshot&&publicCache?.snapshot===snapshot)publicCache=null;
   throw error instanceof StateReadError?error:failure('state');
  }
 };
}
