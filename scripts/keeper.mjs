import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,Wallet,Contract} from 'ethers';
import {artifact} from './lib.mjs';
const autoCursor=new Map();
export async function keeperStep(binary,provider){
 const funded=!!binary.interface?.hasFunction('autoAccountCount');const batch=funded?25:50;
 const phase=await binary.phase();
 if(phase>0n){await(await binary.processEpoch(batch)).wait();return 'epoch batch';}
 if(await binary.jobCursor()<await binary.jobCount()){await(await binary.processVolume(batch)).wait();return 'volume batch';}
 const now=(await provider.getBlock('latest')).timestamp;
 if(BigInt(now)>=await binary.epochEnd()){await(await binary.beginEpochClose()).wait();return 'epoch close';}
 if(await binary.monthPhase()>0n){await(await binary.processBuilderMonth(batch)).wait();return 'builder batch';}
 const key=Number(await binary.nextBuilderMonth());const monthEnd=Date.UTC(Math.floor(key/12),key%12+1,1)/1000;
 if(now>=monthEnd&&Number(await binary.lastClosedAt())>=monthEnd){await(await binary.beginBuilderMonth()).wait();return 'builder close';}
 const count=Number(await (funded?binary.autoAccountCount():binary.memberCount()));let cursor=autoCursor.get(binary.target)||0;
 for(let i=0;i<Math.min(5,count);i++){const who=await (funded?binary.autoAccounts(cursor%count):binary.memberList(cursor%count));cursor++;autoCursor.set(binary.target,cursor%count);const amount=await binary.pendingAuto(who);if(amount>0n){try{await(await binary.executeAuto(who,amount)).wait();return 'auto-buy executed';}catch{/* A failed auto-buy remains owned by the beneficiary and never blocks settlement. */}}}
 return 'idle';
}
export function startKeeper(binary,provider,interval=5000){
 if(!Number.isSafeInteger(interval)||interval<100)throw Error('Keeper interval must be an integer >=100ms');
 let stopped=false,timer;
 async function step(){let delay=interval;try{const result=await keeperStep(binary,provider);if(result!=='idle'){console.log(JSON.stringify({time:new Date().toISOString(),service:'keeper',result}));delay=0;}}catch(e){console.error(JSON.stringify({time:new Date().toISOString(),service:'keeper',error:e.shortMessage||e.message}));}finally{if(!stopped)timer=setTimeout(step,delay);}}
 timer=setTimeout(step,0);return()=>{stopped=true;clearTimeout(timer);};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const cfg=JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_FILE||'deployments/local.json'));const p=new JsonRpcProvider(process.env.RPC_URL||cfg.rpcUrl,undefined,{cacheTimeout:-1});
 if(!process.env.KEEPER_PRIVATE_KEY)throw Error('KEEPER_PRIVATE_KEY is required; it needs gas only and has no admin authority');
 const name=cfg.binaryContract||'BinaryPlan';if(!['BinaryPlan','FundedBinaryPlan'].includes(name))throw Error('Unknown reward model');
 const signer=new Wallet(process.env.KEEPER_PRIVATE_KEY,p);const c=new Contract(cfg.binary,artifact(name).abi,signer);startKeeper(c,p,Number(process.env.KEEPER_INTERVAL_MS||5000));
}
