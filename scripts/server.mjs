import http from 'node:http';
import {readEvents} from './event-reader.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,Contract,isAddress,FetchRequest} from 'ethers';
import {artifact} from './lib.mjs';
import {RELEASE, verifyV3Deployment} from './v3-release.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function startWeb(configPath=process.env.DEPLOYMENT_FILE||'deployments/local.json'){
 const cfg=JSON.parse(fs.readFileSync(configPath));
 if(cfg.tokenContract==='FTIReserveTokenV3'&&cfg.release!==RELEASE)throw Error('V3 release mismatch; deploy the new contracts instead of reusing old addresses');
 const rpc=process.env.RPC_URL||cfg.rpcUrl;const transport=new FetchRequest(rpc);transport.timeout=15000;const provider=new JsonRpcProvider(transport,undefined,{cacheTimeout:-1,batchMaxCount:1});
 if(cfg.release===RELEASE){try{await verifyV3Deployment(cfg,provider);}catch(e){provider.destroy();throw e;}}
 const eventTransport=new FetchRequest(process.env.EVENT_RPC_URL||rpc);eventTransport.timeout=15000;
 const eventProvider=process.env.EVENT_RPC_URL?new JsonRpcProvider(eventTransport,undefined,{cacheTimeout:-1,batchMaxCount:1}):provider;
 const tokenContract=cfg.tokenContract||'FTIToken';if(!['FTIToken','FTIReserveToken','FTIReserveTokenV3'].includes(tokenContract))throw Error('Unknown token model');
 const reserveModel=tokenContract==='FTIReserveToken';const v3Model=tokenContract==='FTIReserveTokenV3';
 const binaryContract=cfg.binaryContract||'BinaryPlan';if(!['BinaryPlan','FundedBinaryPlan'].includes(binaryContract))throw Error('Unknown reward model');
 const fundedModel=binaryContract==='FundedBinaryPlan';
 const contracts=Object.fromEntries(['binary','token','usd','council','timelock'].filter(k=>cfg[k]).map(k=>[k,new Contract(cfg[k],artifact({binary:binaryContract,token:tokenContract,usd:'MockUSD',council:v3Model?'SevenGuardianCouncil':'Council',timelock:'FTITimelock'}[k]).abi,provider)]));
 const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||3000);const publicConfig={...cfg};delete publicConfig.rpcUrl;
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data,(_,v)=>typeof v==='bigint'?v.toString():v));};
 const readMethods=new Set(['eth_chainId','eth_blockNumber','eth_call','eth_getBalance','eth_getCode','eth_getLogs','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBlockByNumber','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getTransactionCount']);
 async function body(req){let raw='';for await(const c of req){raw+=c;if(raw.length>65536)throw Error('Request too large');}return JSON.parse(raw);}
 let eventCache,eventFlight;
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
   const [price,supply,reserve,bb,floor,ath,clock,count,epoch,epochEnd,phase,level,pointPool,pending,auto,jobCursor,jobCount,cursor,monthPhase,nextMonth,paused,tokenPaused,account1,account2,block]=await Promise.all([t.price(),t.totalSupply(),t.reserve(),(v3Model?t.supportReserve():t.buybackFund()),(v3Model?0n:t.floorFund()),t.ath(),(v3Model?0n:t.walletClock()),b.memberCount(),b.epoch(),b.epochEnd(),b.phase(),b.protectionLevel(),b.pointPool(),b.totalPending(),b.totalAuto(),b.jobCursor(),b.jobCount(),b.cursor(),b.monthPhase(),b.nextBuilderMonth(),b.paused(),t.paused(),b.accounting(),t.accounting(),provider.getBlock('latest')]);
   const result={price,supply,reserve,bb,floor,ath,clock,count,epoch,epochEnd,phase,level,pointPool,pending,auto,jobCursor,jobCount,cursor,monthPhase,nextMonth,paused,tokenPaused,account1,account2,block:block.number,timestamp:block.timestamp};
   if(v3Model){result.pricingModel='zero-start-reserve-v3';result.emergencyUnwind=await t.emergencyUnwind();result.builderMultiplier=await t.builderMultiplier();[result.cycle,result.cycleStartPrice,result.development]=await Promise.all([t.cycle(),t.cycleStartPrice(),t.development()]);}
   if(cfg.batchedRewards){result.rewardQueue=await b.rewardAccountCount();}
   if(reserveModel){result.totalSupply=supply;result.anchorSupply=await t.anchorSupply();result.supply=await t.circulatingSupply();result.pricingModel='real-reserve-v1';}
   if(fundedModel){result.rewardModel=v3Model?'attributed-credit-target-v2':'attributed-credit-v1';[result.pointRetained,result.builderRetained,result.pointAssigned,result.dirtyMembers]=await Promise.all([b.retainedPointReserve(),b.retainedBuilderReserve(),b.assignedPointCredit(),b.dirtyCount()]);}
   if(address){const m=await b.members(address);const [usdBalance,ftiBalance,unlocked,remaining,claimable,autoPending,locks]=await Promise.all([usd.balanceOf(address),t.balanceOf(address),(v3Model?t.balanceOf(address):(cfg.liquidityVersion===1?t.available(address):t.unlocked(address))),t.remainingAllowance(address),b.pendingReward(address),b.pendingAuto(address),(v3Model?[]:t.lockInfo(address))]);result.wallet={address,parent:m.parent,left:m.left,right:m.right,units:m.units,carryL:m.carryL,carryR:m.carryR,lifetimeL:m.lifetimeL,lifetimeR:m.lifetimeR,rank:m.rank,exists:m.exists,autoEnabled:m.autoEnabled,maxAutoPrice:m.maxAutoPrice,usdBalance,ftiBalance,unlocked,remaining,claimable,autoPending,locks:locks.map(l=>({amount:l.amount,clock:l.clock,deadline:l.deadline})),lockCount:cfg.lockVersion===2?await t.lockCount(address):locks.length};if(fundedModel){result.wallet.depth=await b.depth(address);result.wallet.creditL=await b.creditL(address);result.wallet.creditR=await b.creditR(address);}}
   return json(res,200,result);
  }
  if(url.pathname==='/api/locks'){
   const address=url.searchParams.get('wallet'),offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||64);
   if(!isAddress(address)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>64)throw Error('Invalid lock page');
   if(v3Model)return json(res,200,{total:0,offset,locks:[]});
   const t=contracts.token;const locks=cfg.lockVersion===2?await t.lockPage(address,offset,limit):(await t.lockInfo(address)).slice(offset,offset+limit);
   const total=cfg.lockVersion===2?await t.lockCount(address):(await t.lockInfo(address)).length;
   return json(res,200,{total,offset,locks:locks.map(l=>({amount:l.amount,clock:l.clock,deadline:l.deadline}))});
  }
  if(url.pathname==='/api/events'){
   if(eventCache&&Date.now()-eventCache.at<15000)return json(res,200,eventCache.rows);
   if(!eventFlight)eventFlight=(async()=>{if((await eventProvider.getNetwork()).chainId!==BigInt(cfg.chainId))throw Error('Wrong activity network');const latest=await eventProvider.getBlockNumber();const rows=await readEvents(eventProvider,{binary:contracts.binary,token:contracts.token},Math.max(cfg.deployedBlock||0,latest-1499),latest);eventCache={at:Date.now(),rows};return rows;})().finally(()=>{eventFlight=null;});
   try{return json(res,200,await eventFlight);}catch{return json(res,503,{error:'Activity RPC unavailable. Retry later; no events have been fabricated.'});}
  }
  if(url.pathname.startsWith('/abi/')){const name=url.pathname.slice(5);if(!['BinaryPlan','FundedBinaryPlan','FTIToken','FTIReserveToken','FTIReserveTokenV3','MockUSD','Council','SevenGuardianCouncil','FTITimelock'].includes(name))throw Error('Unknown ABI');return json(res,200,artifact(name).abi);}
  let file;if(url.pathname==='/vendor/ethers.js')file=path.join(root,'node_modules/ethers/dist/ethers.min.js');else {const entry=url.pathname.match(/^\/(app|token|admin)$/);if(entry){res.writeHead(301,{Location:url.pathname+'/'+url.search});return res.end();}const landingReady=fs.existsSync(path.join(root,'landing/dist/index.html'));const landingRoute=landingReady&&['/','/app.js','/app.css','/protocol-ring.webp'].includes(url.pathname);const staticRoot=path.join(root,landingRoute?'landing/dist':'web');const staticPath=url.pathname.replace(/^\/(app|token|admin)\//,'/');const route=staticPath==='/'?'index.html':staticPath.slice(1);file=path.resolve(staticRoot,route);if(!file.startsWith(staticRoot+path.sep))return json(res,403,{error:'Denied'});}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp'};res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
 }catch(e){json(res,400,{error:e.shortMessage||e.message});}});
 server.once('close',()=>{provider.destroy();if(eventProvider!==provider)eventProvider.destroy();});
 await new Promise((resolve,reject)=>server.once('error',reject).listen(port,host,resolve));console.log(`FTI ${cfg.mode}: http://${host}:${port}`);return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url))startWeb().catch(e=>{console.error(e.message);process.exit(1);});
