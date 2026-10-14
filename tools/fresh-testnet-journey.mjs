// Run outside the frozen service release; only the CLI can target public chain 97.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const source=process.env.FTI_JOURNEY_SOURCE||process.cwd();
const require=createRequire(path.join(source,'package.json'));
const {Wallet,JsonRpcProvider,FetchRequest,Contract,parseEther:E,parseUnits,formatEther:F,keccak256,ZeroAddress}=require('ethers');
const {verifyV3Deployment}=await import(pathToFileURL(path.join(source,'scripts/continuity-release.mjs')));
const {readPrivateKey}=await import(pathToFileURL(path.join(source,'scripts/address-migration-policy.mjs')));
const {auditHourlySettlement}=await import(pathToFileURL(path.join(source,'core/hourly-settlement-audit.mjs')));
export const REVISION='bc2163070a6e79bcc129a6a788e61c4ace402bdf';
export const TARGET={usd:'0xb0b8e7746A695423881981A2C3B53ec59330D483',token:'0x3561f120Ae89C363580Cb3Fb34B53F1265E603D2',binary:'0x40e727e15b65461D52e92907aa96E27017Ea70fE'};
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n';
const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
export function checkTarget(cfg){
 assert.equal(cfg.chainId,97,'Only BNB TESTNET 97');assert.equal(cfg.sourceRevision,REVISION,'Wrong source');
 assert.equal(cfg.deploymentKind,'fresh-testnet');
 for(const [k,a] of Object.entries(TARGET))assert(same(cfg[k],a),'Wrong '+k);
}
function save(file,value){
 const tmp=file+'.tmp';const fd=fs.openSync(tmp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,json(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);
}
export function reserveCost(j,{gasLimit,gasPrice,value=0n},limits){
 assert(gasPrice>0n&&gasPrice<=limits.price,'Gas price above approved ceiling');
 assert(gasLimit>0n&&gasLimit<=3000000n,'Transaction gas limit exceeded');
 assert(Object.keys(j.done).length<80,'Transaction count limit reached');
 const next=BigInt(j.reserved)+gasLimit*gasPrice+value;
 assert(next<=limits.budget,'Total test budget reached; retain journal');return next;
}
function parsed(receipt,contracts){
 const out=[];
 for(const l of receipt.logs)for(const [name,c] of Object.entries(contracts))if(same(l.address,c.target)){
  try{const e=c.interface.parseLog(l);if(e)out.push({contract:name,event:e.name,args:Array.from(e.args),index:l.index});}catch{}
 }
 return out;
}
// Injectable provider/clock is used by LOCAL EVM tests; CLI supplies no time-travel facility.
export async function runJourney({cfg,p,owner,dir,limits,tick=()=>new Promise(r=>setTimeout(r,5000)),log=console.log,verify=true,stop=()=>false}){
 assert([97,31337].includes(Number((await p.getNetwork()).chainId)),'Unsupported chain');
 assert.equal((await p.getNetwork()).chainId,BigInt(cfg.chainId));
 const contracts=verify?await verifyV3Deployment(cfg,p):Object.fromEntries(Object.entries({usd:'MockUSD',token:'FTIReserveTokenUpgradeable',binary:'FundedBinaryPlanUpgradeable'}).map(([k,n])=>[k,new Contract(cfg[k],JSON.parse(fs.readFileSync(path.join(source,'artifacts',n+'.json'))).abi,p)]));
 const {usd,token,binary}=contracts;
 assert.equal(await binary.poolDistributionVersion(),1n);assert.equal(await binary.hourlyCapFlushVersion(),1n);
 assert(!await binary.paused()&&!await token.paused()&&!await binary.recoveryFrozen()&&!await token.recoveryFrozen(),'Paused/frozen deployment');
 const evidenceTopics=['EpochClosed','RewardAllocated','Claimed','AutoExecuted'].map(n=>binary.interface.getEvent(n).topicHash);
 const historyHead=await p.getBlockNumber();
 try{await p.getLogs({address:binary.target,fromBlock:Math.max(0,historyHead-99),toBlock:historyHead,topics:[evidenceTopics]});}
 catch{assert.fail('History RPC unavailable before test funding; use a working testnet log endpoint');}
 fs.mkdirSync(dir,{recursive:true,mode:0o700});assert(!fs.lstatSync(dir).isSymbolicLink());assert.equal(fs.statSync(dir).mode&0o077,0,'Private state directory required');
 const file=path.join(dir,'journal.json'),reportFile=path.join(dir,'report.json');
 let j;
 if(fs.existsSync(file)){assert.equal(fs.lstatSync(file).mode&0o077,0);assert(!fs.lstatSync(file).isSymbolicLink());j=JSON.parse(fs.readFileSync(file));}
 else {assert.equal(await binary.phase(),0n,'Wait until Keeper completes current settlement, then start');j={schema:1,chainId:cfg.chainId,binary:cfg.binary,owner:owner.address,budget:String(limits.budget),price:String(limits.price),keys:Array.from({length:4},()=>Wallet.createRandom().privateKey),done:{},probes:{},reserved:'0',spent:'0',startBlock:await p.getBlockNumber(),startEpoch:String(await binary.epoch())};save(file,j);}
 assert.equal(j.schema,1);assert.equal(j.chainId,cfg.chainId);assert(same(j.binary,cfg.binary)&&same(j.owner,owner.address),'Journal target/funder mismatch');
 assert.equal(j.budget,String(limits.budget),'Keep original budget');assert.equal(j.price,String(limits.price),'Keep original gas ceiling');
 const users=j.keys.map(k=>new Wallet(k,p));assert.equal(users.length,4);
 const persist=()=>save(file,j);
 async function reconcile(){
  if(!j.pending)return;
  const q=j.pending;let r=await p.getTransactionReceipt(q.hash);
  if(!r){if(!await p.getTransaction(q.hash)){try{await p.broadcastTransaction(q.raw);}catch{throw Error('Broadcast unresolved; retain journal and resume');}}
   r=await p.getTransactionReceipt(q.hash)||await p.waitForTransaction(q.hash,1,120000);}
  assert(r,'Pending transaction; resume later');
  assert.equal((await p.getBlock(r.blockNumber)).hash,r.blockHash,'Receipt block changed');
  j.spent=String(BigInt(j.spent)+r.gasUsed*r.gasPrice);
  const row={hash:q.hash,label:q.label,block:r.blockNumber,blockHash:r.blockHash,status:r.status,gasUsed:r.gasUsed,gasPrice:r.gasPrice,events:parsed(r,{usd,token,binary}),meta:q.meta};
  j.done[q.label]=row;delete j.pending;persist();assert.equal(r.status,1,'Reverted test transaction: '+q.label);log('PASS',q.label,q.hash);
 }
 async function send(w,request,label,meta={}){
  assert(!stop(),'Interrupted; resume from retained journal');await reconcile();
  if(j.done[label]){assert.equal(j.done[label].status,1,'Previous revert: '+label);return j.done[label];}
  const gasLimit=(await w.estimateGas(request))*125n/100n;
  const gasPrice=(await p.getFeeData()).gasPrice;assert(gasPrice,'No gas price');
  assert(gasPrice>=((await p.getBlock('latest')).baseFeePerGas||0n),'RPC gas price below current base fee; retry later');
  const value=BigInt(request.value||0),reserved=reserveCost(j,{gasLimit,gasPrice,value},limits);
  assert(await p.getBalance(w.address)>=value+gasLimit*gasPrice,'Insufficient test gas for '+w.address);
  const raw=await w.signTransaction({...request,chainId:cfg.chainId,nonce:await p.getTransactionCount(w.address,'pending'),type:0,gasLimit,gasPrice});
  j.reserved=String(reserved);j.pending={label,raw,hash:keccak256(raw),meta};persist();await reconcile();return j.done[label];
 }
 async function call(w,c,m,args,label,meta){return send(w,await c[m].populateTransaction(...args),label,meta);}
 async function until(check,message,timeout=7200000){const start=Date.now();let announced=false;while(!await check()){
  assert(!stop(),'Interrupted; journal retained');assert(Date.now()-start<timeout,message+' timed out; resume later');
  if(!announced){log('WAIT',message);announced=true;}await tick();
 }}
 async function open(){await until(async()=>await binary.phase()===0n&&await binary.jobCursor()===await binary.jobCount()&&BigInt((await p.getBlock('latest')).timestamp)<await binary.epochEnd(),'Keeper / open hourly epoch');}
 async function accounting(){
  const block=await p.getBlockNumber(),at={blockTag:block};
  for(const c of [binary,token]){const [actual,book]=await c.accounting(at);assert(actual>=book,'Underfunded contract');}
  const [a,b,c,d]=await binary.fundingAccounting(at);assert.equal(a,b);assert.equal(c,d);return block;
 }
 async function rejection(label,fn){
  if(j.probes[label])return;
  let rejected=false;try{await fn();}catch(e){if(e.code==='CALL_EXCEPTION'&&e.data&&e.data!=='0x')rejected=true;else throw Error('Unclassified RPC failure during '+label);}
  assert(rejected,'Forbidden action unexpectedly accepted: '+label);j.probes[label]='PASS';persist();log('PASS',label);
 }
 await reconcile();for(const row of Object.values(j.done))assert.equal(row.status,1,'Journal contains a reverted transaction');
 if(j.completed){const r=JSON.parse(fs.readFileSync(reportFile));assert.equal(r.result,'FTI_TESTNET_JOURNEY_PASS');log('ALREADY_COMPLETED',reportFile);return r;}
 await accounting();await open();
 if(!j.sponsor){for(let n=15;n<31;n++){const a=await binary.memberList(n);if((await binary.members(a)).right===ZeroAddress){j.sponsor=a;break;}}assert(j.sponsor,'No free bootstrap sponsor');persist();}
 log('TEST_WALLETS',users.map(w=>w.address).join(' '));
 for(let i=0;i<4;i++)await send(owner,{to:users[i].address,value:E('0.002')},'fund-'+i);
 const [a,b,c,d]=users;
 await rejection('nonmember-buy',()=>token.connect(a).buy.staticCall(E('1'),0,2n**64n-1n));
 await rejection('invalid-sponsor',()=>binary.connect(a).register.staticCall(ZeroAddress,1));
 for(let i=0;i<4;i++){
  const w=users[i];await call(w,usd,'faucet',[],'faucet-'+i);
  await call(w,usd,'approve',[binary.target,E(i===0?'200':i===1?'300':i===2?'200':'100')],'approve-plan-'+i);
  await open();
  const sponsor=i===0?j.sponsor:a.address;
  await call(w,binary,i===3?'registerWithPlacement':'register',i===3?[a.address,b.address,1]:[sponsor,i===1?3:i===2?2:1],'register-'+i);
  if(i===0){await open();await call(a,binary,'addUnits',[1],'repeat-membership');await open();await call(a,binary,'setAutoBuyPercent',[true,5],'auto-five-percent');}
 }
 const member=await binary.members(a.address);assert(same(member.left,b.address)&&same(member.right,c.address),'Binary placement differs');
 assert(same((await binary.members(d.address)).parent,b.address));assert(same(await binary.directReferrerOf(d.address),a.address));
 assert.equal(await binary.unitsOf(a.address),2n);
 await rejection('duplicate-registration',()=>binary.connect(a).register.staticCall(j.sponsor,1));
 await rejection('zero-units',()=>binary.connect(a).addUnits.staticCall(0));
 await rejection('invalid-auto-percent',()=>binary.connect(a).setAutoBuyPercent.staticCall(true,4));
 await rejection('unauthorized-pause',()=>binary.connect(a).pause.staticCall());
 await call(a,usd,'approve',[token.target,E('20')],'approve-token');
 await rejection('expired-buy',()=>token.connect(a).buy.staticCall(E('1'),0,1));
 await rejection('buy-slippage',()=>token.connect(a).buy.staticCall(E('1'),2n**255n,2n**64n-1n));
 await rejection('buy-cap',async()=>token.connect(a).buy.staticCall((await token.remainingAllowance(a.address))+1n,0,2n**64n-1n));
 const buy=await call(a,token,'buy',[E('10'),(await token.quoteBuy(E('10')))*99n/100n,(await p.getBlock('latest')).timestamp+1200],'token-buy');
 const bought=buy.events.find(e=>e.contract==='token'&&e.event==='Bought');assert(bought&&BigInt(bought.args[1])===E('10'));
 assert(buy.events.some(e=>e.contract==='usd'&&e.event==='Transfer'&&same(e.args[0],a.address)&&same(e.args[1],token.target)&&BigInt(e.args[2])===E('10')),'Purchase collateral transfer differs');
 const amount=BigInt(bought.args[2])/10n,[received,burned]=await token.quoteTransfer(amount);
 assert.equal(burned,(amount*300n+9999n)/10000n);
 const transfer=await call(a,token,'transfer',[b.address,amount],'token-transfer');
 const transfers=transfer.events.filter(e=>e.contract==='token'&&e.event==='Transfer');
 assert(transfers.some(e=>same(e.args[0],a.address)&&same(e.args[1],b.address)&&BigInt(e.args[2])===received));
 assert(transfers.some(e=>same(e.args[0],a.address)&&e.args[1]===ZeroAddress&&BigInt(e.args[2])===burned));
 const saleAmount=BigInt(bought.args[2])/10n;
 const sale=await call(a,token,'sell',[saleAmount,(await token.quoteSell(saleAmount))[0]*99n/100n,(await p.getBlock('latest')).timestamp+1200],'token-sell');
 const sold=sale.events.find(e=>e.contract==='token'&&e.event==='Sold');assert(sold&&BigInt(sold.args[2])>0n);
 assert(sale.events.some(e=>e.contract==='usd'&&e.event==='Transfer'&&same(e.args[0],token.target)&&same(e.args[1],a.address)&&BigInt(e.args[2])===BigInt(sold.args[2])),'Sale did not pay exact USD');
 await accounting();
 // Wait for the epoch containing the final membership transaction, even on resume.
 const last=await p.getBlock(j.done['register-3'].block);const boundary=(Math.floor(last.timestamp/3600)+1)*3600;
 await until(async()=>Number(await binary.lastClosedAt())>=boundary&&await binary.phase()===0n,'Real hourly close (no public-network time travel)');
 const afterClose=await binary.members(a.address);assert.equal(afterClose.carryL,2n,'Stronger-leg carry differs');assert.equal(afterClose.carryR,0n,'Smaller leg not consumed');
 // Disable only this new test wallet after allocation; prevent racing its auto-buy.
 await call(a,binary,'setAutoBuyPercent',[false,5],'auto-disable-after-close');
 const auto=await binary.pendingAuto(a.address);
 if(!j.autoHandled){
  // Any successful Keeper execution is also accepted and verified from logs below.
  if(j.autoBeforeRelease===undefined){j.autoBeforeRelease=String(auto);persist();}
  if(auto>0n)await call(a,binary,'releaseAutoToCash',[],'auto-release-to-cash');
  j.autoHandled=true;persist();
 }
 await until(async()=>await binary.pendingReward(a.address)===0n&&await binary.pendingAuto(a.address)===0n,'Keeper cash payout');
 // A repeat cannot manufacture a second withdrawal. eth_call does not spend gas.
 await rejection('duplicate-claim',()=>binary.connect(a).claim.staticCall());
 const end=await accounting(),logs=[];
 for(let from=j.startBlock;from<=end;from+=100){
  const rows=await p.getLogs({address:binary.target,fromBlock:from,toBlock:Math.min(end,from+99),topics:[evidenceTopics]});
  for(const l of rows){const e=binary.interface.parseLog(l);logs.push({event:e.name,args:Array.from(e.args),hash:l.transactionHash,block:l.blockNumber});}
 }
 const closures=[];
 for(const row of logs.filter(e=>e.event==='EpochClosed'&&BigInt(e.args[0])>=BigInt(j.startEpoch))){
  const [epoch,pool,points,pointValue]=row.args;
  const allocations=await Promise.all(logs.filter(e=>e.event==='RewardAllocated'&&e.args[0]===epoch).map(async e=>({wallet:e.args[1],cash:BigInt(e.args[2]),automatic:BigInt(e.args[3]),points:await binary.paidPoints(epoch,e.args[1],{blockTag:end})})));
  closures.push({epoch,pool,points,pointValue,hash:row.hash,...auditHourlySettlement({pool,points,pointValue,allocations,pooled:true})});
 }
 const mine=logs.filter(e=>e.event==='RewardAllocated'&&same(e.args[1],a.address));
 const gross=mine.reduce((s,e)=>s+e.args[2]+e.args[3],0n);assert(gross>0n,'No actual binary reward observed');
 const executed=logs.filter(e=>e.event==='AutoExecuted'&&same(e.args[0],a.address)).reduce((s,e)=>s+e.args[1],0n);
 const claims=logs.filter(e=>e.event==='Claimed'&&same(e.args[0],a.address));
 const paid=claims.reduce((s,e)=>s+e.args[1],0n);assert.equal(paid+executed,gross,'Cash/auto totals differ from exact hourly allocation');
 for(const claim of claims){
  const receipt=await p.getTransactionReceipt(claim.hash);assert.equal(receipt.status,1);
  assert.equal((await p.getBlock(receipt.blockNumber)).hash,receipt.blockHash);
  assert(parsed(receipt,{usd}).some(e=>e.event==='Transfer'&&same(e.args[0],binary.target)&&same(e.args[1],a.address)&&BigInt(e.args[2])===claim.args[1]),'Missing cash transfer in payout receipt');
 }
 const report={result:'FTI_TESTNET_JOURNEY_PASS',scope:cfg.chainId===97?'PUBLIC_TESTNET_REAL_TRANSACTIONS':'LOCAL_EVM_ONLY',chainId:cfg.chainId,sourceRevision:cfg.sourceRevision,contracts:{usd:cfg.usd,token:cfg.token,binary:cfg.binary},wallets:users.map(w=>w.address),endBlock:end,
  checks:{registrations:4,repeatMembership:true,referralAndPlacement:true,strongerLegCarry:true,tokenBuy:true,tokenSellPaidUSD:true,transferBurn3Percent:true,binaryCashPaid:true,duplicateClaimRejected:true,accounting:true},
  binary:{gross:String(gross),cashPaid:String(paid),automaticExecuted:String(executed),automaticReleasedToCash:j.autoBeforeRelease},hourlyClosures:closures,probes:j.probes,
  budget:{maximumTBNB:F(limits.budget),reservedIncludingWalletFundingTBNB:F(j.reserved),actualRunnerGasTBNB:F(j.spent),existingKeeperGasExcluded:true},transactions:Object.values(j.done),payoutTransactions:claims.map(e=>e.hash),
  limitations:['Public monthly rank payout and governance changes are not executed; their time/authority rules remain in force.','Ranked automatic purchase is covered locally; this small public journey checks preferences and reports any actual automatic execution separately.','Wallet/browser signing UI is not covered by this RPC journey.','Only this test wallet auto preference is changed. Remaining test balances stay in the private test wallets.']};
 save(reportFile,report);j.completed=true;persist();log('FTI_TESTNET_JOURNEY_PASS',reportFile);return report;
}

async function main(){
 const cfg=JSON.parse(fs.readFileSync(process.env.FTI_JOURNEY_DEPLOYMENT));checkTarget(cfg);
 const request=new FetchRequest(process.env.FTI_JOURNEY_RPC);assert(new URL(request.url).protocol==='https:','HTTPS RPC required');request.timeout=30000;
 const p=new JsonRpcProvider(request,undefined,{batchMaxCount:1,cacheTimeout:-1});p.pollingInterval=2500;
 let interrupted=false;for(const s of ['SIGTERM','SIGINT','SIGHUP'])process.on(s,()=>{interrupted=true;});
 try{
  const owner=new Wallet(readPrivateKey(process.env.FTI_JOURNEY_KEY_FILE),p);
  assert(same(owner.address,cfg.deployer),'Use the reviewed test deployer');
  assert(!same(owner.address,process.env.FTI_JOURNEY_KEEPER_ADDRESS),'Test funder must differ from active Keeper');
  const limits={budget:E(process.env.FTI_JOURNEY_BUDGET),price:parseUnits(process.env.FTI_JOURNEY_GAS_GWEI,9)};
  assert(limits.budget>0n&&limits.budget<=E('0.03')&&limits.price>0n&&limits.price<=parseUnits('1',9),'Invalid approved limits');
  await runJourney({cfg,p,owner,dir:process.env.FTI_JOURNEY_STATE,limits,stop:()=>interrupted});
 }finally{p.destroy();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname))main().catch(e=>{
 // RPC errors can embed authenticated URLs, payloads or signed raw transactions.
 console.error('FTI_JOURNEY_STOPPED',e.code==='ERR_ASSERTION'?e.message:'RPC/process failure; retain private state and resume.');process.exitCode=1;
});
