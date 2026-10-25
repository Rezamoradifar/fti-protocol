// Ticket writes are never retried automatically. A lost response is resolved
// by reopening the ticket list, so a network failure cannot duplicate a report.
export async function panelService(path,{method='GET',body,authorization,signal,fetchImpl=globalThis.fetch,timeoutMs=45000}={}){
 if(typeof path!=='string'||!/^\/api\/(?:member-history(?:\?|$)|support\/(?:challenge|session|tickets(?:\/[a-f0-9]{32}(?:\/(?:replies|status))?)?)(?:\?|$))/.test(path)||/[#\r\n\\]/.test(path))throw Error('Unsupported panel endpoint');
 const url=new URL(path,'https://panel.invalid');
 if(url.origin!=='https://panel.invalid'||!['GET','POST'].includes(method)||(method==='GET'&&body!==undefined)||(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000))throw Error('Invalid panel request');
 if(url.pathname==='/api/member-history'&&method!=='GET')throw Error('History is read only');
 if(authorization!==undefined&&!/^Bearer [a-f0-9]{64}$/.test(authorization))throw Error('Invalid support authorization');
 if(signal?.aborted)throw signal.reason||Object.assign(Error('Request canceled'),{name:'AbortError'});
 const controller=new AbortController();
 const cancel=()=>controller.abort(signal.reason||Object.assign(Error('Request canceled'),{name:'AbortError'}));
 signal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(()=>controller.abort(Object.assign(Error('Panel service timed out. Refresh the list before trying again.'),{code:'PANEL_TIMEOUT'})),timeoutMs);
 try{
  const encoded=body===undefined?undefined:JSON.stringify(body);
  if(encoded&&encoded.length>12000)throw Error('Report is too large');
  const response=await fetchImpl(path,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(authorization?{Authorization:authorization}:{})},body:encoded,cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});
  const data=await response.json();
  if(!response.ok){const code=typeof data?.error==='string'&&/^[A-Z_]{1,64}$/.test(data.error)?data.error:'PANEL_SERVICE_UNAVAILABLE';throw Object.assign(Error(code),{status:response.status,code});}
  return data;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
