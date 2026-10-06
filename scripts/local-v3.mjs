import fs from 'node:fs';
import ganache from 'ganache';
import {JsonRpcProvider,MaxUint256} from 'ethers';
import {deployOne,settle} from './lib.mjs';
import {startV3Web} from './server-v3.mjs';
import {startKeeper} from './keeper.mjs';

const chainPort=Number(process.env.LOCAL_RPC_PORT||8553);
if(!process.env.PORT)process.env.PORT='3084';

const chain=ganache.server({
  logging:{quiet:true},
  chain:{chainId:31337,time:new Date('2026-10-07T12:00:00Z')},
  wallet:{totalAccounts:45},
  miner:{blockGasLimit:30000000}
});

await chain.listen(chainPort,'127.0.0.1');

const rpcUrl=`http://127.0.0.1:${chainPort}`;
const provider=new JsonRpcProvider(rpcUrl,undefined,{cacheTimeout:-1});
provider.pollingInterval=50;

const signers=await Promise.all(Array.from({length:45},(_,i)=>provider.getSigner(i)));
const addresses=await Promise.all(signers.map(s=>s.getAddress()));

const usd=await deployOne('MockUSD',[],signers[0]);
const council=await deployOne('SevenGuardianCouncil',[addresses.slice(31,38)],signers[0]);
const token=await deployOne(
  'FTIReserveTokenV3',
  [usd.target,addresses[40],council.target,addresses[38],addresses[39]],
  signers[0]
);
const binary=await deployOne(
  'FundedBinaryPlan',
  [usd.target,token.target,addresses[40],council.target,addresses[41],addresses.slice(0,31)],
  signers[0]
);
await (await token.bind(binary.target)).wait();

for(let i=0;i<45;i++){
  await (await usd.connect(signers[i]).faucet()).wait();
  await (await usd.connect(signers[i]).approve(binary.target,MaxUint256)).wait();
  await (await usd.connect(signers[i]).approve(token.target,MaxUint256)).wait();
}

for(const [i,n] of [[0,1],[1,100],[2,100]]){
  await (await binary.connect(signers[i]).addUnits(n)).wait();
}
await settle({binary,token,usd},provider);

const cfg={
  release:'FTI_V3_ZERO_START',
  mode:'local',
  chainId:31337,
  rpcUrl,
  tokenContract:'FTIReserveTokenV3',
  binaryContract:'FundedBinaryPlan',
  councilContract:'SevenGuardianCouncil',
  lockVersion:0,
  liquidityVersion:3,
  pricingModel:'zero-start-reserve-v3',
  rewardModel:'attributed-credit-v1',
  deployedBlock:0,
  accounts:addresses,
  genesis:addresses.slice(0,31),
  daoThreshold:5,
  daoPartners:addresses.slice(31,38),
  charityWalletA:addresses[38],
  charityWalletB:addresses[39],
  governance:addresses[40],
  development:addresses[41],
  usd:usd.target,
  council:council.target,
  token:token.target,
  binary:binary.target
};

fs.mkdirSync('deployments',{recursive:true});
const configPath='deployments/local-v3.json';
fs.writeFileSync(configPath,JSON.stringify(cfg,null,2));

const web=await startV3Web(configPath);
const stop=startKeeper(binary.connect(signers[42]),provider,250);

console.log('FTI V3 local test assets only. Fresh chain on each start. No real funds.');

async function shutdown(){
  stop();
  await new Promise(resolve=>web.close(resolve));
  await chain.close();
  provider.destroy();
}

process.on('SIGINT',async()=>{await shutdown();process.exit(0);});
process.on('SIGTERM',async()=>{await shutdown();process.exit(0);});
