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
  if(wallets.length)return [...wallets];
  const providers=target.ethereum?.providers||[target.ethereum];
  return [...new Set(providers)].filter(p=>typeof p?.request==='function').map((provider,i)=>({provider,id:'legacy-'+i,name:provider.isTrust?'Trust Wallet':provider.isCoinbaseWallet?'Coinbase Wallet':provider.isMetaMask?'MetaMask':t('Browser wallet','ولت مرورگر')+' '+(i+1)}));
 }};
}

let render=()=>{},pending;
const discovery=typeof window==='undefined'?null:discoverWallets(window,()=>render());
export async function requestWalletAccounts(selected,silent=false){
 if(selected.remote&&!silent)return selected.provider.enable();
 return selected.provider.request({method:silent?'eth_accounts':'eth_requestAccounts'});
}
export function chooseWallet({silent=false,projectId,chainId}={}) {
 const configured=/^[a-f0-9]{32}$/i.test(projectId||'')&&chainId===97;
 const wc=async()=>{const {walletConnectProvider}=await import('/vendor/walletconnect.js');return {provider:await walletConnectProvider(projectId,chainId),name:'WalletConnect',id:'walletconnect',remote:true};};
 discovery.request();
 let saved;try{saved=sessionStorage.getItem('fti-selected-wallet');}catch{}
 if(silent){if(saved==='walletconnect'&&configured)return wc().then(w=>w.provider.session?w:null);return Promise.resolve(discovery.list().find(w=>w.id===saved)||null);}
 if(pending)return pending;
 pending=new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='wallet-dialog';
  const title=document.createElement('h2');title.id='wallet-dialog-title';title.textContent=t('Choose your wallet','ولت خود را انتخاب کنید');dialog.setAttribute('aria-labelledby',title.id);
  const close=document.createElement('button');close.type='button';close.className='secondary';close.textContent=t('Cancel','انصراف');
  const list=document.createElement('div');list.className='wallet-options';
  const info=document.createElement('p');info.textContent=configured?t('Choose an installed wallet, or use WalletConnect for QR and mobile wallets.','ولت نصب‌شده را انتخاب کنید یا برای QR و ولت موبایل از WalletConnect استفاده کنید.'):t('Choose an installed EVM wallet. On mobile, open this site inside your wallet browser. WalletConnect QR requires a project ID and is not configured yet.','یک ولت نصب‌شده سازگار با EVM انتخاب کنید. در موبایل، سایت را داخل مرورگر ولت باز کنید. اتصال QR با WalletConnect هنوز تنظیم نشده است.');
  let finished=false;
  const finish=value=>{if(finished)return;finished=true;render=()=>{};dialog.close();dialog.remove();pending=null;resolve(value);};
  close.onclick=()=>finish(null);dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
  render=()=>{
   list.replaceChildren();const wallets=discovery.list();
   for(const wallet of wallets){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=wallet.name;button.onclick=()=>{try{sessionStorage.setItem('fti-selected-wallet',wallet.id);}catch{}finish(wallet);};list.append(button);}
   if(!wallets.length){const empty=document.createElement('p');empty.textContent=t('No wallet detected. Install a wallet extension or use your wallet’s browser, then retry.','ولتی شناسایی نشد. افزونه ولت را نصب کنید یا از مرورگر داخل ولت استفاده کنید و دوباره تلاش کنید.');list.append(empty);}
  };
  const mobile=document.createElement('button');mobile.type='button';mobile.className='primary';mobile.textContent=t('WalletConnect · QR / mobile','WalletConnect · QR / موبایل');mobile.disabled=!configured;
  mobile.onclick=async()=>{mobile.disabled=true;try{const selected=await wc();try{sessionStorage.setItem('fti-selected-wallet',selected.id);}catch{}finish(selected);}catch(error){info.textContent=t('WalletConnect could not start. Try again.','اتصال WalletConnect شروع نشد؛ دوباره تلاش کنید.')+' '+(error.shortMessage||error.message);mobile.disabled=false;}};
  dialog.append(title,info,list,mobile,close);document.body.append(dialog);render();dialog.showModal();
 });return pending;
}
