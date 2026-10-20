// This scheduler only invokes a caller's read-only verification callback. It
// never sends a wallet request or decides whether an uncertain send is safe.
export function pendingMonitor({check,isCurrent=()=>true,onExhausted=()=>{},document=globalThis.document,
 interval=15000,maxAttempts=6,setTimer=setTimeout,clearTimer=clearTimeout}){
 if(typeof check!=='function'||typeof isCurrent!=='function'||typeof onExhausted!=='function'||
  !Number.isFinite(interval)||interval<1000||!Number.isSafeInteger(maxAttempts)||maxAttempts<1)
  throw Error('Invalid pending monitor configuration.');
 let active=false,timer=null,inFlight=false,attempts=0,generation=0;
 const visible=()=>!document?.hidden;
 const clear=()=>{if(timer!==null){clearTimer(timer);timer=null;}};
 function stop(){active=false;generation++;clear();document?.removeEventListener?.('visibilitychange',visibilityChanged);}
 function queue(delay){
  clear();
  if(active&&visible())timer=setTimer(run,delay);
 }
 function exhausted(){
  if(!active||!visible())return;
  if(!isCurrent()){stop();return;}
  stop();
  try{onExhausted();}catch{/* A status callback cannot restart verification. */}
 }
 async function run(){
  timer=null;
  if(!active)return;
  if(!isCurrent()){stop();return;}
  if(!visible())return;
  if(inFlight){queue(interval);return;}
  if(attempts>=maxAttempts){exhausted();return;}
  const ownGeneration=generation;
  inFlight=true;attempts++;
  let resolved=false;
  try{resolved=await check();}catch{/* Temporary read failures preserve the pending request. */}
  finally{inFlight=false;}
  if(!active||generation!==ownGeneration)return;
  if(!isCurrent()||resolved===true){stop();return;}
  // A final read may finish after the tab becomes hidden. Preserve the
  // exhausted budget and notify only when this current session is visible.
  if(attempts>=maxAttempts){exhausted();return;}
  queue(interval);
 }
 function visibilityChanged(){clear();if(visible())queue(0);}
 function start(){
  if(active)return;
  active=true;attempts=0;generation++;
  document?.addEventListener?.('visibilitychange',visibilityChanged);
  queue(0);
 }
 // Wake never resets the bounded budget. Call start for a new pending session.
 function wake(){if(active&&visible())queue(0);}
 return {start,stop,wake};
}
