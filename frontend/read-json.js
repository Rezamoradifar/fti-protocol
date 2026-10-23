// Only same-origin read endpoints may be retried. Never use for wallet/RPC sends.
import {ACTIVITY_READ_TIMEOUT_MS,ACTIVITY_READ_ATTEMPTS} from '../core/history-read-policy.mjs';
export async function readJson(url,{fetchImpl=globalThis.fetch,timeoutMs,attempts,signal}={}){
 if(!/^\/api\/(config|state|locks|placement|events)(\?|$)/.test(url)&&!/^\/abi\/[A-Za-z][A-Za-z0-9_]*$/.test(url))throw Error('Unsupported read endpoint');
 const activity=/^\/api\/events(\?|$)/.test(url);
 timeoutMs??=activity?ACTIVITY_READ_TIMEOUT_MS:12000;
 attempts??=activity?ACTIVITY_READ_ATTEMPTS:2;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||![1,2].includes(attempts))throw Error('Invalid read policy');
 const canceled=()=>signal.reason||Object.assign(Error('Read request canceled'),{name:'AbortError'});
 for(let attempt=0;attempt<attempts;attempt++){
  if(signal?.aborted)throw canceled();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  const abort=()=>controller.abort(canceled());
  signal?.addEventListener('abort',abort,{once:true});
  try{
   const response=await fetchImpl(url,{method:'GET',cache:'no-store',signal:controller.signal});
   if(!response.ok){const error=Error('Contract data service returned HTTP '+response.status+'. Refresh to retry.');error.retryable=response.status===429||response.status>=500;throw error;}
   return await response.json();
  }catch(error){
   if(signal?.aborted)throw canceled();
   if(error.retryable===false)throw error;
   if(attempt===attempts-1)throw Error('Contract data could not be loaded. Check your connection and tap Refresh. Wallet connection is separate; do not repeat a payment.');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
}

export async function initializeReadSession({refresh,ready,failed,reconnect}){
 try{await refresh();ready();}catch(error){failed(error);}
 // A failed public read must not prevent restoring an already-authorized wallet.
 await reconnect();
}
