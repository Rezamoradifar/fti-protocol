import fs from 'node:fs';
import {ContractFactory,Contract,parseEther} from 'ethers';
export function artifact(name){return JSON.parse(fs.readFileSync(`artifacts/${name}.json`));}
export async function deployOne(name,args,signer){const a=artifact(name);const c=await new ContractFactory(a.abi,a.bytecode,signer).deploy(...args);await c.waitForDeployment();return c;}
export async function deploySuite(signers,{tokenContract='FTIToken',binaryContract='BinaryPlan'}={}){
 if(!['FTIToken','FTIReserveToken'].includes(tokenContract))throw Error('Unknown token model');
 if(!['BinaryPlan','FundedBinaryPlan'].includes(binaryContract))throw Error('Unknown reward model');
 const addresses=await Promise.all(signers.map(s=>s.getAddress()));if(addresses.length<36)throw Error('Need 31 genesis wallets and 5 council signers');
 const usd=await deployOne('MockUSD',[],signers[0]);const council=await deployOne('Council',[addresses.slice(31,36)],signers[0]);
 const timelock=await deployOne('FTITimelock',[council.target],signers[0]);
 const token=await deployOne(tokenContract,[usd.target,timelock.target,council.target],signers[0]);
 const binary=await deployOne(binaryContract,[usd.target,token.target,timelock.target,council.target,addresses[35],addresses.slice(0,31)],signers[0]);
 await(await token.bind(binary.target)).wait();return{usd,council,timelock,token,binary,addresses};
}
export async function checkAccounting(s){for(const c of [s.binary,s.token]){const[a,b]=await c.accounting();if(a!==b)throw Error(`Accounting mismatch ${c.target}: ${a} vs ${b}`);}}
export async function drainVolume(s,batch=100){while(await s.binary.jobCursor()<await s.binary.jobCount())await(await s.binary.processVolume(batch,{gasLimit:12000000})).wait();}
export async function settle(s,provider,batch=100){await drainVolume(s,batch);const b=await provider.getBlock('latest');const end=Number(await s.binary.epochEnd());await provider.send('evm_increaseTime',[Math.max(0,end-b.timestamp+1)]);await provider.send('evm_mine',[]);await(await s.binary.beginEpochClose()).wait();while(await s.binary.phase()>0n)await(await s.binary.processEpoch(batch,{gasLimit:12000000})).wait();await checkAccounting(s);}
