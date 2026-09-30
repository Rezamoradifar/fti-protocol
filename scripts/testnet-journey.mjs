// Testnet-only user journey. Default is read-only; --write spends test tBNB.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {JsonRpcProvider,Wallet,Contract,parseEther as E,formatEther,ZeroAddress} from 'ethers';
const write=process.argv.includes('--write');
const d=JSON.parse(fs.readFileSync('deployments/testnet.json','utf8'));
assert.equal(d.chainId,97,'Only chain 97 is allowed');assert.equal(d.mode,'testnet');
const p=new JsonRpcProvider(process.env.RPC_URL||'https://bsc-testnet.bnbchain.org',undefined,{batchMaxCount:1,cacheTimeout:-1});
p.pollingInterval=3000;
const contracts={};
for(const [key,name]of Object.entries({usd:'MockUSD',token:'FTIToken',binary:'BinaryPlan'}))contracts[key]=new Contract(d[key],JSON.parse(fs.readFileSync(`artifacts/${name}.json`)).abi,p);
const {usd,token,binary}=contracts;
let journal,journalPath,txCount=0;
function save(){if(journalPath)fs.writeFileSync(journalPath,JSON.stringify(journal,null,2),{mode:0o600});}
async function send(signer,label,request){
 if(++txCount>60)throw Error('Transaction count limit reached; rerun to resume');
 const gas=await signer.estimateGas(request);const fees=await p.getFeeData();const gasPrice=fees.gasPrice;if(!gasPrice)throw Error('Missing gas price');
 const gasLimit=gas*125n/100n;if(gasLimit*gasPrice>E('0.003'))throw Error('Estimated transaction fee exceeds 0.003 tBNB');
 const tx=await signer.sendTransaction({...request,gasLimit,gasPrice});
 journal.pending={hash:tx.hash,label};save();console.log('SENT',label,tx.hash);
 const receipt=await tx.wait(1,120000);assert.equal(receipt.status,1,'Transaction reverted');journal.completed[label]=tx.hash;delete journal.pending;save();console.log('PASS',label);
}
async function call(signer,c,method,args,label){await send(signer,label,await c[method].populateTransaction(...args));}
async function accounting(){for(const c of [binary,token]){const [actual,recorded]=await c.accounting();assert.equal(actual,recorded,'Accounting mismatch');}console.log('PASS contract accounting');}
async function settle(signer){
 if(await binary.phase()===0n){
  while(await binary.jobCursor()<await binary.jobCount())await call(signer,binary,'processVolume',[50],`volume-${await binary.jobCursor()}`);
  const block=await p.getBlock('latest');if(BigInt(block.timestamp)<await binary.epochEnd())return;
  await call(signer,binary,'beginEpochClose',[],`close-${await binary.epoch()}`);
 }
 while(await binary.phase()>0n)await call(signer,binary,'processEpoch',[10],`settle-${await binary.epoch()}-${await binary.phase()}-${await binary.cursor()}`);
}
try{
 assert.equal((await p.getNetwork()).chainId,97n,'RPC network mismatch');
 for(const key of ['usd','token','binary','council','timelock'])assert.notEqual(await p.getCode(d[key]),'0x',`Missing contract ${key}`);
 assert.equal((await token.binary()).toLowerCase(),d.binary.toLowerCase(),'Wrong binary binding');
 assert.equal(await usd.symbol(),'tUSD','Unexpected collateral');
 await accounting();console.log('PASS deployed contracts; price:',formatEther(await token.price()));
 const site=process.env.SITE_URL||'http://127.0.0.1:3080';
 for(const route of ['/health','/api/config','/api/state','/api/events']){
  try{const r=await fetch(site+route,{signal:AbortSignal.timeout(45000)});const x=await r.json();if(!r.ok)throw Error(x.error||r.status);if(route==='/api/config'){assert.equal(x.chainId,97);assert.equal(x.token.toLowerCase(),d.token.toLowerCase());}console.log('PASS website',route);}catch(e){console.log('WARN website',route,e.message);}
 }
 if(!write){console.log('READ-ONLY COMPLETE. Use --write for real testnet transactions.');}
 else{
  if(!process.env.TEST_PRIVATE_KEY)throw Error('Enter TEST_PRIVATE_KEY locally; never send it in chat');
  const owner=new Wallet(process.env.TEST_PRIVATE_KEY,p);delete process.env.TEST_PRIVATE_KEY;
  const folder=path.join(os.homedir(),'.fti-testnet-journey');fs.mkdirSync(folder,{recursive:true,mode:0o700});
  journalPath=path.join(folder,d.binary.toLowerCase()+'.json');
  if(fs.existsSync(journalPath))journal=JSON.parse(fs.readFileSync(journalPath,'utf8'));
  else {journal={chainId:97,binary:d.binary,owner:owner.address,keys:Array.from({length:3},()=>Wallet.createRandom().privateKey),completed:{}};fs.writeFileSync(journalPath,JSON.stringify(journal,null,2),{flag:'wx',mode:0o600});}
  assert.equal(journal.owner,owner.address,'Use the original test funder wallet');
  if(journal.pending){const receipt=await p.getTransactionReceipt(journal.pending.hash);if(!receipt)throw Error('Previous transaction is still unresolved: '+journal.pending.hash);if(receipt.status===1)journal.completed[journal.pending.label]=journal.pending.hash;delete journal.pending;save();}
  const actors=journal.keys.map(k=>new Wallet(k,p));
  console.log('Test wallets:',actors.map(w=>w.address).join(', '));
  const needed=(await Promise.all(actors.map(w=>p.getBalance(w.address)))).reduce((n,b)=>n+(b<E('0.01')?E('0.01')-b:0n),0n);
  assert((await p.getBalance(owner.address))>=needed+E('0.002'),'Funder needs about 0.032 tBNB for first run');
  for(const [i,w]of actors.entries()){const b=await p.getBalance(w.address);if(b<E('0.01'))await send(owner,`fund-${i}-${b}`,{to:w.address,value:E('0.01')-b});}
  await settle(actors[0]);
  if(!journal.sponsor){for(let i=15;i<31;i++){const a=await binary.memberList(i);if((await binary.members(a)).right===ZeroAddress){journal.sponsor=a;save();break;}}if(!journal.sponsor)throw Error('No available Genesis leaf sponsor');}
  for(const [i,w]of actors.entries()){
   const units=i===0?1n:2n;const current=await binary.unitsOf(w.address);const add=units>current?units-current:0n;
   if(add===0n)continue;
   if(await usd.balanceOf(w.address)<E('100')*add)await call(w,usd,'faucet',[],`faucet-${i}`);
   await call(w,usd,'approve',[d.binary,E('100')*add],`approve-units-${i}`);
   if(await binary.registered(w.address))await call(w,binary,'addUnits',[add],`units-${i}`);
   else await call(w,binary,'register',[i===0?journal.sponsor:actors[0].address,add],`register-${i}`);
  }
  const member=await binary.members(actors[0].address);
  assert.equal(member.left,actors[1].address);assert.equal(member.right,actors[2].address);console.log('PASS left/right placement; 5 units purchased');
  const buyer=actors[0];
  if(!journal.completed.buy){
   if(await usd.balanceOf(buyer.address)<E('10'))await call(buyer,usd,'faucet',[],'faucet-buy');
   await call(buyer,usd,'approve',[d.token,E('10')],'approve-buy');
   const quote=await token.quoteBuy(E('10'));const block=await p.getBlock('latest');
   await call(buyer,token,'buy',[E('10'),quote*995n/1000n,block.timestamp+1200],'buy');
  }
  const balance=await token.balanceOf(buyer.address),unlocked=await token.unlocked(buyer.address);
  console.log('FTI balance:',formatEther(balance),'unlocked:',formatEther(unlocked));
  if(balance>unlocked){
   // staticCall only; check the specific revert reason so unrelated errors never pass.
   let reason='';try{await token.connect(buyer).sell.staticCall(balance,0,(await p.getBlock('latest')).timestamp+1200);}catch(e){reason=e.reason||'';}
   assert.match(reason,/lock|unlocked/i,'Expected lock-specific sell rejection');console.log('PASS locked sell rejected');
   console.log('PENDING sell/transfer: real lock deadlines apply on testnet; no time travel is attempted.');
  }else if(unlocked>0n&&!journal.completed.sell){
   const transfer=unlocked/10n;if(transfer>0n&&!journal.completed.transfer)await call(buyer,token,'transfer',[actors[1].address,transfer],'transfer');
   const amount=await token.unlocked(buyer.address);if(amount>0n){const [quote]=await token.quoteSell(amount);await call(buyer,token,'sell',[amount,quote*995n/1000n,(await p.getBlock('latest')).timestamp+1200],'sell');}
  }
  await settle(buyer);
  const reward=await binary.pendingReward(buyer.address);
  if(reward>0n)await call(buyer,binary,'claim',[],`claim-${await binary.epoch()}`);
  else console.log('PENDING reward if current epoch is open. Rerun after:',new Date(Number(await binary.epochEnd())*1000).toISOString());
  await accounting();console.log('JOURNEY RUN COMPLETE. PASS = checked, PENDING = not yet tested. Private test wallets retained outside repository.');
 }
}catch(e){console.error('STOP:',e.reason||e.shortMessage||e.message);process.exitCode=1;}finally{p.destroy();}
