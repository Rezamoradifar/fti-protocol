import {t} from './locale.js';

export function discoverWallets(target=window,onChange=()=>{}) {
 const wallets=[];
 const announce=event=>{
  const detail=event.detail;
  if(!detail?.provider||typeof detail.provider.request!=='function'||typeof detail.info?.name!=='string'||typeof detail.info?.rdns!=='string')return;
  if(wallets.some(w=>w.provider===detail.provider))return;
  wallets.push({provider:detail.provider,name:detail.info.name.slice(0,80),id:detail.info.rdns});onChange();
 };
 target.addEventListener('eip6963:announceProvider',announce);
 const request=()=>target.dispatchEvent(new Event('eip6963:requestProvider'));
 request();
 return {request,list(){
  const injected=target.ethereum;
  const providers=[target.safepalProvider,...(Array.isArray(injected?.providers)?injected.providers:[injected])];
  const candidates=[...new Set(providers)].filter(p=>typeof p?.request==='function');
  const mobileSafePal=target.isSafePal===true||/SafePal/i.test(target.navigator?.userAgent||'');
  const safePal=provider=>provider===target.safepalProvider||provider.isSafePal===true||mobileSafePal&&candidates.length===1&&provider===injected&&wallets.every(w=>w.provider===provider);
  return [...wallets,...candidates.filter(p=>!wallets.some(w=>w.provider===p)).map((provider,i)=>({provider,id:safePal(provider)?'safepal':'legacy-'+i,name:safePal(provider)?'SafePal':provider.isTrust?'Trust Wallet':provider.isCoinbaseWallet?'Coinbase Wallet':provider.isMetaMask?'MetaMask':t('Browser wallet','ولت مرورگر')+' '+(i+1)}))];
 }};
}

