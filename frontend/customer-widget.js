// Tiny universal entry. The support UI and its API calls load only on click.
import './customer-services.css';
import {readLanguage,withLanguage} from './language-policy.js';
const document=globalThis.document;
if(document&&!document.querySelector('[data-fti-customer-widget]')&&!/^\/(support|vpn)\/?$/.test(location.pathname)){
 const language=readLanguage(),fa=language==='fa',button=document.createElement('button');
 button.type='button';button.className='fti-widget-launcher';button.dataset.ftiCustomerWidget='';button.textContent=fa?'پشتیبانی':'Support';button.setAttribute('aria-haspopup','dialog');
 document.body.append(button);
 let modal=null,ui=null,loading=false;
 button.onclick=async()=>{
  if(loading)return;if(modal){modal.showModal();ui?.refresh();return;}
  loading=true;button.disabled=true;const original=button.textContent;button.textContent=fa?'در حال بازشدن…':'Opening…';
  try{
   const {mountCustomerServices}=await import('./customer-services.js');
   modal=document.createElement('dialog');modal.className='fti-widget-dialog';modal.setAttribute('aria-label',fa?'پشتیبانی FTI':'FTI support');
   const head=document.createElement('div');head.className='fti-widget-dialog-header';const title=document.createElement('strong');title.textContent=fa?'پشتیبانی FTI':'FTI support';const close=document.createElement('button');close.type='button';close.className='fti-widget-close';close.textContent='×';close.setAttribute('aria-label',fa?'بستن':'Close');close.onclick=()=>modal.close();head.append(title,close);
   const content=document.createElement('div');modal.append(head,content);document.body.append(modal);ui=mountCustomerServices({container:content,language});modal.showModal();
   modal.addEventListener('close',()=>button.focus());
  }catch{location.assign(withLanguage('/support/',language));}finally{loading=false;button.disabled=false;button.textContent=original;}
 };
 globalThis.addEventListener('pagehide',event=>{if(event.persisted)return;ui?.destroy();modal?.remove();button.remove();});
}
