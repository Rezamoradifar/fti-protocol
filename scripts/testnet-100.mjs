// 100 distinct testnet members; no mainnet, no production collateral.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import assert from 'node:assert/strict';
import {Wallet,Contract,JsonRpcProvider,parseEther as E,formatEther,ZeroAddress,keccak256} from 'ethers';
const d=JSON.parse(fs.readFileSync('deployments/testnet.json'));assert.equal(d.chainId,97);assert.equal(d.mode,'testnet');
const p=new JsonRpcProvider(process.env.RPC_URL||'https://bsc-testnet.bnbchain.org',undefined,{batchMaxCount:1,cacheTimeout:-1});p.pollingInterval=Number(process.env.TEST_POLL_MS||3000);
const C={};for(const [k,n]of Object.entries({usd:'MockUSD',token:'FTIToken',binary:'BinaryPlan'}))C[k]=new Contract(d[k],JSON.parse(fs.readFileSync(`artifacts/${n}.json`)).abi,p);
const {usd,token,binary}=C;let j,file,owner;
const budget=E(process.env.TEST_BUDGET_TBNB||'0.25');assert(budget>0n&&budget<=E('1'),'Budget must be >0 and <=1 test BNB');
function save(){fs.writeFileSync(file+'.tmp',JSON.stringify(j,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);}
async function finishPending(){
 if(!j.pending)return;const q=j.pending;let receipt=await p.getTransactionReceipt(q.hash);
 if(!receipt){const known=await p.getTransaction(q.hash);if(!known)await p.broadcastTransaction(q.raw);receipt=await p.waitForTransaction(q.hash,1,120000);}
 if(!receipt)throw Error('Pending transaction; rerun later: '+q.hash);
 delete j.pending;if(receipt.status===1)j.done[q.label]=q.hash;save();assert.equal(receipt.status,1,'Transaction reverted: '+q.label);console.log('PASS',q.label,q.hash);
}
async function send(signer,request,label){
 await finishPending();if(j.done[label])return;
 const gasLimit=(await signer.estimateGas(request))*125n/100n;const {gasPrice}=await p.getFeeData();assert(gasPrice,'No gas price');const fee=gasLimit*gasPrice;assert(fee<=E('0.003'),'Per-transaction fee exceeds 0.003 tBNB');
 const cost=fee+BigInt(request.value||0);
 if(signer.address!==owner.address){const balance=await p.getBalance(signer.address);if(balance<cost){const amount=cost-balance+E('0.00002');await send(owner,{to:signer.address,value:amount},'gas-'+signer.address+'-'+await p.getTransactionCount(owner.address,'pending'));}}
 assert(BigInt(j.reserved)+cost<=budget,'Budget reached. Check progress before explicitly increasing TEST_BUDGET_TBNB.');
 assert(await p.getBalance(signer.address)>=cost,'Insufficient tBNB: '+signer.address);
 const raw=await signer.signTransaction({...request,chainId:97,nonce:await p.getTransactionCount(signer.address,'pending'),type:0,gasLimit,gasPrice});
 j.reserved=(BigInt(j.reserved)+cost).toString();j.pending={label,raw,hash:keccak256(raw)};save();await finishPending();
}
async function call(s,c,m,args,label){await send(s,await c[m].populateTransaction(...args),label);}
async function account(){for(const c of [binary,token]){const [a,b]=await c.accounting();assert.equal(a,b,'Accounting mismatch');}}
async function settle(){
 if(await binary.phase()===0n){while(await binary.jobCursor()<await binary.jobCount()){const cursor=await binary.jobCursor();await call(owner,binary,'processVolume',[25],'volume-'+cursor+'-'+await p.getTransactionCount(owner.address));}
  if(BigInt((await p.getBlock('latest')).timestamp)>=await binary.epochEnd())await call(owner,binary,'beginEpochClose',[],'close-'+await binary.epoch());}
 while(await binary.phase()>0n)await call(owner,binary,'processEpoch',[10],`settle-${await binary.epoch()}-${await binary.phase()}-${await binary.cursor()}`);
}
try{
 assert.equal((await p.getNetwork()).chainId,97n,'Wrong RPC network');for(const k of ['usd','token','binary'])assert.notEqual(await p.getCode(d[k]),'0x');
 assert.equal((await token.binary()).toLowerCase(),d.binary.toLowerCase());assert.equal(await usd.symbol(),'tUSD');await account();
 if(!process.argv.includes('--write'))console.log('READ-ONLY PASS. --write creates 100 members and buys 10 test USD of FTI each. Default cumulative conservative budget: 0.25 tBNB.');
 else{
  assert(process.env.TEST_PRIVATE_KEY,'Enter TEST_PRIVATE_KEY on the server');owner=new Wallet(process.env.TEST_PRIVATE_KEY,p);delete process.env.TEST_PRIVATE_KEY;
  const dir=path.join(os.homedir(),'.fti-testnet-100');fs.mkdirSync(dir,{recursive:true,mode:0o700});file=path.join(dir,d.binary.toLowerCase()+'.json');
  // A lock prevents two simultaneous runs signing conflicting nonces. On a crash,
  // inspect the process before removing this lock; never delete the JSON journal.
  const lock=file+'.lock';const lockFd=fs.openSync(lock,'wx',0o600);fs.writeSync(lockFd,String(process.pid));
  const interrupted=()=>{try{fs.closeSync(lockFd);fs.unlinkSync(lock);}catch{}process.exit(130);};
  for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,interrupted);
  try{
   if(fs.existsSync(file))j=JSON.parse(fs.readFileSync(file));else{j={owner:owner.address,keys:Array.from({length:100},()=>Wallet.createRandom().privateKey),done:{},reserved:'0'};save();}
   assert.equal(j.owner,owner.address,'Use original funder');assert.equal(j.keys.length,100);const users=j.keys.map(k=>new Wallet(k,p));await finishPending();
   console.log('100-wallet test; cumulative budget',formatEther(budget),'tBNB. Transactions are sequential and resumable.');
   await settle();
   if(!j.sponsor){for(let n=15;n<31;n++){const a=await binary.memberList(n);if((await binary.members(a)).right===ZeroAddress){j.sponsor=a;save();break;}}assert(j.sponsor,'No free Genesis leaf');}
   for(let i=0;i<100;i++){
    const w=users[i];await settle();
    if(!await binary.registered(w.address)){
     if(await usd.balanceOf(w.address)<E('110'))await call(w,usd,'faucet',[],'faucet-'+i);
     if(await usd.allowance(w.address,d.binary)<E('100'))await call(w,usd,'approve',[d.binary,E('100')],'approve-unit-'+i);
     await call(w,binary,'register',[i?users[Math.floor((i-1)/2)].address:j.sponsor,1],'register-'+i);
    }
    assert.equal(await binary.unitsOf(w.address),1n,'Expected exactly one unit');
    if(!j.done['buy-'+i]){
     if(await usd.allowance(w.address,d.token)<E('10'))await call(w,usd,'approve',[d.token,E('10')],'approve-buy-'+i);
     const quote=await token.quoteBuy(E('10'));await call(w,token,'buy',[E('10'),quote*995n/1000n,(await p.getBlock('latest')).timestamp+1200],'buy-'+i);
    }
    const balance=await token.balanceOf(w.address),unlocked=await token.unlocked(w.address);
    if(balance>unlocked){let reason='';try{await token.connect(w).sell.staticCall(balance,0,(await p.getBlock('latest')).timestamp+1200);}catch(e){reason=e.reason||'';}assert.match(reason,/lock/i,'Expected lock-specific sell rejection');}
    await account();console.log(`USER ${i+1}/100 PASS`,w.address);
   }
   for(let i=1;i<100;i++){const parent=await binary.members(users[Math.floor((i-1)/2)].address);assert.equal(i%2?parent.left:parent.right,users[i].address,'Tree mismatch');}
   await settle();let claimed=0;
   for(let i=0;i<100;i++)if(await binary.pendingReward(users[i].address)>0n){await call(users[i],binary,'claim',[],`claim-${i}-${await binary.epoch()}`);claimed++;}
   await account();const report={registered:100,units:100,buys:Object.keys(j.done).filter(k=>/^buy-/.test(k)).length,tree:'PASS',accounting:'PASS',claimsThisRun:claimed,reservedBudgetTBNB:formatEther(j.reserved),nextEpochEnd:new Date(Number(await binary.epochEnd())*1000).toISOString(),limitations:'Public testnet: no clock changes. Rewards may require rerun after epoch end. Sell/transfer success, monthly rewards and browser load are NOT tested by this script.'};
   fs.writeFileSync(path.join(dir,d.binary.toLowerCase()+'-report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report,null,2));
  }finally{for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.removeListener(signal,interrupted);fs.closeSync(lockFd);fs.unlinkSync(lock);}
 }
}catch(e){console.error('STOP:',e.reason||e.shortMessage||e.message);process.exitCode=1;}finally{p.destroy();}
