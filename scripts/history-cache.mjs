// Share bounded read-only history work. Failed/late reads never become an empty
// success, and a timed-out upstream call must drain before another can start.
export function historyCache(load,{ttlMs=30000,failureTtlMs=15000,timeoutMs=18000,now=Date.now}={}){
 if(typeof load!=='function'||typeof now!=='function'||![ttlMs,failureTtlMs,timeoutMs].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('Invalid history cache configuration');
 let cached,failure,active;
 return function read(){
  if(cached&&now()-cached.at<ttlMs)return Promise.resolve(cached.value);
  if(failure&&now()-failure.at<failureTtlMs)return Promise.reject(failure.error);
  if(active)return active.response;
  const controller=new AbortController(),entry={};
  const raw=Promise.resolve().then(()=>load(controller.signal));
  let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=Error('History RPC deadline exceeded');controller.abort(error);reject(error);},timeoutMs);});
  entry.response=Promise.race([raw,deadline]).then(value=>{
   if(controller.signal.aborted)throw controller.signal.reason;
   cached={at:now(),value};failure=undefined;return value;
  }).catch(error=>{failure={at:now(),error};throw error;}).finally(()=>clearTimeout(timer));
  active=entry;
  const drained=()=>{if(active===entry)active=undefined;};
  // Handle both outcomes without creating an unhandled rejecting finally-promise.
  raw.then(drained,drained);
  return entry.response;
 };
}
