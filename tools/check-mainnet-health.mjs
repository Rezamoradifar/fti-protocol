// Read-only operational snapshot. Never loads a private key or submits a transaction.
import fs from 'node:fs';
import {JsonRpcProvider,FetchRequest,isAddress} from 'ethers';
const cfg=JSON.parse(fs.readFileSync(new URL('../deployments/mainnet-20261016.json',import.meta.url)));
const keeper=process.argv[2];
if(!isAddress(keeper||''))throw Error('Pass the public Keeper wallet address.');
const rpcUrl=process.env.FTI_HEALTH_RPC_URL||'https://bsc-dataseed.bnbchain.org';
if(new URL(rpcUrl).protocol!=='https:')throw Error('HTTPS RPC required.');
const transport=new FetchRequest(rpcUrl);transport.timeout=20000;
const rpc=new JsonRpcProvider(transport,56,{staticNetwork:true});
try{
 const chain=await rpc.send('eth_chainId',[]);if(BigInt(chain)!==56n)throw Error('Wrong chain');
 const response=await fetch('https://ftiprotocol.com/api/state',{signal:AbortSignal.timeout(20000),cache:'no-store'});
 if(!response.ok)throw Error('State unavailable');const state=await response.json();
 const [head,balance,token,binary]=await Promise.all([rpc.getBlock('latest'),rpc.getBalance(keeper),rpc.getCode(cfg.token),rpc.getCode(cfg.binary)]);
 const lag=head.timestamp-Number(state.timestamp),fresh=Number.isFinite(lag)&&lag>=-30&&lag<=120;
 const minimum=BigInt(process.env.FTI_KEEPER_MIN_GAS_WEI||'1000000000000000');
 const result={result:'FTI_MAINNET_READ_ONLY_HEALTH',chainId:56,contractsHaveCode:token!=='0x'&&binary!=='0x',apiFresh:fresh,apiAgeSeconds:lag,epoch:state.epoch,phase:state.phase,monthPhase:state.monthPhase,rewardQueue:state.rewardQueue,depositWindowOpen:fresh&&Number(state.phase)===0&&Number(state.monthPhase)===0&&!state.paused&&!state.binaryRecoveryFrozen&&head.timestamp<Number(state.epochEnd),keeper,keeperBalanceWei:String(balance),lowGas:balance<minimum,warningThresholdWei:String(minimum),transactionsSent:0};
 console.log(JSON.stringify(result));
 if(!fresh||!result.contractsHaveCode||result.lowGas)process.exitCode=2;
}catch{console.error('FTI_HEALTH_CHECK_FAILED: verify HTTPS/API/RPC connectivity. No transaction sent.');process.exitCode=1;}finally{rpc.destroy();}
