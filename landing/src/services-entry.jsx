import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {initializeLanguage,language,LANGUAGES,changeLanguage} from './public-locale.js';
import {homeMessage} from './home-messages.js';
import {mountCustomerServices} from '../../frontend/customer-services.js';
import '../../frontend/customer-services.css';
import '@fontsource-variable/manrope';
import '@fontsource-variable/vazirmatn';
import './premium.css';
import './services-page.css';
import mark from './assets/fti-mark.jpg';
initializeLanguage();
const view=location.pathname.startsWith('/vpn')?'vpn':'support';
function ServicesPage(){
 const holder=useRef(null),m=key=>homeMessage(key,language);
 const [light,setLight]=useState(()=>{try{return localStorage.getItem('fti-theme')!=='dark'}catch{return true}});
 useEffect(()=>{document.documentElement.dataset.theme=light?'light':'dark';try{localStorage.setItem('fti-theme',light?'light':'dark')}catch{}},[light]);
 useEffect(()=>{const service=mountCustomerServices({container:holder.current,language,view});return()=>service?.destroy?.()},[]);
 return <><header className="header"><div className="container nav"><a className="brand" href="/" aria-label="FTI Protocol"><span className="brand-image"><img src={mark} alt="" width="48" height="48"/></span><span>FTI<small>PROTOCOL</small></span></a><div className="nav-tools"><select className="landing-language" value={language} onChange={event=>changeLanguage(event.target.value)} aria-label={language==='fa'?'انتخاب زبان':'Choose language'}>{LANGUAGES.map(item=><option value={item.code} key={item.code} lang={item.code}>{item.label}</option>)}</select><button className="icon-button" aria-label={language==='fa'?'تغییر تم':'Change theme'} aria-pressed={light} onClick={()=>setLight(!light)}>{light?'☾':'☀'}</button><a className="button primary nav-launch" href="/app/">{m('workspace')} ↗</a></div></div></header><main id="main" className="container services-page"><a className="services-back" href="/">← FTI Protocol</a><div className="services-page-intro"><p className="eyebrow">FTI / {m('services')}</p><h1>{m(view)}</h1><p>{m(view==='vpn'?'vpnBody':'guideBody')}</p></div><nav className="services-page-tabs" aria-label={m('services')}><a href="/support/" aria-current={view==='support'?'page':undefined}>{m('support')}</a><a href="/vpn/" aria-current={view==='vpn'?'page':undefined}>{m('vpn')}</a><a href="/app/#support">{language==='fa'?'پشتیبانی حساب شما':'Your account support'} ↗</a></nav><div ref={holder}/></main><footer className="container services-page-footer"><a href="/whitepaper/">{m('docs')}</a><a href="mailto:Support@FTIProtocol.com">Support@FTIProtocol.com</a><span>FTI Protocol · {new Date().getFullYear()}</span></footer></>;
}
createRoot(document.getElementById('root')).render(<ServicesPage/>);
