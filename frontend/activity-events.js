// Own only the activity view. It never writes wallet/global status, retries a
// transaction, or turns a failed history read into a successful empty result.
export function createActivityEvents({read,render,notice,loading,isActive=()=>true}) {
 let current,hasSnapshot=false;
 async function load() {
  if(!isActive())return;
  if(current)return current.promise;
  const request={controller:new AbortController()};
  current=request;
  loading(true);
  notice(hasSnapshot?'refreshing':'loading');
  const valid=()=>current===request&&!request.controller.signal.aborted&&isActive();
  request.promise=(async()=>{
   try{
    const rows=await read('/api/events',{signal:request.controller.signal});
    if(!valid())return;
    if(!Array.isArray(rows))throw Error('Events are unavailable.');
    render(rows);
    hasSnapshot=true;
    notice(rows.length?'ready':'empty');
   }catch(error){
    if(valid())notice(hasSnapshot?'stale':'error');
   }finally{
    if(current===request){current=null;loading(false);}
   }
  })();
  return request.promise;
 }
 function cancel(){
  if(!current)return;
  const request=current;current=null;
  request.controller.abort();loading(false);
 }
 return {load,cancel};
}
