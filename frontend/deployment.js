import {readJson} from './read-json.js';
import {deploymentNetwork} from '../core/deployment-network.mjs';
let pending;
export function deploymentConfiguration(){
 if(!pending)pending=(async()=>{
  const cfg=await readJson('/api/config');deploymentNetwork(cfg);return cfg;
 })().catch(error=>{pending=null;throw error;});
 return pending;
}
