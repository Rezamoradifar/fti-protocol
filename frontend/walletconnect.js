import EthereumProvider from '@walletconnect/ethereum-provider';
import {walletConnectOptions} from '../core/deployment-network.mjs';
const connections=new Map();
export async function walletConnectProvider(projectId,chainId){
 const options=walletConnectOptions(projectId,chainId,location.origin),key=projectId+':'+chainId;
 if(!connections.has(key))connections.set(key,EthereumProvider.init(options).catch(error=>{connections.delete(key);throw error;}));
 return connections.get(key);
}
