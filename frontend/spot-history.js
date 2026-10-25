// Observed prices are never built from USD/token execution averages or localStorage.
const uint=/^(0|[1-9][0-9]*)$/;
function check(ok,message){if(!ok)throw Error(message);}
export function validObservation(row){
 check(row&&Number.isSafeInteger(row.block)&&row.block>=0&&Number.isSafeInteger(row.time)&&row.time>=0,'Invalid observation block/time');
 check(/^0x[\da-f]{64}$/i.test(row.hash),'Missing observation block hash');
 for(const key of ['priceWei','supplyWei','cycle'])check(['string','bigint'].includes(typeof row[key])&&uint.test(String(row[key]))&&BigInt(row[key])<(1n<<256n),'Invalid observation '+key);
 check(BigInt(row.cycle)>0n,'Invalid cycle');
 return {...row,priceWei:String(row.priceWei),supplyWei:String(row.supplyWei),cycle:String(row.cycle)};
}
export function mergeObservations(previous,incoming,limit=400){
 check(Number.isSafeInteger(limit)&&limit>=1&&limit<=10000,'Invalid observation limit');
 const rows=previous.map(validObservation);
 for(const input of incoming){const row=validObservation(input),same=rows.find(r=>r.block===row.block);
  if(same&&same.hash.toLowerCase()===row.hash.toLowerCase())check(['priceWei','supplyWei','cycle','time'].every(k=>same[k]===row[k]),'Conflicting observation for one block');
  if(same&&same.hash.toLowerCase()!==row.hash.toLowerCase()){
   // Drop descendants of a replaced block. Never connect across a known reorg.
   for(let i=rows.length-1;i>=0;i--)if(rows[i].block>=row.block)rows.splice(i,1);
  }
  const index=rows.findIndex(r=>r.block===row.block);if(index<0)rows.push(row);else rows[index]=row;
 }
 rows.sort((a,b)=>a.block-b.block);
 const cycle=rows.at(-1)?.cycle;
 return rows.filter(r=>r.cycle===cycle).slice(-limit);
}
export function observedSeries(rows,windowSeconds=0){
 check(Number.isSafeInteger(windowSeconds)&&windowSeconds>=0,'Invalid chart window');
 if(!rows.length)return [];
 const verified=rows.map(validObservation).sort((a,b)=>a.block-b.block);
 const last=verified.at(-1),series=[];
 for(const r of verified){
  if(r.cycle!==last.cycle||BigInt(r.supplyWei)===0n||(windowSeconds&&r.time<last.time-windowSeconds))continue;
  const price=Number(r.priceWei)/1e18;check(Number.isFinite(price)&&price>=0,'Unplottable price');
  check(!series.length||r.time>=series.at(-1).time,'Nonmonotonic block times');
  // Several blocks may share a timestamp; keep the final observation at that time.
  if(series.at(-1)?.time===r.time)series.pop();series.push({...r,price});
 }
 return series;
}
export function curveGeometry(series){
 if(!series.length)return null;
 const values=series.map(p=>p.price);
 check(values.every(p=>Number.isFinite(p)&&p>=0),'Invalid chart value');
 const low=Math.min(...values),high=Math.max(...values),pad=Math.max((high-low)*.15,high*.001,1e-18);
 const min= Math.max(0,low-pad),max=high+pad,first=series[0].time,last=series.at(-1).time;
 const xy=series.map(p=>[54+(p.time-first)/Math.max(1,last-first)*630,25+(max-p.price)/Math.max(1e-18,max-min)*210]);
 const path=xy.map(([x,y],i)=>{if(!i)return `M${x} ${y}`;const [px,py]=xy[i-1],mid=(px+x)/2;return `C${mid} ${py} ${mid} ${y} ${x} ${y}`;}).join(' ');
 return {xy,path,min,max,change:series[0].price>0?(series.at(-1).price/series[0].price-1)*100:null};
}
export async function readObservation(token,rpc,block){
 check(block&&Number.isSafeInteger(block.number),'Missing price block');
 const at={blockTag:block.number};
 const [price,supply,cycle]=await Promise.all([token.price(at),token.totalSupply(at),token.cycle(at)]);
 const again=await rpc.getBlock(block.number);check(again?.hash===block.hash,'Price block reorganized');
 return validObservation({block:block.number,hash:block.hash,time:block.timestamp,priceWei:String(price),supplyWei:String(supply),cycle:String(cycle)});
}
export async function historicalObservations(token,rpc,cfg,{count=16,lookback=300}={}){
 check(Number.isSafeInteger(count)&&count>=2&&count<=24&&(lookback==='deployment'||Number.isSafeInteger(lookback)&&lookback>=1&&lookback<=5000),'Historical budget exceeded');
 check(Number.isSafeInteger(cfg.deployedBlock)&&cfg.deployedBlock>=0,'Unknown deployment block');
 check(String((await rpc.getNetwork()).chainId)===String(cfg.chainId),'Wrong history network');
 const tip=await rpc.getBlock('latest');check(tip&&tip.number>=cfg.deployedBlock,'Missing history tip');
 // deployedBlock may identify the earlier council deployment. The token proxy
 // is first readable at its own creation receipt, when supplied by the release.
 const created=cfg.receipts?.token?.blockNumber??cfg.deployedBlock;
 check(Number.isSafeInteger(created)&&created>=cfg.deployedBlock&&created<=tip.number,'Invalid token creation block');
 const first=lookback==='deployment'?created:Math.max(created,tip.number-lookback);
 const numbers=[...new Set(Array.from({length:count},(_,i)=>first+Math.floor((tip.number-first)*i/(count-1))))];
 const rows=[];
 // Bound concurrency and work. Any missing historical call fails the WHOLE
 // history read; callers may still show separately verified current samples.
 for(let i=0;i<numbers.length;i+=2){
  const batch=await Promise.all(numbers.slice(i,i+2).map(async n=>readObservation(token,rpc,await rpc.getBlock(n))));rows.push(...batch);
 }
 check((await rpc.getBlock(tip.number))?.hash===tip.hash,'History tip reorganized');
 return mergeObservations([],rows);
}
export function tradeHistory(payload){
 check(payload&&Number.isSafeInteger(payload.fromBlock)&&Number.isSafeInteger(payload.toBlock)&&payload.fromBlock>=0&&payload.toBlock>=payload.fromBlock&&Array.isArray(payload.trades)&&payload.trades.length<=10000,'Invalid trade history');
 for(const r of payload.trades){check(['Bought','Sold'].includes(r.event)&&Number.isSafeInteger(r.block)&&r.block>=payload.fromBlock&&r.block<=payload.toBlock&&Number.isSafeInteger(r.time)&&r.time>=0&&/^0x[\da-f]{64}$/i.test(r.hash),'Invalid trade');
  for(const k of ['usd','tokens'])check(typeof r[k]==='string'&&uint.test(r[k])&&BigInt(r[k])>0n&&BigInt(r[k])<(1n<<256n),'Invalid trade amount');
 }
 return {rows:[...payload.trades],volumeWei:payload.trades.reduce((sum,r)=>sum+BigInt(r.usd),0n)};
}

