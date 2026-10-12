#!/usr/bin/env node
// New testnet contracts only. No old deployment file, upgrade or importer is read.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {Contract, ContractFactory, FetchRequest, JsonRpcProvider, Wallet, getAddress, getCreateAddress, keccak256} from 'ethers';
import {artifact} from './lib.mjs';
import {RELEASE, releaseManifest, verifyV3Deployment} from './continuity-release.mjs';
import {createBudget, readPrivateKey} from './address-migration-policy.mjs';

const BINARY='FundedBinaryPlanUpgradeable', TOKEN='FTIReserveTokenUpgradeable';
const ORDER=['usd','council','timelock','tokenImplementation','token','binaryImplementation','binary'];
const MODELS={usd:'MockUSD',council:'SevenGuardianCouncil',timelock:'FTITimelock',tokenImplementation:TOKEN,binaryImplementation:BINARY,token:'FTIProxy',binary:'FTIProxy'};
const encode=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const freshDigest=value=>createHash('sha256').update(encode(canonical(value))).digest('hex');
export class FreshError extends Error {}
const check=(ok,message)=>{if(!ok)throw new FreshError(message);};
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const addr=value=>{try{const a=getAddress(value);check(!/^0x0{40}$/i.test(a),'Zero address');return a;}catch{throw new FreshError('Invalid nonzero public wallet address');}};
export function validateFreshInput({chainId,deployer,partners,testGenesis}) {
  check(chainId===97||chainId===31337,'TESTNET/LOCAL ONLY: chain must be 97 or 31337');
  check(testGenesis===true,'Explicit test-genesis consent required: 31 fresh unpurchased bootstrap positions');
  deployer=addr(deployer);
  check(Array.isArray(partners)&&partners.length===7,'Exactly seven council wallet addresses required');
  partners=partners.map(addr);
  check(new Set(partners.map(x=>x.toLowerCase())).size===7,'Council wallet addresses must be unique');
  return {chainId,deployer,partners,testGenesis:true};
}
async function expectedPlan(input,genesis,nonce) {
  input=validateFreshInput(input);
  check(Number.isSafeInteger(nonce)&&nonce>=0&&Number.isSafeInteger(nonce+8),'Invalid deployment nonce');
  check(Array.isArray(genesis)&&genesis.length===31,'Exactly 31 fresh bootstrap positions required');
  genesis=genesis.map(addr);
  check(same(genesis[0],input.deployer)&&new Set(genesis.map(a=>a.toLowerCase())).size===31,'Invalid bootstrap root or duplicate positions');
  check(genesis.slice(1).every(a=>!input.partners.some(b=>same(a,b))),'Test helper must not be a council wallet');
  const manifest=releaseManifest();
  if(input.chainId===97)check(/^[a-f0-9]{40}$/.test(manifest.sourceRevision||''),'Pinned source revision required for public testnet');
  check(artifact(BINARY).abi.some(f=>f.type==='function'&&f.name==='setAutoBuyPercent'),'Build lacks the new Builder controls');
  const addresses=Object.fromEntries(ORDER.map((key,i)=>[key,getCreateAddress({from:input.deployer,nonce:nonce+i})]));
  const ti=new Contract(addresses.token,artifact(TOKEN).abi);
  const bi=new Contract(addresses.binary,artifact(BINARY).abi);
  const tokenInit=ti.interface.encodeFunctionData('initialize',[addresses.usd,addresses.timelock,addresses.council]);
  const binaryInit=bi.interface.encodeFunctionData('initialize',[addresses.usd,addresses.token,addresses.timelock,addresses.council,input.deployer,genesis]);
  const args={usd:[],council:[input.partners],timelock:[addresses.council],tokenImplementation:[],token:[addresses.tokenImplementation,tokenInit],binaryImplementation:[],binary:[addresses.binaryImplementation,binaryInit]};
  const transactions=[];
  for(const [i,key] of ORDER.entries()){
    const a=artifact(MODELS[key]);
    const tx=await new ContractFactory(a.abi,a.bytecode).getDeployTransaction(...args[key]);
    transactions.push({name:key,to:null,nonce:nonce+i,value:'0',data:tx.data});
  }
  transactions.push({name:'bind',to:addresses.token,nonce:nonce+7,value:'0',data:ti.interface.encodeFunctionData('bind',[addresses.binary])});
  return {schema:'FTI_FRESH_TESTNET_PLAN_V1',...input,nonce,genesis,manifest,addresses,constructorArgs:args,transactions,
    warning:'NEW TESTNET CONTRACTS, NOT A MIGRATION. 31 fresh unpurchased bootstrap positions; zero protocol balances. Predicted addresses are NOT deployed addresses.'};
}
async function ready(provider,input,nonce){
  check((await provider.getNetwork()).chainId===BigInt(input.chainId),'RPC network mismatch');
  const latest=await provider.getTransactionCount(input.deployer,'latest'),pending=await provider.getTransactionCount(input.deployer,'pending');
  check(latest===pending,'Deployer has pending transactions; resolve them first');
  if(nonce!==undefined)check(latest===nonce,'Deployment nonce changed; do not blindly retry');
  return latest;
}
export async function prepareFresh({provider,...input}) {
  input=validateFreshInput(input);
  const nonce=await ready(provider,input);
  const wallets=[];const seen=new Set([input.deployer,...input.partners].map(a=>a.toLowerCase()));
  while(wallets.length<30){const w=Wallet.createRandom();if(!seen.has(w.address.toLowerCase())){wallets.push(w);seen.add(w.address.toLowerCase());}}
  const body=await expectedPlan(input,[input.deployer,...wallets.map(w=>w.address)],nonce);
  for(const a of Object.values(body.addresses))check(await provider.getCode(a)==='0x','Predicted address already has code');
  return {plan:{...body,digest:freshDigest(body)},testKeys:{warning:'PRIVATE TESTNET HELPERS. Never use or fund on mainnet. Not council keys.',
    wallets:wallets.map(w=>({address:w.address,privateKey:w.privateKey}))}};
}
export async function validateFreshPlan(plan){
  check(plan?.schema==='FTI_FRESH_TESTNET_PLAN_V1','Not a fresh-deployment plan');
  const {digest,...body}=plan;
  check(/^[a-f0-9]{64}$/.test(digest||'')&&freshDigest(body)===digest,'Plan digest mismatch');
  const expected=await expectedPlan(plan,plan.genesis,plan.nonce);
  check(freshDigest(expected)===digest,'Plan/build mismatch or arbitrary transaction data');
  return plan;
}
export async function deployFresh({provider,signer,plan,confirmPlan,budget,confirmations=2,onEvent=async()=>{}}){
  await validateFreshPlan(plan);
  check(confirmPlan===plan.digest,'Explicit reviewed plan digest required');
  check(Number.isSafeInteger(confirmations)&&confirmations>=1&&confirmations<=64,'Invalid confirmation count');
  check(same(await signer.getAddress(),plan.deployer),'Signing wallet differs from reviewed deployer');
  check(signer.provider&&(await signer.provider.getNetwork()).chainId===BigInt(plan.chainId),'Signing network mismatch');
  await ready(provider,plan,plan.nonce);
  check(budget&&typeof budget.reserve==='function','Explicit gas budget required');
  const receipts={},transactions={};
  for(const a of Object.values(plan.addresses))check(await provider.getCode(a)==='0x','Fresh contract address already occupied');
  for(const step of plan.transactions){
    await ready(provider,plan,step.nonce);
    const {gasPrice}=await provider.getFeeData();check(gasPrice!==null&&gasPrice>0n,'Gas price unavailable');
    const request={...(step.to?{to:step.to}:{}),from:plan.deployer,data:step.data,value:0n,nonce:step.nonce,chainId:plan.chainId};
    const estimate=await provider.estimateGas(request),limits=budget.reserve((estimate*120n+99n)/100n+10000n,gasPrice);
    check(await provider.getBalance(plan.deployer)>=limits.gasLimit*limits.gasPrice,'Insufficient test gas balance');
    await onEvent({stage:step.name,status:'PREPARED',nonce:step.nonce,dataHash:keccak256(step.data),feeReservedWei:String(budget.reserved)});
    const tx=await signer.sendTransaction({...request,...limits});
    await onEvent({stage:step.name,status:'SUBMITTED',hash:tx.hash,nonce:step.nonce});
    const receipt=await tx.wait(confirmations);
    check(receipt?.status===1,'Creation/binding transaction failed');
    if(step.to===null)check(same(receipt.contractAddress,plan.addresses[step.name]),'New contract address mismatch');
    const block=await provider.getBlock(receipt.blockNumber);
    check(block&&same(block.hash,receipt.blockHash),'Deployment receipt was reorganized');
    transactions[step.name]=tx.hash;
    receipts[step.name]={hash:tx.hash,status:1,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,contractAddress:receipt.contractAddress};
    await onEvent({...receipts[step.name],stage:step.name,receiptStatus:1,status:'CONFIRMED'});
  }
  const cfg={release:RELEASE,...plan.manifest,...plan.addresses,tokenContract:TOKEN,binaryContract:BINARY,councilContract:'SevenGuardianCouncil',
    batchedRewards:true,mode:plan.chainId===97?'bnb-testnet':'local',chainId:plan.chainId,deployedAt:new Date().toISOString(),
    deployedBlock:receipts.bind.blockNumber,deployer:plan.deployer,governance:plan.addresses.timelock,governanceDelay:259200,
    development:plan.deployer,daoThreshold:5,daoPartners:plan.partners,genesis:plan.genesis,
    tradeFeeBps:300,reserveFeeBps:300,transferFeeBps:300,transferFeeMode:'burn',charityEnabled:false,
    initialQuotePrice:'100000000000000000',restartQuotePrice:'200000000000000000',smallSellExemptionUSD:'500000000000000000000',
    pointValuePolicy:'protection-target-20',finalExitFeeDestination:'development',supportPolicy:'minimum-ath-repair-no-sale-veto',
    constructorArgs:plan.constructorArgs,transactions,receipts,codeHashes:{},deploymentKind:'fresh-testnet',planDigest:plan.digest,
    importedUsers:0,importedFunds:'0',secretsFile:'test-genesis-keys.json',
    note:'TESTNET ONLY. New contracts with 31 fresh bootstrap positions, no purchased units. MockUSD has no monetary value. Not a mainnet release.'};
  const at={blockTag:receipts.bind.blockNumber};
  for(const [key,address]of Object.entries(plan.addresses))cfg.codeHashes[key]=keccak256(await provider.getCode(address,at.blockTag));
  cfg.implementationCodeHashes={token:cfg.codeHashes.tokenImplementation,binary:cfg.codeHashes.binaryImplementation};
  const {binary,token}=await verifyV3Deployment(cfg,provider);
  check(await binary.memberCount(at)===31n,'Unexpected initial member count');
  const fields=['epochUnits','unitsSinceSettlement','pointPool','builderAccounted','totalPending','totalAuto','jobCount','rewardAccountCount','autoAccountCount'];
  for(const field of fields)check(await binary[field](at)===0n,'Nonzero fresh binary accounting: '+field);
  for(const wallet of plan.genesis)check((await binary.members(wallet,at)).units===0n,'Bootstrap position has purchased units');
  for(const c of [binary,token]){const a=await c.accounting(at);check(a[0]===0n&&a[1]===0n,'Nonzero fresh collateral');}
  check(await token.totalSupply(at)===0n&&await token.price(at)===0n,'Unexpected supply/spot price');
  check(await binary.autoBuyPercent(plan.deployer,at)===5n,'New percentage getter unavailable');
  cfg.initialState={blockNumber:at.blockTag,blockHash:receipts.bind.blockHash,memberCount:31,purchasedUnits:'0',totalSupply:'0',
    reserve:'0',supportReserve:'0',price:'0',bootstrapQuotePrice:cfg.initialQuotePrice,binaryCollateral:'0',tokenCollateral:'0',pending:'0',automatic:'0'};
  // The spot price is zero at zero supply; the 0.10 bootstrap quote is separate.
  await onEvent({stage:'verify',status:'VERIFIED',blockNumber:at.blockTag,importedUsers:0});
  return cfg;
}
function privateRead(file){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const s=fs.fstatSync(fd);check(s.isFile()&&s.size<5_000_000,'Invalid input file');return JSON.parse(fs.readFileSync(fd,'utf8'));}
  finally{fs.closeSync(fd);}
}
function saveNew(file,value){const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,encode(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
const HELP=`FTI fresh testnet deployment (no old users, funds, contracts or service changes)
After a pinned checkout: npm ci && npm run compile && npm run build:web && npm --prefix landing run build
Plan (no signer):
  node scripts/fresh-testnet.mjs plan --chain 97 --deployer PUBLIC_ADDRESS --dao-file NEW_DAO.json --test-genesis --out NEW_PRIVATE_DIRECTORY
Deploy reviewed plan (8 sequential transactions; gas budget per invocation):
  node scripts/fresh-testnet.mjs deploy --out SAME_PRIVATE_DIRECTORY --send --confirm-plan PRINTED_DIGEST --key-file PRIVATE_0600_FILE --max-fee-wei APPROVED_BUDGET --max-gas-price-wei APPROVED_CEILING [--confirmations 2]
RPC: FTI_FRESH_RPC_URL. No RPC/key/config defaults from the existing service.
DAO file: {"threshold":5,"partners":[seven explicitly selected nonzero wallet addresses]}.
The current initializer requires 31 test bootstrap positions: deployer + 30 newly generated wallets, all with zero units/balances. --test-genesis explicitly accepts this; it does not import old users.
Output MUST be outside the source checkout, new for plan, private for deploy. Secrets stay in test-genesis-keys.json, never in GitHub/chat.
If a send fails, partial new contracts may remain. Do not delete deployment.started.json or blindly retry. Inspect journal.jsonl and receipts; old deployments are never modified.
No old-council approvals are required for NEW creation. Future governed upgrades use the NEW 5-of-7 council and 72-hour Timelock.
`;
export async function main(args=process.argv.slice(2)){
  const {values:v,positionals:p}=parseArgs({args,allowPositionals:true,strict:true,options:Object.fromEntries([
    ...['chain','deployer','dao-file','out','confirm-plan','key-file','max-fee-wei','max-gas-price-wei','confirmations'].map(k=>[k,{type:'string'}]),
    ...['test-genesis','send','help'].map(k=>[k,{type:'boolean'}])])});
  if(v.help){console.log(HELP);return;}
  check(p.length===1&&['plan','deploy'].includes(p[0]),'Choose plan or deploy; see --help');
  check(v.out,'New private output directory required');
  const out=path.resolve(v.out),root=fs.realpathSync(process.cwd());
  const parent=fs.realpathSync(path.dirname(out));
  check(parent!==root&&!parent.startsWith(root+path.sep),'Output must be outside the source checkout');
  const rpc=process.env.FTI_FRESH_RPC_URL;check(rpc,'FTI_FRESH_RPC_URL required');
  const request=new FetchRequest(rpc);request.timeout=15000;
  const provider=new JsonRpcProvider(request,undefined,{cacheTimeout:-1,batchMaxCount:1});
  try{
    if(p[0]==='plan'){
      check(!v.send&&!v['key-file'],'Planning must not use a signing key or --send');
      check(v['dao-file'],'Explicit new-council file required');
      const dao=privateRead(v['dao-file']);check(dao.threshold===5,'DAO threshold must remain 5');
      const input=validateFreshInput({chainId:Number(v.chain),deployer:v.deployer,partners:dao.partners,testGenesis:v['test-genesis']});
      fs.mkdirSync(out,{mode:0o700}); // exclusive: existing plan folders are never overwritten
      const {plan,testKeys}=await prepareFresh({provider,...input});
      saveNew(path.join(out,'test-genesis-keys.json'),testKeys);saveNew(path.join(out,'plan.json'),plan);
      console.log(encode({result:'FTI_FRESH_PLAN_READY',chainId:plan.chainId,digest:plan.digest,out,transactions:8,deployed:false,importedUsers:0}));
    }else{
      check(v.send===true&&v['confirm-plan']&&v['key-file'],'Explicit --send, plan digest and private key file required');
      const s=fs.lstatSync(out);check(s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o077)===0,'Output directory must be private (0700)');
      const plan=privateRead(path.join(out,'plan.json'));await validateFreshPlan(plan);
      check(v['confirm-plan']===plan.digest,'Confirmation must match the reviewed plan');
      const budget=createBudget({maxFeeWei:v['max-fee-wei'],maxGasPriceWei:v['max-gas-price-wei'],maxGas:12000000,maxTransactions:8});
      const confirmations=Number(v.confirmations??2);
      check(Number.isSafeInteger(confirmations)&&confirmations>=1&&confirmations<=64,'Invalid confirmation count');
      // Keep this exclusive marker even on failure to prevent accidental double creation.
      saveNew(path.join(out,'deployment.started.json'),{planDigest:plan.digest,startedAt:new Date().toISOString()});
      const journal=fs.openSync(path.join(out,'journal.jsonl'),'wx',0o600);
      try{
        const signer=new Wallet(readPrivateKey(v['key-file']),provider);
        const cfg=await deployFresh({provider,signer,plan,confirmPlan:v['confirm-plan'],budget,confirmations,
          onEvent:async e=>{fs.writeSync(journal,encode(e)+'\n');fs.fsyncSync(journal);}});
        saveNew(path.join(out,'deployment.json'),cfg);
        const result={result:'FTI_FRESH_TESTNET_DEPLOYED',chainId:cfg.chainId,sourceRevision:cfg.sourceRevision,addresses:plan.addresses,
          deploymentFile:path.join(out,'deployment.json'),initialState:cfg.initialState,importedUsers:0,importedFunds:'0',servicesChanged:false};
        saveNew(path.join(out,'result.json'),result);console.log(encode(result));
      }catch(e){saveNew(path.join(out,'failure.json'),{result:'FAILED_OR_PARTIAL_DEPLOYMENT',note:'Inspect journal.jsonl before any retry. Old contracts/services were not modified.'});throw e;}
      finally{fs.closeSync(journal);}
    }
  }finally{provider.destroy();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{
  console.error('FTI_FRESH_FAILED: '+(e instanceof FreshError?e.message:'RPC, file or signing failure. Inspect the private journal; do not share secrets.'));process.exitCode=1;
});
