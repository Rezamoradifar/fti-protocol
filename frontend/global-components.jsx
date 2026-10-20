import React from 'react';
import {t,language,LANGUAGES,changeLanguage} from './locale.js';
import socialConfig from '../config/social-links.json';
import {validatedSocialLinks} from './social-policy.js';
export function LanguageSelect({id='language-select',className=''}){
 return <label className={'fti-language '+className}><span>{t('Language')}</span>
  <select id={id} aria-label={t('Choose language')} value={language} onChange={e=>{if(!e.target.disabled)changeLanguage(e.target.value);}}>
   {LANGUAGES.map(l=><option key={l.code} value={l.code} lang={l.code} dir={l.dir}>{l.label}</option>)}
  </select></label>;
}
export function SocialLinks(){
 const links=validatedSocialLinks(socialConfig);
 const email=typeof socialConfig.email==='string'&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(socialConfig.email)?socialConfig.email:null;
 return <section className="fti-social" aria-label={t('Official social channels')}>
  <h2>{t('Official social channels')}</h2>
  {links.length||email?<nav aria-label={t('Official social channels')}>{links.map(l=><a key={l.id} href={l.href} target="_blank" rel="noopener noreferrer"><SocialIcon name={l.id}/><span>{l.name}<small dir="ltr">@FTIProtocol</small></span><span aria-hidden="true">↗</span></a>)}{email&&<a className="fti-email" href={'mailto:'+email}><SocialIcon name="email"/><span>{t('Contact support','ارتباط با پشتیبانی')}<small dir="ltr">{email}</small></span><span aria-hidden="true">↗</span></a>}</nav>
   :<p className="muted">{t('Official links have not been configured. No account address is assumed.')}</p>}
 </section>;
}
function SocialIcon({name}){
 const paths={telegram:'m3 11 18-7-4 17-5-6-4 3v-5l9-6-11 7z',x:'M4 3h5l11 18h-5z M20 3 4 21',email:'M3 5h18v14H3z M3 5l9 8 9-8'};
 return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||'M4 12h16M12 4v16'}/></svg>;
}
export function TranslationNotice({includePersian=false}){
 if(['en','ar','tr','zh-CN'].includes(language)||language==='fa'&&!includePersian)return null;
 return <p className="fti-translation-notice" role="note">{t('Core controls are translated. Some detailed explanations are still shown in English.')}</p>;
}
