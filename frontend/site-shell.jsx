import React,{useEffect,useRef,useState} from 'react';
import {t} from './locale.js';
import {Brand} from './brand.jsx';
import {LanguageSelect,SocialLinks} from './global-components.jsx';
import {siteLinks} from './site-links.js';

function initialAppearance(){try{return localStorage.getItem('fti-appearance')!=='solid';}catch{return true;}}
export function AppearanceToggle(){
 const [glass,setGlass]=useState(initialAppearance);
 useEffect(()=>{document.documentElement.dataset.appearance=glass?'glass':'solid';try{localStorage.setItem('fti-appearance',glass?'glass':'solid');}catch{}},[glass]);
 return <button type="button" className="fti-appearance" aria-pressed={glass} aria-label={t('Glass appearance','ظاهر شیشه‌ای')} title={t('Glass appearance','ظاهر شیشه‌ای')} onClick={()=>setGlass(v=>!v)}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="13" height="13" rx="4"/><rect x="8" y="8" width="13" height="13" rx="4" fill="currentColor" fillOpacity=".15"/></svg><span>{t('Glass','شیشه‌ای')}</span></button>;
}
export function SiteHeader({token=false}){
 const sites=siteLinks(location.href),[open,setOpen]=useState(false),button=useRef(null),header=useRef(null);
 useEffect(()=>{if(!open)return;const escape=e=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}};const outside=e=>{if(!header.current?.contains(e.target))setOpen(false);};document.addEventListener('keydown',escape);document.addEventListener('pointerdown',outside);return()=>{document.removeEventListener('keydown',escape);document.removeEventListener('pointerdown',outside);};},[open]);
 const links=[[sites.main,'Overview','معرفی'],[sites.main+'#binary','Binary plan','پلن باینری'],[sites.token,'FTI token','توکن FTI'],[sites.whitepaper,'Presentation','معرفی کامل'],[sites.roadmap,'Roadmap','نقشه راه']];
 return <header className="fti-site-header" ref={header}><div className="fti-header-inner"><Brand href={sites.main} token={token}/><nav id="fti-main-navigation" className={'fti-main-navigation'+(open?' is-open':'')} aria-label={t('Main navigation','منوی اصلی')}>{links.map(([href,en,fa])=><a key={href} href={href} onClick={()=>setOpen(false)} aria-current={new URL(href).pathname===location.pathname&&!href.includes('#')?'page':undefined}>{t(en,fa)}</a>)}<a className="fti-mobile-member" href={sites.member}>{t('Member dashboard','پنل اعضا')} ↗</a></nav><div className="fti-header-controls"><LanguageSelect id="site-language-select"/><AppearanceToggle/><a className="fti-header-cta" href={sites.member}>{t('Open app','ورود به برنامه')}<span aria-hidden="true">↗</span></a><button ref={button} className="fti-menu-toggle" type="button" aria-expanded={open} aria-controls="fti-main-navigation" aria-label={open?t('Close menu','بستن منو'):t('Open menu','بازکردن منو')} onClick={()=>setOpen(v=>!v)}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={open?'M6 6 18 18M6 18 18 6':'M4 7h16M4 12h16M4 17h16'}/></svg></button></div></div></header>;
}
export function SiteFooter(){
 const sites=siteLinks(location.href);
 return <footer className="fti-site-footer"><div className="fti-footer-main"><div><Brand href={sites.main}/><p>{t('Membership. Rewards. A reserve token.','عضویت، پاداش و توکن مبتنی بر ذخیره.')}<br/>{t('The rules, in one connected place.','قوانین روشن، در یک فضای یکپارچه.')}</p></div><nav aria-label={t('Explore FTI','دسترسی‌های FTI')}>{[[sites.member,'Member dashboard','پنل اعضا'],[sites.token,'FTI token','توکن FTI'],[sites.whitepaper,'Presentation & rules','معرفی و قوانین'],[sites.roadmap,'Roadmap','نقشه راه'],[sites.council,'Council','شورا']].map(([href,en,fa])=><a key={href} href={href}>{t(en,fa)}</a>)}</nav><SocialLinks/></div><div className="fti-footer-bottom"><span dir="ltr">© {new Date().getFullYear()} FTI Protocol</span><span>ftiprotocol.com</span></div></footer>;
}
