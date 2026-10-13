#!/usr/bin/env node
'use strict';
/* FTI freshly-deployed BNB TESTNET ONLY, 100 unique funded actors.
 * Built to run OUTSIDE the pinned contract source tree. The deployment fingerprint
 * must never be rehashed/rewritten for a load test. No mainnet, migration, or real USDT.
 * Stages: prepare (no tx), run (explicit digest, resumable tx), settle, status.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {createRequire} = require('node:module');
const {pathToFileURL} = require('node:url');
const assert = require('node:assert/strict');

const SOURCE='/root/fti-fresh-testnet-runner/run-d0o29raa/candidates/fresh-DtCQihcY/source';
const DEPLOYMENT='/root/fti-fresh-testnet-runner/run-d0o29raa/deployment/deployment.json';
const OUT='/root/fti-fresh-100-testnet';
const DEFAULT_RPC='https://bsc-testnet-dataseed.bnbchain.org';
const SOURCE_REV='81aae37e2ad3abcbe46d27ad48c8f89ba54610d5';
const KNOWN=Object.freeze({
 binary:'0xc02b4e207ACcDc020Be0dec190FEA732716B383A',
 token:'0x1C38Ab2c2F64e1bcE96Fc438Da374c4998E70411',
 usd:'0x6CFf59257D178AB3954aA0189ad48B20090B8a11',
});
const COUNT=100;
const WAD=10n**18n;
const UNIT=100n*WAD;
const TUSD_PER_WALLET=220n*WAD;
const BUY=10n*WAD;
const EXTRA_UNITS=10;
const MAX_TX=1600;
const MAX_SINGLE_GAS=7500000n;
const LOCK='operation.lock';

function fail(text){throw Error(text)}
function ensure(ok,message){if(!ok)fail(message)}
function safeStringify(value){return JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v)}
function canonical(value){return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;}
function digest(x){return crypto.createHash('sha256').update(safeStringify(canonical(x))).digest('hex');}
function amount(s,decimals){ensure(typeof s==='string'&&/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(s),'Positive decimal required');const [a,b='']=s.split('.');ensure(b.length<=decimals,'Too many decimal places');const n=BigInt(a)*10n**BigInt(decimals)+BigInt((b+'0'.repeat(decimals)).slice(0,decimals)||'0');ensure(n>0n,'Amount must be positive');return n;}
function decimal(n,decimals=18){n=BigInt(n);const base=10n**BigInt(decimals),q=n/base,r=(n%base).toString().padStart(decimals,'0').replace(/0+$/,'');return q.toString()+(r?'.'+r:'');}
function parseArgs(argv){const [command,...args]=argv;ensure(['prepare','run','settle','status','help'].includes(command),'Choose prepare, run, settle or status; see help');const opt={};for(let i=0;i<args.length;i++){const a=args[i];ensure(a.startsWith('--'),'Unexpected argument '+a);ensure(!Object.hasOwn(opt,a),'Repeated flag '+a);if(['--send'].includes(a)){opt[a]=true;continue;}ensure(i+1<args.length&&!args[i+1].startsWith('--'),'Missing value for '+a);opt[a]=args[++i];}return {command,opt};}
function validateRpc(endpoint){ensure(typeof endpoint==='string'&&endpoint.length<=2048&&!/[\x00-\x20]/.test(endpoint),'Invalid RPC');const x=new URL(endpoint);ensure(x.protocol==='https:'&&x.hostname&&!x.username&&!x.password&&!x.hash,'Use a HTTPS RPC without credentials in the URL');return endpoint;}
function requirePrivateKeyFile(file){ensure(file&&path.isAbsolute(file),'Absolute --funder-key-file required');const st=fs.lstatSync(file);ensure(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o077)===0&&st.size<=128&&st.size>=64,'Funder key file must be root-owned, private (0600) and regular');const raw=fs.readFileSync(file,'utf8').trim();ensure(/^(0x)?[a-fA-F0-9]{64}$/.test(raw),'Invalid testnet key file');return raw.startsWith('0x')?raw:'0x'+raw;}
function atomic(file,obj){const data=safeStringify(obj)+'\n';const temp=file+'.tmp-'+process.pid;const fd=fs.openSync(temp,'wx',0o600);try{fs.writeSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);}
function saveFileNew(file,obj){const fd=fs.openSync(file,'wx',0o600);try{fs.writeSync(fd,safeStringify(obj)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function readPrivateJSON(file){const st=fs.lstatSync(file);ensure(st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o077)===0,'Private regular state file required');return JSON.parse(fs.readFileSync(file,'utf8'));}
async function lockRun(fn){const file=path.join(OUT,LOCK);const fd=fs.openSync(file,'wx',0o600);try{fs.writeSync(fd,String(process.pid));return await fn();}finally{fs.closeSync(fd);fs.unlinkSync(file);}}
function contractAbi(source,key){const m={usd:'MockUSD',binary:'FundedBinaryPlanUpgradeable',token:'FTIReserveTokenUpgradeable'};return JSON.parse(fs.readFileSync(path.join(source,'artifacts',m[key]+'.json'))).abi;}
function loadEthers(source){return createRequire(path.join(source,'package.json'))('ethers');}
async function openProvider(eth,rpc){const req=new eth.FetchRequest(validateRpc(rpc));req.timeout=18000;const p=new eth.JsonRpcProvider(req,undefined,{cacheTimeout:-1,batchMaxCount:1});p.pollingInterval=2500;ensure((await p.getNetwork()).chainId===97n,'STOP: only BNB Testnet chainId=97');return p;}
async function context(opt){
 ensure(process.getuid()===0&&os.hostname()==='vps-titan-5320','Run as root on vps-titan-5320 only');
 const source=SOURCE,dep=DEPLOYMENT;
 ensure(fs.existsSync(source)&&fs.existsSync(dep),'Pinned FTI release or deployment missing');
 const cfg=JSON.parse(fs.readFileSync(dep,'utf8'));
 ensure(cfg.chainId===97&&cfg.deploymentKind==='fresh-testnet'&&cfg.sourceRevision===SOURCE_REV,'Not the reviewed fresh public testnet deployment');
 for(const [key,value] of Object.entries(KNOWN))ensure(cfg[key].toLowerCase()===value.toLowerCase(),'Wrong FTI fresh contract '+key);
 ensure(cfg.importedUsers===0&&cfg.importedFunds==='0','Unexpected migrated user/funds metadata');
 const eth=loadEthers(source),p=await openProvider(eth,opt['--rpc']||process.env.FTI_STRESS_RPC_URL||DEFAULT_RPC);
 try{
  for(const key of ['usd','binary','token']){const code=await p.getCode(cfg[key]);ensure(code!=='0x'&&eth.keccak256(code).toLowerCase()===cfg.codeHashes[key].toLowerCase(),'Code hash mismatch: '+key);}
  const usd=new eth.Contract(cfg.usd,contractAbi(source,'usd'),p);
  const binary=new eth.Contract(cfg.binary,contractAbi(source,'binary'),p);
  const token=new eth.Contract(cfg.token,contractAbi(source,'token'),p);
  ensure(await usd.symbol()==='tUSD'&&await usd.decimals()===18n,'Wrong stablecoin: TEST USD only');
  ensure((await token.binary()).toLowerCase()===cfg.binary.toLowerCase(),'Token/binary binding mismatch');
  ensure((await binary.token()).toLowerCase()===cfg.token.toLowerCase(),'Binary/token binding mismatch');
  ensure(!(await binary.paused())&&!(await token.paused())&&!(await binary.recoveryFrozen())&&!(await token.recoveryFrozen()),'Contract is paused/frozen; stop');
  const {verifyV3Deployment}=await import(pathToFileURL(path.join(source,'scripts/continuity-release.mjs')).href);
  await verifyV3Deployment(cfg,p);
  return {cfg,eth,p,usd,binary,token,source};
 }catch(e){p.destroy();throw e;}
}
function contextFiles(){ensure(fs.existsSync(OUT),'Run prepare first');return {planPath:path.join(OUT,'plan.json'),keysPath:path.join(OUT,'wallets-PRIVATE.json'),statePath:path.join(OUT,'journal-PRIVATE.json'),reportPath:path.join(OUT,'report.json')};}
function loadPrepared(eth){const files=contextFiles(),plan=readPrivateJSON(files.planPath),keys=readPrivateJSON(files.keysPath),j=readPrivateJSON(files.statePath);ensure(plan.schema==='FTI_PUBLIC_TESTNET_100_V1'&&plan.count===COUNT,'Wrong plan');const {digest:planDigest,...planBody}=plan;ensure(digest(planBody)===planDigest,'Plan digest mismatch');ensure(keys.length===COUNT&&keys.every((k,i)=>eth.computeAddress(k.privateKey).toLowerCase()===k.address.toLowerCase()),'Wallet/secret mismatch');ensure(j.planDigest===planDigest,'Journal/plan mismatch');return {...files,plan,keys,j};}
async function makePrepared(ctx,opt){
 const eth=ctx.eth;ensure(!fs.existsSync(OUT),'Private output exists. Refuse overwriting keys and old journal');
 const gasEach=amount(opt['--wallet-gas-tbnb']||'0.001',18);
 const budget=amount(opt['--max-total-tbnb']||'0.25',18);
 const price=amount(opt['--gas-price-ceiling-gwei']||'1',9);
 ensure(gasEach>=amount('0.0001',18)&&gasEach<=amount('0.005',18),'Wallet gas allocation 0.0001..0.005 tBNB');
 ensure(budget>=gasEach*100n&&budget<=amount('1',18),'Budget must cover initial 100 wallets and cannot exceed 1 tBNB');
 const currentGasPrice=(await ctx.p.getFeeData()).gasPrice;
 ensure(currentGasPrice!==null&&currentGasPrice>0n,'Public testnet gas price unavailable');
 ensure(price<=amount('10',9),'Max gas price ceiling 10 gwei');
 ensure(currentGasPrice<=price,'CURRENT_GAS_PRICE_ABOVE_REVIEWED_CEILING');
 const funder=opt['--funder-address'];ensure(eth.isAddress(funder)&&funder!==eth.ZeroAddress,'Public funder address required for prepare');
 ensure((await ctx.p.getBalance(funder))>=gasEach*100n,'TEST_FUNDER_BALANCE_TOO_LOW_FOR_100_WALLET_GAS');
 const sponsor=ctx.cfg.genesis[15];ensure(eth.isAddress(sponsor),'Genesis leaf 15 missing');
 const node=await ctx.binary.members(sponsor);ensure(node.exists&&node.left===eth.ZeroAddress&&node.right===eth.ZeroAddress,'Genesis leaf already occupied; manual review needed');
 ensure(await ctx.binary.memberCount()===31n,'Fresh contract no longer at initial 31 members. Stop, do not collide with real users.');
 ensure(await ctx.token.totalSupply()===0n,'Fresh token supply already nonzero; stop');
 const wallets=Array.from({length:COUNT},()=>eth.Wallet.createRandom());
 ensure(new Set(wallets.map(w=>w.address.toLowerCase())).size===COUNT,'Wallet collision');
 const keys=wallets.map(w=>({address:w.address,privateKey:w.privateKey}));
 const planBody={schema:'FTI_PUBLIC_TESTNET_100_V1',chainId:97,count:COUNT,sourceRevision:SOURCE_REV,
  binary:ctx.cfg.binary,token:ctx.cfg.token,usd:ctx.cfg.usd,
  genesisSponsor:sponsor,funder:eth.getAddress(funder),walletAddresses:keys.map(k=>k.address),
  walletGasWei:gasEach.toString(),maxTotalNativeWei:budget.toString(),maxGasPriceWei:price.toString(),
  mockUsdPerWallet:TUSD_PER_WALLET.toString(),unitUSD:UNIT.toString(),buyUSD:BUY.toString(),extraUnitWallets:EXTRA_UNITS,
  warning:'TEST ONLY: 100 new wallets. MockUSD is free synthetic test money. Signed transaction costs real testnet BNB, not mainnet BNB. Keys never upload. Time-locked earnings may remain PENDING.'};
 const plan={...planBody,digest:digest(planBody)};
 fs.mkdirSync(OUT,{mode:0o700});saveFileNew(path.join(OUT,'wallets-PRIVATE.json'),keys);saveFileNew(path.join(OUT,'plan.json'),plan);
 saveFileNew(path.join(OUT,'journal-PRIVATE.json'),{schema:'FTI_100_JOURNAL_V1',planDigest:plan.digest,completed:{},pending:null,upperNativeReserved:'0',nativeTransferred:'0',transactionCount:0,startedAt:null});
 console.log(safeStringify({result:'FTI_100_WALLETS_PREPARED_NO_TRANSACTIONS',chainId:97,wallets:100,sponsor,
  testUsdToDistribute:decimal(TUSD_PER_WALLET*100n),nativeGasPrefundTBNB:decimal(gasEach*100n),totalBudgetTBNB:decimal(budget),funderBalanceTBNB:decimal(await ctx.p.getBalance(funder)),
  digest:plan.digest,publicWalletAddressesFile:path.join(OUT,'plan.json'),privateKeysFile:path.join(OUT,'wallets-PRIVATE.json'),deployed:false}));
}

class Engine{
 constructor(ctx,data,funder){this.ctx=ctx;this.data=data;this.j=data.j;this.plan=data.plan;this.funder=funder;this.actors=data.keys.map(k=>new ctx.eth.Wallet(k.privateKey,ctx.p));}
 save(){atomic(this.data.statePath,this.j);}
 async recoverPending(){
  if(!this.j.pending)return;
  const pending=this.j.pending;const receipt=await this.ctx.p.getTransactionReceipt(pending.hash);
  if(!receipt){fail('UNRESOLVED_TX '+pending.label+' '+pending.hash+'; check explorer and nonce before retrying. Never auto-rebroadcast.');}
  ensure(receipt.status===1,'REVERTED_TX '+pending.label+' '+pending.hash);
  this.j.completed[pending.label]={hash:pending.hash,block:receipt.blockNumber,gasUsed:receipt.gasUsed.toString(),gasPrice:receipt.gasPrice.toString(),from:pending.from};
  this.j.pending=null;this.save();console.log('CONFIRMED_RECOVERY '+pending.label+' '+pending.hash);
 }
 async send(signer,contract,method,args,label){const req=await contract[method].populateTransaction(...args);return this.tx(signer,req,label);}
 async tx(signer,req,label){
  await this.recoverPending();if(this.j.completed[label])return null;
  ensure(this.j.transactionCount<MAX_TX,'MAXIMUM_TRANSACTION_COUNT_REACHED');
  const net=await this.ctx.p.getNetwork();ensure(net.chainId===97n,'WRONG_CHAIN_ON_SEND');
  const latest=await this.ctx.p.getTransactionCount(signer.address,'latest');
  const pendingNonce=await this.ctx.p.getTransactionCount(signer.address,'pending');
  ensure(latest===pendingNonce,'PENDING_NONCE: '+signer.address);
  const gasEst=await this.ctx.p.estimateGas({...req,from:signer.address});
  const gasLimit=gasEst*120n/100n+12000n;
  ensure(gasLimit<=MAX_SINGLE_GAS,'GAS_ESTIMATE_TOO_LARGE '+label);
  const gasPrice=(await this.ctx.p.getFeeData()).gasPrice;
  ensure(gasPrice!==null&&gasPrice>0n&&gasPrice<=BigInt(this.plan.maxGasPriceWei),'GAS_PRICE_ABOVE_REVIEWED_CEILING');
  const value=BigInt(req.value||0);
  const cost=value+gasLimit*gasPrice;
  ensure(BigInt(this.j.upperNativeReserved)+cost<=BigInt(this.plan.maxTotalNativeWei),'TOTAL_TEST_BNB_BUDGET_REACHED');
  if(signer.address.toLowerCase()!==this.funder.address.toLowerCase()&&(await this.ctx.p.getBalance(signer.address))<cost){
   const index=this.actors.findIndex(a=>a.address.toLowerCase()===signer.address.toLowerCase());
   ensure(index>=0,'UNREGISTERED_TEST_SIGNER');await this.fundGas(signer,index,cost);
  }
  ensure(await this.ctx.p.getBalance(signer.address)>=cost,'SIGNER_INSUFFICIENT_TBNB '+signer.address);
  const raw=await signer.signTransaction({...req,chainId:97,nonce:latest,type:0,gasLimit,gasPrice});
  const hash=this.ctx.eth.keccak256(raw);
  this.j.upperNativeReserved=(BigInt(this.j.upperNativeReserved)+cost).toString();
  this.j.nativeTransferred=(BigInt(this.j.nativeTransferred)+value).toString();
  this.j.transactionCount++;
  this.j.pending={label,hash,raw,from:signer.address,nonce:latest};this.save();
  try{const response=await this.ctx.p.broadcastTransaction(raw);ensure(response.hash.toLowerCase()===hash.toLowerCase(),'SIGNED_TX_HASH_CHANGED');
  }catch(e){fail('SUBMISSION_UNCERTAIN '+label+' '+hash+' (inspect journal; do not retry blindly): '+(e.code||'RPC_ERROR'));}
  const receipt=await this.ctx.p.waitForTransaction(hash,1,150000);
  if(!receipt)fail('RECEIPT_NOT_CONFIRMED '+label+' '+hash+'; rerun only after explorer inspection');
  await this.recoverPending();
  console.log('PASS '+label+' '+hash);return receipt;
 }
 async fundGas(actor,i,minimum=0n){
  let balance=await this.ctx.p.getBalance(actor.address);
  const target=BigInt(this.plan.walletGasWei);
  if(balance>=((minimum>target/3n)?minimum:target/3n))return;
  let n=0;while(this.j.completed['gas-'+i+'-'+n])n++;
  const wanted=minimum>=target?minimum+target/4n:target;
  const delta=wanted-balance;
  ensure(delta>0n&&delta<=target*4n,'INVALID_GAS_TOPUP');
  await this.tx(this.funder,{to:actor.address,value:delta},'gas-'+i+'-'+n);
  balance=await this.ctx.p.getBalance(actor.address);ensure(balance>=target/2n,'GAS_PREFUND_UNDERFUNDED '+i);
 }
 async actorSend(i,contract,method,args,label){const actor=this.actors[i];await this.fundGas(actor,i);return this.send(actor,contract,method,args,label);}
 async checkBooks(){
  for(const [name,c] of [['binary',this.ctx.binary],['token',this.ctx.token]]){
   const [balance,accounted]=await c.accounting();ensure(balance>=accounted,'COLLATERAL_DEFICIT '+name);
  }
  ensure(!(await this.ctx.binary.paused())&&!(await this.ctx.token.paused()),'CONTRACT_PAUSED');
 }
 async ensureEpochWritable(){
  const b=this.ctx.binary,block=await this.ctx.p.getBlock('latest');
  if(await b.phase()!==0n || BigInt(block.timestamp)>=await b.epochEnd()){
   await this.settleEpoch();
  }
  ensure((await b.phase())===0n&&BigInt((await this.ctx.p.getBlock('latest')).timestamp)<await b.epochEnd(),'EPOCH_NOT_READY_FOR_DEPOSIT');
 }
 async settleEpoch(){
  const b=this.ctx.binary;
  while((await b.phase())===0n && await b.jobCursor()<await b.jobCount()){
   const cursor=await b.jobCursor();await this.send(this.funder,b,'processVolume',[25],`volume-${cursor}`);
  }
  const now=BigInt((await this.ctx.p.getBlock('latest')).timestamp);
  if(await b.phase()===0n && now>=await b.epochEnd()){
   await this.send(this.funder,b,'beginEpochClose',[],`epoch-close-${await b.epoch()}`);
  }
  while(await b.phase()>0n){
   const e=await b.epoch(),cur=await b.cursor();
   await this.send(this.funder,b,'processEpoch',[25],`epoch-process-${e}-${cur}`);
  }
 }
 async distributeStable(){
  const {usd}=this.ctx;const required=TUSD_PER_WALLET*BigInt(COUNT);
  if(await usd.balanceOf(this.funder.address)<required && !this.j.completed.faucet){
   await this.send(this.funder,usd,'faucet',[],'faucet');
  }
  for(let i=0;i<COUNT;i++){
   const w=this.actors[i];if(this.j.completed['stable-'+i])continue;
   const amount=TUSD_PER_WALLET;
   await this.send(this.funder,usd,'transfer',[w.address,amount],`stable-${i}`);
  }
 }
 async registerAll(){
  const {usd,binary}=this.ctx;
  const sponsor=this.plan.genesisSponsor;
  for(let i=0;i<COUNT;i++){
   const w=this.actors[i];const expectedSponsor=i<2?sponsor:this.actors[Math.floor((i-2)/2)].address;
   if(await binary.registered(w.address)){
    const m=await binary.members(w.address);ensure(m.parent.toLowerCase()===expectedSponsor.toLowerCase()&&m.units>0n,'UNEXPECTED_EXISTING_MEMBER '+i);
   }else{
    await this.ensureEpochWritable();
    ensure((await binary.members(expectedSponsor)).right===this.ctx.eth.ZeroAddress,'SPONSOR_ALREADY_FULL '+i);
    if(await usd.allowance(w.address,this.ctx.cfg.binary)<2n*UNIT){await this.actorSend(i,usd,'approve',[this.ctx.cfg.binary,2n*UNIT],`approve-registration-${i}`);}
    await this.actorSend(i,binary,'register',[expectedSponsor,1],`register-${i}`);
   }
   ensure(await binary.registered(w.address),'REGISTRATION_MISSING '+i);
   if((i+1)%10===0)console.log('REGISTERED='+String(i+1)+'/'+COUNT);
  }
  for(let i=0;i<EXTRA_UNITS;i++){
   const w=this.actors[i],units=await binary.unitsOf(w.address);
   if(units===1n){await this.ensureEpochWritable();await this.actorSend(i,binary,'addUnits',[1],`additional-unit-${i}`);}
   ensure(await binary.unitsOf(w.address)===2n,'REPEAT_PURCHASE_FAILED '+i);
  }
 }
 async buyAll(){const {usd,token}=this.ctx;
  for(let i=0;i<COUNT;i++){
   const w=this.actors[i];if(this.j.completed['buy-'+i])continue;
   ensure(await token.remainingAllowance(w.address)>=BUY,'PURCHASE_LIMIT '+i);
   if(await usd.allowance(w.address,this.ctx.cfg.token)<BUY){await this.actorSend(i,usd,'approve',[this.ctx.cfg.token,BUY],`approve-buy-${i}`);}
   const quote=await token.quoteBuy(BUY),stamp=(await this.ctx.p.getBlock('latest')).timestamp;
   const before=await token.balanceOf(w.address);
   await this.actorSend(i,token,'buy',[BUY,quote*99n/100n,stamp+1800],`buy-${i}`);
   ensure(await token.balanceOf(w.address)>before,'BUY_NO_TOKENS '+i);
  }
 }
 async configureAuto(){const {binary}=this.ctx;
  for(let i=0;i<COUNT;i++){
   if(this.j.completed['auto-pref-'+i])continue;
   await this.ensureEpochWritable();
   const enabled=(i%4===0),percent=[5,37,100][i%3];
   await this.actorSend(i,binary,'setAutoBuyPercent',[enabled,percent],`auto-pref-${i}`);
   const m=await binary.members(this.actors[i].address);
   ensure(m.autoEnabled===enabled&&await binary.autoBuyPercent(this.actors[i].address)===BigInt(percent),'AUTO_PREF_MISMATCH '+i);
  }
 }
 async transferAll(){const {token}=this.ctx;
  for(let i=0;i<COUNT;i++){
   if(this.j.completed['transfer-'+i])continue;
   const from=this.actors[i],to=this.actors[(i+1)%COUNT];
   const amount=(await token.balanceOf(from.address))/12n;ensure(amount>1000000n,'TRANSFER_AMOUNT_TOO_SMALL '+i);
   const [received,burn]=await token.quoteTransfer(amount);
   const beforeFrom=await token.balanceOf(from.address),beforeTo=await token.balanceOf(to.address),beforeSupply=await token.totalSupply();
   await this.actorSend(i,token,'transfer',[to.address,amount],`transfer-${i}`);
   ensure(beforeFrom-await token.balanceOf(from.address)===amount,'TRANSFER_SENDER_DELTA '+i);
   ensure(await token.balanceOf(to.address)-beforeTo===received,'TRANSFER_RECEIVER_DELTA '+i);
   ensure(beforeSupply-await token.totalSupply()===burn,'TRANSFER_BURN_MISMATCH '+i);
  }
 }
 async sellAll(){const {token,usd}=this.ctx;
  for(let i=0;i<COUNT;i++){
   if(this.j.completed['sell-'+i])continue;
   const w=this.actors[i],balance=await token.balanceOf(w.address);
   const sellAmount=balance/9n;ensure(sellAmount>1000000n,'SELL_AMOUNT_TOO_SMALL '+i);
   const [quote,gross]=await token.quoteSell(sellAmount);
   ensure(quote>0n&&gross<=500n*WAD,'SELL_SIZE_EXCEEDS_SMALL_TRADE_EXEMPTION '+i);
   const beforeUSD=await usd.balanceOf(w.address),beforeToken=await token.balanceOf(w.address);
   const stamp=(await this.ctx.p.getBlock('latest')).timestamp;
   await this.actorSend(i,token,'sell',[sellAmount,quote*99n/100n,stamp+1800],`sell-${i}`);
   ensure(beforeToken-await token.balanceOf(w.address)===sellAmount,'SELL_BURN_MISMATCH '+i);
   ensure(await usd.balanceOf(w.address)>beforeUSD,'SELL_PAYOUT_MISSING '+i);
  }
 }
 async readOnlyAdversarial(){
  const {binary,token}=this.ctx,w=this.actors[0];let rejected=0;
  try{await binary.connect(w).register.staticCall(this.plan.genesisSponsor,1);}catch{rejected++;}
  try{await token.connect(w).sell.staticCall((await token.balanceOf(w.address))+1n,0n,2n**255n);}catch{rejected++;}
  try{await binary.connect(w).setAutoBuyPercent.staticCall(true,101);}catch{rejected++;}
  ensure(rejected===3,'NEGATIVE_SECURITY_GUARD_FAILED');
  return rejected;
 }
 async claimIfEligible(){
  let claims=0;const b=this.ctx.binary,usd=this.ctx.usd;
  for(let i=0;i<10;i++){
   const w=this.actors[i];const pending=await b.pendingReward(w.address);
   if(pending===0n)continue;
   const before=await usd.balanceOf(w.address);
   await this.actorSend(i,b,'claim',[],`claim-${i}-${await b.epoch()}`);
   ensure(await usd.balanceOf(w.address)-before===pending,'CLAIM_PAYOUT_MISMATCH '+i);
   claims++;
  }
  return claims;
 }
 async payQueued(){
  const b=this.ctx.binary;
  ensure((await b.phase())===0n&&(await b.monthPhase())===0n,'CANNOT_PAY_WHILE_SETTLING');
  let paid=0;
  for(let page=0;page<4;page++){
   const n=await b.rewardAccountCount();if(n===0n)break;
   const before=await b.totalPending();
   const receipt=await this.send(this.funder,b,'payRewards',[100],`pay-batch-${await b.epoch()}-${before}`);
   if(receipt){ensure(await b.totalPending()<before,'NO_PAYOUT_PROOF');paid++;}
   else {ensure(await b.totalPending()<before,'PREVIOUS_PAYOUT_UNCLEAR');}
  }
  ensure(await b.rewardAccountCount()===0n,'PAYMENT_QUEUE_NOT_DRAINED');
  return paid;
 }
 async report(extra={}){
  const c=this.ctx,j=this.j,addresses=this.actors.map(x=>x.address);
  const count=await c.binary.memberCount(),supply=await c.token.totalSupply(),pool=await c.binary.totalPending(),auto=await c.binary.totalAuto();
  const balances=await Promise.all([c.binary.accounting(),c.token.accounting()]);
  const report={schema:'FTI_PUBLIC_TESTNET_100_RESULTS_V1',chainId:97,createdWallets:addresses.length,registeredWallets:Number(count)-31,
   chainMemberCount:Number(count),tokenSupply:supply.toString(),binaryPending:pool.toString(),binaryAutoPending:auto.toString(),
   completed:{registrations:Object.keys(j.completed).filter(k=>/^register-\d+$/.test(k)).length,
   buy:Object.keys(j.completed).filter(k=>/^buy-\d+$/.test(k)).length,
   transfer:Object.keys(j.completed).filter(k=>/^transfer-\d+$/.test(k)).length,
   sell:Object.keys(j.completed).filter(k=>/^sell-\d+$/.test(k)).length,
   autoPreferences:Object.keys(j.completed).filter(k=>/^auto-pref-\d+$/.test(k)).length,
   repeatPurchases:Object.keys(j.completed).filter(k=>/^additional-unit-\d+$/.test(k)).length,
   payoutBatches:Object.keys(j.completed).filter(k=>/^pay-batch-/.test(k)).length},
   accounting:{binary:{actual:balances[0][0].toString(),obligations:balances[0][1].toString()},token:{actual:balances[1][0].toString(),obligations:balances[1][1].toString()}},
   spentUpperBoundTBNB:decimal(j.upperNativeReserved),gasWalletsTransferredTBNB:decimal(j.nativeTransferred),
   txCount:j.transactionCount,epochEnd:new Date(Number(await c.binary.epochEnd())*1000).toISOString(),
   monthPhase:(await c.binary.monthPhase()).toString(),
   note:'Real BNB Testnet transactions. tUSD synthetic, no real collateral. Hourly rewards/auto executions require eligible rank and time; never marked PASS unless executed.',
   explorer:'https://testnet.bscscan.com/tx/',
   walletTransactionProof:addresses.map((address,i)=>({address,register:j.completed['register-'+i]?.hash||null,buy:j.completed['buy-'+i]?.hash||null,transfer:j.completed['transfer-'+i]?.hash||null,sell:j.completed['sell-'+i]?.hash||null})),
   extra,createdAt:new Date().toISOString()};
  atomic(this.data.reportPath,report);console.log('REPORT_FILE='+this.data.reportPath);console.log(safeStringify(report));return report;
 }
 async run(){
  await this.recoverPending();await this.checkBooks();
  if(!this.j.startedAt){this.j.startedAt=new Date().toISOString();this.save();}
  const initialCount=await this.ctx.binary.memberCount();
  ensure(initialCount>=31n&&initialCount<=131n,'Unexpected live membership outside isolated 100-user test');
  console.log('CHAIN_97_TESTNET_100_BEGIN '+this.plan.digest);
  await this.distributeStable();console.log('STABLE_FUNDED');
  await this.registerAll();console.log('REGISTRATION_AND_EXTRA_UNITS_DONE');
  await this.buyAll();console.log('ALL_BUYS_DONE');
  await this.configureAuto();console.log('AUTO_PREFERENCES_DONE');
  await this.transferAll();console.log('ALL_TRANSFERS_DONE');
  await this.sellAll();console.log('ALL_SELLS_DONE');
  const guards=await this.readOnlyAdversarial();await this.settleEpoch();const claims=await this.claimIfEligible();const payments=await this.payQueued();await this.checkBooks();
  const report=await this.report({negativeReadOnlyTestsPassed:guards,claimsThisRun:claims,payoutBatchesThisRun:payments,epochDue:BigInt((await this.ctx.p.getBlock('latest')).timestamp)>=(await this.ctx.binary.epochEnd())});
  ensure(report.completed.registrations===100&&report.completed.buy===100&&report.completed.transfer===100&&report.completed.sell===100&&report.completed.autoPreferences===100&&report.completed.repeatPurchases===10,
   'NOT_ALL_TESTS_COMPLETED');
  ensure(report.chainMemberCount===131,'MEMBER_COUNT_MISMATCH');
  console.log('FTI_FRESH_TESTNET_100_WALLET_JOURNEY_COMPLETE');
 }
 async settle(){await this.recoverPending();await this.settleEpoch();const claims=await this.claimIfEligible();const payments=await this.payQueued();await this.checkBooks();await this.report({settlementRun:true,claims,paymentBatches:payments});console.log('FTI_100_TESTNET_SETTLEMENT_CHECK_COMPLETE');}
}

async function main(){const {command,opt}=parseArgs(process.argv.slice(2));
 if(command==='help'){console.log(`FTI 100 actor BNB TESTNET ONLY. Run outside the pinned FTI source checkout.
prepare --funder-address PUBLIC_0x [--wallet-gas-tbnb 0.001 --max-total-tbnb 0.25 --gas-price-ceiling-gwei 1]
run --funder-key-file /root/private/testnet-funder.key --send --confirm-plan DIGEST
settle --funder-key-file PATH --send --confirm-plan DIGEST
status (read-only, does not print private keys)
Optional: FTI_STRESS_RPC_URL=https://your-bnb-testnet-rpc
Only synthetic tUSD; 100 wallets in a private 0600 vault; wallet funder supplies TEST tBNB gas.
Full runs may span many minutes, and hourly/monthly rewards require real time.
No mainnet; never use a leaked/private mainnet key.`);return;}
 const ctx=await context(opt);
 try{
  if(command==='prepare'){await makePrepared(ctx,opt);return;}
  const d=loadPrepared(ctx.eth),plan=d.plan;
  for(const k of ['binary','token','usd'])ensure(plan[k].toLowerCase()===ctx.cfg[k].toLowerCase(),'Wrong saved plan address');
  if(command==='status'){
   console.log(safeStringify({chainId:97,planDigest:plan.digest,preparedWallets:d.keys.length,completedOperations:Object.keys(d.j.completed).length,unresolved:d.j.pending?{label:d.j.pending.label,hash:d.j.pending.hash}:null,transactions:d.j.transactionCount,upperNativeBudgetUsedTBNB:decimal(d.j.upperNativeReserved),activeKeysNeverPrinted:true}));return;
  }
  ensure(opt['--send']===true&&opt['--confirm-plan']===plan.digest,'Explicit --send and full matching --confirm-plan DIGEST required');
  ensure(opt['--funder-key-file'],'Funder key file required');
  const funder=new ctx.eth.Wallet(requirePrivateKeyFile(opt['--funder-key-file']),ctx.p);
  ensure(funder.address.toLowerCase()===plan.funder.toLowerCase(),'Testnet funder key does not match reviewed address');
  ensure(await ctx.p.getBalance(funder.address)>0n,'Insufficient TEST tBNB');
  ensure(!fs.existsSync(path.join(OUT,LOCK)),'Test already running or interrupted; inspect before re-running');
  await lockRun(async()=>{const engine=new Engine(ctx,d,funder);if(command==='run')await engine.run();else await engine.settle();});
 }finally{ctx.p.destroy();}
}
if(require.main===module)main().catch(e=>{const msg=String(e.message||e).replace(/https?:\/\/\S+/g,'[RPC_URL_REDACTED]').replace(/0x[a-fA-F0-9]{64}/g,'[HEX_REDACTED]');console.error('FTI_100_TESTNET_STOP '+msg.slice(0,400));process.exitCode=1;});
module.exports={digest,amount,decimal,parseArgs,KNOWN,COUNT,UNIT,TUSD_PER_WALLET,BUY,contextFiles};
