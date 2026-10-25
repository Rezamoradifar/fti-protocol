import {contentSecurityPolicy} from './content-security-policy.mjs';
import {operationalRpcUrl} from './mainnet-rpc.mjs';
import http from 'node:http';
import {rootForHost,PUBLIC_ROUTES} from './site-routing.mjs';
import {createStateReader} from './state-reader.mjs';
import {historyCache} from './history-cache.mjs';
import {HISTORY_SERVER_TIMEOUT_MS} from '../core/history-read-policy.mjs';
import {createEventHistoryReader,PUBLIC_EVENT_RPC} from './event-history-source.mjs';
import {createMemberHistoryReader} from './member-history.mjs';
import {createSupportService} from './support-tickets.mjs';
import {networkPlacementIndexer,detectGenesisPlacementLayout} from './referral-placement-index.mjs';
import {readHourlyCapFlushVersion} from '../core/hourly-cap-policy.mjs';
import {readPoolDistributionVersion} from '../core/pool-distribution-policy.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,Contract,isAddress,FetchRequest} from 'ethers';
import {artifact} from './lib.mjs';
import {assertOperationalConfig,verifyOperationalDeployment} from './operational-release.mjs';
import {COLLATERAL_ABI,deploymentNetwork} from '../core/deployment-network.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function startWeb(configPath=process.env.DEPLOYMENT_FILE||'deployments/local.json'){
 const cfg=JSON.parse(fs.readFileSync(configPath));
 assertOperationalConfig(cfg);
 const network=deploymentNetwork(cfg);
 const rpc=operationalRpcUrl(cfg);const transport=new FetchRequest(rpc);transport.timeout=15000;const provider=new JsonRpcProvider(transport,undefined,{cacheTimeout:-1,batchMaxCount:1});
 try{await verifyOperationalDeployment(cfg,provider);}catch(e){provider.destroy();throw e;}
 const eventTransport=new FetchRequest(process.env.EVENT_RPC_URL||rpc);eventTransport.timeout=15000;
 const eventProvider=process.env.EVENT_RPC_URL?new JsonRpcProvider(eventTransport,undefined,{cacheTimeout:-1,batchMaxCount:1}):provider;
 const tokenContract=cfg.tokenContract||'FTIToken';if(!['FTIToken','FTIReserveToken','FTIReserveTokenV3','FTIReserveTokenUpgradeable'].includes(tokenContract))throw Error('Unknown token model');
 const v3Model=['FTIReserveTokenV3','FTIReserveTokenUpgradeable'].includes(tokenContract);
 const binaryContract=cfg.binaryContract||'BinaryPlan';if(!['BinaryPlan','FundedBinaryPlan','FundedBinaryPlanUpgradeable'].includes(binaryContract))throw Error('Unknown reward model');
 const contracts=Object.fromEntries(['binary','token','usd','council','timelock'].filter(k=>cfg[k]).map(k=>[k,new Contract(cfg[k],k==='usd'&&!network.testAssets?COLLATERAL_ABI:artifact({binary:binaryContract,token:tokenContract,usd:'MockUSD',council:v3Model?'SevenGuardianCouncil':'Council',timelock:'FTITimelock'}[k]).abi,provider)]));
 const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||3000);const publicConfig={...cfg,network};delete publicConfig.rpcUrl;const walletConnectProjectId=process.env.WALLETCONNECT_PROJECT_ID||'';if(walletConnectProjectId&&!/^[a-f0-9]{32}$/i.test(walletConnectProjectId))throw Error('Invalid WalletConnect project ID');publicConfig.walletConnectProjectId=walletConnectProjectId;publicConfig.selectableHourlyAutoBuy=contracts.binary.interface.hasFunction('setAutoBuyPercent');
 // Referral endpoint is dormant until the proxy really exposes the new
 // function. ABI presence by itself does NOT imply a completed DAO upgrade.
 let referralPlacementEnabled=false,referralIndexer;
 if(binaryContract==='FundedBinaryPlanUpgradeable'&&Array.isArray(cfg.genesis)&&cfg.genesis.length===31){
  try{await contracts.binary.directReferrerOf(cfg.genesis[0]);
   const genesisLayout=await detectGenesisPlacementLayout(cfg.genesis,contracts.binary);
   if(cfg.genesisLayout&&cfg.genesisLayout!==genesisLayout)throw Error('Genesis layout configuration mismatch');
   publicConfig.genesisLayout=genesisLayout;
   referralIndexer=networkPlacementIndexer({genesis:cfg.genesis,genesisLayout,binary:contracts.binary,provider:eventProvider,startBlock:cfg.deployedBlock});referralPlacementEnabled=true;
  }catch{/* The active implementation is still the original V1. */}
 }
 publicConfig.referralPlacementEnabled=referralPlacementEnabled;
 publicConfig.hourlyCapFlushVersion=await readHourlyCapFlushVersion(contracts.binary);
 publicConfig.poolDistributionVersion=await readPoolDistributionVersion(contracts.binary);
 publicConfig.stateReaderVersion=1;
 publicConfig.eventHistoryVersion=1;
 publicConfig.eventHistoryTimeoutMs=HISTORY_SERVER_TIMEOUT_MS;
 publicConfig.memberHistoryVersion=Number.isSafeInteger(cfg.deployedBlock)&&cfg.deployedBlock>=0?1:0;
 publicConfig.supportTicketVersion=1;
 const readState=createStateReader({provider,contracts,cfg,publicConfig});
 let fallbackProvider;
 if(cfg.chainId===56){const fallbackTransport=new FetchRequest(PUBLIC_EVENT_RPC);fallbackTransport.timeout=8000;fallbackProvider=new JsonRpcProvider(fallbackTransport,undefined,{cacheTimeout:-1,batchMaxCount:1});}
 const readHistory=createEventHistoryReader({primary:provider,eventProvider,fallbackProvider,contracts,cfg});
 const readMemberHistory=publicConfig.memberHistoryVersion?createMemberHistoryReader({provider,eventProvider,contracts,cfg}):null;
 let supportService;
 const marketRead=historyCache(signal=>readHistory('market',signal));
 const eventsRead=historyCache(signal=>readHistory('events',signal),{ttlMs:15000});
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data,(_,v)=>typeof v==='bigint'?v.toString():v));};
 const readMethods=new Set(['eth_chainId','eth_blockNumber','eth_call','eth_getBalance','eth_getStorageAt','eth_getCode','eth_getLogs','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBlockByNumber','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getTransactionCount']);
 async function body(req){let raw='';for await(const c of req){raw+=c;if(raw.length>65536)throw Error('Request too large');}return JSON.parse(raw);}
 const server=http.createServer(async(req,res)=>{try{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',contentSecurityPolicy(walletConnectProjectId));
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/support/')){
   if(!supportService)return json(res,503,{error:'SUPPORT_UNAVAILABLE'});
   if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'SUPPORT_ORIGIN_DENIED'});
   const requestOrigin=req.headers.origin||(cfg.mode==='local'?'http://':'https://')+req.headers.host;
   const result=await supportService.handle({method:req.method,path:url.pathname+url.search,body:req.method==='POST'?await body(req):undefined,authorization:req.headers.authorization,origin:requestOrigin});
   return json(res,result.status,result.data);
  }
  if(req.method==='GET'&&url.pathname==='/'&&rootForHost(req.headers.host)){res.writeHead(302,{Location:rootForHost(req.headers.host)+url.search});return res.end();}
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
  if(url.pathname==='/api/placement'){
   if(!referralPlacementEnabled)return json(res,409,{error:'REFERRAL_UPGRADE_REQUIRED'});
   const referrer=url.searchParams.get('referrer');if(!isAddress(referrer))return json(res,400,{error:'INVALID_REFERRER'});
   try{return json(res,200,await referralIndexer.choose(referrer));}
   catch(e){return json(res,503,{error:e.message||'PLACEMENT_UNAVAILABLE'});}
  }
  if(url.pathname==='/api/state'){
   const address=url.searchParams.get('wallet');
   if(address&&!isAddress(address))return json(res,400,{error:'Invalid address'});
   try{return json(res,200,await readState(address));}
   catch(error){
    res.setHeader('Retry-After','2');
    const code=/^[A-Z_]{1,64}$/.test(error.code||'')?error.code:'STATE_UNAVAILABLE';
    const field=/^[a-zA-Z0-9_.]{1,80}$/.test(error.field||'')?error.field:undefined;
    return json(res,503,{error:'Contract state is temporarily unavailable. Retry shortly.',code,...(field?{field}:{})});
   }
  }
  if(url.pathname==='/api/locks'){
   const address=url.searchParams.get('wallet'),offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||64);
   if(!isAddress(address)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>64)throw Error('Invalid lock page');
   if(v3Model)return json(res,200,{total:0,offset,locks:[]});
   const t=contracts.token;const locks=cfg.lockVersion===2?await t.lockPage(address,offset,limit):(await t.lockInfo(address)).slice(offset,offset+limit);
   const total=cfg.lockVersion===2?await t.lockCount(address):(await t.lockInfo(address)).length;
   return json(res,200,{total,offset,locks:locks.map(l=>({amount:l.amount,clock:l.clock,deadline:l.deadline}))});
  }
  if(url.pathname==='/api/market'){
   try{return json(res,200,await marketRead());}
   catch{res.setHeader('Retry-After','15');return json(res,503,{error:'Market history unavailable; no fabricated volume.'});}
  }
  if(url.pathname==='/api/events'){
   res.setHeader('X-FTI-Read-Timeout-Ms',String(HISTORY_SERVER_TIMEOUT_MS));
   try{return json(res,200,await eventsRead());}
   catch{res.setHeader('Retry-After','15');return json(res,503,{error:'Activity RPC unavailable. Retry later; no events have been fabricated.'});}
  }
  if(url.pathname==='/api/member-history'){
   if(!readMemberHistory)return json(res,409,{error:'MEMBER_HISTORY_UNAVAILABLE'});
   const wallet=url.searchParams.get('wallet');
   if(!isAddress(wallet))return json(res,400,{error:'INVALID_WALLET'});
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),40000);
   const disconnected=()=>{if(!res.writableEnded)controller.abort();};
   res.once('close',disconnected);
   try{return json(res,200,await readMemberHistory({wallet,cursor:url.searchParams.get('cursor'),limit:Number(url.searchParams.get('limit')||50)},controller.signal));}
   catch(error){const invalid=/^INVALID_HISTORY_/.test(error.code||'');return json(res,invalid?400:503,{error:invalid?'INVALID_HISTORY_PAGE':'MEMBER_HISTORY_UNAVAILABLE'});}
   finally{clearTimeout(timer);res.removeListener('close',disconnected);}
  }
  if(url.pathname.startsWith('/abi/')){const name=url.pathname.slice(5);if(name==='Collateral')return json(res,200,COLLATERAL_ABI);if(!network.testAssets&&name==='MockUSD')return json(res,404,{error:'Test ABI unavailable on mainnet'});if(!['BinaryPlan','FundedBinaryPlan','FTIToken','FTIReserveToken','FTIReserveTokenV3','MockUSD','Council','SevenGuardianCouncil','FTITimelock','FundedBinaryPlanUpgradeable','FTIReserveTokenUpgradeable'].includes(name))throw Error('Unknown ABI');return json(res,200,artifact(name).abi);}
  let file;if(url.pathname==='/vendor/ethers.js')file=path.join(root,'node_modules/ethers/dist/ethers.min.js');else {const entry=url.pathname.match(/^\/(app|token|admin)$/);if(entry){res.writeHead(301,{Location:url.pathname+'/'+url.search});return res.end();}const landingReady=fs.existsSync(path.join(root,'landing/dist/index.html'));const landingRoute=landingReady&&(url.pathname.startsWith('/assets/')||['/','/app.js','/app.css','/protocol-ring.webp',...PUBLIC_ROUTES].includes(url.pathname));const staticRoot=path.join(root,landingRoute?'landing/dist':'web');const staticPath=url.pathname.replace(/^\/(app|token|admin)\//,'/');const route=PUBLIC_ROUTES.includes(url.pathname)?url.pathname.slice(1)+'index.html':staticPath==='/'?'index.html':staticPath.slice(1);file=path.resolve(staticRoot,route);if(!file.startsWith(staticRoot+path.sep))return json(res,403,{error:'Denied'});}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2'};res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
 }catch(e){json(res,400,{error:e.shortMessage||e.message});}});
 server.once('close',()=>{provider.destroy();if(eventProvider!==provider)eventProvider.destroy();fallbackProvider?.destroy();});
 await new Promise((resolve,reject)=>server.once('error',reject).listen(port,host,resolve));
 const supportOrigin=cfg.mode==='local'?'http://'+host+':'+server.address().port:'https://ftiprotocol.com';
 const supportDataDir=process.env.FTI_SUPPORT_DATA_DIR||(cfg.mode==='local'?path.resolve(path.dirname(configPath),'support-'+cfg.binary.toLowerCase()):'/var/lib/fti-support/'+cfg.chainId+'-'+cfg.binary.toLowerCase());
 supportService=createSupportService({cfg,council:{isGuardian:address=>v3Model?contracts.council.isGuardian(address):contracts.council.isOwner(address)},dataDir:supportDataDir,origin:supportOrigin});
 console.log(`FTI ${cfg.mode}: http://${host}:${port}`);return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url))startWeb().catch(e=>{console.error(e.message);process.exit(1);});
