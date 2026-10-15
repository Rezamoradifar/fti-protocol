import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(path.join(process.env.FTI_JOURNEY_SOURCE||process.cwd(),'package.json'));
const {Wallet,JsonRpcProvider,FetchRequest,Transaction,parseEther:E,parseUnits,formatEther:F}=require('ethers');
const TARGET=E('0.005'),PRICE=parseUnits('0.1','gwei'),GAS=21000n;
const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
function save(file,j){
 const temp=file+'.tmp',fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(j,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);
}
export async function topUpKeeper({p,owner,keeper,dir,log=console.log}){
 assert.equal((await p.getNetwork()).chainId,97n,'Only testnet 97');
 assert(!same(owner.address,keeper),'Keeper and funder must differ');
 assert.equal(await p.getCode(keeper),'0x','Keeper must be an EOA');
 const st=fs.lstatSync(dir);assert(st.isDirectory()&&!st.isSymbolicLink()&&(st.mode&0o077)===0,'Private state directory required');
 const file=path.join(dir,'keeper-gas-topup.json');let j;
 if(fs.existsSync(file)){
  const s=fs.lstatSync(file);assert(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o077)===0,'Unsafe top-up journal');
  j=JSON.parse(fs.readFileSync(file));
  assert.equal(j.schema,1);assert.equal(j.chainId,97);
  assert(same(j.keeper,keeper)&&same(j.funder,owner.address),'Top-up journal mismatch');
 }else{
  const balance=await p.getBalance(keeper);
  log('KEEPER_ADDRESS',keeper);log('KEEPER_BALANCE_tBNB',F(balance));
  if(balance>=TARGET){log('FTI_KEEPER_ALREADY_FUNDED');return {skipped:true};}
  const value=TARGET-balance,gasPrice=(await p.getFeeData()).gasPrice;
  assert(gasPrice>0n&&gasPrice<=PRICE,'Gas price exceeds 0.1 gwei; no top-up sent');
  const [latest,pending]=await Promise.all([p.getTransactionCount(owner.address,'latest'),p.getTransactionCount(owner.address,'pending')]);
  assert.equal(latest,pending,'Funder has a pending transaction; wait and retry');
  assert(await p.getBalance(owner.address)>=value+GAS*gasPrice,'Test deployer has insufficient tBNB');
  const raw=await owner.signTransaction({chainId:97,to:keeper,value,nonce:pending,type:0,gasLimit:GAS,gasPrice});
  j={schema:1,chainId:97,keeper,funder:owner.address,hash:Transaction.from(raw).hash,raw};save(file,j);
  log('TOPUP_tBNB',F(value));log('MAXIMUM_GAS_tBNB',F(GAS*gasPrice));
 }
 // Never create a second payment when resuming, even if Keeper spent the first.
 const signed=Transaction.from(j.raw);
 assert.equal(signed.hash,j.hash);assert(same(signed.from,owner.address)&&same(signed.to,keeper));
 assert.equal(signed.chainId,97n);assert.equal(signed.type,0);assert.equal(signed.data,'0x');
 assert.equal(signed.gasLimit,GAS);assert(signed.value>0n&&signed.value<=TARGET);
 assert(signed.gasPrice>0n&&signed.gasPrice<=PRICE);
 let receipt=await p.getTransactionReceipt(j.hash);
 if(!receipt){
  if(!await p.getTransaction(j.hash))await p.broadcastTransaction(j.raw);
  receipt=await p.getTransactionReceipt(j.hash)||await p.waitForTransaction(j.hash,1,120000);
 }
 assert(receipt,'Pending top-up; rerun this same command');assert.equal(receipt.status,1,'Top-up reverted; retain journal');
 assert.equal((await p.getBlock(receipt.blockNumber)).hash,receipt.blockHash,'Receipt block changed');
 j.confirmed=true;j.block=receipt.blockNumber;save(file,j);
 const result={result:'FTI_KEEPER_TOPUP_CONFIRMED',keeper,transaction:j.hash,amountTBNB:F(signed.value),maximumGasTBNB:F(GAS*signed.gasPrice)};
 log(JSON.stringify(result));return result;
}
async function main(){
 const req=new FetchRequest(process.env.FTI_JOURNEY_RPC);assert.equal(new URL(req.url).protocol,'https:');req.timeout=30000;
 const p=new JsonRpcProvider(req,undefined,{batchMaxCount:1,cacheTimeout:-1});p.pollingInterval=2000;
 try{
  const cfg=JSON.parse(fs.readFileSync(process.env.FTI_JOURNEY_DEPLOYMENT));
  assert.equal(cfg.chainId,97);assert.equal(cfg.sourceRevision,'bc2163070a6e79bcc129a6a788e61c4ace402bdf');
  assert(same(cfg.binary,'0x40e727e15b65461D52e92907aa96E27017Ea70fE'));
  const key=fs.readFileSync(process.env.FTI_JOURNEY_KEY_FILE,'utf8').trim();
  const owner=new Wallet(key.startsWith('0x')?key:'0x'+key,p);assert(same(owner.address,cfg.deployer));
  await topUpKeeper({p,owner,keeper:process.env.FTI_JOURNEY_KEEPER_ADDRESS,dir:process.env.FTI_JOURNEY_STATE});
 }finally{p.destroy();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{
 console.error('FTI_KEEPER_TOPUP_STOPPED',e.code==='ERR_ASSERTION'?e.message:'RPC/process failure; keep private state and rerun this same command.');process.exitCode=1;
});
