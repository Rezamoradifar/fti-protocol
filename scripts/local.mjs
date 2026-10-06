import fs from 'node:fs';
import ganache from 'ganache';
import {JsonRpcProvider,MaxUint256} from 'ethers';
import {deploySuite,settle} from './lib.mjs';
import {startWeb} from './server.mjs';
import {startKeeper} from './keeper.mjs';
const fundedModel=process.argv.includes('--funded-plan');
const retirementModel=process.argv.includes('--retirement-review');
if(retirementModel&&['--funded-plan','--legacy-token','--reserve-token'].some(flag=>process.argv.includes(flag)))throw Error('Choose --retirement-review without a historical token or reward model flag.');
const reserveModel=!process.argv.includes('--legacy-token');
if(fundedModel)console.warn('HISTORICAL FundedBinaryPlan: attributed credit, raw-unit ranks and hard $20 ceiling. Not the canonical review policy.');
const tokenContract=retirementModel?'FTIRetirementReviewToken':reserveModel?'FTIReserveToken':'FTIToken';
const binaryContract=fundedModel?'FundedBinaryPlan':'BinaryPlan';
const chainPort=Number(process.env.LOCAL_RPC_PORT||(retirementModel?8548:fundedModel?8547:reserveModel?8546:8545));
const configPath=retirementModel?'deployments/local-retirement.json':fundedModel?'deployments/local-funded.json':reserveModel?'deployments/local-reserve.json':'deployments/local.json';
if(reserveModel&&!process.env.PORT)process.env.PORT=retirementModel?'3084':fundedModel?'3083':'3082';
const chain=ganache.server({logging:{quiet:true},chain:{chainId:31337},wallet:{totalAccounts:45},miner:{blockGasLimit:30000000}});
await chain.listen(chainPort,'127.0.0.1');
const rpcUrl=`http://127.0.0.1:${chain.address().port}`;
const p=new JsonRpcProvider(rpcUrl,undefined,{cacheTimeout:-1});p.pollingInterval=50;
const signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));const s=await deploySuite(signers,{tokenContract,binaryContract});
for(let i=0;i<45;i++){await(await s.usd.connect(signers[i]).faucet()).wait();await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();}
for(const [i,n] of [[0,1],[1,100],[2,100]])await(await s.binary.connect(signers[i]).addUnits(n)).wait();await settle(s,p);
const cfg={mode:'local',chainId:31337,rpcUrl,tokenContract,binaryContract,lockVersion:reserveModel?3:1,rewardModel:fundedModel?'historical-attributed-credit-v1':'global-pool-paid-points-v2',pricingModel:retirementModel?'real-reserve-retirement-review':reserveModel?'real-reserve-size-fee-floor-review':'crr-20',deployedBlock:0,accounts:s.addresses,genesis:s.addresses.slice(0,31),councilOwners:s.addresses.slice(31,38),binary:s.binary.target,token:s.token.target,usd:s.usd.target,council:s.council.target,timelock:s.timelock.target};
if(retirementModel)cfg.developmentFund=await s.token.developmentFund();
fs.writeFileSync(configPath,JSON.stringify(cfg,null,2));
const web=await startWeb(configPath);const stop=startKeeper(s.binary,p);console.log('Local test assets only. Fresh chain on each start. No real funds.');
async function shutdown(){stop();web.close();await chain.close();process.exit(0);}process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);

if(process.env.UI_QA==='1'){stop();try{const {uiSmoke}=await import('./ui-smoke.mjs');await uiSmoke();await shutdown();}catch(e){console.error(e);web.close();await chain.close();process.exit(1);}}
