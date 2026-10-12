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
 return <section className="fti-social" aria-label={t('Official social channels')}>
  <h2>{t('Official social channels')}</h2>
  {links.length?<nav aria-label={t('Official social channels')}>{links.map(l=><a key={l.id} href={l.href} target="_blank" rel="noopener noreferrer">{l.name}<span aria-hidden="true"> ↗</span></a>)}</nav>
   :<p className="muted">{t('Official links have not been configured. No account address is assumed.')}</p>}
 </section>;
}
export function TranslationNotice({includePersian=false}){
 if(language==='en'||language==='fa'&&!includePersian)return null;
 return <p className="fti-translation-notice" role="note">{t('Core controls are translated. Some detailed explanations are still shown in English.')}</p>;
}
