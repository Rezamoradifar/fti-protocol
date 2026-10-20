// Only same-origin read endpoints may be retried. Never use for wallet/RPC sends.
export async function readJson(url,{fetchImpl=globalThis.fetch,timeoutMs=12000}={}){
 if(!/^\/api\/(config|state|locks|placement|events)(\?|$)/.test(url)&&!/^\/abi\/[A-Za-z][A-Za-z0-9_]*$/.test(url))throw Error('Unsupported read endpoint');
 for(let attempt=0;attempt<2;attempt++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetchImpl(url,{method:'GET',cache:'no-store',signal:controller.signal});
   if(!response.ok){const error=Error('Contract data service returned HTTP '+response.status+'. Refresh to retry.');error.retryable=response.status===429||response.status>=500;throw error;}
   return await response.json();
  }catch(error){
   if(error.retryable===false)throw error;
   if(attempt===1)throw Error('Contract data could not be loaded. Check your connection and tap Refresh. Wallet connection is separate; do not repeat a payment.');
  }finally{clearTimeout(timer);}
 }
}

export async function initializeReadSession({refresh,ready,failed,reconnect}){
 try{await refresh();ready();}catch(error){failed(error);}
 // A failed public read must not prevent restoring an already-authorized wallet.
 await reconnect();
}