let render=()=>{},pending;
const discovery=typeof window==='undefined'?null:discoverWallets(window,()=>render());
const authorizations=new WeakMap();
// Invoke permission in the original user gesture. Keep the underlying request
// after a UI timeout so retrying cannot open a duplicate permission request.
function beginAuthorization(selected){
 const provider=selected?.provider;
 if(!provider||typeof provider.request!=='function')throw Error('Wallet provider is unavailable.');
 const existing=authorizations.get(provider);if(existing)return existing;
 let resolve,reject;const request=new Promise((yes,no)=>{resolve=yes;reject=no;});
 authorizations.set(provider,request);
 const cleanup=()=>{if(authorizations.get(provider)===request)authorizations.delete(provider);};
 request.then(cleanup,cleanup);
 try{Promise.resolve(selected.remote?provider.enable():provider.request({method:'eth_requestAccounts'})).then(resolve,reject);}
 catch(error){reject(error);}
 return request;
}
async function accountDeadline(request,silent,timeoutMs){
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Invalid wallet connection timeout.');
 let timer;try{return await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error(silent?'Wallet reconnection timed out. Press Connect wallet to choose again.':'Wallet approval is still pending. Open your wallet to finish connecting, then try Connect again.'),{code:silent?'FTI_WALLET_RECONNECTION_TIMEOUT':'FTI_WALLET_AUTHORIZATION_TIMEOUT'})),timeoutMs);})]);}finally{clearTimeout(timer);}
}
export async function requestWalletAccounts(selected,silent=false,timeoutMs=silent?5000:60000){
 if(!selected?.provider||typeof selected.provider.request!=='function')throw Error('Wallet provider is unavailable.');
 const request=silent?selected.provider.request({method:'eth_accounts'}):selected.authorization||beginAuthorization(selected);
 return accountDeadline(request,silent,timeoutMs);
}
export function chooseWallet({silent=false,projectId,chainId,authorize=false}={}) {
 const configured=/^[a-f0-9]{32}$/i.test(projectId||'')&&[56,97].includes(chainId);
 const wc=async()=>{const {walletConnectProvider}=await import('/vendor/walletconnect.js');return {provider:await walletConnectProvider(projectId,chainId),name:'WalletConnect',id:'walletconnect',remote:true};};
 discovery.request();
 let saved;try{saved=sessionStorage.getItem('fti-selected-wallet');}catch{}
 if(silent){if(saved==='walletconnect'&&configured)return wc().then(w=>w.provider.session?w:null);return Promise.resolve(discovery.list().find(w=>w.id===saved)||null);}
 if(pending)return pending;
 const remember=wallet=>{try{sessionStorage.setItem('fti-selected-wallet',wallet.id);}catch{}};
 const selectedWallet=wallet=>authorize?{...wallet,authorization:beginAuthorization(wallet)}:wallet;
 const initial=discovery.list();
 if(authorize&&initial.length===1&&(initial[0].id==='safepal'||initial[0].provider===window.safepalProvider||initial[0].provider.isSafePal===true)){
  const selected=selectedWallet(initial[0]);remember(selected);return Promise.resolve(selected);
 }
 pending=new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='wallet-dialog';
  const title=document.createElement('h2');title.id='wallet-dialog-title';title.textContent=t('Choose your wallet','ولت خود را انتخاب کنید');dialog.setAttribute('aria-labelledby',title.id);
  const close=document.createElement('button');close.type='button';close.className='secondary';close.textContent=t('Cancel','انصراف');
  const list=document.createElement('div');list.className='wallet-options';
  const info=document.createElement('p');info.textContent=configured?t('Choose an installed wallet, or use WalletConnect for QR and mobile wallets.','ولت نصب‌شده را انتخاب کنید یا برای QR و ولت موبایل از WalletConnect استفاده کنید.'):t('Choose an installed EVM wallet. On mobile, open this site inside your wallet browser. WalletConnect QR requires a project ID and is not configured yet.','یک ولت نصب‌شده سازگار با EVM انتخاب کنید. در موبایل، سایت را داخل مرورگر ولت باز کنید. اتصال QR با WalletConnect هنوز تنظیم نشده است.');
  let finished=false,lastWallets=null,pollTimer=null,pollBudget=30;const previousFocus=document.activeElement;
  const overlay=document.createElement('div');overlay.className='wallet-dialog-fallback';
  const finish=value=>{if(finished)return;finished=true;render=()=>{};clearTimeout(pollTimer);document.removeEventListener('keydown',keyboard,true);document.removeEventListener('visibilitychange',visibility);dialog.remove();overlay.remove();pending=null;resolve(value);queueMicrotask(()=>{try{previousFocus?.focus?.();}catch{}});};
  const keyboard=event=>{
   if(event.key==='Escape'){event.preventDefault();finish(null);return;}
   if(event.key!=='Tab')return;
   const buttons=[...dialog.querySelectorAll('button')].filter(button=>!button.disabled&&!button.hidden),first=buttons[0],last=buttons.at(-1);
   if(!first)return;
   if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
  };
  close.onclick=()=>finish(null);dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
  overlay.onclick=event=>{if(event.target===overlay)finish(null);};
  render=()=>{
   const wallets=discovery.list();
   if(lastWallets&&lastWallets.length===wallets.length&&lastWallets.every((wallet,index)=>wallet.provider===wallets[index].provider&&wallet.id===wallets[index].id&&wallet.name===wallets[index].name))return;
   const focusedProvider=[...list.querySelectorAll('button')].find(button=>button===document.activeElement)?.walletProvider;
   lastWallets=wallets;list.replaceChildren();
   for(const wallet of wallets){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=wallet.name;button.walletProvider=wallet.provider;button.onclick=()=>{if(finished)return;button.disabled=true;const selected=selectedWallet(wallet);remember(selected);finish(selected);};list.append(button);if(focusedProvider===wallet.provider)button.focus();}
   if(!wallets.length){const empty=document.createElement('p');empty.textContent=t('No wallet detected. Install a wallet extension or use your wallet’s browser, then retry.','ولتی شناسایی نشد. افزونه ولت را نصب کنید یا از مرورگر داخل ولت استفاده کنید و دوباره تلاش کنید.');list.append(empty);}
  };
  const mobile=document.createElement('button');mobile.type='button';mobile.className='primary';mobile.textContent=t('WalletConnect · QR / mobile','WalletConnect · QR / موبایل');mobile.disabled=!configured;
  mobile.onclick=async()=>{mobile.disabled=true;try{const wallet=await wc();if(finished)return;const selected=selectedWallet(wallet);remember(selected);finish(selected);}catch(error){if(finished)return;info.textContent=t('WalletConnect could not start. Try again.','اتصال WalletConnect شروع نشد؛ دوباره تلاش کنید.')+' '+(error.shortMessage||error.message);mobile.disabled=false;}};
  const retry=document.createElement('button');retry.type='button';retry.className='secondary';retry.textContent=t('Refresh wallet list','جست‌وجوی دوبارهٔ ولت');
  const poll=()=>{pollTimer=null;if(finished||document.hidden||pollBudget<=0)return;pollBudget--;discovery.request();render();if(pollBudget>0)pollTimer=setTimeout(poll,500);};
  const visibility=()=>{clearTimeout(pollTimer);pollTimer=null;if(!finished&&!document.hidden&&pollBudget>0)pollTimer=setTimeout(poll,0);};
  retry.onclick=()=>{if(finished)return;pollBudget=30;clearTimeout(pollTimer);poll();};
  dialog.append(title,info,list,mobile,retry,close);
  // Always use our accessible overlay. Some embedded browsers expose a native
  // showModal method that silently does nothing instead of throwing.
  dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  overlay.append(dialog);document.body.append(overlay);document.addEventListener('keydown',keyboard,true);document.addEventListener('visibilitychange',visibility);render();
  (list.querySelector('button')||close).focus();if(!document.hidden)pollTimer=setTimeout(poll,500);
 });return pending;
}
