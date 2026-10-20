// This deadline is only for reads/preparation. Never use it to infer that an
// unsigned/unknown transaction was not broadcast or to clear a pending record.
export async function preparationDeadline(promise,timeoutMs=15000){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Wallet or network did not respond during preparation. No new request was sent.')),timeoutMs);})]);}
 finally{clearTimeout(timer);}
}
export async function readWalletIdentity(wallet,address,chainId,{timeoutMs=10000}={}){
 if(!wallet||typeof wallet.request!=='function'||!/^0x[0-9a-f]{40}$/i.test(address||'')||!Number.isSafeInteger(chainId)||chainId<1)throw Error('Wallet identity is unavailable.');
 const [chain,accounts]=await preparationDeadline(Promise.all([wallet.request({method:'eth_chainId'}),wallet.request({method:'eth_accounts'})]),timeoutMs);
 if(Number(chain)!==chainId||!Array.isArray(accounts)||accounts[0]?.toLowerCase()!==address.toLowerCase())throw Error('Wallet network or account changed. Connect the original wallet.');
 return {address:accounts[0],chainId};
}
