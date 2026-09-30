import fs from 'node:fs';
import ganache from 'ganache';
import {JsonRpcProvider,MaxUint256} from 'ethers';
import {deploySuite,settle} from './lib.mjs';
import {startWeb} from './server.mjs';
import {startKeeper} from './keeper.mjs';
const chain=ganache.server({logging:{quiet:true},chain:{chainId:31337},wallet:{totalAccounts:45},miner:{blockGasLimit:30000000}});
await chain.listen(8545,'127.0.0.1');
const p=new JsonRpcProvider('http://127.0.0.1:8545',undefined,{cacheTimeout:-1});p.pollingInterval=50;
const signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));const s=await deploySuite(signers);
for(let i=0;i<45;i++){await(await s.usd.connect(signers[i]).faucet()).wait();await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();}
for(const [i,n] of [[0,1],[1,100],[2,100]])await(await s.binary.connect(signers[i]).addUnits(n)).wait();await settle(s,p);
const cfg={liquidityVersion:1,mode:'local',chainId:31337,rpcUrl:'http://127.0.0.1:8545',deployedBlock:0,accounts:s.addresses,genesis:s.addresses.slice(0,31),councilOwners:s.addresses.slice(31,36),binary:s.binary.target,token:s.token.target,usd:s.usd.target,council:s.council.target,timelock:s.timelock.target};
fs.writeFileSync('deployments/local.json',JSON.stringify(cfg,null,2));
const web=await startWeb();const stop=startKeeper(s.binary,p);console.log('Local test assets only. Fresh chain on each start. No real funds.');
async function shutdown(){stop();web.close();await chain.close();process.exit(0);}process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);

if(process.env.UI_QA==='1'){stop();try{const {uiSmoke}=await import('./ui-smoke.mjs');await uiSmoke();await shutdown();}catch(e){console.error(e);web.close();await chain.close();process.exit(1);}}
