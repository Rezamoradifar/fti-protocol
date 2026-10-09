// OHLC of observed on-chain spot samples. Missing intervals are never fabricated.
export function candles(points,seconds=60){
 if(![60,300,900].includes(seconds))throw Error('Unsupported interval');
 const buckets=new Map();
 for(const p of [...points].sort((a,b)=>a.time-b.time)){
  if(!Number.isFinite(p.time)||!Number.isFinite(p.price)||p.price<0)throw Error('Invalid sample');
  const time=Math.floor(p.time/seconds)*seconds,c=buckets.get(time);
  if(c){c.high=Math.max(c.high,p.price);c.low=Math.min(c.low,p.price);c.close=p.price;c.samples++;}
  else buckets.set(time,{time,open:p.price,high:p.price,low:p.price,close:p.price,samples:1});
 }
 return [...buckets.values()];
}
