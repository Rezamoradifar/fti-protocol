import {deploymentNetwork} from '../core/deployment-network.mjs';
let pending;
export function deploymentConfiguration(){
 if(!pending)pending=(async()=>{
  const response=await fetch('/api/config',{cache:'no-store',signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error('Deployment configuration unavailable');
  const cfg=await response.json();deploymentNetwork(cfg);return cfg;
 })().catch(error=>{pending=null;throw error;});
 return pending;
}
