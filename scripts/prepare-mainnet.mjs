#!/usr/bin/env node
// Read-only preparation for a NEW chain-56 deployment. No signer or send path.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {Contract,ContractFactory,FetchRequest,JsonRpcProvider,getAddress,getCreateAddress,keccak256} from 'ethers';
import {artifact} from './lib.mjs';
import {mainnetRpcUrl} from './mainnet-rpc.mjs';
import {assertSelectedMainnetCouncil} from './mainnet-council.mjs';
import {assertSelectedMainnetCollateral} from './mainnet-collateral.mjs';
import {assertApprovedMainnetProfile} from './approved-mainnet-profile.mjs';
import {releaseManifest} from './continuity-release.mjs';
import {loadMigrationBuild} from './address-migration-operator.mjs';
import {layoutDigest} from './address-migration-manifest.mjs';
import {freshDigest} from './fresh-testnet.mjs';

const ORDER=['council','timelock','tokenImplementation','token','binaryImplementation','binary'];
const MODELS={council:'SevenGuardianCouncil',timelock:'FTITimelock',tokenImplementation:'FTIReserveTokenUpgradeable',
 token:'FTIProxy',binaryImplementation:'FundedBinaryPlanUpgradeable',binary:'FTIProxy'};
const check=(ok,message)=>{if(!ok)throw Error(message);};
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const publicAddress=(value,label)=>{
 let result;try{result=getAddress(value);}catch{throw Error('Invalid public address: '+label);}
 check(!/^0x0{40}$/i.test(result),'Zero address: '+label);return result;
};
export function validateMainnetInput(input){
 check(input?.schema==='FTI_MAINNET_INPUT_V1'&&input.chainId===56,'Explicit BNB mainnet input with chainId 56 required');
 check(input.deploymentKind==='new-contracts','This planner only supports new contracts; migration needs a source snapshot');
 check(input.daoThreshold===5,'Council threshold must remain 5');
 if(input.walletProfile!==undefined)assertApprovedMainnetProfile(input);
 const owner=input.owner===undefined?undefined:publicAddress(input.owner,'owner');
 const addresses={};for(const key of ['deployer','development','usd'])addresses[key]=publicAddress(input[key],key);
 const lists={};for(const [key,count]of [['partners',7],['genesis',31]]){
  check(Array.isArray(input[key])&&input[key].length===count,'Provide exactly '+count+' '+key+' addresses');
  lists[key]=input[key].map((x,i)=>publicAddress(x,key+'['+i+']'));
  check(new Set(lists[key].map(x=>x.toLowerCase())).size===count,'Duplicate '+key+' address');
 }
 check(!same(addresses.development,owner),'Owner and development must remain distinct');
 check(!lists.genesis.some(x=>same(x,addresses.development)||same(x,owner)),'Owner/development cannot occupy genesis positions');
 check(!lists.genesis.some(x=>lists.partners.some(member=>same(x,member))),'Council wallets cannot occupy genesis positions');
 check(!same(addresses.usd,owner),'Collateral cannot be the owner');
 check(!same(addresses.usd,addresses.deployer)&&!same(addresses.usd,addresses.development)
  &&![...lists.partners,...lists.genesis].some(x=>same(x,addresses.usd)),'Collateral contract cannot be a participant wallet');
 check(/^0x[0-9a-f]{64}$/i.test(input.usdCodeHash||'')&&!/^0x0{64}$/i.test(input.usdCodeHash),'Reviewed collateral runtime code hash required');
 return {schema:input.schema,chainId:56,deploymentKind:'new-contracts',daoThreshold:5,...(owner?{owner}:{}),...(input.walletProfile?{walletProfile:input.walletProfile}:{}),...addresses,...lists,usdCodeHash:input.usdCodeHash.toLowerCase()};
}
export async function mainnetPayloads(rawInput,nonce){
 const input=validateMainnetInput(rawInput);
 check(Number.isSafeInteger(nonce)&&nonce>=0&&Number.isSafeInteger(nonce+7),'Invalid deployment nonce');
 const addresses=Object.fromEntries(ORDER.map((key,i)=>[key,getCreateAddress({from:input.deployer,nonce:nonce+i})]));
 const token=new Contract(addresses.token,artifact(MODELS.tokenImplementation).abi);
 const binary=new Contract(addresses.binary,artifact(MODELS.binaryImplementation).abi);
 const tokenInit=token.interface.encodeFunctionData('initialize',[input.usd,addresses.timelock,addresses.council]);
 const binaryInit=binary.interface.encodeFunctionData('initialize',[input.usd,addresses.token,addresses.timelock,addresses.council,input.development,input.genesis]);
 const constructorArgs={council:[input.partners],timelock:[addresses.council],tokenImplementation:[],token:[addresses.tokenImplementation,tokenInit],
  binaryImplementation:[],binary:[addresses.binaryImplementation,binaryInit]};
 const transactions=[];
 for(const [index,key]of ORDER.entries()){
  const compiled=artifact(MODELS[key]);
  const tx=await new ContractFactory(compiled.abi,compiled.bytecode).getDeployTransaction(...constructorArgs[key]);
  check((tx.data.length-2)/2<=49152,'Deployment initcode exceeds EIP-3860: '+key);
  transactions.push({name:key,chainId:56,from:input.deployer,to:null,nonce:nonce+index,value:'0',data:tx.data,dataHash:keccak256(tx.data)});
 }
 const bind=token.interface.encodeFunctionData('bind',[addresses.binary]);
 transactions.push({name:'bind',chainId:56,from:input.deployer,to:addresses.token,nonce:nonce+6,value:'0',data:bind,dataHash:keccak256(bind)});
 return {addresses,constructorArgs,transactions};
}
export async function prepareMainnet({provider,input}){
 input=validateMainnetInput(input);
 check((await provider.getNetwork()).chainId===56n,'RPC is not BNB mainnet chain 56');
 const block=await provider.getBlock('latest');check(block?.hash,'Snapshot block unavailable');
 const code=await provider.getCode(input.usd,block.number);
 check(code!=='0x'&&keccak256(code)===input.usdCodeHash,'Collateral runtime hash mismatch');
 const usd=new Contract(input.usd,['function decimals() view returns(uint8)'],provider);
 check(await usd.decimals({blockTag:block.number})===18n,'Contracts require collateral with 18 decimals');
 const nonce=await provider.getTransactionCount(input.deployer,'latest');
 check(nonce===await provider.getTransactionCount(input.deployer,'pending'),'Resolve pending deployer transactions first');
 check(Number.isSafeInteger(nonce)&&nonce>=0&&Number.isSafeInteger(nonce+7),'Invalid deployment nonce');
 const manifest=releaseManifest();check(/^[a-f0-9]{40}$/.test(manifest.sourceRevision||''),'Pinned source revision required');
 const build=loadMigrationBuild();
 const {addresses,constructorArgs,transactions}=await mainnetPayloads(input,nonce);
 const selected=[...(input.owner?[input.owner]:[]),input.deployer,input.development,input.usd,...input.partners,...input.genesis];
 for(const address of Object.values(addresses)){
  check(!selected.some(x=>same(x,address)),'Predicted contract collides with a configured wallet');
  check(await provider.getCode(address)==='0x','Predicted contract address already occupied');
  check(await provider.getTransactionCount(address)===0,'Predicted contract address has a nonce');
 }
 check(same((await provider.getBlock(block.number))?.hash,block.hash),'Snapshot block changed');
 check(nonce===await provider.getTransactionCount(input.deployer,'latest')&&nonce===await provider.getTransactionCount(input.deployer,'pending'),'Deployer nonce changed during preparation');
 const body={schema:'FTI_MAINNET_UNSIGNED_PLAN_V1',input,manifest,nonce,addresses,constructorArgs,transactions,
  collateralSnapshot:{blockNumber:block.number,blockHash:block.hash,address:input.usd,codeHash:input.usdCodeHash,decimals:18},
  layoutHashes:build.layouts.map(layoutDigest),deployerBalanceWei:String(await provider.getBalance(input.deployer)),
  initialState:{genesisPositions:31,purchasedUnits:'0',tokenSupply:'0',importedUsers:0,importedFunds:'0'},
  scope:'UNSIGNED_CONTRACT_PREPARATION_ONLY',readyToBroadcast:false,
  remaining:['Public-chain rehearsal of this release','Independent contract/security review','Approved gas budget and deployment signing',
   'Public mainnet web/Keeper/monitor activation and verification','Post-deployment receipt, roles, implementation and accounting verification'],
  notes:['No MockUSD or private wallet keys are created.','Predicted addresses are not deployed addresses.',
   'This is a fresh deployment, not a migration; test assets and old balances are not imported.',
   'Code hash and decimals do not prove collateral transfer, upgrade or issuer behavior.',
   'Do not use existing testnet deployment, migration or service scripts on mainnet.']};
 return {...body,digest:freshDigest(body)};
}
const HELP=`FTI mainnet contract preparation — READ ONLY, no signing or broadcasting.
Usage: node scripts/prepare-mainnet.mjs --config REVIEWED_PUBLIC_ADDRESSES.json --out NEW_PLAN.json
RPC: FTI_MAINNET_RPC_URL or private FTI_MAINNET_RPC_FILE (operator GetBlock; no embedded endpoint).
Input template: config/mainnet-approved-input.REQUIRED.json. Approved owner/development and exact 31-wallet order are enforced by the CLI. All addresses and collateral hash require review.
Use a clean, pinned checkout after npm ci, npm run compile and npm run build:web.
Creates seven UNSIGNED transactions. Does not deploy, import balances, generate keys or start services.
The output is preparation evidence, not a mainnet readiness approval or a broadcast command.
`;
export function assertPinnedMainnetCheckout(){
 const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 check(releaseManifest().sourceRevision===revision,'Source revision differs from checkout');
 check(execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim()==='','Use a clean committed checkout');
 check(execFileSync('git',['ls-files','--others','--exclude-standard','--','contracts','scripts','frontend','core','landing/src','config'],{encoding:'utf8'}).trim()==='','Untracked release sources require review and a commit');
}
export async function main(args=process.argv.slice(2)){
 const {values:v,positionals}=parseArgs({args,strict:true,allowPositionals:true,options:{config:{type:'string'},out:{type:'string'},help:{type:'boolean'}}});
 if(v.help){console.log(HELP);return;}
 check(positionals.length===0&&v.config&&v.out,'Use --config and --out; see --help');
 const input=validateMainnetInput(assertSelectedMainnetCollateral(assertApprovedMainnetProfile(JSON.parse(fs.readFileSync(v.config,'utf8')))));assertSelectedMainnetCouncil(input);
 assertPinnedMainnetCheckout();
 const out=path.resolve(v.out),parent=fs.realpathSync(path.dirname(out)),root=fs.realpathSync(process.cwd());
 check(parent!==root&&!parent.startsWith(root+path.sep),'Write plans outside the source checkout');
 check(!fs.existsSync(out),'Output already exists; never overwrite a reviewed plan');
 const request=new FetchRequest(mainnetRpcUrl());request.timeout=15000;
 const provider=new JsonRpcProvider(request,undefined,{cacheTimeout:-1,batchMaxCount:1});
 try{
  const plan=await prepareMainnet({provider,input});
  const fd=fs.openSync(out,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify(plan,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  console.log(JSON.stringify({result:'FTI_MAINNET_UNSIGNED_PLAN_PREPARED',digest:plan.digest,sourceRevision:plan.manifest.sourceRevision,out,transactions:7,submitted:false,readyToBroadcast:false}));
 }finally{provider.destroy();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(()=>{
 console.error('FTI_MAINNET_PREPARATION_FAILED: check input, pinned build, RPC and new output path. No transactions were submitted.');process.exitCode=1;
});
