import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,Contract,isAddress} from 'ethers';
import {artifact} from './lib.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function startWeb(configPath=process.env.DEPLOYMENT_FILE||'deployments/local.json'){
 const cfg=JSON.parse(fs.readFileSync(configPath));const rpc=process.env.RPC_URL||cfg.rpcUrl;const provider=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1});
 const contracts=Object.fromEntries(['binary','token','usd','council','timelock'].map(k=>[k,new Contract(cfg[k],artifact({binary:'BinaryPlan',token:'FTIToken',usd:'MockUSD',council:'Council',timelock:'FTITimelock'}[k]).abi,provider)]));
 const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||3000);const publicConfig={...cfg};delete publicConfig.rpcUrl;
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data,(_,v)=>typeof v==='bigint'?v.toString():v));};
 const readMethods=new Set(['eth_chainId','eth_blockNumber','eth_call','eth_getBalance','eth_getCode','eth_getLogs','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBlockByNumber','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getTransactionCount']);
 async function body(req){let raw='';for await(const c of req){raw+=c;if(raw.length>65536)throw Error('Request too large');}return JSON.parse(raw);}
 const server=http.createServer(async(req,res)=>{try{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
  const url=new URL(req.url,'http://localhost');
  if(req.method==='POST'){
   const origin=req.headers.origin;if(origin&&new URL(origin).host!==req.headers.host)return json(res,403,{error:'Cross-origin denied'});
   if(url.pathname==='/rpc'){
    const data=await body(req);const items=Array.isArray(data)?data:[data];if(items.length>50)throw Error('Batch too large');
    for(const item of items)if(!readMethods.has(item.method)&&!(cfg.mode==='local'&&['eth_accounts','eth_sendTransaction','eth_signTypedData_v4','personal_sign'].includes(item.method)))throw Error('RPC method not allowed');
    const response=await fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});return json(res,200,await response.json());
   }
   if(url.pathname==='/api/dev/time'&&cfg.mode==='local'){
    const {seconds}=await body(req);if(!Number.isSafeInteger(seconds)||seconds<1||seconds>100*86400)throw Error('Invalid interval');await provider.send('evm_increaseTime',[seconds]);await provider.send('evm_mine',[]);return json(res,200,{ok:true});
   }
   return json(res,404,{error:'Not found'});
  }
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  if(url.pathname==='/health'){const block=await provider.getBlockNumber();return json(res,200,{ok:true,chainId:cfg.chainId,block,mode:cfg.mode});}
  if(url.pathname==='/api/config')return json(res,200,publicConfig);
  if(url.pathname==='/api/state'){
   const {binary:b,token:t,usd}=contracts;const address=url.searchParams.get('wallet');if(address&&!isAddress(address))throw Error('Invalid address');
   const [price,supply,reserve,bb,floor,ath,clock,count,epoch,epochEnd,phase,level,pointPool,pending,auto,jobCursor,jobCount,cursor,monthPhase,nextMonth,paused,tokenPaused,account1,account2,block]=await Promise.all([t.price(),t.totalSupply(),t.reserve(),t.buybackFund(),t.floorFund(),t.ath(),t.walletClock(),b.memberCount(),b.epoch(),b.epochEnd(),b.phase(),b.protectionLevel(),b.pointPool(),b.totalPending(),b.totalAuto(),b.jobCursor(),b.jobCount(),b.cursor(),b.monthPhase(),b.nextBuilderMonth(),b.paused(),t.paused(),b.accounting(),t.accounting(),provider.getBlock('latest')]);
   const result={price,supply,reserve,bb,floor,ath,clock,count,epoch,epochEnd,phase,level,pointPool,pending,auto,jobCursor,jobCount,cursor,monthPhase,nextMonth,paused,tokenPaused,account1,account2,block:block.number,timestamp:block.timestamp};
   if(address){const m=await b.members(address);const [usdBalance,ftiBalance,unlocked,remaining,claimable,autoPending,locks]=await Promise.all([usd.balanceOf(address),t.balanceOf(address),t.unlocked(address),t.remainingAllowance(address),b.pendingReward(address),b.pendingAuto(address),t.lockInfo(address)]);result.wallet={address,parent:m.parent,left:m.left,right:m.right,units:m.units,carryL:m.carryL,carryR:m.carryR,lifetimeL:m.lifetimeL,lifetimeR:m.lifetimeR,rank:m.rank,exists:m.exists,autoEnabled:m.autoEnabled,maxAutoPrice:m.maxAutoPrice,usdBalance,ftiBalance,unlocked,remaining,claimable,autoPending,locks:locks.map(l=>({amount:l.amount,clock:l.clock,deadline:l.deadline}))};}
   return json(res,200,result);
  }
  if(url.pathname==='/api/events'){
   const latest=await provider.getBlockNumber();const from=Math.max(cfg.deployedBlock||0,latest-1500);let records=[];
   for(const name of ['binary','token']){const c=contracts[name];const logs=await provider.getLogs({address:c.target,fromBlock:from,toBlock:latest});for(const log of logs){try{const parsed=c.interface.parseLog(log);records.push({name:parsed.name,contract:name,block:log.blockNumber,hash:log.transactionHash,args:parsed.fragment.inputs.map((input,i)=>({name:input.name,value:parsed.args[i]}))});}catch{}}}
   return json(res,200,records.sort((a,b)=>b.block-a.block).slice(0,100));
  }
  if(url.pathname.startsWith('/abi/')){const name=url.pathname.slice(5);if(!['BinaryPlan','FTIToken','MockUSD','Council','FTITimelock'].includes(name))throw Error('Unknown ABI');return json(res,200,artifact(name).abi);}
  let file;if(url.pathname==='/vendor/ethers.js')file=path.join(root,'node_modules/ethers/dist/ethers.min.js');else {const route=url.pathname==='/'?'index.html':url.pathname.slice(1);file=path.resolve(root,'web',route);if(!file.startsWith(path.join(root,'web')+path.sep))return json(res,403,{error:'Denied'});}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
 }catch(e){json(res,400,{error:e.shortMessage||e.message});}});
 await new Promise((resolve,reject)=>server.once('error',reject).listen(port,host,resolve));console.log(`FTI ${cfg.mode}: http://${host}:${port}`);return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url))startWeb().catch(e=>{console.error(e.message);process.exit(1);});
