import {deploymentNetwork} from '../core/deployment-network.mjs';
import {readWalletIdentity} from './wallet-preflight.js';

const ADDRESS=/^0x[0-9a-f]{40}$/i,ZERO=/^0x0{40}$/i;
const pendingImports=new WeakMap();
const stale=()=>Object.assign(Error('Wallet changed. Connect the wallet again before adding FTI.'),{code:'FTI_WALLET_CHANGED'});
const waiting=()=>Object.assign(Error('The wallet has not answered the FTI import request yet. Check its token-import window, then retry to keep waiting.'),{code:'FTI_TOKEN_IMPORT_PENDING'});

function importRequest(wallet,metadata,address){
 const key=metadata.chainId+':'+metadata.address.toLowerCase()+':'+address.toLowerCase(),pending=pendingImports.get(wallet);
 if(pending){if(pending.key!==key)throw waiting();return pending.promise;}
 const operation={key};
 // Publish ownership before opening the prompt, including for providers that
 // throw synchronously. A UI timeout must not create another wallet dialog.
 operation.promise=Promise.resolve().then(()=>wallet.request({method:'wallet_watchAsset',params:{type:'ERC20',options:{address:metadata.address,symbol:metadata.symbol,decimals:metadata.decimals}}}));
 pendingImports.set(wallet,operation);
 const clear=()=>{if(pendingImports.get(wallet)===operation)pendingImports.delete(wallet);};
 operation.promise.then(clear,clear);
 return operation.promise;
}

async function waitForImport(promise,timeoutMs){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(waiting()),timeoutMs);})]);}
 catch(error){if(error?.code===-32601)throw Object.assign(Error('This wallet cannot add custom tokens automatically.'),{code:4200});throw error;}
 finally{clearTimeout(timer);}
}

// Importing an asset adds its metadata and quantity to a wallet. The wallet's
// own price provider decides whether to display a fiat price or portfolio value.
export function walletTokenMetadata(cfg){
 const network=deploymentNetwork(cfg||{});
 if(!ADDRESS.test(cfg.token||'')||ZERO.test(cfg.token))throw Error('The configured FTI token address is invalid.');
 if(!['FTIToken','FTIReserveToken','FTIReserveTokenV3','FTIReserveTokenUpgradeable'].includes(cfg.tokenContract))throw Error('The configured FTI token model is unsupported.');
 return Object.freeze({address:cfg.token,symbol:'FTI',decimals:18,chainId:network.chainId,network:network.name});
}

export async function addFTIToWallet(wallet,cfg,address,{isCurrent=()=>true,timeoutMs=10000}={}){
 const metadata=walletTokenMetadata(cfg);
 if(!wallet||typeof wallet.request!=='function')throw Object.assign(Error('This wallet cannot add custom tokens automatically.'),{code:4200});
 if(typeof isCurrent!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('Invalid wallet-token request options.');
 if(!isCurrent())throw stale();
 await readWalletIdentity(wallet,address,metadata.chainId,{timeoutMs});
 if(!isCurrent())throw stale();
 const added=await waitForImport(importRequest(wallet,metadata,address),timeoutMs);
 if(!isCurrent())throw stale();
 if(typeof added!=='boolean')throw Error('The wallet did not confirm whether FTI was added.');
 return added;
}
