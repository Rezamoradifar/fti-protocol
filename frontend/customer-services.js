const API='/api/customer-services';
const TOPICS=[['membership','Getting started','شروع عضویت'],['wallet','Connect a wallet','اتصال کیف‌پول'],['token','Buy FTI','خرید FTI'],['sell','Sell FTI','فروش FTI'],['rewards','Rewards','پاداش‌ها'],['vpn','VPN & delivery','VPN و تحویل'],['trust','Audits & listings','ممیزی و لیستینگ']];
const ROUTES={membership:'/app/#network',market:'/token/#trade',support:'/app/#support',guide:'/whitepaper/',vpn:'/vpn/',contact:'#contact'};
const INTERESTS=[['membership','Membership','عضویت'],['token','Token market','بازار توکن'],['vpn','VPN','VPN'],['partnership','Partnership','همکاری'],['support','Support','پشتیبانی']];
const STATES=[['new','New','جدید'],['reviewing','In review','در حال بررسی'],['replied','Replied','پاسخ داده‌شده'],['closed','Closed','بسته'],['withdrawn','Withdrawn','لغوشده']];
const ID=/^[a-f0-9]{32}$/;
const COPY={
 unavailable:['Support is temporarily unavailable. Your text is kept. Try again, or open private support.','پشتیبانی موقتاً در دسترس نیست. متن شما حفظ شده؛ دوباره تلاش کنید یا وارد پشتیبانی خصوصی شوید.'],
 rate:['Please wait before sending another request.','لطفاً پیش از درخواست بعدی کمی صبر کنید.'],
 secret:['Do not send private keys, recovery phrases, VPN configurations or long secret codes. Use private wallet support for a transaction hash.','کلید خصوصی، عبارت بازیابی، کانفیگ VPN یا کدهای محرمانه نفرستید. هش تراکنش را در پشتیبانی خصوصی ولت وارد کنید.'],
 contact:['Enter a valid email address or Telegram username.','ایمیل یا نام کاربری معتبر تلگرام وارد کنید.'],
 consent:['Please choose whether the team may contact you about this request.','لطفاً رضایت تماس تیم دربارهٔ این درخواست را مشخص کنید.'],
 conflict:['This request changed after it was sent. Refresh its status or start a new request.','این درخواست بعد از ارسال تغییر کرده است. وضعیت را بررسی کنید یا درخواست تازه بسازید.'],
};
function elements(container,language,providedDocument){
 const document=providedDocument||container.ownerDocument,fa=language==='fa',rtl=language==='fa'||language==='ar';
 const t=(en,per)=>fa?(per||en):en;
 const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 const field=(label,input)=>{const node=make('label',undefined,'fti-services-field');node.append(make('span',label),input);return node;};
 const button=(text,cls='fti-services-button')=>{const node=make('button',text,cls);node.type='button';return node;};
 return {document,fa,rtl,t,make,field,button};
}
export async function requestCustomerService(path,{method='GET',body,signal,authorization}={}){
 const controller=new AbortController(),abort=()=>controller.abort();
 if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(),10_000);
 try{
  const response=await fetch(path,{method,cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(authorization?{Authorization:authorization}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});
  const value=await response.json();if(!response.ok)throw Object.assign(Error('Customer service request failed'),{status:response.status,code:value?.error});return value;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function messageFor(error,t){
 const key=error?.status===429?'rate':error?.code==='CUSTOMER_SECRET_REJECTED'?'secret':error?.code==='CUSTOMER_INVALID_CONTACT'?'contact':error?.code==='CUSTOMER_CONSENT_REQUIRED'?'consent':error?.code==='CUSTOMER_REQUEST_CONFLICT'?'conflict':'unavailable';
 return t(...COPY[key]);
}
function randomHex(bytes){const values=new Uint8Array(bytes);globalThis.crypto.getRandomValues(values);return [...values].map(value=>value.toString(16).padStart(2,'0')).join('');}

export function mountCustomerServices({container,language='en',view='support',request=requestCustomerService}){
 const {document,fa,rtl,t,make,field,button}=elements(container,language),controller=new AbortController();
 let alive=true,chatBusy=false,leadBusy=false,config=null,draft=null;
 const receiptKey='fti.customer-services.receipt.v1';
 container.classList.add('fti-services');container.lang=language;container.dir=rtl?'rtl':'ltr';container.replaceChildren();
 const status=make('p','', 'fti-services-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const grid=make('div',undefined,'fti-services-grid');
 const assistant=make('section',undefined,'fti-services-card'),heading=make('div',undefined,'fti-services-card-head');
 heading.append(make('span',t('FTI ASSISTANT','دستیار FTI'),'fti-services-eyebrow'),make('h2',t('A clear next step.','قدم بعدی، روشن.')),make('p',t('Automated guidance for membership, token tools and support.','راهنمای خودکار عضویت، ابزارهای توکن و پشتیبانی.')));assistant.append(heading);
 const quick=make('div',undefined,'fti-services-topics');quick.setAttribute('aria-label',t('Help topics','موضوع‌های راهنما'));
 const transcript=make('div',undefined,'fti-services-transcript');transcript.setAttribute('role','log');transcript.setAttribute('aria-label',t('Assistant conversation','گفتگو با دستیار'));transcript.setAttribute('aria-live','polite');
 const compose=make('form',undefined,'fti-services-compose'),question=make('textarea');question.name='question';question.required=true;question.maxLength=1200;question.rows=3;question.placeholder=t('What would you like to do?','می‌خواهید چه کاری انجام دهید؟');
 const send=button(t('Ask the assistant','پرسیدن از دستیار'));send.type='submit';
 const aiLine=make('label',undefined,'fti-services-check'),ai=make('input');ai.type='checkbox';aiLine.hidden=true;aiLine.append(ai,make('span',t('Use AI matching for my question (sent to OpenAI).','تطبیق سؤال با هوش مصنوعی (ارسال سؤال به OpenAI).')));
 compose.append(field(t('Your question','سؤال شما'),question),aiLine,send);
 const privacy=make('p',t('Never share wallet secrets. Guided questions are not saved as chat history.','اطلاعات محرمانهٔ ولت را نفرستید. سؤال‌های راهنمای خودکار به‌عنوان تاریخچه ذخیره نمی‌شوند.'),'fti-services-note');
 assistant.append(quick,transcript,compose,privacy,status);

 const contact=make('section',undefined,'fti-services-card fti-services-contact');contact.id='contact';
 contact.append(make('span',t('TALK TO THE TEAM','ارتباط با تیم'),'fti-services-eyebrow'),make('h2',t('Continue with a person.','پیگیری با تیم پشتیبانی.')),make('p',t('Leave a request for the support team. We will not enroll you in a marketing list.','برای تیم پشتیبانی درخواست بگذارید. این درخواست شما را عضو فهرست تبلیغاتی نمی‌کند.')));
 const form=make('form',undefined,'fti-services-contact-form');
 const interest=make('select');interest.name='interest';for(const [id,en,per]of INTERESTS){const item=make('option',t(en,per));item.value=id;interest.append(item);}interest.value=view==='vpn'?'vpn':'support';
 const name=make('input');name.type='text';name.name='name';name.maxLength=80;name.autocomplete='name';
 const channel=make('select');channel.name='channel';for(const [value,label]of [['email','Email'],['telegram','Telegram']]){const option=make('option',label);option.value=value;channel.append(option);}
 const address=make('input');address.type='email';address.name='contact';address.required=true;address.maxLength=254;address.autocomplete='email';address.dir='ltr';
 const detail=make('textarea');detail.name='message';detail.maxLength=1500;detail.rows=4;
 const website=make('input');website.name='website';website.autocomplete='off';website.tabIndex=-1;const trap=field('Website',website);trap.classList.add('fti-services-hp');trap.setAttribute('aria-hidden','true');
 const consentLabel=make('label',undefined,'fti-services-check'),consent=make('input');consent.type='checkbox';consent.name='consent';consent.required=true;
 consentLabel.append(consent,make('span',t('I want FTI support to contact me about this request. My details are kept for up to 30 days; I can withdraw my request.','می‌خواهم پشتیبانی FTI دربارهٔ این درخواست با من تماس بگیرد. اطلاعات من حداکثر ۳۰ روز نگهداری می‌شود و می‌توانم درخواست را لغو کنم.')));
 const submit=button(t('Send request','ارسال درخواست'));submit.type='submit';
 const receipt=make('div',undefined,'fti-services-receipt');receipt.hidden=true;receipt.setAttribute('role','status');
 const leadStatus=make('p','', 'fti-services-status');leadStatus.setAttribute('role','status');leadStatus.setAttribute('aria-live','polite');
 form.append(field(t('I need help with','موضوع درخواست'),interest),field(t('Name · optional','نام · اختیاری'),name),field(t('Contact method','روش تماس'),channel),field(t('Email or Telegram username','ایمیل یا نام کاربری تلگرام'),address),field(t('What do you need? · optional','چه کمکی نیاز دارید؟ · اختیاری'),detail),trap,consentLabel,submit);
 contact.append(form,leadStatus,receipt);
 const privateLink=make('a',t('Already a member? Open private wallet support →','عضو هستید؟ ورود به پشتیبانی خصوصی ولت ←'),'fti-services-link');privateLink.href='/app/#support';contact.append(privateLink);
 const emailLink=make('a',t('Email support','ایمیل پشتیبانی'),'fti-services-link');emailLink.href='mailto:Support@FTIProtocol.com';contact.append(emailLink);

 function focusContact(){interest.value=view==='vpn'?'vpn':'support';contact.scrollIntoView?.({behavior:'smooth',block:'start'});address.focus({preventScroll:true});}
 function appendAnswer(value){
  if(!value||typeof value.answer!=='string'||value.answer.length>5000||!Array.isArray(value.actions))throw Error('Invalid assistant response');
  const item=make('article',undefined,'fti-services-message fti-services-message-assistant');item.append(make('b',t('FTI · automated assistant','FTI · دستیار خودکار')),make('p',value.answer));
  const actions=make('div',undefined,'fti-services-actions');
  for(const action of value.actions.slice(0,4)){
   if(!action||!Object.hasOwn(ROUTES,action.id)||action.href!==ROUTES[action.id]||typeof action.label!=='string')continue;
   if(action.id==='contact'){const el=button(action.label,'fti-services-button fti-services-button-secondary');el.onclick=focusContact;actions.append(el);}else{const el=make('a',action.label,'fti-services-button fti-services-button-secondary');el.href=action.href;actions.append(el);}
  }
  item.append(actions);transcript.append(item);while(transcript.children.length>12)transcript.firstElementChild.remove();
 }
 async function ask(message,topic){
  if(chatBusy||!alive)return;chatBusy=true;send.disabled=true;for(const node of quick.children)node.disabled=true;
  status.textContent=t('Finding the right guidance…','در حال پیدا کردن راهنما…');
  const item=make('article',undefined,'fti-services-message fti-services-message-user');item.append(make('b',t('You','شما')),make('p',message));transcript.append(item);
  try{const data=await request(API+'/chat',{method:'POST',body:{message,language,...(topic?{topic}:{}),allowAi:ai.checked===true},signal:controller.signal});if(!alive)return;appendAnswer(data);status.textContent='';question.value='';}
  catch(error){if(alive)status.textContent=messageFor(error,t);}finally{if(alive){chatBusy=false;send.disabled=false;for(const node of quick.children)node.disabled=false;}}
 }
 for(const [id,en,per]of TOPICS){const node=button(t(en,per),'fti-services-topic');node.onclick=()=>ask(t(en,per),id);quick.append(node);}
 compose.onsubmit=event=>{event.preventDefault();if(question.value.trim())ask(question.value.trim());};
 channel.onchange=()=>{address.value='';address.type=channel.value==='email'?'email':'text';address.autocomplete=channel.value==='email'?'email':'off';address.placeholder=channel.value==='email'?'you@example.com':'@username';};

 function showReceipt(data,token){
  if(!ID.test(data.reference)||!Number.isSafeInteger(data.expiresAt))throw Error('Invalid request receipt');
  form.hidden=true;receipt.hidden=false;receipt.replaceChildren();
  receipt.append(make('h3',t('Your request is recorded.','درخواست شما ثبت شد.')),make('p',t('The support team can now review it. This receipt does not confirm a purchase or a response.','تیم پشتیبانی می‌تواند درخواست را بررسی کند. این رسید تأیید خرید یا دریافت پاسخ نیست.')),make('code',data.reference));
  const cancel=button(t('Withdraw this request','لغو این درخواست'),'fti-services-button fti-services-button-secondary');
  cancel.onclick=async()=>{if(leadBusy)return;leadBusy=true;cancel.disabled=true;try{const result=await request(API+'/leads/'+data.reference+'/withdraw',{method:'POST',body:{receiptToken:token},signal:controller.signal});if(!alive)return;if(result.status!=='withdrawn')throw Error('Invalid withdrawal');try{globalThis.sessionStorage?.removeItem(receiptKey);}catch{}receipt.replaceChildren(make('h3',t('Request withdrawn.','درخواست لغو شد.')),make('p',t('Your contact details and message have been removed from the request.','اطلاعات تماس و متن درخواست حذف شدند.')));}catch(error){if(alive)leadStatus.textContent=messageFor(error,t);}finally{if(alive){leadBusy=false;cancel.disabled=false;}}};receipt.append(cancel);
  // Only a cancellation receipt is retained in this browser tab. No contact
  // details, conversation or support-session token enter browser storage.
  try{globalThis.sessionStorage?.setItem(receiptKey,JSON.stringify({reference:data.reference,expiresAt:data.expiresAt,receiptToken:token}));}catch{}
 }
 form.onsubmit=async event=>{
  event.preventDefault();if(leadBusy||!alive||!form.reportValidity())return;
  const source=/^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(globalThis.location?.pathname||'')?globalThis.location.pathname:'/';
  const rawCampaign=new URLSearchParams(globalThis.location?.search||'').get('utm_campaign')||'';
  const campaign=/^[a-zA-Z0-9 ._-]{0,80}$/.test(rawCampaign)?rawCampaign:'';
  const values={interest:interest.value,name:name.value.trim(),channel:channel.value,contact:address.value.trim(),message:detail.value.trim(),consent:consent.checked===true,website:website.value,language,source,campaign};
  try{const signature=JSON.stringify(values);if(!draft||draft.signature!==signature)draft={signature,requestId:randomHex(16),receiptToken:randomHex(32)};}catch{leadStatus.textContent=t('Use a secure browser connection to send a request.','برای ارسال درخواست از اتصال امن مرورگر استفاده کنید.');return;}
  leadBusy=true;submit.disabled=true;leadStatus.textContent=t('Sending your request…','در حال ارسال درخواست…');
  try{const data=await request(API+'/leads',{method:'POST',body:{...values,requestId:draft.requestId,receiptToken:draft.receiptToken},signal:controller.signal});if(!alive)return;showReceipt(data,draft.receiptToken);leadStatus.textContent='';}
  catch(error){if(alive)leadStatus.textContent=messageFor(error,t);}finally{if(alive){leadBusy=false;submit.disabled=false;}}
 };

 const vpnCard=make('section',undefined,'fti-services-card fti-services-vpn'),vpnStatus=make('p','', 'fti-services-status'),vpnAction=button(t('Check availability','بررسی دسترس‌پذیری'));
 function paintVpn(value){
  const ready=value?.state==='ready'&&typeof value.checkoutUrl==='string';
  vpnCard.dataset.state=ready?'ready':'pending';vpnCard.replaceChildren(make('span','NODESHIELD VPN','fti-services-eyebrow'),make('h2',ready?t('Your connection, ready to go.','اتصال شما، آمادهٔ شروع.'):t('A connection you can rely on.','اتصالی که بتوانید به آن تکیه کنید.')));
  vpnCard.append(make('p',ready?t('The VPN provider is available. Review current plans, delivery details and terms in the provider portal before purchasing.','ارائه‌دهندهٔ VPN در دسترس است. پیش از خرید، پلن‌های جاری، جزئیات تحویل و شرایط را در پنل ارائه‌دهنده بررسی کنید.'):t('VPN ordering is not open here yet. Leave a request for availability or help with an existing order. No payment is collected on this page.','سفارش VPN هنوز در این صفحه باز نشده است. برای اطلاع از دسترس‌پذیری یا پیگیری سفارش قبلی درخواست بگذارید. در این صفحه پرداختی دریافت نمی‌شود.')));
  const benefits=make('ul',undefined,'fti-services-vpn-features');for(const label of [t('Plans and terms before checkout','مشاهدهٔ پلن و شرایط پیش از خرید'),t('Delivery tied to your order','تحویل مرتبط با سفارش شما'),t('Support for delivery issues','پشتیبانی مشکلات تحویل')])benefits.append(make('li',label));vpnCard.append(benefits);
  const controls=make('div',undefined,'fti-services-actions');
  if(ready){
   try{const target=new URL(value.checkoutUrl);if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash)throw Error('Invalid portal');
    const portal=button(t('Continue to VPN provider ↗','ورود به ارائه‌دهندهٔ VPN ↗'));portal.onclick=async()=>{portal.disabled=true;try{const checked=await request(API+'/vpn',{signal:controller.signal});if(!alive)return;if(checked.vpn?.state!=='ready'||checked.vpn.checkoutUrl!==target.href){paintVpn(checked.vpn);return;}globalThis.location.assign(target.href);}catch(error){if(alive)vpnStatus.textContent=messageFor(error,t);}finally{if(alive)portal.disabled=false;}};controls.append(portal);
   }catch{/* An invalid URL never becomes a checkout link. */}
  }
  const requestHelp=button(ready?t('Help with an order','کمک برای سفارش'):t('Request an update','درخواست اطلاع‌رسانی'),'fti-services-button fti-services-button-secondary');requestHelp.onclick=()=>{interest.value='vpn';contact.scrollIntoView?.({behavior:'smooth',block:'start'});address.focus({preventScroll:true});};controls.append(requestHelp,vpnAction);vpnCard.append(controls,vpnStatus);
 }
 async function refreshVpn(){vpnAction.disabled=true;vpnStatus.textContent=t('Checking provider availability…','در حال بررسی دسترس‌پذیری سرویس…');try{const data=await request(API+'/vpn',{signal:controller.signal});if(alive){paintVpn(data.vpn);vpnStatus.textContent='';}}catch(error){if(alive)vpnStatus.textContent=messageFor(error,t);}finally{if(alive)vpnAction.disabled=false;}}
 vpnAction.onclick=refreshVpn;
 if(view==='vpn'){paintVpn(null);container.append(vpnCard);}
 grid.append(assistant,contact);container.append(grid);
 try{const stored=JSON.parse(globalThis.sessionStorage?.getItem(receiptKey)||'null');if(stored&&ID.test(stored.reference)&&/^[a-f0-9]{64}$/.test(stored.receiptToken)&&Number.isSafeInteger(stored.expiresAt)&&stored.expiresAt>Date.now())showReceipt(stored,stored.receiptToken);}catch{}
 appendAnswer({answer:t('Welcome. I can help you find the right steps and bring your request to the team. Choose a topic to begin.','سلام. می‌توانم مسیر انجام کار را توضیح بدهم و درخواست شما را به تیم برسانم. برای شروع موضوعی را انتخاب کنید.'),actions:[]});
 async function refresh(){
  try{const data=await request(API+'/config',{signal:controller.signal});if(!alive)return;if(data.version!==1)throw Error('Invalid support config');config=data;aiLine.hidden=data.assistant?.configured!==true;if(!data.intake?.available){submit.disabled=true;leadStatus.textContent=t('Contact requests are temporarily unavailable. You can use private wallet support or email.','ثبت درخواست تماس موقتاً در دسترس نیست. از پشتیبانی خصوصی ولت یا ایمیل استفاده کنید.');}else if(!leadBusy)submit.disabled=false;if(view==='vpn')await refreshVpn();}
  catch(error){if(alive){status.textContent=messageFor(error,t);submit.disabled=true;}}
 }
 refresh();
 return {refresh,destroy(){alive=false;controller.abort();container.replaceChildren();container.classList.remove('fti-services');}};
}

export function mountCustomerLeadInbox({container,language='en',getAuthorization,request=requestCustomerService,document:providedDocument}){
 const {t,make,button,rtl}=elements(container,language,providedDocument);let alive=true,identity='',controller=null,busy=false,offset=0;
 container.className=(container.className||'')+' fti-services fti-services-inbox';container.lang=language;container.dir=rtl?'rtl':'ltr';
 const title=make('h3',t('Customer requests','درخواست‌های مشتریان')),intro=make('p',t('Visitors opted in to a reply about these requests. Contact details are unverified; do not disclose account data or add them to marketing campaigns.','بازدیدکننده‌ها برای پاسخ به این درخواست‌ها رضایت داده‌اند. اطلاعات تماس تأیید نشده؛ اطلاعات حساب را افشا نکنید و آن‌ها را عضو کمپین تبلیغاتی نکنید.'));
 const status=make('p','', 'fti-services-status');status.setAttribute('role','status');
 const refreshButton=button(t('Refresh customer requests','به‌روزرسانی درخواست‌ها'),'secondary'),more=button(t('Older requests','درخواست‌های قدیمی‌تر'),'secondary'),rows=make('div',undefined,'fti-services-inbox-rows');more.hidden=true;
 container.replaceChildren(title,intro,refreshButton,status,rows,more);
 const authorization=()=>{try{const value=getAuthorization?.();return typeof value==='string'&&/^Bearer [a-f0-9]{64}$/.test(value)?value:'';}catch{return '';}};
 function refresh(){const next=authorization();if(next!==identity){identity=next;controller?.abort();controller=null;busy=false;offset=0;rows.replaceChildren();more.hidden=true;status.textContent='';}container.hidden=!identity;refreshButton.disabled=busy;}
 async function load(append=false){
  refresh();if(!identity||busy||!alive)return;busy=true;controller=new AbortController();const own=identity,signal=controller.signal;refreshButton.disabled=true;more.disabled=true;
  try{
   const data=await request(API+'/leads?limit=25&offset='+(append?offset:0),{authorization:identity,signal});if(!alive||identity!==own||signal.aborted)return;
   if(!Array.isArray(data.leads)||data.leads.length>50||!(data.nextOffset===null||Number.isSafeInteger(data.nextOffset)))throw Error('Invalid leads response');if(!append)rows.replaceChildren();
   for(const lead of data.leads){
    if(!lead||!ID.test(lead.id)||!STATES.some(([id])=>id===lead.status)||typeof lead.contact!=='string'||lead.contact.length>254||typeof lead.message!=='string'||lead.message.length>1500)throw Error('Invalid customer request');
    const row=make('article',undefined,'fti-services-lead');row.append(make('h4',(lead.name||t('Visitor','بازدیدکننده'))+' · '+(INTERESTS.find(([id])=>id===lead.interest)?.[language==='fa'?2:1]||lead.interest)),make('code',lead.id),make('p',lead.channel+': '+lead.contact),make('p',lead.message),make('small',t('Source','منبع')+': '+lead.source+(lead.campaign?' · '+lead.campaign:'')),make('small',new Date(lead.createdAt).toLocaleString()),make('p',t('Status','وضعیت')+': '+STATES.find(([id])=>id===lead.status)[language==='fa'?2:1]));
    const controls=make('div',undefined,'fti-services-actions');
    if(lead.status!=='withdrawn')for(const [next,en,per]of STATES.filter(([id])=>id!=='withdrawn'&&id!=='new')){
     const change=button(t(en,per),'secondary');change.disabled=lead.status===next;
     change.onclick=async()=>{refresh();const ownToken=identity;if(!ownToken||busy)return;busy=true;change.disabled=true;try{await request(API+'/leads/'+lead.id+'/status',{method:'POST',body:{status:next},authorization:ownToken});if(!alive||identity!==ownToken)return;busy=false;await load();}catch(error){if(alive&&identity===ownToken)status.textContent=messageFor(error,t);}finally{busy=false;refresh();}};controls.append(change);
    }
    row.append(controls);rows.append(row);
   }
   offset=data.nextOffset||0;more.hidden=data.nextOffset===null;status.textContent=data.leads.length?t('Customer requests updated.','درخواست‌ها به‌روزرسانی شدند.'):t('No customer requests.','درخواستی ثبت نشده است.');
  }catch(error){if(alive&&identity===own)status.textContent=messageFor(error,t);}finally{if(alive&&identity===own){busy=false;refreshButton.disabled=false;more.disabled=false;}}
 }
 refreshButton.onclick=()=>load();more.onclick=()=>load(true);refresh();
 return {refresh,destroy(){alive=false;controller?.abort();identity='';rows.replaceChildren();container.replaceChildren();}};
}
