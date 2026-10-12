// Only these seven explicitly requested languages are accepted. No remote translation.
export const LANGUAGES=Object.freeze([
 {code:'fa',label:'فارسی',locale:'fa-IR',dir:'rtl'},
 {code:'en',label:'English',locale:'en-US',dir:'ltr'},
 {code:'ar',label:'العربية',locale:'ar',dir:'rtl'},
 {code:'tr',label:'Türkçe',locale:'tr-TR',dir:'ltr'},
 {code:'zh-CN',label:'简体中文',locale:'zh-CN',dir:'ltr'},
 {code:'ru',label:'Русский',locale:'ru-RU',dir:'ltr'},
 {code:'es',label:'Español',locale:'es-ES',dir:'ltr'},
]);
export function normalizeLanguage(value){
 if(typeof value!=='string')return null;
 const v=value.toLowerCase();
 if(v==='zh'||v==='zh-hans'||v==='zh-cn')return 'zh-CN';
 return LANGUAGES.find(x=>x.code.toLowerCase()===v)?.code??null;
}
export function languageFrom(url,stored){
 let requested;try{requested=new URL(url).searchParams.get('lang');}catch{}
 return normalizeLanguage(requested)||normalizeLanguage(stored)||'fa';
}
export function readLanguage(){let saved;try{saved=globalThis.localStorage?.getItem('fti-language');}catch{}
 return languageFrom(globalThis.location?.href,saved);
}
export const language=readLanguage();
export const languageInfo=LANGUAGES.find(l=>l.code===language);
export function withLanguage(value,selected=language,base=globalThis.location?.href){
 const code=normalizeLanguage(selected);if(!code)throw Error('Unsupported language');
 const url=new URL(value,base);if(!['https:','http:'].includes(url.protocol))throw Error('Invalid link protocol');
 url.searchParams.set('lang',code);return url.href;
}
export function changeLanguage(value){
 const code=normalizeLanguage(value);if(!code)throw Error('Unsupported language');
 try{localStorage.setItem('fti-language',code);}catch{}
 // The query parameter also works when browser storage is unavailable. Preserve
 // the current route, referral and hash; never reload in the middle of signing.
 location.assign(withLanguage(location.href,code));
}
export function initializeLanguage(){
 document.documentElement.lang=language;document.documentElement.dir=languageInfo.dir;
 if(document.documentElement.dataset.ftiLanguageLinks)return;
 document.documentElement.dataset.ftiLanguageLinks='1';
 document.addEventListener('click',event=>{
  const a=event.target?.closest?.('a[href]');if(!a||a.hasAttribute('download'))return;
  try{const u=new URL(a.href,location.href);if(!['https:','http:'].includes(u.protocol))return;
   const ours=u.origin===location.origin||['ftiprotocol.com','www.ftiprotocol.com','app.ftiprotocol.com','token.ftiprotocol.com','council.ftiprotocol.com'].includes(u.hostname);
   if(ours&&!a.getAttribute('href').startsWith('#'))a.href=withLanguage(u.href);
  }catch{}
 },{capture:true});
}
export function displayNumber(value,options={}){
 return new Intl.NumberFormat(languageInfo.locale,options).format(value);
}
export function displayUTC(seconds){
 const date=new Date(Number(seconds)*1000);if(!Number.isFinite(date.getTime()))return '—';
 return new Intl.DateTimeFormat(languageInfo.locale,{calendar:'gregory',timeZone:'UTC',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(date)+' UTC';
}
