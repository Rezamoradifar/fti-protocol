// Recent execution prices and actual notional; no fabricated candles or 24h totals.
const timestampCaches=new WeakMap();
export async function readMarket(provider,token,from,to){
 const rows=[];
 for(let end=to;end>=from;end-=100){
  const logs=await provider.getLogs({address:token.target,fromBlock:Math.max(from,end-99),toBlock:end,topics:[[token.interface.getEvent('Bought').topicHash,token.interface.getEvent('Sold').topicHash]]});
  for(const log of logs){const e=token.interface.parseLog(log);rows.push({event:e.name,block:log.blockNumber,index:log.index,hash:log.transactionHash,usd:String(e.name==='Bought'?e.args.usdIn:e.args.usdOut),tokens:String(e.name==='Bought'?e.args.userTokens:e.args.tokensIn)});}
 }
 let blocks=timestampCaches.get(provider);if(!blocks){blocks=new Map();timestampCaches.set(provider,blocks);}
 const missing=[...new Set(rows.map(r=>r.block))].filter(n=>!blocks.has(n));
 for(let i=0;i<missing.length;i+=4)await Promise.all(missing.slice(i,i+4).map(async n=>{const b=await provider.getBlock(n);if(!b)throw Error('Missing trade block');blocks.set(n,b.timestamp);}));
 const result=rows.sort((a,b)=>a.block-b.block||a.index-b.index).map(r=>({...r,time:blocks.get(r.block)}));
 for(const n of blocks.keys())if(n<from-300)blocks.delete(n);
 return {fromBlock:from,toBlock:to,trades:result};

}
