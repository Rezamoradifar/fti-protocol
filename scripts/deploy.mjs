import fs from 'node:fs';
import {JsonRpcProvider,Wallet,isAddress} from 'ethers';
import {deployOne} from './lib.mjs';
if(!process.env.RPC_URL||!process.env.DEPLOYER_PRIVATE_KEY)throw Error('Set RPC_URL and DEPLOYER_PRIVATE_KEY in your own environment');
const p=new JsonRpcProvider(process.env.RPC_URL);const chainId=Number((await p.getNetwork()).chainId);
if(![97,31337].includes(chainId))throw Error('Deployment is restricted to BNB testnet (97) and local (31337). Mainnet release not approved.');
const config=JSON.parse(fs.readFileSync(process.env.CONFIG_FILE||'deployments/testnet-input.json'));
for(const [name,length]of [['genesis',31],['owners',5]]){if(config[name]?.length!==length||new Set(config[name].map(x=>x.toLowerCase())).size!==length||config[name].some(x=>!isAddress(x)||/^0x0{40}$/i.test(x)))throw Error(`Provide ${length} unique nonzero ${name} addresses`);}
if(!isAddress(config.development))throw Error('development address required');
const signer=new Wallet(process.env.DEPLOYER_PRIVATE_KEY,p);
const usd=await deployOne('MockUSD',[],signer);const council=await deployOne('Council',[config.owners],signer);const timelock=await deployOne('FTITimelock',[council.target],signer);const token=await deployOne('FTIToken',[usd.target,timelock.target,council.target],signer);const binary=await deployOne('BinaryPlan',[usd.target,token.target,timelock.target,council.target,config.development,config.genesis],signer);await(await token.bind(binary.target)).wait();
const result={mode:'testnet',chainId,deployedBlock:(await binary.deploymentTransaction().wait()).blockNumber,usd:usd.target,token:token.target,binary:binary.target,council:council.target,timelock:timelock.target,genesis:config.genesis,councilOwners:config.owners};fs.writeFileSync('deployments/testnet.json',JSON.stringify(result,null,2));console.log('Saved deployments/testnet.json. All USD in this deployment is explicitly TEST ONLY.');
