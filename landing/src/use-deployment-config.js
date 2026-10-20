import {useEffect,useState} from 'react';

export function useDeploymentConfig(){
 const [config,setConfig]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let stopped=false,retryTimer;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
  setLoading(true);setError(false);
  (async()=>{
   try{
    const response=await fetch('/api/config',{method:'GET',cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error('Network configuration unavailable.');
    const next=await response.json();
    if(!next||!((next.chainId===56&&next.mode==='bnb-mainnet')||(next.chainId===97&&['testnet','bnb-testnet'].includes(next.mode))))throw Error('Unrecognized deployment.');
    if(!stopped)setConfig(next);
   }catch{
    if(!stopped){setConfig(null);setError(true);retryTimer=setTimeout(()=>setAttempt(value=>value+1),30000);}
   }finally{clearTimeout(timeout);if(!stopped)setLoading(false);}
  })();
  return()=>{stopped=true;clearTimeout(timeout);clearTimeout(retryTimer);controller.abort();};
 },[attempt]);
 return {config,loading,error,retry:()=>setAttempt(value=>value+1)};
}
