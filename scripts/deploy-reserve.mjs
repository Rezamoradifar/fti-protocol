import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {JsonRpcProvider,Wallet,ContractFactory,isAddress,ZeroAddress,getCreateAddress} from 'ethers';
import {artifact} from './lib.mjs';

const funded=process.argv.includes('--funded-plan');
const binaryContract=funded?'FundedBinaryPlan':'BinaryPlan';
// A separate testnet deployment. Never overwrite the active testnet.json or resume blindly.
const output=path.resolve(process.env.RESERVE_DEPLOYMENT_FILE||(funded?'deployments/funded-testnet.json':'deployments/reserve-testnet.json'));
const journal=output+'.progress.json';
if(output===path.resolve('deployments/testnet.json'))throw Error('Use a separate reserve-token deployment file');
if(fs.existsSync(output)||fs.existsSync(journal))throw Error('Deployment or journal already exists. Inspect it before any new transaction; do not delete a partial deployment record.');
if(!process.env.RPC_URL||!process.env.DEPLOYER_PRIVATE_KEY)throw Error('Set RPC_URL and DEPLOYER_PRIVATE_KEY locally. Never share a wallet key in chat.');
const config=JSON.parse(fs.readFileSync(process.env.CONFIG_FILE||'deployments/testnet-input.json','utf8'));
for(const[name,n]of [['genesis',31],['owners',5]])if(!Array.isArray(config[name])||config[name].length!==n||config[name].some(a=>!isAddress(a)||a.toLowerCase()===ZeroAddress)||new Set(config[name].map(a=>a.toLowerCase())).size!==n)throw Error(`Provide ${n} distinct nonzero ${name} addresses`);
if(!isAddress(config.development)||config.development.toLowerCase()===ZeroAddress)throw Error('Provide a nonzero development address');
const provider=new JsonRpcProvider(process.env.RPC_URL,undefined,{cacheTimeout:-1});
try{
 if((await provider.getNetwork()).chainId!==97n)throw Error('Reserve candidate deployment is restricted to BNB testnet chain 97');
 const signer=new Wallet(process.env.DEPLOYER_PRIVATE_KEY,provider);
 if(await provider.getBalance(signer.address)===0n)throw Error('The deployer needs test BNB for gas');
 const names=['MockUSD','Council','FTITimelock','FTIReserveToken',binaryContract];
 const artifacts=Object.fromEntries(names.map(n=>[n,artifact(n)]));
 const record={mode:'testnet',chainId:97,tokenContract:'FTIReserveToken',binaryContract,lockVersion:2,rewardModel:funded?'attributed-credit-v1':'global-pool',pricingModel:'real-reserve-v1',owner:signer.address,config,steps:[],artifactSHA256:Object.fromEntries(names.map(n=>[n,createHash('sha256').update(Buffer.from(artifacts[n].bytecode.slice(2),'hex')).digest('hex')]))};
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(journal,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
 const save=()=>{fs.writeFileSync(journal+'.tmp',JSON.stringify(record,null,2)+'\n',{mode:0o600});fs.renameSync(journal+'.tmp',journal);};
 async function deploy(name,args){
  const nonce=await provider.getTransactionCount(signer.address,'pending');const step={name,nonce,expectedAddress:getCreateAddress({from:signer.address,nonce}),status:'prepared'};record.steps.push(step);save();
  const a=artifacts[name],c=await new ContractFactory(a.abi,a.bytecode,signer).deploy(...args,{nonce});step.hash=c.deploymentTransaction().hash;step.status='broadcast';save();console.log('SENT',name,step.hash);
  const receipt=await c.deploymentTransaction().wait();if(!receipt||receipt.status!==1||receipt.contractAddress?.toLowerCase()!==step.expectedAddress.toLowerCase())throw Error('Deployment receipt mismatch: '+name);
  await c.waitForDeployment();step.status='confirmed';step.address=c.target;step.block=receipt.blockNumber;save();console.log('CONFIRMED',name,c.target);return c;
 }
 const usd=await deploy('MockUSD',[]),council=await deploy('Council',[config.owners]),timelock=await deploy('FTITimelock',[council.target]);
 const token=await deploy('FTIReserveToken',[usd.target,timelock.target,council.target]);
 const binary=await deploy(binaryContract,[usd.target,token.target,timelock.target,council.target,config.development,config.genesis]);
 const step={name:'bind',status:'prepared',nonce:await provider.getTransactionCount(signer.address,'pending')};record.steps.push(step);save();const tx=await token.bind(binary.target,{nonce:step.nonce});step.hash=tx.hash;step.status='broadcast';save();const receipt=await tx.wait();if(receipt.status!==1)throw Error('Binding failed');step.status='confirmed';save();
 if((await token.binary()).toLowerCase()!==binary.target.toLowerCase()||await token.reserve()!==0n||await token.anchorSupply()!==0n)throw Error('Unexpected initial reserve/binding state');
 const result={mode:'testnet',chainId:97,tokenContract:'FTIReserveToken',binaryContract,lockVersion:2,rewardModel:funded?'attributed-credit-v1':'global-pool',pricingModel:'real-reserve-v1',deployedBlock:record.steps[0].block,usd:usd.target,token:token.target,binary:binary.target,council:council.target,timelock:timelock.target,genesis:config.genesis,councilOwners:config.owners};
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log('SAVED',output);console.log('First paid membership allocation initializes the backed anchor. Existing deployments are unchanged.');
}catch(error){console.error('STOPPED:',error.shortMessage||error.message);console.error('Keep any progress journal. Inspect receipts and pending nonces before attempting another deployment.');process.exitCode=1;}finally{provider.destroy();}
