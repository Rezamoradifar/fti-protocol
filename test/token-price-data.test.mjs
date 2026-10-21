import test from 'node:test';
import assert from 'node:assert/strict';
import {readTokenPrice,TOKEN_PRICE_SELECTORS,tokenPriceSupported} from '../landing/src/token-price-data.mjs';
import {tokenPriceAmount,tokenPriceFreshness} from '../landing/src/token-price-view.mjs';
const UNIT=10n**18n,config={chainId:56,mode:'bnb-mainnet',tokenContract:'FTIReserveTokenUpgradeable',token:'0x43755B1E813b2d41F669ea08bcf859De07195eA1',usd:'0x55d398326f99059fF775485246999027B3197955'};
const hash='0x'+'a'.repeat(64),abi=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
function fixture(change=()=>{}){
 const calls=[],values={price:UNIT/5n,supply:500n*UNIT,reserve:100n*UNIT,support:25n*UNIT};
 const fetchImpl=async(url,options)=>{
  assert.equal(url,'/rpc');assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');
  const batch=JSON.parse(options.body);calls.push(batch);
  const rows=batch.map(call=>{
   assert(['eth_chainId','eth_getBlockByNumber','eth_call'].includes(call.method));
   let result;
   if(call.method==='eth_chainId')result='0x38';
   else if(call.method==='eth_getBlockByNumber')result={number:'0x64',timestamp:'0x6a000000',hash};
   else{
    assert.equal(call.params[0].to,config.token);assert.equal(call.params[1],'0x64');
    const name=Object.keys(TOKEN_PRICE_SELECTORS).find(name=>TOKEN_PRICE_SELECTORS[name]===call.params[0].data);assert(name);result=abi(values[name]);
   }
   return {jsonrpc:'2.0',id:call.id,result};
  });
  change({rows,batch,values,index:calls.length});return {ok:true,json:async()=>rows.reverse()};
 };
 return {calls,values,fetchImpl};
}
test('reads the live contract price and compact stats at one canonical block without wallet or full state requests',async()=>{
 const f=fixture(),result=await readTokenPrice(config,{fetchImpl:f.fetchImpl});
 assert.equal(result.priceWei,String(UNIT/5n));assert.equal(result.supplyWei,String(500n*UNIT));assert.equal(result.reserveWei,String(100n*UNIT));assert.equal(result.supportWei,String(25n*UNIT));
 assert.equal(result.block,100);assert.equal(result.blockHash,hash);assert.equal(f.calls.length,3);assert.equal(f.calls[1].length,4);
 assert.equal(f.calls[2][1].params[0],'0x64');
});
test('zero supply has no displayed rate and never invents a launch price',async()=>{
 const f=fixture();Object.assign(f.values,{price:0n,supply:0n,reserve:0n});
 const result=await readTokenPrice(config,{fetchImpl:f.fetchImpl});assert.equal(result.priceWei,null);assert.equal(result.supplyWei,'0');
 f.values.price=UNIT/10n;await assert.rejects(readTokenPrice(config,{fetchImpl:f.fetchImpl}),/do not match/);
});
test('unsupported chain, collateral, address or model stops before reading',async()=>{
 for(const change of [{chainId:97},{mode:'local'},{tokenContract:'FTIToken'},{token:'0x'+'1'.repeat(40)},{usd:'0x'+'2'.repeat(40)}]){
  let called=false;await assert.rejects(readTokenPrice({...config,...change},{fetchImpl:async()=>{called=true;}}),/not supported/);assert.equal(called,false);
 }
 assert.equal(tokenPriceSupported(config),true);
});
test('network mismatch, changed canonical block or reserve/price inconsistency rejects the snapshot',async()=>{
 const wrong=fixture(({rows,index})=>{if(index===1)rows.find(r=>r.id===1).result='0x61';});
 await assert.rejects(readTokenPrice(config,{fetchImpl:wrong.fetchImpl}),/network/);assert.equal(wrong.calls.length,1);
 const reorg=fixture(({rows,index})=>{if(index===3)rows.find(r=>r.id===31).result.hash='0x'+'b'.repeat(64);});
 await assert.rejects(readTokenPrice(config,{fetchImpl:reorg.fetchImpl}),/block changed/);
 const mismatch=fixture();mismatch.values.price=UNIT/10n;await assert.rejects(readTokenPrice(config,{fetchImpl:mismatch.fetchImpl}),/do not match/);
});
test('RPC errors, malformed quantities and missing or duplicate results never become zero prices',async()=>{
 for(const mutate of [
  ({rows,index})=>{if(index===2)delete rows[0].result;},
  ({rows,index})=>{if(index===2)rows[0].error={code:-32000};},
  ({rows,index})=>{if(index===2)rows[0].result='0x1';},
  ({rows,index})=>{if(index===2)rows[1].id=rows[0].id;},
  ({rows,index})=>{if(index===2)rows.pop();}
 ]){const f=fixture(mutate);await assert.rejects(readTokenPrice(config,{fetchImpl:f.fetchImpl}));}
});
test('cancellation and bounded timeout abort read-only requests',async()=>{
 const abort=new AbortController();abort.abort();let called=false;
 await assert.rejects(readTokenPrice(config,{signal:abort.signal,fetchImpl:async()=>{called=true;}}),/cancelled/);assert.equal(called,false);
 await assert.rejects(readTokenPrice(config,{timeoutMs:1,fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))}),/aborted/);
});
test('the current rate shows eight exact decimals in English and Persian without a made-up zero price',()=>{
 assert.equal(tokenPriceAmount('103092783505154639'),'0.10309278');
 assert.equal(tokenPriceAmount('103092783505154639','fa'),'۰٫۱۰۳۰۹۲۷۸');
 assert.equal(tokenPriceAmount('100000000000000000'),'0.10000000');
 assert.equal(tokenPriceAmount('1'),'< 0.00000001');
 assert.equal(tokenPriceAmount('0'),'0.00000000');
 for(const value of [null,undefined,'-1','bad'])assert.equal(tokenPriceAmount(value),'—');
});
test('a successful canonical snapshot older than 45 seconds is delayed, with its actual price retained',async()=>{
 const f=fixture(),snapshot=await readTokenPrice(config,{fetchImpl:f.fetchImpl});
 const time=snapshot.timestamp*1000;
 assert.equal(tokenPriceFreshness(snapshot.timestamp,time+45000),'fresh');
 assert.equal(tokenPriceFreshness(snapshot.timestamp,time+45001),'delayed');
 assert.equal(tokenPriceAmount(snapshot.priceWei),'0.20000000');
 assert.equal(tokenPriceFreshness(snapshot.timestamp,time-45001),'delayed');
 for(const timestamp of [0,-1,undefined,null,1.5])assert.equal(tokenPriceFreshness(timestamp,time),'unavailable');
});
test('zero timestamp is rejected even if both canonical block reads agree',async()=>{
 const f=fixture(({rows,batch})=>{for(const call of batch)if(call.method==='eth_getBlockByNumber')rows.find(row=>row.id===call.id).result.timestamp='0x0';});
 await assert.rejects(readTokenPrice(config,{fetchImpl:f.fetchImpl}),/timestamp/);
});
