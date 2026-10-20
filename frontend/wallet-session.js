// Disconnecting must never remove pending transaction records.
export async function disconnectSession(selected,storage,timeoutMs=5000){
 for(const key of ['fti-wallet-connected','fti-selected-wallet','fti-local-account'])try{storage?.removeItem(key);}catch{}
 if(!selected?.remote)return true;
 let timer;
 try{
  if(typeof selected.provider?.disconnect!=='function')return false;
  await Promise.race([Promise.resolve().then(()=>selected.provider.disconnect()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Disconnect timeout')),timeoutMs);})]);
  return true;
 }catch{return false;}finally{clearTimeout(timer);}
}
