import UniversalProvider from '@walletconnect/universal-provider';
import {walletConnectOptions} from '../core/deployment-network.mjs';
import {createWalletConnectAdapter} from './walletconnect-adapter.js';
import {showWalletConnectPairing} from './walletconnect-modal.js';
const connections=new Map();
export async function walletConnectProvider(projectId,chainId){
 const options=walletConnectOptions(projectId,chainId,location.origin),key=projectId+':'+chainId;
 if(!connections.has(key))connections.set(key,UniversalProvider.init({projectId:options.projectId,metadata:options.metadata}).then(client=>createWalletConnectAdapter(client,options,{showPairing:showWalletConnectPairing})).catch(error=>{connections.delete(key);throw error;}));
 return connections.get(key);
}
