#!/usr/bin/env node
'use strict';
/* FTI BNB Testnet 97: sell ALL remaining FTI owned by the 100 private test wallets.
 * No real assets, no external wallets. Dry-run 'prepare' by default.
 * Explicit digest + testnet signer required for --send. Respect contract protections.
 * Crash-safe journal with hash persisted before any broadcast; never auto-rebroadcast.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const SOURCE='/root/fti-fresh-testnet-runner/run-d0o29raa/candidates/fresh-DtCQihcY/source';
const DEP='/root/fti-fresh-testnet-runner/run-d0o29raa/deployment/deployment.json';
const BASE='/root/fti-fresh-100-testnet';
const OUTPUT='/root/fti-testnet-liquidation';
const GAS_LOCK='operation.lock';
const RPC_DEFAULT='https://bsc-testnet-dataseed.bnbchain.org';
const ADDR={
 token:'0x1C38Ab2c2F64e1bcE96Fc438Da374c4998E70411',
 binary:'0xc02b4e207ACcDc020Be0dec190FEA732716B383A',
 usd:'0x6CFf59257D178AB3954aA0189ad48B20090B8a11',
};
const WAD=10n**18n;
const MAX_GROSS_PER_TX=20000n*WAD;
const NATURAL_SMALL_EXEMPTION=500n*WAD;
const MAX_TX_GAS=6000000n;
const MAX_RECORDED_TX=1500;
function insist(cond,msg){if(!cond)throw Error(msg)}
function serialize(o){return JSON.stringify(o,(_,v)=>typeof v==='bigint'?v.toString():v)}
function canonical(o){return Array.isArray(o)?o.map(canonical):o&&typeof o==='object'?Object.fromEntries(Object.entries(o).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):o}
function sha(o){return crypto.createHash('sha256').update(serialize(canonical(o))).digest('hex')}
function decimal(v,d=18){v=BigInt(v);const k=10n**BigInt(d),frac=(v%k).toString().padStart(d,'0').replace(/0+$/,'');return (v/k).toString()+(frac?'.'+frac:'')}
function ethAmount(s,places=18){insist(/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s||''),'INVALID_DECIMAL');const [a,b='']=s.split('.');insist(b.length<=places,'DECIMAL_TOO_PRECISE');return BigInt(a)*10n**BigInt(places)+BigInt((b+'0'.repeat(places)).slice(0,places)||'0')}
function min(...xs){return xs.reduce((a,b)=>a<b?a:b)}
function argsParse(argv){const [command,...argvRest]=argv;insist(['help','prepare','status','sell'].includes(command),'EXPECTED_HELP_PREPARE_STATUS_SELL');const a={};for(let i=0;i<argvRest.length;i++){let key=argvRest[i];insist(key.startsWith('--')&&!Object.hasOwn(a,key),'INVALID_OR_DUPLICATE_FLAG '+key);if(key==='--send'){a[key]=true;continue}insist(argvRest[i+1]&&!argvRest[i+1].startsWith('--'),'MISSING_OPTION_VALUE '+key);a[key]=argvRest[++i]}const allowed=command==='prepare'?['--budget-test-bnb','--gas-ceiling-gwei']:command==='sell'?['--send','--confirm-plan','--funder-key-file','--max-steps']:[];insist(Object.keys(a).every(k=>allowed.includes(k)),'FLAG_NOT_ALLOWED_FOR_COMMAND');return {command,a}}
function privateJSON(p){const st=fs.lstatSync(p);insist(st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o077)===0,'INSECURE_PRIVATE_FILE '+path.basename(p));return JSON.parse(fs.readFileSync(p,'utf8'))}
function atomic(p,obj,create=false){let b=serialize(obj)+'\n',q=p+'.tmp-'+process.pid;let fd=fs.openSync(create?p:q,'wx',0o600);try{fs.writeSync(fd,b);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}if(!create)fs.renameSync(q,p)}
function signerKey(file){insist(file&&path.isAbsolute(file),'ABSOLUTE_TEST_KEY_FILE_REQUIRED');let st=fs.lstatSync(file);insist(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o077)===0&&st.size>=64&&st.size<=128,'TEST_KEY_FILE_REQUIRES_ROOT_0600');let key=fs.readFileSync(file,'utf8').trim();insist(/^(0x)?[0-9a-fA-F]{64}$/.test(key),'BAD_TEST_KEY');return key.startsWith('0x')?key:'0x'+key}
function withCwd(dir,fn){const original=process.cwd();return (async()=>{try{process.chdir(dir);return await fn()}finally{process.chdir(original)}})()}
function clampSale({held,supply,reserve,hourHeadroom}){
 if(!held||!supply||!reserve)return {amount:0n,reason:'NO_BALANCE_OR_LIQUIDITY'};
 if(held===supply)return {amount:held,reason:'FINAL_CYCLE_EXIT'};
 let wholeGross=held*reserve/supply;
 if(wholeGross<=NATURAL_SMALL_EXEMPTION)return {amount:held,reason:'NATURALLY_SMALL_WALLET'};
 // A >$500 holding never gets split into $500-exempt pieces to evade protections.
 const maxGross=min(MAX_GROSS_PER_TX,reserve*3n/100n,hourHeadroom*75n/100n);
 if(maxGross<=NATURAL_SMALL_EXEMPTION)return {amount:0n,reason:'NEXT_HOURLY_WINDOW_REQUIRED'};
 const desired=min(wholeGross,maxGross);
 let amount=desired*supply/reserve;
 if(amount>held)amount=held;
 return {amount,reason:amount===held?'FULL_SELL_PROTECTED':'PARTIAL_SELL_PROTECTED'};
}
function abi(key){const types={usd:'MockUSD',token:'FTIReserveTokenUpgradeable',binary:'FundedBinaryPlanUpgradeable'};return JSON.parse(fs.readFileSync(path.join(SOURCE,'artifacts',types[key]+'.json'),'utf8')).abi}
function loadVault(eth){
 const p=privateJSON(path.join(BASE,'plan.json'));
 const {digest,...body}=p;
 insist(p.schema==='FTI_PUBLIC_TESTNET_100_V1'&&p.chainId===97&&p.count===100&&sha(body)===digest,'100_WALLET_PLAN_INVALID');
 const keys=privateJSON(path.join(BASE,'wallets-PRIVATE.json'));
 insist(Array.isArray(keys)&&keys.length===100&&keys.every((x,i)=>eth.computeAddress(x.privateKey).toLowerCase()===x.address.toLowerCase()&&x.address.toLowerCase()===p.walletAddresses[i].toLowerCase()),'VAULT_KEYS_DO_NOT_MATCH_PUBLIC_PLAN');
 return {plan:p,keys};
}
async function init(){
 insist(process.getuid()===0&&os.hostname()==='vps-titan-5320','WRONG_SERVER_ROOT_REQUIRED');
 insist(fs.existsSync(SOURCE)&&fs.existsSync(DEP),'DEPLOYED_RELEASE_NOT_PRESENT');
 const cfg=JSON.parse(fs.readFileSync(DEP,'utf8'));
 insist(cfg.chainId===97&&cfg.deploymentKind==='fresh-testnet'&&cfg.sourceRevision==='81aae37e2ad3abcbe46d27ad48c8f89ba54610d5','WRONG_FRESH_TESTNET_RELEASE');
 for(const [k,v] of Object.entries(ADDR))insist(cfg[k].toLowerCase()===v.toLowerCase(),'WRONG_DEPLOYED_CONTRACT '+k);
 const eth=createRequire(path.join(SOURCE,'package.json'))('ethers');
 const endpoint=process.env.FTI_STRESS_RPC_URL||RPC_DEFAULT;
 let url=new URL(endpoint);insist(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash,'INVALID_TESTNET_RPC');
 const req=new eth.FetchRequest(endpoint);req.timeout=20000;
 const provider=new eth.JsonRpcProvider(req,undefined,{batchMaxCount:1,cacheTimeout:-1});provider.pollingInterval=3000;
 try{
  insist((await provider.getNetwork()).chainId===97n,'CHAIN_NOT_BNB_TESTNET_97');
  for(const k of ['token','binary','usd']){let code=await provider.getCode(cfg[k]);insist(code!=='0x'&&eth.keccak256(code).toLowerCase()===cfg.codeHashes[k].toLowerCase(),'DEPLOYED_CODE_HASH_MISMATCH_'+k)}
  const t=new eth.Contract(cfg.token,abi('token'),provider),b=new eth.Contract(cfg.binary,abi('binary'),provider),usd=new eth.Contract(cfg.usd,abi('usd'),provider);
  insist((await usd.symbol())==='tUSD'&&(await usd.decimals())===18n,'NOT_SYNTHETIC_TEST_USD');
  insist((await t.binary()).toLowerCase()===cfg.binary.toLowerCase()&&(await b.token()).toLowerCase()===cfg.token.toLowerCase(),'WRONG_CONTRACT_BINDINGS');
  insist(!(await t.paused())&&!(await b.paused())&&!(await t.recoveryFrozen())&&!(await b.recoveryFrozen())&&!(await t.emergencyUnwind()),'CONTRACT_PAUSED_FROZEN_OR_EMERGENCY');
  const {verifyV3Deployment}=await import(require('node:url').pathToFileURL(path.join(SOURCE,'scripts/continuity-release.mjs')).href);
  await withCwd(SOURCE,()=>verifyV3Deployment(cfg,provider));
  return {cfg,eth,provider,t,b,usd};
 }catch(e){provider.destroy();throw e}
}
function loadState(vault){let plan=privateJSON(path.join(OUTPUT,'plan.json')),journal=privateJSON(path.join(OUTPUT,'journal-PRIVATE.json'));
 const {digest,...body}=plan;
 insist(plan.schema==='FTI_TESTNET_100_LIQUIDATE_V1'&&sha(body)===digest&&journal.digest===digest&&plan.parentDigest===vault.plan.digest,'LIQUIDATION_PLAN_INVALID');
 insist(plan.walletAddresses.length===100&&plan.walletAddresses.every((x,i)=>x.toLowerCase()===vault.plan.walletAddresses[i].toLowerCase()),'LIQUIDATION_WALLET_SET_CHANGED');
 return {plan,journal};
}
function checkNoConcurrent(){for(const [p,label] of [[path.join(BASE,GAS_LOCK),'100_WALLET_RUN'],['/root/fti-large-trade-testnet/operation.lock','LARGE_TRADE_RUN'],[path.join(OUTPUT,GAS_LOCK),'LIQUIDATION_RUN']])insist(!fs.existsSync(p),'CONCURRENT_OR_STALE_LOCK_'+label)}
function makePlan(ctx,vault,a){insist(!fs.existsSync(OUTPUT),'LIQUIDATION_PLAN_ALREADY_EXISTS_USE_STATUS');checkNoConcurrent();
 const budget=ethAmount(a['--budget-test-bnb']||'0.12'),price=ethAmount(a['--gas-ceiling-gwei']||'1',9);
 insist(budget>=ethAmount('0.02')&&budget<=ethAmount('0.25'),'GAS_BUDGET_0_02_TO_0_25_TEST_BNB_ONLY');
 insist(price>0n&&price<=ethAmount('10',9),'GAS_CEILING_MAX_10_GWEI');
 const body={schema:'FTI_TESTNET_100_LIQUIDATE_V1',chainId:97,sourceRevision:ctx.cfg.sourceRevision,parentDigest:vault.plan.digest,
  token:ctx.cfg.token,binary:ctx.cfg.binary,usd:ctx.cfg.usd,publicTestnetOnly:true,confirmedAddressesOnly:true,
  funder:vault.plan.funder,walletAddresses:vault.plan.walletAddresses,budgetWei:budget.toString(),gasCeilingWei:price.toString(),
  purpose:'Sell entire remaining FTI holdings belonging to 100 locally generated test wallets ONLY. Native gas budget separately approved. No mainnet, no real USD. Do not evade sale protections.'};
 fs.mkdirSync(OUTPUT,{mode:0o700});const plan={...body,digest:sha(body)};
 atomic(path.join(OUTPUT,'plan.json'),plan,true);atomic(path.join(OUTPUT,'journal-PRIVATE.json'),{digest:plan.digest,pending:null,completed:{},reservedWei:'0',transactionCount:0,createdAt:new Date().toISOString()},true);
 console.log(serialize({result:'FTI_SELL_ALL_PLAN_READY_NO_TRANSACTIONS',digest:plan.digest,chainId:97,wallets:100,
  funder:plan.funder,testBNBBudget:decimal(budget),gasCeilingGwei:decimal(price,9),
  files:{plan:path.join(OUTPUT,'plan.json'),journal:path.join(OUTPUT,'journal-PRIVATE.json')},message:'Dry-run only; no sell signed or sent'}));
}
async function windowHeadroom(t,provider){
 const reserve=await t.reserve(),start=Number(await t.sellWindowStart());
 if(!start||(await provider.getBlock('latest')).timestamp>=start+3600)return reserve*20n/100n;
 const opening=await t.sellWindowOpeningReserve(),out=await t.sellWindowOutflow(),cap=opening*20n/100n;
 return cap>out?cap-out:0n;
}
class Runner{
 constructor(ctx,vault,state,funder){this.c=ctx;this.vault=vault;this.plan=state.plan;this.j=state.journal;this.funder=funder;
  this.wallets=vault.keys.map(x=>new ctx.eth.Wallet(x.privateKey,ctx.provider));this.jfile=path.join(OUTPUT,'journal-PRIVATE.json');}
 save(){atomic(this.jfile,this.j)}
 async recover(){
  const q=this.j.pending;if(!q)return;
  const receipt=await this.c.provider.getTransactionReceipt(q.hash);
  insist(receipt,'PENDING_UNKNOWN_HASH '+q.hash+'; DO_NOT_REBROADCAST_OR_DELETE_JOURNAL');
  insist(receipt.status===1,'REVERTED_TX '+q.hash+'; STOP_FOR_REVIEW');
  const result={hash:q.hash,block:receipt.blockNumber,gasUsed:String(receipt.gasUsed),gasPrice:String(receipt.gasPrice),walletIndex:q.walletIndex||null};
  if(q.kind==='sell'){
   const txEvent=receipt.logs.map(log=>{try{return this.c.t.interface.parseLog(log)}catch{return null}}).find(ev=>ev?.name==='Sold'&&ev.args.seller.toLowerCase()===this.wallets[q.walletIndex].address.toLowerCase());
   insist(txEvent,'SELL_EVENT_NOT_FOUND_'+q.hash);
   insist(txEvent.args.tokensIn===BigInt(q.amount)&&txEvent.args.usdOut>0n,'SELL_EVENT_AMOUNT_MISMATCH');
   result.tokensSold=txEvent.args.tokensIn.toString();result.usdReceived=txEvent.args.usdOut.toString();
  }
  this.j.completed[q.label]=result;this.j.pending=null;this.save();console.log('PASS '+q.label+' '+q.hash);
 }
 async tx(signer,request,label,kind='',amount='',walletIndex=-1){
  await this.recover();if(this.j.completed[label])return this.j.completed[label];
  insist(this.j.transactionCount<MAX_RECORDED_TX,'MAX_TRANSACTIONS_REACHED');
  insist((await this.c.provider.getNetwork()).chainId===97n,'WRONG_NETWORK_ON_SEND');
  const allowed=[this.c.cfg.token,...this.wallets.map(w=>w.address)];
  insist(allowed.some(s=>s.toLowerCase()===String(request.to).toLowerCase()),'UNAPPROVED_TX_RECEIVER');
  const gasPrice=(await this.c.provider.getFeeData()).gasPrice;
  insist(gasPrice!==null&&gasPrice>0n&&gasPrice<=BigInt(this.plan.gasCeilingWei),'TEST_GAS_PRICE_ABOVE_CEILING');
  let gasEst=await this.c.provider.estimateGas({...request,from:signer.address});let gas=gasEst*125n/100n+10000n;
  insist(gas<=MAX_TX_GAS,'SINGLE_TX_GAS_TOO_HIGH');
  const nonce=await this.c.provider.getTransactionCount(signer.address,'latest');
  insist(nonce===await this.c.provider.getTransactionCount(signer.address,'pending'),'SIGNER_HAS_PENDING_NONCE');
  const value=BigInt(request.value||0),cost=value+gas*gasPrice;
  insist(BigInt(this.j.reservedWei)+cost<=BigInt(this.plan.budgetWei),'STOP_TEST_BNB_BUDGET_EXHAUSTED');
  let bal=await this.c.provider.getBalance(signer.address);
  if(bal<cost&&signer.address.toLowerCase()!==this.funder.address.toLowerCase()){
   insist(walletIndex>=0&&walletIndex<100&&this.wallets[walletIndex].address.toLowerCase()===signer.address.toLowerCase(),'UNREVIEWED_GAS_BENEFICIARY');
   await this.fundIfNeeded(signer,walletIndex,cost);
   bal=await this.c.provider.getBalance(signer.address);
  }
  insist(bal>=cost,'TEST_GAS_BALANCE_LOW_'+signer.address);
  const raw=await signer.signTransaction({...request,chainId:97,type:0,nonce,gasLimit:gas,gasPrice});
  const hash=this.c.eth.keccak256(raw);
  this.j.reservedWei=(BigInt(this.j.reservedWei)+cost).toString();this.j.transactionCount++;
  this.j.pending={hash,raw,label,kind,amount:String(amount),walletIndex,from:signer.address};this.save();
  try{const r=await this.c.provider.broadcastTransaction(raw);insist(r.hash.toLowerCase()===hash.toLowerCase(),'BROADCAST_HASH_CHANGED')}
  catch(e){throw Error('SUBMISSION_UNCERTAIN '+hash+'; inspect explorer and private journal, never auto-repeat: '+String(e.code||'RPC_ERROR'))}
  const rec=await this.c.provider.waitForTransaction(hash,1,150000);
  insist(rec,'PENDING_CONFIRMATION '+hash+'; inspect explorer, do not blindly resend');
  await this.recover();return this.j.completed[label];
 }
 async fundIfNeeded(w,idx,minimum=ethAmount('0.0004')){
  insist(idx>=0&&idx<100&&this.wallets[idx].address.toLowerCase()===w.address.toLowerCase(),'UNAPPROVED_TOPUP_ADDRESS');
  const balance=await this.c.provider.getBalance(w.address);
  if(balance>=minimum)return;
  const amount=minimum-balance+ethAmount('0.0004');
  insist(amount>0n&&amount<=ethAmount('0.003'),'TEST_TOPUP_TOO_LARGE');
  const previous=Object.keys(this.j.completed).filter(x=>x.startsWith('gas-'+idx+'-')).length;
  return this.tx(this.funder,{to:w.address,value:amount},`gas-${idx}-${previous}`,'gas','',idx);
 }
 async attempt(idx){
  const w=this.wallets[idx],balance=await this.c.t.balanceOf(w.address);
  if(!balance)return {kind:'empty',idx};
  const supply=await this.c.t.totalSupply(),reserve=await this.c.t.reserve(),head=await windowHeadroom(this.c.t,this.c.provider);
  const proposed=clampSale({held:balance,supply,reserve,hourHeadroom:head});
  if(!proposed.amount)return {kind:'pending',idx,reason:proposed.reason};
  let amount=proposed.amount;let quote,gross;
  for(let attempts=0;attempts<20;attempts++){
   try{[quote,gross]=await this.c.t.quoteSell(amount)}
   catch(e){return {kind:'pending',idx,reason:'QUOTE_SELL_REJECTED_'+String(e.reason||e.shortMessage||e.code||'REVERT').slice(0,80)}}
   if(amount===supply || gross<=NATURAL_SMALL_EXEMPTION && balance===amount ||
      gross<=reserve*5n/100n && quote<=head)break;
   amount=amount*98n/100n;
   if(amount===0n)return {kind:'pending',idx,reason:'SAFE_SELL_LOT_TOO_SMALL'};
  }
  if(!(quote>0n&&gross>0n))return {kind:'pending',idx,reason:'ZERO_SELL_QUOTE'};
  if(gross<=NATURAL_SMALL_EXEMPTION&&balance!==amount)return {kind:'pending',idx,reason:'SMALL_ORDER_SPLIT_DISALLOWED'};
  if(amount!==supply && gross>NATURAL_SMALL_EXEMPTION && (gross>reserve*5n/100n||quote>head))return {kind:'pending',idx,reason:'SELL_WINDOW_PROTECTION'};
  const stamp=(await this.c.provider.getBlock('latest')).timestamp;
  try{await this.c.t.connect(w).sell.staticCall(amount,quote*99n/100n,stamp+1800)}
  catch(e){return {kind:'pending',idx,reason:'ONCHAIN_RESTRICTION_'+String(e.reason||e.shortMessage||e.code||'REVERT').slice(0,80)}}
  await this.fundIfNeeded(w,idx);
  const i=Object.keys(this.j.completed).filter(k=>k.startsWith('sell-'+idx+'-')).length;
  const label=`sell-${idx}-${i}`;
  const outcome=await this.tx(w,await this.c.t.sell.populateTransaction(amount,quote*99n/100n,stamp+1800),label,'sell',amount,idx);
  const [actual,book]=await this.c.t.accounting();insist(actual>=book,'TOKEN_RESERVE_DEFICIT_AFTER_SELL');
  console.log('SELL_WALLET='+idx+' FTI='+decimal(amount)+' TUSD_NET='+decimal(outcome.usdReceived));
  return {kind:'sold',idx,amount,net:BigInt(outcome.usdReceived),hash:outcome.hash};
 }
 async sell(maxSteps){
  await this.recover();insist(maxSteps>=1&&maxSteps<=100,'MAX_STEPS_1_TO_100');
  insist(Number.isSafeInteger(maxSteps),'MAX_STEPS_MUST_BE_INTEGER');
  const ordered=[...Array(99)].map((_,i)=>i+1).concat([0]);
  let sold=0,deferred=[];
  for(const idx of ordered){
   if(sold>=maxSteps)break;
   const result=await this.attempt(idx);
   if(result.kind==='sold')sold++;
   else if(result.kind==='pending')deferred.push({index:idx,reason:result.reason});
  }
  // Huge holdings can require repeated protected lots. Use remaining per-run cap.
  while(sold<maxSteps){
   const result=await this.attempt(0);
   if(result.kind!=='sold'){if(result.kind==='pending')deferred.push({index:0,reason:result.reason});break}
   sold++;
  }
  const after=await this.summary();
  console.log(serialize({result:after.walletsWithFTI===0?'FTI_100_TESTNET_ALL_CONTROLLED_FTI_SOLD':'FTI_100_TESTNET_LIQUIDATION_PARTIAL_OR_PENDING',soldTransactionsThisRun:sold,pending:deferred,remainingWallets:after.walletsWithFTI,remainingFTI:after.totalFTI,confirmedNetTUSD:after.confirmedNetTUSD,report:OUTPUT+'/report.json'}));
 }
 async summary(){
  const balances=[];
  for(let offset=0;offset<100;offset+=5){const batch=await Promise.all(this.wallets.slice(offset,offset+5).map(async w=>this.c.t.balanceOf(w.address)));balances.push(...batch)}
  const remaining=balances.reduce((a,b)=>a+b,0n),saleLogs=Object.values(this.j.completed).filter(q=>q.tokensSold),net=saleLogs.reduce((a,b)=>a+BigInt(b.usdReceived),0n);
  const report={result:'FTI_SELL_ALL_CURRENT_STATUS',chainId:97,testWalletCount:100,walletsWithFTI:balances.filter(b=>b>0n).length,
   totalFTI:decimal(remaining),confirmedSales:saleLogs.length,confirmedNetTUSD:decimal(net),
   reserveTUSD:decimal(await this.c.t.reserve()),nativeBudgetUpperBoundUsedTBNB:decimal(this.j.reservedWei),
   nativeBudgetCapTBNB:decimal(this.plan.budgetWei),
   pendingHash:this.j.pending?.hash||null,pendingTestWallets:balances.map((v,i)=>v>0n?i:-1).filter(i=>i>=0),
   updatedAt:new Date().toISOString(),caveat:'Only 100 controlled test wallets. Synthetic tUSD and chain97. Other wallet holdings are never touched; full exit is not guaranteed if liquidity/caps are insufficient.'};
  atomic(path.join(OUTPUT,'report.json'),report);return report;
 }
}
async function start(){
 const {command,a}=argsParse(process.argv.slice(2));
 if(command==='help'){console.log('FTI chain97 synthetic tUSD sell-all: prepare [--budget-test-bnb 0.12 --gas-ceiling-gwei 1]; status; sell --send --confirm-plan DIGEST --funder-key-file /root/private/key --max-steps 50. Never use mainnet.');return}
 const c=await init();
 try{
  const vault=loadVault(c.eth);
  if(command==='prepare'){makePlan(c,vault,a);return}
  const state=loadState(vault);
  if(command==='status'){
   // Read-only: no signing, no state changes except local report.
   const dummy={address:state.plan.funder};const runner=new Runner(c,vault,state,dummy);
   console.log(serialize(await runner.summary()));return;
  }
  insist(a['--send']===true&&a['--confirm-plan']===state.plan.digest,'EXPLICIT_SEND_AND_REVIEWED_DIGEST_REQUIRED');
  insist(a['--funder-key-file'],'TEST_FUNDER_KEY_FILE_REQUIRED');
  const signer=new c.eth.Wallet(signerKey(a['--funder-key-file']),c.provider);
  insist(signer.address.toLowerCase()===state.plan.funder.toLowerCase(),'WRONG_FUNDING_TEST_KEY');
  checkNoConcurrent();const lock=path.join(OUTPUT,GAS_LOCK);let fd=fs.openSync(lock,'wx',0o600);
  try{
   fs.writeSync(fd,String(process.pid));
   const r=new Runner(c,vault,state,signer);
   await r.sell(Number(a['--max-steps']||50));
  }finally{fs.closeSync(fd);fs.unlinkSync(lock)}
 }finally{c.provider.destroy()}
}
if(require.main===module)start().catch(e=>{let msg=String(e?.message||e).replace(/https?:\/\/\S+/g,'[RPC_REDACTED]').replace(/0x[0-9a-fA-F]{64}/g,'[HASH_REDACTED]');console.error('FTI_SELL_ALL_STOP '+msg.slice(0,420));process.exitCode=1});
module.exports={sha,decimal,ethAmount,min,clampSale,argsParse,ADDR,MAX_GROSS_PER_TX,NATURAL_SMALL_EXEMPTION};
