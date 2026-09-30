// Bounded log pagination. Never report an empty success when RPC retrieval failed.
export async function readEvents(provider,contracts,from,to,maxRequests=80){
 let calls=0;const records=[];
 async function range(contract,name,lo,hi){
  if(++calls>maxRequests)throw Error('Activity RPC request budget exceeded; retry later');
  let logs;try{logs=await provider.getLogs({address:contract.target,fromBlock:lo,toBlock:hi});}
  catch(error){if(lo===hi)throw Error('Activity RPC unavailable at block '+lo,{cause:error});const mid=Math.floor((lo+hi)/2);await range(contract,name,mid+1,hi);await range(contract,name,lo,mid);return;}
  for(const log of logs){let parsed;try{parsed=contract.interface.parseLog(log);}catch{continue;}if(!parsed)continue;records.push({name:parsed.name,contract:name,block:log.blockNumber,index:log.index,hash:log.transactionHash,args:parsed.fragment.inputs.map((input,i)=>({name:input.name,value:parsed.args[i]}))});}
 }
 for(let end=to;end>=from;end-=100){const start=Math.max(from,end-99);for(const [name,c]of Object.entries(contracts))await range(c,name,start,end);if(records.length>=100)break;}
 return records.sort((a,b)=>b.block-a.block||b.index-a.index).slice(0,100);
}
