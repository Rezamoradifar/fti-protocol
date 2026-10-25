import QRCode from 'qrcode';

// Pairing keys live only in the active QR/link UI and are never logged, sent to
// analytics or put into the page URL. A wallet opens only from a user's click.
export function validPairingUri(uri){
 if(typeof uri!=='string'||uri.length>4096||!/^wc:[0-9a-f]{64}@2\?/i.test(uri))throw Error('Invalid WalletConnect pairing.');
 const query=new URLSearchParams(uri.slice(uri.indexOf('?')+1));
 if(query.get('relay-protocol')!=='irn'||!/^[0-9a-f]{64}$/i.test(query.get('symKey')||'')||query.getAll('symKey').length!==1||query.getAll('relay-protocol').length!==1)throw Error('Invalid WalletConnect pairing.');
 return uri;
}
export function pairingLinks(uri){
 const encoded=encodeURIComponent(validPairingUri(uri));
 return [
  {name:'Trust Wallet',href:'https://link.trustwallet.com/wc?uri='+encoded},
  {name:'MetaMask',href:'https://metamask.app.link/wc?uri='+encoded}
 ];
}
export function showWalletConnectPairing({uri,chainId,onCancel},{document=globalThis.document,navigator=globalThis.navigator,toCanvas=QRCode.toCanvas}={}){
 validPairingUri(uri);if(!document?.body||![56,97].includes(chainId))throw Error('Wallet connection screen unavailable.');
 const fa=document.documentElement.lang==='fa',copy=(en,faText)=>fa?faText:en,previous=document.activeElement;
 const overlay=document.createElement('div');overlay.className='wallet-dialog-fallback';
 const dialog=document.createElement('dialog');dialog.className='wallet-dialog';dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','fti-walletconnect-title');
 const heading=document.createElement('h2');heading.id='fti-walletconnect-title';heading.textContent='WalletConnect';
 const notice=document.createElement('p');notice.textContent=copy('Scan this QR code with your wallet, or choose an app.','این QR را با ولت اسکن کنید یا برنامه را انتخاب کنید.')+' · '+(chainId===56?'BNB Mainnet · 56':'BNB Testnet · 97');
 const canvas=document.createElement('canvas');canvas.width=232;canvas.height=232;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',copy('Wallet connection QR code','کد QR اتصال ولت'));
 const actions=document.createElement('div');actions.className='wallet-options';
 for(const link of pairingLinks(uri)){
  const anchor=document.createElement('a');anchor.className='secondary';anchor.textContent=link.name;anchor.href=link.href;anchor.rel='noreferrer noopener';anchor.target='_blank';actions.append(anchor);
 }
 const open=document.createElement('a');open.className='secondary';open.textContent=copy('Open another wallet','باز کردن ولت دیگر');open.href=uri;actions.append(open);
 const copyButton=document.createElement('button');copyButton.type='button';copyButton.className='secondary';copyButton.textContent=copy('Copy connection link','کپی لینک اتصال');copyButton.onclick=async()=>{
  try{if(!navigator?.clipboard?.writeText)throw Error('clipboard');await navigator.clipboard.writeText(uri);if(!closed)message.textContent=copy('Connection link copied. Paste it into your wallet’s WalletConnect screen.','لینک کپی شد؛ آن را در بخش WalletConnect ولت وارد کنید.');}
  catch{if(!closed)message.textContent=copy('Your browser cannot copy. Scan the QR code with your wallet.','مرورگر امکان کپی ندارد؛ QR را با ولت اسکن کنید.');}
 };
 actions.append(copyButton);
 const message=document.createElement('p');message.setAttribute('role','status');message.textContent=copy('SafePal and other WalletConnect wallets can scan or paste this connection link. Approve only the connection in your wallet.','در سیف‌پال و دیگر ولت‌های WalletConnect می‌توانید QR را اسکن یا لینک را وارد کنید. اتصال را در ولت تأیید کنید.');
 const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';cancel.textContent=copy('Cancel','انصراف');
 let closed=false;
 const close=()=>{if(closed)return;closed=true;document.removeEventListener('keydown',keyboard,true);overlay.remove();queueMicrotask(()=>{try{previous?.focus?.();}catch{}});};
 const reject=()=>{close();onCancel?.();};
 const keyboard=event=>{
  if(event.key==='Escape'){event.preventDefault();reject();return;}
  if(event.key!=='Tab')return;
  const controls=[...dialog.querySelectorAll('button,a[href]')].filter(e=>!e.disabled&&!e.hidden),first=controls[0],last=controls.at(-1);
  if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first?.focus();}
 };
 cancel.onclick=reject;dialog.addEventListener('cancel',event=>{event.preventDefault();reject();});overlay.onclick=event=>{if(event.target===overlay)reject();};
 dialog.append(heading,notice,canvas,actions,message,cancel);overlay.append(dialog);document.body.append(overlay);document.addEventListener('keydown',keyboard,true);cancel.focus();
 Promise.resolve(toCanvas(canvas,uri,{width:232,margin:4,errorCorrectionLevel:'M',color:{dark:'#07120fff',light:'#ffffffff'}})).catch(()=>{if(!closed){canvas.hidden=true;message.textContent=copy('QR rendering failed. Choose an app or copy the connection link.','نمایش QR ممکن نشد؛ برنامه را انتخاب یا لینک اتصال را کپی کنید.');}});
 return close;
}
