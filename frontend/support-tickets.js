// Ticket sessions stay in memory and are discarded on wallet/role changes.
// Every signature starts from an explicit click; no transaction is submitted.
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;
const ID=/^[a-f0-9]{32}$/;
const TOPICS=['Wallet connection','Membership and referral','Rewards and auto-buy','Token transaction','Other'];
const COPIES={
 'Wallet connection':'اتصال ولت','Membership and referral':'عضویت و معرف','Rewards and auto-buy':'پاداش و خرید خودکار','Token transaction':'تراکنش توکن','Other':'سایر',
 open:'باز',answered:'پاسخ داده‌شده',closed:'بسته',
};
export function createSupportTickets({container,getAddress,signMessage,request,translate=value=>value,isAdmin=()=>false,document=container.ownerDocument,origin=globalThis.location?.origin}){
 const t=(en,fa=COPIES[en])=>translate(en,fa),make=(tag,copy,cls)=>{const e=document.createElement(tag);if(copy!==undefined)e.textContent=copy;if(cls)e.className=cls;return e;};
 let identity='',generation=0,session=null,busy=false,controller=null,rows=[],selected=null,nextOffset=null,destroyed=false;
 const seen=new Map();
 const address=()=>{try{const a=getAddress();return typeof a==='string'&&ADDRESS.test(a)&&!/^0x0{40}$/i.test(a)?a:null;}catch{return null;}};
 const admin=()=>{try{return isAdmin()===true;}catch{return false;}};
 const head=make('div',undefined,'panel-head'),title=make('h3',t('Support tickets','تیکت‌های پشتیبانی'));
 const auth=make('button',t('Verify wallet for support','تأیید ولت برای پشتیبانی'),'secondary');auth.type='button';
 const status=make('p',undefined,'member-support-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const intro=make('p',t('Sign a support access message to create tickets and read private replies. This does not spend funds.','برای ثبت تیکت و مشاهدهٔ پاسخ خصوصی، پیام ورود به پشتیبانی را امضا کنید. این امضا دارایی خرج نمی‌کند.'));
 const actions=make('div',undefined,'actions'),reload=make('button',t('Refresh tickets','به‌روزرسانی تیکت‌ها'),'secondary'),more=make('button',t('Older tickets','تیکت‌های قدیمی‌تر'),'secondary');reload.type=more.type='button';actions.append(reload,more);
 const listing=make('div',undefined,'member-ticket-list');listing.setAttribute('aria-label',t('Your support tickets','تیکت‌های پشتیبانی شما'));
 const thread=make('div',undefined,'member-ticket-thread');
 const form=make('form',undefined,'member-ticket-create');
 function field(label,input){const el=make('label',label);el.append(input);return el;}
 const topic=make('select');for(const value of TOPICS){const option=make('option',t(value));option.value=value;topic.append(option);}
 const hash=make('input');hash.name='hash';hash.dir='ltr';hash.placeholder='0x…';hash.pattern='0x[0-9a-fA-F]{64}';hash.maxLength=66;
 const message=make('textarea');message.name='message';message.required=true;message.minLength=15;message.maxLength=2000;message.rows=4;
 const submit=make('button',t('Create support ticket','ثبت تیکت پشتیبانی'));submit.type='submit';
 form.append(field(t('Topic','موضوع'),topic),field(t('Transaction hash · optional','هش تراکنش · اختیاری'),hash),field(t('What happened?','چه اتفاقی افتاد؟'),message),submit);
 head.append(title,auth);container.replaceChildren(head,intro,status,actions,listing,thread,form);
 const key=()=>`${address()?.toLowerCase()||''}/${admin()}`;
 function sync(){auth.disabled=busy||!address();auth.hidden=!!session;reload.disabled=busy||!session;more.disabled=busy||!session||nextOffset===null;more.hidden=nextOffset===null;form.hidden=!session||admin();submit.disabled=busy;for(const button of thread.querySelectorAll?.('button')||[])button.disabled=busy;}
 function clear(){generation++;controller?.abort();controller=null;session=null;busy=false;rows=[];selected=null;nextOffset=null;seen.clear();listing.replaceChildren();thread.replaceChildren();message.value='';hash.value='';status.textContent=address()?t('Verify your wallet to open private support.','برای ورود به پشتیبانی خصوصی، ولت را تأیید کنید.'):t('Connect a wallet to use support tickets.','برای استفاده از تیکت، ولت خود را متصل کنید.');sync();}
 function refresh(){if(destroyed)return;const next=key();if(identity!==next){identity=next;clear();}sync();}
 function reset(){identity=key();clear();}
 function scope(path){return path+(admin()?(path.includes('?')?'&':'?')+'scope=admin':'');}
 async function run(fn){refresh();if(destroyed||busy)return;const own=generation;busy=true;controller=new AbortController();sync();const live=()=>!destroyed&&generation===own&&identity===key()&&!controller?.signal.aborted;
  try{await fn({live,signal:controller.signal});}catch(e){if(live()){if(e.status===401){session=null;rows=[];listing.replaceChildren();thread.replaceChildren();status.textContent=t('Support access expired. Verify your wallet again.','دسترسی پشتیبانی منقضی شد؛ ولت را دوباره تأیید کنید.');}else if(e.status===403){session=null;rows=[];listing.replaceChildren();thread.replaceChildren();status.textContent=t('This wallet is not authorized for this support view.','این ولت مجوز دسترسی به این بخش پشتیبانی را ندارد.');}else if(e.code==='ACTION_REJECTED'||e.code===4001)status.textContent=t('Support access was not signed. You can verify again when ready.','پیام ورود امضا نشد؛ هر زمان آماده بودید دوباره تأیید کنید.');else status.textContent=t('Support is unavailable. Your text is kept; refresh before retrying a submission.','پشتیبانی در دسترس نیست. متن شما حفظ شده؛ پیش از ارسال مجدد، فهرست را به‌روزرسانی کنید.');}}
  finally{if(generation===own){busy=false;controller=null;sync();}}
 }
 const call=(path,options={})=>request(path,{...options,...(session?{authorization:'Bearer '+session.token}:{})});
 function validateSummary(r){if(!r||!ID.test(r.id)||!ADDRESS.test(r.wallet)||!TOPICS.includes(r.topic)||!['open','answered','closed'].includes(r.status)||!Number.isSafeInteger(r.updatedAt)||!Number.isSafeInteger(r.createdAt)||!Number.isSafeInteger(r.messageCount)||!['member','team'].includes(r.lastRole)||!admin()&&r.wallet.toLowerCase()!==address()?.toLowerCase())throw Error('Invalid support response');return r;}
 function paintList(){listing.replaceChildren();if(!rows.length){listing.append(make('p',t('No support tickets yet.','هنوز تیکتی ثبت نشده است.')));return;}
  for(const r of rows){const button=make('button',undefined,'secondary member-ticket-row');button.type='button';button.dataset.ticketId=r.id;button.append(make('b',t(r.topic)),make('span',t(r.status)),make('small','#'+r.id.slice(0,10)),make('time',new Date(r.updatedAt).toLocaleString()));if(r.lastRole===(admin()?'member':'team')&&(seen.get(r.id)||0)<r.messageCount)button.append(make('span',t('New reply','پاسخ جدید'),'badge'));if(admin())button.append(make('small',r.wallet));button.onclick=()=>open(r.id);listing.append(button);}
 }
 async function load(signal,live,offset=0){const data=await call(scope('/api/support/tickets?offset='+offset+'&limit=25'),{signal});if(!live())return;if(!Array.isArray(data.tickets)||data.tickets.length>50||!(data.nextOffset===null||Number.isSafeInteger(data.nextOffset)&&data.nextOffset>offset))throw Error('Invalid support page');const batch=data.tickets.map(validateSummary);const merged=offset?new Map(rows.map(r=>[r.id,r])):new Map();for(const row of batch)merged.set(row.id,row);rows=[...merged.values()];nextOffset=data.nextOffset;paintList();status.textContent=t('Support tickets updated.','تیکت‌ها به‌روزرسانی شدند.');}
 function validateTicket(r){if(!r||!ID.test(r.id)||!Array.isArray(r.messages)||!r.messages.length||r.messages.length>100||!ADDRESS.test(r.wallet)||!['open','answered','closed'].includes(r.status)||!TOPICS.includes(r.topic)||!admin()&&r.wallet.toLowerCase()!==address()?.toLowerCase())throw Error('Invalid support response');for(const m of r.messages)if(!m||!['member','team'].includes(m.role)||typeof m.text!=='string'||m.text.length>2000||!Number.isSafeInteger(m.createdAt))throw Error('Invalid support response');return r;}
 function paintThread(r){thread.replaceChildren();thread.append(make('h3',t(r.topic)),make('p',t('Ticket reference','شماره پیگیری')+': '+r.id),make('p',t('Status','وضعیت')+': '+t(r.status)));if(r.hash)thread.append(make('code',r.hash));
  for(const m of r.messages){const article=make('article',undefined,'member-ticket-message');article.append(make('b',m.role==='team'?t('FTI support','پشتیبانی FTI'):t('You','شما')),make('time',new Date(m.createdAt).toLocaleString()),make('p',m.text));thread.append(article);}
  if(admin()){const controls=make('div',undefined,'actions');for(const value of ['open','answered','closed']){const button=make('button',t(value),'secondary');button.type='button';button.disabled=r.status===value;button.onclick=()=>run(async({signal,live})=>{const data=await call(scope('/api/support/tickets/'+r.id+'/status'),{method:'POST',body:{status:value},signal});if(!live())return;selected=validateTicket(data.ticket);paintThread(selected);await load(signal,live);});controls.append(button);}thread.append(controls);}
  if(r.status!=='closed'){const replyForm=make('form'),reply=make('textarea');reply.name='reply';reply.required=true;reply.maxLength=2000;reply.rows=3;const button=make('button',t('Send reply','ارسال پاسخ'));button.type='submit';replyForm.append(field(t('Your reply','پاسخ شما'),reply),button);replyForm.onsubmit=event=>{event.preventDefault();if(!reply.value.trim())return;run(async({signal,live})=>{const data=await call(scope('/api/support/tickets/'+r.id+'/replies'),{method:'POST',body:{message:reply.value},signal});if(!live())return;selected=validateTicket(data.ticket);seen.set(r.id,selected.messages.length);paintThread(selected);await load(signal,live);});};thread.append(replyForm);}
 }
 function open(id){return run(async({signal,live})=>{const data=await call(scope('/api/support/tickets/'+id),{signal});if(!live())return;selected=validateTicket(data.ticket);seen.set(id,selected.messages.length);paintThread(selected);paintList();status.textContent=t('Ticket opened.','تیکت باز شد.');});}
 auth.onclick=()=>run(async({signal,live})=>{const own=address(),data=await request('/api/support/challenge',{method:'POST',body:{wallet:own},signal});if(!live())return;
  if(!data||!ID.test(data.nonce)||typeof data.message!=='string'||data.message.length>1200||!data.message.startsWith('FTI Protocol support access\n\nOrigin: '+origin+'\n')||!data.message.includes('\nWallet: '+own+'\n')||!data.message.includes('\nNonce: '+data.nonce+'\n')||!Number.isSafeInteger(data.expiresAt)||data.expiresAt<=Date.now()||data.expiresAt>Date.now()+310_000||!data.message.endsWith('Sign only to access private support tickets. This does not authorize a transaction or spending.'))throw Error('Invalid support challenge');
  status.textContent=t('Review the support access message in your wallet.','پیام ورود به پشتیبانی را در ولت خود بررسی کنید.');
  const signature=await signMessage(data.message,own);if(!live())return;
  const next=await request('/api/support/session',{method:'POST',body:{wallet:own,nonce:data.nonce,signature},signal});if(!live())return;
  if(!next||typeof next.token!=='string'||!/^[a-f0-9]{64}$/.test(next.token)||next.wallet?.toLowerCase()!==own.toLowerCase()||!Number.isSafeInteger(next.expiresAt))throw Error('Invalid support session');session=next;await load(signal,live);
 });
 reload.onclick=()=>run(async({signal,live})=>{await load(signal,live);if(selected&&live()){const data=await call(scope('/api/support/tickets/'+selected.id),{signal});if(live()){selected=validateTicket(data.ticket);seen.set(selected.id,selected.messages.length);paintThread(selected);paintList();}}});
 more.onclick=()=>run(({signal,live})=>load(signal,live,nextOffset??0));
 form.onsubmit=event=>{event.preventDefault();if(message.value.trim().length<15||hash.value&&!/^0x[0-9a-fA-F]{64}$/.test(hash.value))return;run(async({signal,live})=>{const data=await call('/api/support/tickets',{method:'POST',body:{topic:topic.value||TOPICS[0],message:message.value,hash:hash.value},signal});if(!live())return;selected=validateTicket(data.ticket);message.value='';hash.value='';seen.set(selected.id,selected.messages.length);paintThread(selected);await load(signal,live);status.textContent=t('Ticket created. Keep the reference shown below.','تیکت ثبت شد؛ شماره پیگیری نمایش‌داده‌شده را نگه دارید.');});};
 refresh();
 return {refresh,reset,destroy(){destroyed=true;generation++;controller?.abort();session=null;rows=[];selected=null;seen.clear();container.replaceChildren();}};
}
