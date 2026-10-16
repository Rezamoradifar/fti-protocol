#!/usr/bin/env node
// Read-only: turn independently supplied transaction hashes into a verified
// deployment config. Never signs, broadcasts, starts services or imports users.
import fs from 'node:fs';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Contract,JsonRpcProvider,FetchRequest,keccak256} from 'ethers';
import {assertApprovedMainnetProfile} from './approved-mainnet-profile.mjs';
import {MAINNET_RELEASE} from '../core/deployment-network.mjs';
import {releaseManifest,verifyV3Deployment} from './continuity-release.mjs';
import {mainnetPayloads,validateMainnetInput,assertPinnedMainnetCheckout} from './prepare-mainnet.mjs';
import {freshDigest} from './fresh-testnet.mjs';
import {loadMigrationBuild} from './address-migration-operator.mjs';
import {layoutDigest} from './address-migration-manifest.mjs';
const check=(ok,message)=>{if(!ok)throw Error(message);};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export async function finalizeMainnet({provider,plan,transactions,confirmations=12}){
 check(Number.isSafeInteger(confirmations)&&confirmations>=1,'Positive receipt confirmations required');
 check((await provider.getNetwork()).chainId===56n,'Mainnet chain 56 required');
 const {digest,...body}=plan;
 check(plan.schema==='FTI_MAINNET_UNSIGNED_PLAN_V1'&&digest===freshDigest(body),'Unsigned plan digest mismatch');
 const input=validateMainnetInput(plan.input),manifest=releaseManifest();
 check(freshDigest(manifest)===freshDigest(plan.manifest),'Plan/build identity mismatch');
 check(freshDigest(loadMigrationBuild().layouts.map(layoutDigest))===freshDigest(plan.layoutHashes),'Plan storage layout mismatch');
 const expected=await mainnetPayloads(input,plan.nonce);
 for(const key of ['addresses','constructorArgs','transactions'])check(freshDigest(expected[key])===freshDigest(plan[key]),'Plan payload mismatch: '+key);
 check(transactions&&Object.keys(transactions).length===7&&new Set(Object.values(transactions)).size===7,'Seven distinct transaction hashes required');
 const head=await provider.getBlock('latest');check(head?.hash,'Head unavailable');
 const receipts={};
 for(const step of expected.transactions){
  const hash=transactions[step.name];check(/^0x[0-9a-f]{64}$/i.test(hash||''),'Missing transaction: '+step.name);
  const [tx,r]=await Promise.all([provider.getTransaction(hash),provider.getTransactionReceipt(hash)]);
  check(tx&&r?.status===1&&same(tx.hash,hash)&&same(r.hash,hash),'Successful receipt required: '+step.name);
  check(tx.chainId===56n&&tx.nonce===step.nonce&&tx.value===0n&&same(tx.from,input.deployer)&&same(tx.data,step.data)
   &&(step.to?same(tx.to,step.to):tx.to===null),'Transaction does not match reviewed payload: '+step.name);
  check(head.number-r.blockNumber+1>=confirmations,'Insufficient receipt confirmations: '+step.name);
  check((await provider.getBlock(r.blockNumber))?.hash===r.blockHash,'Receipt block changed: '+step.name);
  if(!step.to)check(same(r.contractAddress,expected.addresses[step.name]),'Created address mismatch: '+step.name);
  receipts[step.name]={transactionHash:hash,blockNumber:r.blockNumber,blockHash:r.blockHash};
 }
 const cfg={...expected.addresses,...manifest,release:MAINNET_RELEASE,mode:'bnb-mainnet',chainId:56,
  tokenContract:'FTIReserveTokenUpgradeable',binaryContract:'FundedBinaryPlanUpgradeable',usd:input.usd,
  ...(input.owner?{owner:input.owner}:{}),...(input.walletProfile?{walletProfile:input.walletProfile}:{}),deployer:input.deployer,development:input.development,daoPartners:input.partners,genesis:input.genesis,
  constructorArgs:expected.constructorArgs,transactions,receipts,deployedBlock:Math.min(...Object.values(receipts).map(r=>r.blockNumber)),
  transferFeeBps:300,transferFeeMode:'burn',batchedRewards:true,
  collateral:{address:input.usd,codeHash:input.usdCodeHash,decimals:18},codeHashes:{},implementationCodeHashes:{},
  mainnetPlanDigest:digest,verificationBlock:{number:head.number,hash:head.hash},receiptConfirmations:confirmations,
  importedUsers:0,importedFunds:'0'};
 for(const key of ['usd','council','timelock','binary','token']){
  const code=await provider.getCode(cfg[key],head.number);check(code!=='0x','Missing code: '+key);cfg.codeHashes[key]=keccak256(code);
 }
 check(cfg.codeHashes.usd===input.usdCodeHash,'Collateral changed from reviewed input');
 for(const key of ['binary','token'])cfg.implementationCodeHashes[key]=keccak256(await provider.getCode(cfg[key+'Implementation'],head.number));
 await verifyV3Deployment(cfg,provider);
 const binary=new Contract(cfg.binary,JSON.parse(fs.readFileSync('artifacts/FundedBinaryPlanUpgradeable.json')).abi,provider);
 const token=new Contract(cfg.token,JSON.parse(fs.readFileSync('artifacts/FTIReserveTokenUpgradeable.json')).abi,provider);
 const at={blockTag:head.number};
 check(await binary.memberCount(at)===31n,'Fresh deployment must contain exactly 31 initial positions');
 for(let i=0;i<31;i++){
  check(same(await binary.memberList(i,at),input.genesis[i]),'Initial wallet order mismatch');
  check(await binary.unitsOf(input.genesis[i],at)===0n&&await binary.activatedAtSerial(input.genesis[i],at)===0n,'Initial positions must remain unpaid until ordinary purchases');
 }
 for(const role of [input.owner,input.development].filter(Boolean))check(!await binary.registered(role,at),'External role unexpectedly owns a position');
 check(await token.totalSupply(at)===0n&&await token.reserve(at)===0n&&await token.supportReserve(at)===0n,'Fresh token must start without imported supply or reserves');
 check(await binary.pointPool(at)===0n&&await binary.totalPending(at)===0n&&await binary.builderAccounted(at)===0n,'Fresh binary must start without imported rewards or debt');
  cfg.poolDistributionVersion=1;
  cfg.rewardModel='hourly-global-pool-v2';
 check((await provider.getBlock(head.number))?.hash===head.hash,'Verification block changed');
 return cfg;
}
export async function main(args=process.argv.slice(2)){
 const {values:v,positionals}=parseArgs({args,strict:true,allowPositionals:true,options:Object.fromEntries(
  [...['plan','transactions','out','confirmations'].map(k=>[k,{type:'string'}]),['help',{type:'boolean'}]])});
 if(v.help){console.log('READ ONLY: node scripts/finalize-mainnet.mjs --plan REVIEWED_PLAN.json --transactions HASHES.json --out NEW_DEPLOYMENT.json [--confirmations 12]\nFTI_MAINNET_RPC_URL required. Checks all seven transactions. Never submits or activates services.');return;}
 check(!positionals.length&&v.plan&&v.transactions&&v.out,'Plan, transaction hashes and new output required');
 assertPinnedMainnetCheckout();
 check(process.env.FTI_MAINNET_RPC_URL,'Explicit FTI_MAINNET_RPC_URL required');
 const request=new FetchRequest(process.env.FTI_MAINNET_RPC_URL);request.timeout=15000;
 const provider=new JsonRpcProvider(request,undefined,{cacheTimeout:-1,batchMaxCount:1});
 try{
  const plan=JSON.parse(fs.readFileSync(v.plan));assertApprovedMainnetProfile(plan.input);
  const cfg=await finalizeMainnet({provider,plan,transactions:JSON.parse(fs.readFileSync(v.transactions)),confirmations:Number(v.confirmations||12)});
  const fd=fs.openSync(v.out,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify(cfg,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  console.log(JSON.stringify({result:'FTI_MAINNET_DEPLOYMENT_VERIFIED',chainId:56,submitted:false,servicesActivated:false,usersImported:0,out:v.out}));
 }finally{provider.destroy();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(()=>{console.error('FTI_MAINNET_VERIFICATION_FAILED: check pinned build, plan, transaction hashes, network and new output path. No transactions submitted.');process.exitCode=1;});