// An opening quote is a reference from the contract, never a reserve/supply
// observation while supply is zero. Keep its provenance separate in the chart.
export function validOpeningQuote(value){
 check(value&&value.kind==='opening-quote'&&Number.isSafeInteger(value.block)&&value.block>=0&&Number.isSafeInteger(value.time)&&value.time>0,'Invalid opening quote');
 check(/^0x[\da-f]{64}$/i.test(value.hash||'')&&/^0x[\da-f]{64}$/i.test(value.transactionHash||'')&&/^0x[\da-f]{40}$/i.test(value.token||''),'Invalid opening quote provenance');
 check(typeof value.priceWei==='string'&&uint.test(value.priceWei)&&BigInt(value.priceWei)>0n&&BigInt(value.priceWei)<(1n<<256n)&&value.cycle==='1','Invalid opening quote amount');
 return {...value};
}
export async function readOpeningQuote(token,rpc,cfg,current){
 const sample=validObservation(current);
 // Later cycles open at a different quote and time. Do not carry the first
 // cycle's reference across a reset or invent an unknown cycle-start timestamp.
 if(sample.cycle!=='1')return null;
 check(String((await rpc.getNetwork()).chainId)===String(cfg.chainId),'Wrong opening quote network');
 const source=cfg.receipts?.token;
 check(source&&Number.isSafeInteger(source.blockNumber)&&source.blockNumber>=0&&source.blockNumber<=sample.block&&/^0x[\da-f]{64}$/i.test(source.transactionHash||'')&&/^0x[\da-f]{64}$/i.test(source.blockHash||''),'Token creation receipt unavailable');
 check(/^0x[\da-f]{40}$/i.test(cfg.token||'')&&String(token.target).toLowerCase()===cfg.token.toLowerCase(),'Opening quote token mismatch');
 const at={blockTag:sample.block};
 const [receipt,block,initial,start,cycle]=await Promise.all([
  rpc.getTransactionReceipt(source.transactionHash),rpc.getBlock(source.blockNumber),
  token.INITIAL_PRICE(at),token.cycleStartPrice(at),token.cycle(at)
 ]);
 check(receipt&&receipt.status===1&&receipt.blockNumber===source.blockNumber&&String(receipt.hash??receipt.transactionHash).toLowerCase()===source.transactionHash.toLowerCase()&&String(receipt.blockHash).toLowerCase()===source.blockHash.toLowerCase()&&String(receipt.contractAddress).toLowerCase()===cfg.token.toLowerCase(),'Token creation receipt mismatch');
 check(block&&block.number===source.blockNumber&&String(block.hash).toLowerCase()===source.blockHash.toLowerCase()&&Number.isSafeInteger(block.timestamp)&&block.timestamp>0&&block.timestamp<=sample.time,'Token creation block mismatch');
 check(BigInt(cycle)===1n&&BigInt(initial)>0n&&BigInt(start)===BigInt(initial),'Opening quote cycle mismatch');
 check((await rpc.getBlock(sample.block))?.hash?.toLowerCase()===sample.hash.toLowerCase(),'Opening quote anchor reorganized');
 return validOpeningQuote({kind:'opening-quote',cycle:'1',priceWei:String(initial),block:block.number,time:block.timestamp,hash:block.hash,transactionHash:source.transactionHash,token:cfg.token});
}
export function priceChartSeries(rows,windowSeconds=0,openingQuote=null){
 const series=observedSeries(rows,windowSeconds).map(row=>({...row,kind:'observation'}));
 if(!openingQuote||windowSeconds||!series.length)return series;
 const quote=validOpeningQuote(openingQuote),first=series[0];
 if(quote.cycle!==first.cycle||quote.block>=first.block||quote.time>=first.time)return series;
 const price=Number(quote.priceWei)/1e18;check(Number.isFinite(price)&&price>0,'Unplottable opening quote');
 return [{...quote,price},...series];
}
