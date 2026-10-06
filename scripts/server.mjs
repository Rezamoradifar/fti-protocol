import http from 'node:http';
import {readEvents} from './event-reader.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,Contract,isAddress,FetchRequest} from 'ethers';
import {artifact} from './lib.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function startWeb(configPath=process.env.DEPLOYMENT_FILE||'deployments/local-retirement.json'){
 const cfg=JSON.parse(fs.readFileSync(configPath));const rpc=process.env.RPC_URL||cfg.rpcUrl;const transport=new FetchRequest(rpc);transport.timeout=15000;const provider=new JsonRpcProvider(transport,undefined,{cacheTimeout:-1,batchMaxCount:1});
 const eventTransport=new FetchRequest(process.env.EVENT_RPC_URL||rpc);eventTransport.timeout=15000;
 const eventProvider=process.env.EVENT_RPC_URL?new JsonRpcProvider(eventTransport,undefined,{cacheTimeout:-1,batchMaxCount:1}):provider;
 const tokenContract=cfg.tokenContract||'FTIToken';if(!['FTIToken','FTIReserveToken','FTIRetirementReviewToken'].includes(tokenContract))throw Error('Unknown token model');
 const retirementModel=tokenContract==='FTIRetirementReviewToken';
 const reserveModel=retirementModel||tokenContract==='FTIReserveToken';
 const binaryContract=cfg.binaryContract||'BinaryPlan';if(!['BinaryPlan','FundedBinaryPlan'].includes(binaryContract))throw Error('Unknown reward model');
 const fundedModel=binaryContract==='FundedBinaryPlan';
 const contracts=Object.fromEntries(['binary','token','usd','council','timelock'].map(k=>[k,new Contract(cfg[k],artifact({binary:binaryContract,token:tokenContract,usd:'MockUSD',council:'Council',timelock:'FTITimelock'}[k]).abi,provider)]));
 // Local artifacts describe callable shapes, not the code actually deployed at cfg addresses.
 // Probe read-only getters before presenting a capability. Empty/missing selectors mean
 // historical support; operational RPC errors must remain errors rather than false flags.
 async function viewCapability(contract,names,probe){
  if(!names.every(name=>contract.interface.hasFunction(name)))return false;
  try{await probe();return true;}catch(error){
   const upstreamMessage=error.info?.error?.message||error.error?.message||'';
   if(error.code==='CALL_EXCEPTION'&&(!error.data||error.data==='0x')&&!error.reason&&/execution reverted|VM Exception.*revert|function selector.*not recognized|invalid opcode/i.test(upstreamMessage))return false;
   if(error.code==='BAD_DATA'&&error.value==='0x')return false;
   throw error;
  }
 }
 async function readCapabilities(blockTag='latest'){
  const atBlock={blockTag};
  const [immediateAuto,restartSupported]=await Promise.all([
   viewCapability(contracts.binary,['setAutoBuy(bool)','effectiveAutoEnabled','nextAutoSetting'],()=>Promise.all([contracts.binary.effectiveAutoEnabled(cfg.binary,atBlock),contracts.binary.nextAutoSetting(cfg.binary,atBlock)])),
   viewCapability(contracts.token,['buysPermanentlyClosed','referenceReserve','referenceSupply'],()=>Promise.all([contracts.token.buysPermanentlyClosed(atBlock),contracts.token.referenceReserve(atBlock),contracts.token.referenceSupply(atBlock)]))
  ]);
  return {immediateAuto,restartSupported,autoBuyPolicy:immediateAuto?'immediate-current-quote-v1':'historical-price-cap'};
 }
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
  if(url.pathname==='/api/config'){const {restartSupported,autoBuyPolicy}=await readCapabilities();return json(res,200,{...publicConfig,restartSupported,autoBuyPolicy});}
  if(url.pathname==='/api/state'){
   const {binary:b,token:t,usd}=contracts;const address=url.searchParams.get('wallet');if(address&&!isAddress(address))throw Error('Invalid address');
   const block=await provider.getBlock('latest');if(!block?.hash)throw Error('State block unavailable');const atBlock={blockTag:block.number};
   const {immediateAuto,restartSupported,autoBuyPolicy}=await readCapabilities(block.number);
   const [price,supply,reserve,bb,floor,ath,clock,count,epoch,epochEnd,phase,level,pointPool,pending,auto,jobCursor,jobCount,cursor,monthPhase,nextMonth,paused,tokenPaused,account1,account2]=await Promise.all([t.price(atBlock),t.totalSupply(atBlock),t.reserve(atBlock),t.buybackFund(atBlock),t.floorFund(atBlock),t.ath(atBlock),t.walletClock(atBlock),b.memberCount(atBlock),b.epoch(atBlock),b.epochEnd(atBlock),b.phase(atBlock),b.protectionLevel(atBlock),b.pointPool(atBlock),b.totalPending(atBlock),b.totalAuto(atBlock),b.jobCursor(atBlock),b.jobCount(atBlock),b.cursor(atBlock),b.monthPhase(atBlock),b.nextBuilderMonth(atBlock),b.paused(atBlock),t.paused(atBlock),b.accounting(atBlock),t.accounting(atBlock)]);
   const result={autoBuyPolicy,restartSupported,price,supply,reserve,bb,floor,ath,clock,count,epoch,epochEnd,phase,level,pointPool,pending,auto,jobCursor,jobCount,cursor,monthPhase,nextMonth,paused,tokenPaused,account1,account2,block:block.number,blockHash:block.hash,timestamp:block.timestamp};
   if(reserveModel){result.totalSupply=supply;result.anchorSupply=await t.anchorSupply(atBlock);result.supply=await t.circulatingSupply(atBlock);result.pricingModel=retirementModel?'real-reserve-retirement-review':cfg.pricingModel||'real-reserve-size-fee-floor-review';[result.lifecycleClosed,result.referencePrice,result.sellPressureWad,result.lastPartialSellAt,result.unallocatedReserve]=await Promise.all([t.lifecycleClosed(atBlock),t.referencePrice(atBlock),t.currentSellPressure(atBlock),t.lastPartialSellAt(atBlock),t.unallocatedReserve(atBlock)]);[result.emergencyExit,result.sellWindowStart,result.sellWindowStartReserve,result.sellWindowGross,result.maxSingleSellBps,result.maxHourlySellBps]=await Promise.all([t.emergencyExit(atBlock),t.sellWindowStart(atBlock),t.sellWindowStartReserve(atBlock),t.sellWindowGross(atBlock),t.MAX_SINGLE_SELL_BPS(atBlock),t.MAX_HOURLY_GROSS_SELL_BPS(atBlock)]);}
   if(retirementModel)[result.developmentFeeClaim,result.developmentFund,result.permanentlyRetired]=await Promise.all([t.developmentFeeClaim(atBlock),t.developmentFund(atBlock),t.permanentlyRetired(atBlock)]);
   if(restartSupported)[result.buysPermanentlyClosed,result.referenceReserve,result.referenceSupply]=await Promise.all([t.buysPermanentlyClosed({blockTag:block.number}),t.referenceReserve({blockTag:block.number}),t.referenceSupply({blockTag:block.number})]);
   if(fundedModel){result.rewardModel='historical-attributed-credit-v1';[result.pointRetained,result.builderRetained,result.pointAssigned,result.dirtyMembers]=await Promise.all([b.retainedPointReserve(atBlock),b.retainedBuilderReserve(atBlock),b.assignedPointCredit(atBlock),b.dirtyCount(atBlock)]);}
   if(!fundedModel)result.rewardModel='global-pool-paid-points-v2';
   if(address){const m=await b.members(address,{blockTag:block.number});const [usdBalance,ftiBalance,unlocked,remaining,claimable,autoPending,locks]=await Promise.all([usd.balanceOf(address,atBlock),t.balanceOf(address,atBlock),(cfg.liquidityVersion===1?t.available(address,atBlock):t.unlocked(address,atBlock)),t.remainingAllowance(address,atBlock),b.pendingReward(address,atBlock),b.pendingAuto(address,atBlock),t.lockInfo(address,atBlock)]);result.wallet={address,parent:m.parent,left:m.left,right:m.right,units:m.units,carryL:m.carryL,carryR:m.carryR,lifetimeL:m.lifetimeL,lifetimeR:m.lifetimeR,rank:m.rank,exists:m.exists,autoEnabled:m.autoEnabled,autoStoredEnabled:m.autoEnabled,maxAutoPrice:m.maxAutoPrice,usdBalance,ftiBalance,unlocked,remaining,claimable,autoPending,locks:locks.map(l=>({amount:l.amount,clock:l.clock,deadline:l.deadline})),lockCount:cfg.lockVersion>=2?await t.lockCount(address,atBlock):locks.length};if(immediateAuto){const [enabled,next]=await Promise.all([b.effectiveAutoEnabled(address,{blockTag:block.number}),b.nextAutoSetting(address,{blockTag:block.number})]);result.wallet.autoEnabled=enabled;result.wallet.nextAutoSetting={enabled:next.enabled,effectiveAt:next.effectiveAt};}else result.wallet.nextAutoSetting=null;if(fundedModel){result.wallet.depth=await b.depth(address,atBlock);result.wallet.creditL=await b.creditL(address,atBlock);result.wallet.creditR=await b.creditR(address,atBlock);}else result.wallet.cumulativePaidRankPoints=await b.cumulativePaidRankPoints(address,atBlock);}
   const verifiedBlock=await provider.getBlock(block.number);if(verifiedBlock?.hash!==block.hash)throw Error('Chain changed while reading state; retry the contract read.');
   return json(res,200,result);
  }
  if(url.pathname==='/api/locks'){
   const address=url.searchParams.get('wallet'),offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||64);
   if(!isAddress(address)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>64)throw Error('Invalid lock page');
   const t=contracts.token;const locks=cfg.lockVersion>=2?await t.lockPage(address,offset,limit):(await t.lockInfo(address)).slice(offset,offset+limit);
   const total=cfg.lockVersion>=2?await t.lockCount(address):(await t.lockInfo(address)).length;
   return json(res,200,{total,offset,locks:locks.map(l=>({amount:l.amount,clock:l.clock,deadline:l.deadline}))});
  }
  if(url.pathname==='/api/events'){
   if(eventCache&&Date.now()-eventCache.at<15000)return json(res,200,eventCache.rows);
   if(!eventFlight)eventFlight=(async()=>{if((await eventProvider.getNetwork()).chainId!==BigInt(cfg.chainId))throw Error('Wrong activity network');const latest=await eventProvider.getBlockNumber();const rows=await readEvents(eventProvider,{binary:contracts.binary,token:contracts.token},Math.max(cfg.deployedBlock||0,latest-1499),latest);eventCache={at:Date.now(),rows};return rows;})().finally(()=>{eventFlight=null;});
   try{return json(res,200,await eventFlight);}catch{return json(res,503,{error:'Activity RPC unavailable. Retry later; no events have been fabricated.'});}
  }
  if(url.pathname.startsWith('/abi/')){const name=url.pathname.slice(5);if(!['BinaryPlan','FundedBinaryPlan','FTIToken','FTIReserveToken','FTIRetirementReviewToken','MockUSD','Council','FTITimelock'].includes(name))throw Error('Unknown ABI');return json(res,200,artifact(name).abi);}
  let file;if(url.pathname==='/vendor/ethers.js')file=path.join(root,'node_modules/ethers/dist/ethers.min.js');else {const entry=url.pathname.match(/^\/(app|token|admin)$/);if(entry){res.writeHead(301,{Location:url.pathname+'/'+url.search});return res.end();}const staticPath=url.pathname.replace(/^\/(app|token|admin)\//,'/');const route=staticPath==='/'?'index.html':staticPath.slice(1);file=path.resolve(root,'web',route);if(!file.startsWith(path.join(root,'web')+path.sep))return json(res,403,{error:'Denied'});}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
 }catch(e){json(res,400,{error:e.shortMessage||e.message});}});
 server.once('close',()=>{provider.destroy();if(eventProvider!==provider)eventProvider.destroy();});
 await new Promise((resolve,reject)=>server.once('error',reject).listen(port,host,resolve));console.log(`FTI ${cfg.mode}: http://${host}:${server.address().port}`);return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url))startWeb().catch(e=>{console.error(e.message);process.exit(1);});
