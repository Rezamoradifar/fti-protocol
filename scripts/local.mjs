import fs from 'node:fs';
import ganache from 'ganache';
import {JsonRpcProvider,MaxUint256} from 'ethers';
import {deploySuite,settle} from './lib.mjs';
import {startWeb} from './server.mjs';
import {startKeeper} from './keeper.mjs';
const fundedModel=process.argv.includes('--funded-plan');
const reserveModel=fundedModel||process.argv.includes('--reserve-token');
const tokenContract=reserveModel?'FTIReserveToken':'FTIToken';
const binaryContract=fundedModel?'FundedBinaryPlan':'BinaryPlan';
const chainPort=Number(process.env.LOCAL_RPC_PORT||(fundedModel?8547:reserveModel?8546:8545));
const configPath=fundedModel?'deployments/local-funded.json':reserveModel?'deployments/local-reserve.json':'deployments/local.json';
if(reserveModel&&!process.env.PORT)process.env.PORT=fundedModel?'3083':'3082';
const chain=ganache.server({logging:{quiet:true},chain:{chainId:31337},wallet:{totalAccounts:45},miner:{blockGasLimit:30000000}});
await chain.listen(chainPort,'127.0.0.1');
const rpcUrl=`http://127.0.0.1:${chainPort}`;
const p=new JsonRpcProvider(rpcUrl,undefined,{cacheTimeout:-1});p.pollingInterval=50;
const signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));const s=await deploySuite(signers,{tokenContract,binaryContract});
for(let i=0;i<45;i++){await(await s.usd.connect(signers[i]).faucet()).wait();await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();}
for(const [i,n] of [[0,1],[1,100],[2,100]])await(await s.binary.connect(signers[i]).addUnits(n)).wait();await settle(s,p);
const cfg={mode:'local',chainId:31337,rpcUrl,tokenContract,binaryContract,lockVersion:reserveModel?3:1,rewardModel:fundedModel?'attributed-credit-v1':'global-pool',pricingModel:reserveModel?'real-reserve-v2-zero-start':'crr-20',deployedBlock:0,accounts:s.addresses,genesis:s.addresses.slice(0,31),councilOwners:s.addresses.slice(31,38),animalSupport:reserveModel?s.addresses.slice(-2):[],binary:s.binary.target,token:s.token.target,usd:s.usd.target,council:s.council.target,timelock:s.timelock.target};
fs.writeFileSync(configPath,JSON.stringify(cfg,null,2));
const web=await startWeb(configPath);const stop=startKeeper(s.binary,p);console.log('Local test assets only. Fresh chain on each start. No real funds.');
async function shutdown(){stop();web.close();await chain.close();process.exit(0);}process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);

if(process.env.UI_QA==='1'){stop();try{const {uiSmoke}=await import('./ui-smoke.mjs');await uiSmoke();await shutdown();}catch(e){console.error(e);web.close();await chain.close();process.exit(1);}}
