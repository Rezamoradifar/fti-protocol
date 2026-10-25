import {useSyncExternalStore} from 'react';

const MAX_AGE_MS=120_000;
const empty=Object.freeze({connected:false,address:null,network:null,verified:false,stale:false,status:'disconnected',membershipStatus:'unknown',busy:false,snapshot:Object.freeze({block:null,timestamp:null,updatedAt:null,ageSeconds:null})});
let current=empty;
const listeners=new Set();
let expiryTimer;
const milliseconds=value=>Number.isSafeInteger(value)&&value>0?value:null;
function observedTimes(view){
 const timestamp=milliseconds(view?.snapshot?.timestamp);
 const blockTime=timestamp!==null&&timestamp<=Math.floor(Number.MAX_SAFE_INTEGER/1000)?timestamp*1000:null;
 const updatedAt=milliseconds(view?.snapshot?.updatedAt);
 return {blockTime,updatedAt,times:[blockTime,updatedAt].filter(value=>value!==null)};
}

/** Expire an observed view without changing its identity or retained balances. */
export function expireMemberView(view,now=Date.now()){
 if(!view?.connected||view.verified!==true||milliseconds(now)===null)return view;
 const {blockTime,times}=observedTimes(view);
 if(!times.length||!times.some(time=>now-time>MAX_AGE_MS||time-now>15_000))return view;
 return {...view,verified:false,stale:true,status:'stale',hourlyCap:null,
  snapshot:{...view.snapshot,ageSeconds:blockTime===null?view.snapshot?.ageSeconds??null:Math.max(0,Math.floor((now-blockTime)/1000))}};
}

const notify=()=>{for(const listener of [...listeners])listener();};
function checkExpiry(){
 const next=expireMemberView(current);
 if(next!==current){current=next;notify();}
 scheduleExpiry();
}
function scheduleExpiry(){
 clearTimeout(expiryTimer);expiryTimer=undefined;
 if(!listeners.size||!current.connected||current.verified!==true)return;
 const {times}=observedTimes(current);if(!times.length)return;
 // The account projector is fresh through exactly 120 seconds. Wake at the
 // first millisecond beyond that boundary; this timer performs no reads.
 const deadline=Math.min(...times)+MAX_AGE_MS+1;
 const delay=Math.max(1,Math.min(2_147_483_647,deadline-Date.now()));
 expiryTimer=setTimeout(checkExpiry,delay);
 expiryTimer?.unref?.();
}
function onVisibilityChange(){checkExpiry();}

export function publishMemberView(next){current=expireMemberView(next);notify();scheduleExpiry();}
export const readMemberView=()=>current;
export function subscribeMemberView(listener){
 listeners.add(listener);
 if(listeners.size===1&&typeof document!=='undefined')document.addEventListener('visibilitychange',onVisibilityChange);
 checkExpiry();
 return()=>{
  listeners.delete(listener);
  if(!listeners.size){clearTimeout(expiryTimer);expiryTimer=undefined;if(typeof document!=='undefined')document.removeEventListener('visibilitychange',onVisibilityChange);}
 };
}
export const useMemberView=()=>useSyncExternalStore(subscribeMemberView,readMemberView,()=>empty);
