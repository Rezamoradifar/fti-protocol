import test from 'node:test';
import assert from 'node:assert/strict';
import {HOURLY_POOL_SELECTORS,hourlyPoolSupported,readHourlyPool} from '../frontend/hourly-pool-data.js';
const unit=10n**18n,address='0x'+'1'.repeat(40),blockHash='0x'+'a'.repeat(64);
const config={chainId:56,mode:'bnb-mainnet',binaryContract:'FundedBinaryPlanUpgradeable',tokenContract:'FTIReserveTokenUpgradeable',poolDistributionVersion:1,binary:address};
const word=value=>'0x'+BigInt(value).toString(16).padStart(64,'0');
function fixture(changes={}){
 const state={pointPool:95n*unit,epoch:3n,epochEnd:7200n,phase:0n,frozenPool:100n*unit,totalPaidPoints:3n,pointValue:100n*unit/3n,lastClosedAt:3600n,...changes};
 const calls=[],heads={number:'0x64',hash:blockHash,timestamp:'0x1000'};
 const fetchImpl=async(url,options)=>{
  const requests=JSON.parse(options.body);calls.push(requests);
  assert.equal(url,'/rpc');assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');
  const rows=requests.map(request=>{
   let result;
   if(request.method==='eth_chainId')result='0x38';
   else if(request.method==='eth_getBlockByNumber')result={...heads};
   else{
    assert.equal(request.method,'eth_call');assert.equal(request.params[0].to,address);assert.equal(request.params[1],'0x64');
    const name=Object.keys(HOURLY_POOL_SELECTORS).find(name=>HOURLY_POOL_SELECTORS[name]===request.params[0].data);
    assert(name);result=word(state[name]);
   }
   return {jsonrpc:'2.0',id:request.id,result};
  });
  return {ok:true,json:async()=>rows.reverse()};
 };
 return {state,calls,heads,fetchImpl};
}
test('reads only public RPC methods at one verified block and labels current versus completed epochs',async()=>{
 const f=fixture(),data=await readHourlyPool(config,f);
 assert.equal(f.calls.length,3);assert.equal(f.calls[1].length,8);
 assert.deepEqual(data.current,{epoch:'3',poolWei:String(95n*unit),end:7200,timestamp:4096,phase:0});
 assert.deepEqual(data.settled,{epoch:'2',poolWei:String(100n*unit),points:'3',pointValueWei:String(100n*unit/3n),closedAt:3600});
 assert.equal(data.block,100);assert.equal(data.blockHash,blockHash);
 assert(f.calls.flat().every(row=>['eth_call','eth_chainId','eth_getBlockByNumber'].includes(row.method)));
});
test('matching/allocation never expose partial counts as a completed hourly settlement',async()=>{
 for(const phase of [1n,2n]){const f=fixture({phase,totalPaidPoints:2n,pointValue:99n});assert.equal((await readHourlyPool(config,f)).settled,null);}
});
test('zero eligible points has no point value, including a nonempty carried pool',async()=>{
 const f=fixture({totalPaidPoints:0n,pointValue:0n});const data=await readHourlyPool(config,f);
 assert.equal(data.settled.points,'0');assert.equal(data.settled.pointValueWei,null);assert.equal(data.settled.poolWei,String(100n*unit));
});
test('the first open epoch has no fabricated settlement history',async()=>{
 const f=fixture({epoch:1n,lastClosedAt:0n});assert.equal((await readHourlyPool(config,f)).settled,null);
});
test('unsupported deployment identity is rejected before any RPC request',async()=>{
 for(const change of [{chainId:97},{mode:'local'},{poolDistributionVersion:0},{binary:'not an address'},{binaryContract:'BinaryPlan'},{tokenContract:'FTIToken'}]){
  let called=false;assert.equal(hourlyPoolSupported({...config,...change}),false);
  await assert.rejects(readHourlyPool({...config,...change},{fetchImpl:async()=>{called=true;}}),/not supported/);assert.equal(called,false);
 }
});
test('malformed, incomplete, duplicate and errored batch data do not become zero-valued metrics',async()=>{
 for(const mutate of [rows=>rows.slice(1),rows=>[rows[0],rows[0]],rows=>rows.map(row=>({...row,error:{message:'unavailable'}})),rows=>rows.map(row=>({...row,result:undefined})),rows=>rows.map(row=>({...row,jsonrpc:'1.0'}))]){
  const f=fixture(),fetchImpl=async(...args)=>{const r=await f.fetchImpl(...args);return {...r,json:async()=>mutate(await r.json())};};
  await assert.rejects(readHourlyPool(config,{fetchImpl}));
 }
 for(const value of ['0x0','0xzz','',null]){
  const f=fixture(),fetchImpl=async(...args)=>{const r=await f.fetchImpl(...args);return {...r,json:async()=>{const rows=await r.json();if(f.calls.length===2)rows[0].result=value;return rows;}};};
  await assert.rejects(readHourlyPool(config,{fetchImpl}),/Invalid hourly pool contract response/);
 }
});
test('wrong initial/final network and reorgs reject the whole snapshot',async()=>{
 for(const stage of [1,3]){
  const f=fixture(),fetchImpl=async(...args)=>{const r=await f.fetchImpl(...args);return {...r,json:async()=>{const rows=await r.json();if(f.calls.length===stage)rows.find(row=>row.id===(stage===1?1:30)).result='0x61';return rows;}};};
  await assert.rejects(readHourlyPool(config,{fetchImpl}),/different network/);
 }
 const f=fixture(),fetchImpl=async(...args)=>{if(f.calls.length===2)f.heads.hash='0x'+'b'.repeat(64);return f.fetchImpl(...args);};
 await assert.rejects(readHourlyPool(config,{fetchImpl}),/block changed/);
});
test('inconsistent settled value, invalid phases and future close times are not published',async()=>{
 for(const changes of [{pointValue:1n},{phase:3n},{epoch:0n},{epochEnd:1n},{lastClosedAt:7200n}])await assert.rejects(readHourlyPool(config,fixture(changes)),/verified|Inconsistent/);
});
test('HTTP failure, timeout and cancelled reads remain failures without wallet calls or retries',async()=>{
 await assert.rejects(readHourlyPool(config,{fetchImpl:async()=>({ok:false})}),/unavailable/);
 const controller=new AbortController();controller.abort();let called=false;
 await assert.rejects(readHourlyPool(config,{signal:controller.signal,fetchImpl:async()=>{called=true;}}),/cancelled/);assert.equal(called,false);
 await assert.rejects(readHourlyPool(config,{timeoutMs:5,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))}),/aborted/);
});
