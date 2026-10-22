// Browser-only draft state. The controller and contract remain authoritative for
// address checksum, membership, ancestry, vacant slots and transaction approval.
export const REFERRAL_KEY='fti:registration-referrer:v1';
export const REFERRAL_TTL=24*60*60*1000;
const aliases=['sponsor','referrer','ref'];
const destinations=new Set(['/','/app','/app/','/token','/token/','/token-site','/token-site/']);
const installed=new WeakMap();
const address=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value)&&!/^0x0{40}$/i.test(value);

export function referralFromUrl(href){
 const url=new URL(href),values=aliases.flatMap(key=>url.searchParams.getAll(key));
 if(!values.length)return {present:false,value:'',valid:false};
 const trimmed=values.map(value=>value.trim());
 // Never let an invalid or conflicting explicit invitation fall back to an old
 // stored inviter. The form stays empty until the user supplies a valid address.
 if(trimmed.some(value=>!address(value))||new Set(trimmed.map(value=>value.toLowerCase())).size!==1)
  return {present:true,value:'',valid:false};
 return {present:true,value:trimmed[0],valid:true};
}

export function referralUrl(href,value,{cleared=false}={}){
 const url=new URL(href);
 for(const key of aliases)url.searchParams.delete(key);
 if(address(value))url.searchParams.set('sponsor',value);
 else if(cleared)url.searchParams.set('sponsor','');
 return url.href;
}

export function loadReferral(storage,now=Date.now()){
 try{
  const saved=JSON.parse(storage?.getItem(REFERRAL_KEY)||'null');
  if(!saved||saved.version!==1||!Number.isFinite(saved.at)||saved.at>now||now-saved.at>=REFERRAL_TTL)return null;
  // Empty is a deliberate clear, not permission to resurrect an older link.
  return saved.value===''||address(saved.value)?saved.value:null;
 }catch{return null;}
}

export function saveReferral(storage,value,now=Date.now()){
 try{storage?.setItem(REFERRAL_KEY,JSON.stringify({version:1,at:now,value:address(value)?value:''}));}catch{}
}

export function installReferralContext(win,{now=()=>Date.now()}={}){
 if(installed.has(win))return installed.get(win);
 const doc=win.document;
 let storage;try{storage=win.sessionStorage;}catch{}
 const incoming=referralFromUrl(win.location.href);
 const saved=loadReferral(storage,now());
 let value=incoming.present?incoming.value:(saved??'');
 let hasDraft=incoming.present||saved!==null;
 // Canonicalize invalid/ambiguous invitations to an explicit empty sponsor.
 // Otherwise the legacy controller could pick the first conflicting alias.
 let invalidLink=incoming.present&&!incoming.valid;
 let field=null;
 const decorated=new WeakMap();
 const syncUrl=()=>{
  try{
   const next=referralUrl(win.location.href,value,{cleared:hasDraft&&!value});
   if(next!==win.location.href)win.history.replaceState(win.history.state,'',next);
  }catch{} // Restricted webviews must still be able to use the form.
 };
 const remember=()=>{saveReferral(storage,value,now());syncUrl();};
 if(incoming.present)saveReferral(storage,value,now());
 syncUrl(); // Canonicalize aliases before the existing controller reads sponsor.
 const input=()=>doc.querySelector('#register-form input[name="sponsor"]');
 const bind=(force=false)=>{
  const next=input();
  if(!next){field=null;return;}
  if(next===field&&!force)return;
  field=next;
  field.setCustomValidity?.(invalidLink&&!field.disabled?'Invalid invitation. Enter one valid sponsor address.':'');
  // Never replace the registered member's on-chain inviter or a live nonempty
  // edit. Restore a draft only into an empty, enabled field.
  if(!field.disabled&&!field.value&&value)field.value=value;
 };
 const edit=e=>{
  if(e.target!==input()||e.target.disabled)return;
  const raw=e.target.value.trim();
  value=address(raw)?raw:'';
  invalidLink=false;hasDraft=true;
  e.target.setCustomValidity?.('');
  remember();
 };
 const focus=e=>{if(e.target===input())bind(true);};
 const resume=()=>bind(true);
 const navigate=e=>{
  const anchor=e.target?.closest?.('a[href]');
  if(!anchor)return;
  const previous=decorated.get(anchor),href=anchor.getAttribute('href');
  const base=previous&&href===previous.result?previous.base:href;
  let target;try{target=new URL(base,win.location.href);}catch{return;}
  if(!['http:','https:'].includes(target.protocol)||target.origin!==win.location.origin||!destinations.has(target.pathname)||anchor.hasAttribute('download'))return;
  // An explicit invitation on the destination has priority, including invalid
  // input. Do not silently rewrite it as the current user's invitation.
  if(referralFromUrl(target.href).present)return;
  // Re-evaluate our own decorated links when the draft changes or is cleared.
  if(!hasDraft&&!previous)return;
  const result=referralUrl(target.href,value,{cleared:hasDraft&&!value});
  anchor.setAttribute('href',result);decorated.set(anchor,{base,result});
 };
 doc.addEventListener('input',edit,true);
 doc.addEventListener('change',edit,true);
 doc.addEventListener('focusin',focus,true);
 doc.addEventListener('click',navigate,true);
 doc.addEventListener('auxclick',navigate,true);
 win.addEventListener('pageshow',resume);
 win.addEventListener('pagehide',remember);
 const observer=new win.MutationObserver(()=>bind());
 observer.observe(doc.documentElement,{childList:true,subtree:true});
 bind();
 const context={
  dispose(){
   observer.disconnect();
   for(const [type,handler] of [['input',edit],['change',edit],['focusin',focus],['click',navigate],['auxclick',navigate]])doc.removeEventListener(type,handler,true);
   win.removeEventListener('pageshow',resume);win.removeEventListener('pagehide',remember);
   installed.delete(win);
  }
 };
 installed.set(win,context);
 return context;
}
