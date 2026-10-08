// Real chain-97 test transactions only. Journals contain keys: keep them private.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {Wallet,Contract,JsonRpcProvider,parseEther as E,formatEther as F,ZeroAddress,keccak256} from 'ethers';

export const N=1000;
export const amounts=[1,5,10,25,50,100,250,500,1000,2500,5000,10000];
export function scenario(i){
 const buy=amounts[i%amounts.length];
 const planned=[100,200,500,1000,2500,5000,10000][i%7];
 const units=Math.max(planned/100,Math.ceil(buy/500));
 return {buy,units,sell:amounts[(i*5+3)%amounts.length]};
}
export function sellAmount(target,held,supply,reserve){
 if(!held||!supply||!reserve)return 0n;
 const tokens=(target*supply+reserve-1n)/reserve;
 return tokens<held?tokens:held;
}
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
const envFile=file=>Object.fromEntries(fs.readFileSync(file,'utf8').split(/\r?\n/).filter(l=>/^(RPC_URL|DEPLOYMENT_FILE|KEEPER_PRIVATE_KEY)=/.test(l)).map(l=>{const at=l.indexOf('=');let value=l.slice(at+1).trim();try{value=JSON.parse(value);}catch{}return [l.slice(0,at),value];}));

export async function run(){
 const server=process.env.V3_SERVER_CONFIG?envFile(process.env.V3_SERVER_CONFIG):{};
 const d=JSON.parse(fs.readFileSync(process.env.V3_DEPLOYMENT_FILE||server.DEPLOYMENT_FILE||'deployments/v3-testnet.json'));
 assert.equal(d.chainId,97);assert.equal(d.tokenContract,'FTIReserveTokenV3');assert.equal(d.binaryContract,'FundedBinaryPlan');
 const p=new JsonRpcProvider(process.env.RPC_URL||server.RPC_URL||'https://bsc-testnet.bnbchain.org',undefined,{batchMaxCount:1,cacheTimeout:-1});p.pollingInterval=3000;
 const artifactDir=process.env.V3_ARTIFACT_DIR||new URL('../artifacts/',import.meta.url);
 const make=(key,name)=>new Contract(d[key],JSON.parse(fs.readFileSync(artifactDir instanceof URL?new URL(name+'.json',artifactDir):path.join(artifactDir,name+'.json'))).abi,p);
 const usd=make('usd','MockUSD'),token=make('token','FTIReserveTokenV3'),binary=make('binary','FundedBinaryPlan');
 let owner,j,file,lockFd,lock,interrupted=false;
 const onSignal=()=>{interrupted=true;console.error('Stopping after the current receipt; journal will be retained.');};
 const budget=E(process.env.TEST_BUDGET_TBNB||'1');assert(budget>0n&&budget<=E('10'),'Budget must be >0 and <=10 test BNB');
 function save(){fs.writeFileSync(file+'.tmp',json(j),{mode:0o600});fs.renameSync(file+'.tmp',file);}
 async function accounting(){for(const c of [binary,token]){const[a,b]=await c.accounting();assert.equal(a,b,'USD accounting mismatch');}const[a,b,c,e]=await binary.fundingAccounting();assert.equal(a,b,'Point credit mismatch');assert.equal(c,e,'Builder credit mismatch');}
 async function state(){return {price:F(await token.price()),supply:F(await token.totalSupply()),reserve:F(await token.reserve()),support:F(await token.supportReserve()),cycle:String(await token.cycle()),pointValue:F(await binary.pointValue()),protectionLevel:String(await binary.protectionLevel()),pointPool:F(await binary.pointPool()),epoch:String(await binary.epoch())};}
 function events(receipt){const list=[];for(const l of receipt.logs){for(const [name,c] of [['token',token],['binary',binary],['usd',usd]]){if(l.address.toLowerCase()!==c.target.toLowerCase())continue;try{const e=c.interface.parseLog(l);if(e)list.push({contract:name,event:e.name,args:Array.from(e.args)});}catch{}}}return list;}
 async function pending(){
  if(!j.pending)return;const q=j.pending;let r=await p.getTransactionReceipt(q.hash);
  if(!r){if(!await p.getTransaction(q.hash))await p.broadcastTransaction(q.raw);r=await p.waitForTransaction(q.hash,1,180000);}
  assert(r,'Transaction pending; rerun later: '+q.hash);
  delete j.pending;j.spent=(BigInt(j.spent)+r.gasUsed*r.gasPrice).toString();
  if(r.status===1)j.done[q.label]={hash:q.hash,block:r.blockNumber,gasUsed:r.gasUsed,events:events(r),meta:q.meta};
  else j.failures.push({label:q.label,hash:q.hash,block:r.blockNumber});save();
  assert.equal(r.status,1,'Reverted transaction: '+q.label);console.log('PASS',q.label,q.hash);
 }
 async function send(w,request,label,meta={}){
  assert(!interrupted,'Interrupted; rerun to resume');
  await pending();if(j.done[label])return;
  // Estimates on BSC nodes can fail for an unfunded sender, so fund first.
  if(w.address!==owner.address&&await p.getBalance(w.address)<E('0.0005'))await send(owner,{to:w.address,value:E('0.001')},'gas-'+w.address+'-'+await p.getTransactionCount(owner.address,'pending'));
  const gasLimit=(await w.estimateGas(request))*125n/100n;const {gasPrice}=await p.getFeeData();assert(gasPrice);
  const fee=gasLimit*gasPrice,value=BigInt(request.value||0);assert(fee<=E('0.005'),'Fee estimate exceeds 0.005 tBNB');
  if(w.address!==owner.address&&await p.getBalance(w.address)<fee+value)await send(owner,{to:w.address,value:fee+value+E('0.0001')},'gas-'+w.address+'-'+await p.getTransactionCount(owner.address,'pending'));
  assert(BigInt(j.reserved)+fee+value<=budget,'Budget reached; journal saved. Increase TEST_BUDGET_TBNB deliberately and rerun.');
  assert(await p.getBalance(w.address)>=fee+value,'Insufficient test BNB in '+w.address);
  const raw=await w.signTransaction({...request,chainId:97,nonce:await p.getTransactionCount(w.address,'pending'),type:0,gasLimit,gasPrice});
  j.reserved=(BigInt(j.reserved)+fee+value).toString();j.pending={label,raw,hash:keccak256(raw),meta};save();await pending();
 }
 async function call(w,c,method,args,label,meta){await send(w,await c[method].populateTransaction(...args),label,meta);}
 async function settle(force=false){
  if(await binary.phase()===0n){
   if(force||BigInt((await p.getBlock('latest')).timestamp)>=await binary.epochEnd()){
    while(await binary.jobCursor()<await binary.jobCount())await call(owner,binary,'processVolume',[25],'volume-'+await binary.jobCursor()+'-'+await p.getTransactionCount(owner.address,'pending'));
    if(BigInt((await p.getBlock('latest')).timestamp)>=await binary.epochEnd())await call(owner,binary,'beginEpochClose',[],'close-'+await binary.epoch());
   }
  }
  while(await binary.phase()>0n)await call(owner,binary,'processEpoch',[10],'epoch-'+await binary.epoch()+'-'+await binary.cursor());
 }
 async function probe(label,fn){if(j.probes[label])return;try{const result=await fn();j.probes[label]={accepted:true,result};}catch(e){
  if(e.code!=='CALL_EXCEPTION'||(!e.data&&!e.reason&&!e.revert))throw Error('Unclassified RPC failure during '+label+': '+e.message);
  j.probes[label]={accepted:false,reason:e.reason||e.shortMessage,data:e.data};
 }save();console.log('PROBE',label,j.probes[label].accepted?'accepted':'rejected');}
 async function report(){
  const receipts=Object.values(j.done);let observed=receipts.flatMap(r=>r.events.filter(e=>e.contract==='binary').map(e=>({...e,hash:r.hash})));
  // Include settlements made by the installed keeper, rather than silently losing them.
  if(j.settledFinal){observed=[];const end=await p.getBlockNumber();for(let from=j.startBlock;from<=end;from+=1000){const logs=await p.getLogs({address:d.binary,fromBlock:from,toBlock:Math.min(from+999,end),topics:[[binary.interface.getEvent('EpochClosed').topicHash,binary.interface.getEvent('RewardAllocated').topicHash]]});for(const l of logs){const e=binary.interface.parseLog(l);observed.push({event:e.name,args:Array.from(e.args),hash:l.transactionHash});}}}
  const closures=observed.filter(e=>e.event==='EpochClosed'&&BigInt(e.args[0])>BigInt(j.startEpoch)).map(e=>({hash:e.hash,epoch:String(e.args[0]),pool:F(e.args[1]),points:String(e.args[2]),pointValue:F(e.args[3]),nextProtection:String(e.args[4])}));
  const allocated=observed.filter(e=>e.event==='RewardAllocated'&&BigInt(e.args[0])>BigInt(j.startEpoch));
  for(const c of closures){const sum=allocated.filter(e=>String(e.args[0])===c.epoch).reduce((s,e)=>s+BigInt(e.args[2])+BigInt(e.args[3]),0n);assert.equal(E(c.pointValue),BigInt(c.points)?sum/BigInt(c.points):0n,'Epoch value must equal actual allocation divided by paid points');}
  const rewards=allocated.reduce((s,e)=>s+BigInt(e.args[2])+BigInt(e.args[3]),0n);
  const points=closures.reduce((s,e)=>s+BigInt(e.points),0n);
  const buys=receipts.filter(r=>r.meta?.kind==='buy'),sells=receipts.filter(r=>r.meta?.kind==='sell'),regs=receipts.filter(r=>r.meta?.kind==='register');
  const r={chainId:97,mode:'public-testnet-real-transactions',contracts:{usd:d.usd,token:d.token,binary:d.binary},start:j.start,end:await state(),counts:{binaryPurchases:regs.length,tokenBuys:buys.length,tokenSells:sells.length},totals:{binaryUSD:F(regs.reduce((s,r)=>s+E(String(r.meta.usd)),0n)),tokenBuyUSD:F(buys.reduce((s,r)=>s+E(String(r.meta.usd)),0n)),sellPayoutUSD:F(sells.reduce((s,r)=>s+BigInt(r.events.find(e=>e.event==='Sold').args[2]),0n)),allocatedHourlyUSD:F(rewards),paidPoints:String(points),weightedPointValue:points?F(rewards/points):null},hourlyClosures:closures,pointTarget20Status:points?(rewards>=E('20')*points?'at_or_above_20':'below_20'):'no_paid_points',accounting:'PASS',budget:{reservedTBNB:F(j.reserved),actualGasTBNB:F(j.spent)},probes:j.probes,transactions:receipts,failures:j.failures,completed:regs.length===N&&buys.length===N&&sells.length===N&&j.settledFinal===true,limitations:['No artificial token price changes; prices are actual R/S quotes. USD range refers to transaction amounts.','One sale per test wallet; remaining FTI stays in test wallets. No forced liquidation of other users.','Epoch reward values cover observed closures and may include existing members, not only test wallets.','Monthly Builder payout, council emergency, ranked auto-buy and transfer burn are separate tests.']};
  fs.writeFileSync(file.replace(/\.json$/,'-report.json'),json(r),{mode:0o600});console.log('REPORT',file.replace(/\.json$/,'-report.json'));console.log(json({...r,transactions:undefined,probes:undefined}));return r;
 }
 try{
  assert.equal((await p.getNetwork()).chainId,97n,'Wrong RPC network');for(const k of ['usd','token','binary']){const code=await p.getCode(d[k]);assert.notEqual(code,'0x');assert.equal(keccak256(code),d.codeHashes[k],'Code mismatch: '+k);}
  assert.equal((await token.binary()).toLowerCase(),d.binary.toLowerCase());assert.equal(await usd.symbol(),'tUSD');await accounting();
  if(!process.argv.includes('--write')){console.log('READ-ONLY PASS',json(await state()));console.log('Use --write to create 1000 members, 1000 buys and 1000 sales. Real test BNB required.');return;}
  const funderKey=process.env.TEST_FUNDER_KEY_FILE?fs.readFileSync(process.env.TEST_FUNDER_KEY_FILE,'utf8').trim():process.env.TEST_PRIVATE_KEY;
  assert(funderKey,'Enter a dedicated funded TESTNET gas wallet key on the server. Do not use the active keeper wallet.');
  owner=new Wallet(funderKey,p);delete process.env.TEST_PRIVATE_KEY;delete server.KEEPER_PRIVATE_KEY;
  if(process.env.TEST_KEEPER_CONFIG){const keeper=envFile(process.env.TEST_KEEPER_CONFIG);if(keeper.KEEPER_PRIVATE_KEY)assert.notEqual(owner.address,new Wallet(keeper.KEEPER_PRIVATE_KEY).address,'Use a separate test gas wallet to avoid keeper nonce conflicts');}
  console.log('Test gas funder:',owner.address,'balance:',F(await p.getBalance(owner.address)),'tBNB; budget cap:',F(budget));
  const dir=process.env.TEST_STATE_DIR||path.join(os.homedir(),'.fti-v3-testnet-1000');fs.mkdirSync(dir,{recursive:true,mode:0o700});file=path.join(dir,d.binary.toLowerCase()+'.json');lock=file+'.lock';lockFd=fs.openSync(lock,'wx',0o600);fs.writeSync(lockFd,String(process.pid));
  for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,onSignal);
  if(fs.existsSync(file))j=JSON.parse(fs.readFileSync(file));else{j={version:1,owner:owner.address,contracts:{usd:d.usd,token:d.token,binary:d.binary},keys:Array.from({length:N},()=>Wallet.createRandom().privateKey),done:{},probes:{},failures:[],reserved:'0',spent:'0',startBlock:await p.getBlockNumber(),startEpoch:String(await binary.epoch()),start:await state()};save();}
  assert.equal(j.owner,owner.address);assert.equal(j.keys.length,N);assert.deepEqual(j.contracts,{usd:d.usd,token:d.token,binary:d.binary});await pending();await settle();
  const users=j.keys.map(k=>new Wallet(k,p));
  if(!j.sponsor){for(let n=15;n<31;n++){const a=await binary.memberList(n);if((await binary.members(a)).right===ZeroAddress){j.sponsor=a;save();break;}}assert(j.sponsor,'No free genesis leaf; choose a valid sponsor explicitly in a separate run.');}
  for(let i=0;i<N;i++){
   const w=users[i],s=scenario(i);await settle();
   if(!j.done['register-'+i]){
    assert(!await binary.registered(w.address),'Unexpected registered account');
    await call(w,usd,'faucet',[],'faucet-'+i);await call(w,usd,'approve',[d.binary,E(String(s.units*100))],'approve-plan-'+i);
    const sponsor=i?users[Math.floor((i-1)/2)].address:j.sponsor;
    if(i===0)await probe('binary-below-100',()=>binary.connect(w).register.staticCall(sponsor,0));
    await settle();await call(w,binary,'register',[sponsor,s.units],'register-'+i,{kind:'register',usd:s.units*100,units:s.units,wallet:w.address});
   }
   assert.equal(await binary.unitsOf(w.address),BigInt(s.units));
   if(!j.done['buy-'+i]){
    await call(w,usd,'approve',[d.token,E('20000')],'approve-token-'+i);
    if(i===0)await probe('token-over-account-cap',async()=>token.connect(w).buy.staticCall((await token.remainingAllowance(w.address))+1n,0,(await p.getBlock('latest')).timestamp+1200));
    const quote=await token.quoteBuy(E(String(s.buy))),before=await state();
    await call(w,token,'buy',[E(String(s.buy)),quote*995n/1000n,(await p.getBlock('latest')).timestamp+1200],'buy-'+i,{kind:'buy',usd:s.buy,wallet:w.address,quote,before});
   }
   await accounting();console.log('BOUGHT',i+1,'/',N,'binaryUSD',s.units*100,'tokenUSD',s.buy,'price',F(await token.price()));
  }
  for(let i=1;i<N;i++){const m=await binary.members(users[Math.floor((i-1)/2)].address);assert.equal(i%2?m.left:m.right,users[i].address,'Tree placement mismatch');}
  for(let i=0;i<N;i++){
   if(j.done['sell-'+i])continue;await settle();const w=users[i],s=scenario(i),held=await token.balanceOf(w.address);assert(held>0n);
   let amount=sellAmount(E(String(s.sell)),held,await token.totalSupply(),await token.reserve());
   let [quote,gross]=await token.quoteSell(amount);const deadline=(await p.getBlock('latest')).timestamp+1200;
   await probe('sell-target-'+i,()=>token.connect(w).sell.staticCall(amount,quote*995n/1000n,deadline));
   const rejected=!j.probes['sell-target-'+i].accepted;
   if(rejected){const reason=j.probes['sell-target-'+i].reason||'';assert(/single sell protection|hourly sell protection/.test(reason),'Unexpected sale rejection: '+reason);amount=sellAmount(E('499'),held,await token.totalSupply(),await token.reserve());[quote,gross]=await token.quoteSell(amount);}
   const before=await state();await call(w,token,'sell',[amount,quote*995n/1000n,(await p.getBlock('latest')).timestamp+1200],'sell-'+i,{kind:'sell',wallet:w.address,targetUSD:s.sell,tokens:amount,quotedGross:gross,quotedPayout:quote,fallbackBelow500:rejected,before});
   await accounting();console.log('SOLD',i+1,'/',N,'gross',F(gross),'price',F(await token.price()));
  }
  await settle(true);
  if(!j.settledFinal){
   if(process.env.TEST_WAIT_HOURLY!=='1'){await accounting();await report();console.log('WAITING: rerun with TEST_WAIT_HOURLY=1 to await real hourly settlement.');return;}
   if(!j.finalEpoch){j.finalEpoch=String(await binary.epoch());j.finalEpochEnd=String(await binary.epochEnd());save();}
   while(await binary.epoch()<=BigInt(j.finalEpoch)&&BigInt((await p.getBlock('latest')).timestamp)<BigInt(j.finalEpochEnd)){assert(!interrupted,'Interrupted; rerun to resume');console.log('Waiting for real hourly epoch',j.finalEpochEnd);await new Promise(r=>setTimeout(r,30000));}
   await settle(true);assert(await binary.epoch()>BigInt(j.finalEpoch),'Final epoch has not closed');j.settledFinal=true;save();
  }
  let batches=0;while(await binary.rewardAccountCount()>0n){await call(owner,binary,'payRewards',[100],'pay-'+await p.getTransactionCount(owner.address,'pending'));assert(++batches<=200,'Unexpected reward queue growth');}
  await accounting();await report();
 }catch(e){if(j&&file){try{await accounting();await report();}catch{} }throw e;}
 finally{for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.removeListener(signal,onSignal);if(lockFd!==undefined){fs.closeSync(lockFd);fs.unlinkSync(lock);}p.destroy();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname))run().catch(e=>{console.error('STOP:',e.reason||e.shortMessage||e.message);process.exitCode=1;});
