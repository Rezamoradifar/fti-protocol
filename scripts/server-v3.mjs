import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,Contract,isAddress,FetchRequest} from 'ethers';
import {artifact} from './lib.mjs';
import {readEvents} from './event-reader.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export async function startV3Web(configPath=process.env.DEPLOYMENT_FILE||'deployments/v3-testnet.json'){
  const cfg=JSON.parse(fs.readFileSync(configPath,'utf8'));

  if(cfg.tokenContract!=='FTIReserveTokenV3')throw Error('FTI V3 deployment config required');
  if(cfg.binaryContract!=='FundedBinaryPlan')throw Error('FundedBinaryPlan deployment config required');
  if(cfg.councilContract!=='SevenGuardianCouncil')throw Error('SevenGuardianCouncil deployment config required');
  if(![97,31337].includes(Number(cfg.chainId)))throw Error('Only BNB Testnet or local V3 deployments are supported');

  const rpcUrl=process.env.RPC_URL||cfg.rpcUrl;
  if(!rpcUrl)throw Error('RPC_URL is required');

  const transport=new FetchRequest(rpcUrl);
  transport.timeout=15000;
  const provider=new JsonRpcProvider(transport,undefined,{cacheTimeout:-1,batchMaxCount:1});

  const eventTransport=new FetchRequest(process.env.EVENT_RPC_URL||rpcUrl);
  eventTransport.timeout=15000;
  const eventProvider=process.env.EVENT_RPC_URL
    ?new JsonRpcProvider(eventTransport,undefined,{cacheTimeout:-1,batchMaxCount:1})
    :provider;

  const binary=new Contract(cfg.binary,artifact('FundedBinaryPlan').abi,provider);
  const token=new Contract(cfg.token,artifact('FTIReserveTokenV3').abi,provider);
  const usd=new Contract(cfg.usd,artifact('MockUSD').abi,provider);
  const council=new Contract(cfg.council,artifact('SevenGuardianCouncil').abi,provider);
  const contracts={binary,token,usd,council};

  const host=process.env.HOST||'127.0.0.1';
  const port=Number(process.env.PORT||3001);
  const publicConfig={...cfg};
  delete publicConfig.rpcUrl;
  delete publicConfig.secretsFile;

  const json=(res,status,data)=>{
    res.writeHead(status,{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store'
    });
    res.end(JSON.stringify(data,(_,v)=>typeof v==='bigint'?v.toString():v));
  };

  const readMethods=new Set([
    'eth_chainId','eth_blockNumber','eth_call','eth_getBalance','eth_getCode',
    'eth_getLogs','eth_getTransactionReceipt','eth_getTransactionByHash',
    'eth_getBlockByNumber','eth_estimateGas','eth_gasPrice',
    'eth_maxPriorityFeePerGas','eth_feeHistory','eth_getTransactionCount'
  ]);

  async function body(req){
    let raw='';
    for await(const chunk of req){
      raw+=chunk;
      if(raw.length>65536)throw Error('Request too large');
    }
    return JSON.parse(raw||'{}');
  }

  let eventCache,eventFlight;

  const server=http.createServer(async(req,res)=>{
    try{
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('X-Frame-Options','DENY');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"
      );

      const url=new URL(req.url,'http://localhost');

      if(req.method==='POST'){
        const origin=req.headers.origin;
        if(origin&&new URL(origin).host!==req.headers.host)return json(res,403,{error:'Cross-origin denied'});

        if(url.pathname==='/rpc'){
          const data=await body(req);
          const items=Array.isArray(data)?data:[data];
          if(items.length>50)throw Error('Batch too large');

          for(const item of items){
            if(!readMethods.has(item.method)&&!(cfg.mode==='local'&&[
              'eth_accounts','eth_sendTransaction','eth_signTypedData_v4','personal_sign'
            ].includes(item.method)))throw Error('RPC method not allowed');
          }

          const response=await fetch(rpcUrl,{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(data),
            signal:AbortSignal.timeout(20000)
          });
          return json(res,200,await response.json());
        }

        if(url.pathname==='/api/dev/time'&&cfg.mode==='local'){
          const {seconds}=await body(req);
          if(!Number.isSafeInteger(seconds)||seconds<1||seconds>100*86400)throw Error('Invalid interval');
          await provider.send('evm_increaseTime',[seconds]);
          await provider.send('evm_mine',[]);
          return json(res,200,{ok:true});
        }

        return json(res,404,{error:'Not found'});
      }

      if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});

      if(url.pathname==='/health'){
        const network=await provider.getNetwork();
        const block=await provider.getBlockNumber();
        return json(res,200,{
          ok:Number(network.chainId)===Number(cfg.chainId),
          release:'FTI_V3_ZERO_START',
          chainId:Number(network.chainId),
          expectedChainId:Number(cfg.chainId),
          block,
          mode:cfg.mode
        });
      }

      if(url.pathname==='/api/config')return json(res,200,publicConfig);

      if(url.pathname==='/api/state'){
        const address=url.searchParams.get('wallet');
        if(address&&!isAddress(address))throw Error('Invalid wallet address');

        const block=await provider.getBlock('latest');

        const [
          price,supply,reserve,supportReserve,launchPrice,builderMultiplier,
          emergencyUnwind,sellWindowStart,sellWindowOpeningReserve,sellWindowOutflow,
          tokenPaused,tokenAccounting,animalWalletA,animalWalletB,
          count,epoch,epochEnd,phase,level,pointPool,pending,auto,
          jobCursor,jobCount,cursor,monthPhase,nextMonth,binaryPaused,binaryAccounting,
          pointRetained,builderRetained,assignedPointCredit,dirtyMembers,rewardQueueRemaining
        ]=await Promise.all([
          token.price(),token.totalSupply(),token.reserve(),token.supportReserve(),
          token.launchPrice(),token.builderMultiplier(),token.emergencyUnwind(),
          token.sellWindowStart(),token.sellWindowOpeningReserve(),token.sellWindowOutflow(),
          token.paused(),token.accounting(),token.animalWalletA(),token.animalWalletB(),
          binary.memberCount(),binary.epoch(),binary.epochEnd(),binary.phase(),
          binary.protectionLevel(),binary.pointPool(),binary.totalPending(),binary.totalAuto(),
          binary.jobCursor(),binary.jobCount(),binary.cursor(),binary.monthPhase(),
          binary.nextBuilderMonth(),binary.paused(),binary.accounting(),
          binary.retainedPointReserve(),binary.retainedBuilderReserve(),
          binary.assignedPointCredit(),binary.dirtyCount(),binary.rewardQueueRemaining()
        ]);

        const maxSingleSellBps=await token.MAX_SINGLE_SELL_BPS();
        const maxHourlyOutflowBps=await token.MAX_HOURLY_OUTFLOW_BPS();
        const tradeFeeBps=await token.TRADE_FEE_BPS();
        const charityBps=await token.CHARITY_BPS();
        const reserveFeeBps=await token.RESERVE_FEE_BPS();

        const result={
          release:'FTI_V3_ZERO_START',
          pricingModel:'zero-start-reserve-v3',
          rewardModel:'attributed-credit-v1',
          price,supply,reserve,supportReserve,launchPrice,builderMultiplier,
          emergencyUnwind,sellWindowStart,sellWindowOpeningReserve,sellWindowOutflow,
          maxSingleSellBps,maxHourlyOutflowBps,tradeFeeBps,charityBps,reserveFeeBps,
          tokenPaused,binaryPaused,animalWalletA,animalWalletB,
          count,epoch,epochEnd,phase,level,pointPool,pending,auto,
          jobCursor,jobCount,cursor,monthPhase,nextMonth,
          account1:binaryAccounting,account2:tokenAccounting,
          pointRetained,builderRetained,assignedPointCredit,dirtyMembers,rewardQueueRemaining,
          block:block.number,timestamp:block.timestamp
        };

        const opening=BigInt(sellWindowOpeningReserve);
        const maxHour=opening===0n?0n:opening*BigInt(maxHourlyOutflowBps)/10000n;
        result.hourlyOutflowLimit=maxHour;
        result.hourlyOutflowRemaining=maxHour>BigInt(sellWindowOutflow)
          ?maxHour-BigInt(sellWindowOutflow)
          :0n;

        if(address){
          const m=await binary.members(address);
          const [
            usdBalance,ftiBalance,remaining,claimable,autoPending,creditL,creditR,depth
          ]=await Promise.all([
            usd.balanceOf(address),token.balanceOf(address),token.remainingAllowance(address),
            binary.pendingReward(address),binary.pendingAuto(address),
            binary.creditL(address),binary.creditR(address),binary.depth(address)
          ]);

          result.wallet={
            address,
            parent:m.parent,left:m.left,right:m.right,
            units:m.units,carryL:m.carryL,carryR:m.carryR,
            lifetimeL:m.lifetimeL,lifetimeR:m.lifetimeR,rank:m.rank,exists:m.exists,
            autoEnabled:m.autoEnabled,maxAutoPrice:m.maxAutoPrice,
            usdBalance,ftiBalance,unlocked:ftiBalance,remaining,claimable,autoPending,
            creditL,creditR,depth,locks:[],lockCount:0
          };

          const grossMax=BigInt(reserve)*BigInt(maxSingleSellBps)/10000n;
          result.wallet.maxSingleSellGross=grossMax;
          if(BigInt(supply)>0n&&BigInt(reserve)>0n){
            result.wallet.maxSingleSellTokens=grossMax*BigInt(supply)/BigInt(reserve);
          }else result.wallet.maxSingleSellTokens=0n;
        }

        return json(res,200,result);
      }

      if(url.pathname==='/api/locks'){
        const address=url.searchParams.get('wallet');
        if(!isAddress(address))throw Error('Invalid wallet address');
        return json(res,200,{total:0,offset:0,locks:[],model:'no-locks-v3'});
      }

      if(url.pathname==='/api/events'){
        if(eventCache&&Date.now()-eventCache.at<15000)return json(res,200,eventCache.rows);
        if(!eventFlight)eventFlight=(async()=>{
          if((await eventProvider.getNetwork()).chainId!==BigInt(cfg.chainId))throw Error('Wrong activity network');
          const latest=await eventProvider.getBlockNumber();
          const rows=await readEvents(
            eventProvider,
            {binary,token,council},
            Math.max(cfg.deployedBlock||0,latest-1499),
            latest
          );
          eventCache={at:Date.now(),rows};
          return rows;
        })().finally(()=>{eventFlight=null;});

        try{return json(res,200,await eventFlight);}
        catch{return json(res,503,{error:'Activity RPC unavailable. Retry later; no events have been fabricated.'});}
      }

      if(url.pathname.startsWith('/abi/')){
        const name=url.pathname.slice(5);
        if(!['FundedBinaryPlan','FTIReserveTokenV3','MockUSD','SevenGuardianCouncil'].includes(name))throw Error('Unknown ABI');
        return json(res,200,artifact(name).abi);
      }

      let file;
      if(url.pathname==='/vendor/ethers.js'){
        file=path.join(root,'node_modules/ethers/dist/ethers.min.js');
      }else{
        const entry=url.pathname.match(/^\/(app|token|admin)$/);
        if(entry){
          res.writeHead(301,{Location:url.pathname+'/'+url.search});
          return res.end();
        }

        const staticPath=url.pathname.replace(/^\/(app|token|admin)\//,'/');
        const route=staticPath==='/'?'index.html':staticPath.slice(1);
        file=path.resolve(root,'web',route);
        if(!file.startsWith(path.join(root,'web')+path.sep))return json(res,403,{error:'Denied'});
      }

      if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});

      const types={
        '.html':'text/html; charset=utf-8',
        '.css':'text/css; charset=utf-8',
        '.js':'text/javascript; charset=utf-8',
        '.svg':'image/svg+xml'
      };
      res.writeHead(200,{
        'Content-Type':types[path.extname(file)]||'application/octet-stream',
        'Cache-Control':path.extname(file)==='.html'?'no-cache':'public, max-age=300'
      });
      fs.createReadStream(file).pipe(res);
    }catch(error){
      json(res,400,{error:error.shortMessage||error.message});
    }
  });

  server.once('close',()=>{
    provider.destroy();
    if(eventProvider!==provider)eventProvider.destroy();
  });

  await new Promise((resolve,reject)=>server.once('error',reject).listen(port,host,resolve));
  console.log(`FTI V3 ${cfg.mode}: http://${host}:${server.address().port}`);
  return server;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  startV3Web().catch(error=>{
    console.error(error.message);
    process.exit(1);
  });
}
