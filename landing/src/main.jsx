import React,{Suspense,lazy,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {translate,initializeLanguage,language,LANGUAGES,changeLanguage} from './public-locale.js';
import {content} from './home-content.js';
import {homeMessage} from './home-messages.js';
import {LiveDataBoundary} from './live-boundary.jsx';
import mark from './assets/fti-mark.jpg';
import '@fontsource-variable/manrope';
import '@fontsource-variable/vazirmatn';
import './premium.css';

initializeLanguage();
const LiveData=lazy(()=>import('./live-data.jsx'));
const app=__FTI_APP_URL__||'/app/';
function Icon({kind='arrow',...props}){
 const paths={arrow:'M7 17 17 7M7 7h10v10',member:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87',token:'M7 10h10M7 14h7',support:'M4 13v-2a8 8 0 0 1 16 0v2M4 12H2v6h4v-6H4M20 12h2v6h-4v-6h2M18 18a6 6 0 0 1-6 4',shield:'m12 3 8 4v5c0 5-8 10-8 10S4 17 4 12V7l8-4Zm-4 9 3 3 5-6',code:'m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16',book:'M12 6C9 3 4 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-2-1-7-1-10 2Zm0 0v15',check:'m5 12 4 4L19 6'};
 return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{kind==='member'&&<circle cx="9" cy="7" r="4"/>}{kind==='token'&&<circle cx="12" cy="12" r="10"/>}<path d={paths[kind]||paths.arrow}/></svg>;
}
function Logo(){return <a href="/" className="brand" aria-label="FTI Protocol"><span className="brand-image"><img src={mark} width="48" height="48" alt="" fetchPriority="high"/></span><span>FTI<small>PROTOCOL</small></span></a>}
function preference(key,fallback){try{return localStorage.getItem(key)||fallback}catch{return fallback}}
function ProtocolVisual({m}){
 return <div className="protocol-visual" aria-label="FTI protocol workspaces">
  <div className="visual-grid" aria-hidden="true"/><div className="orbit orbit-one" aria-hidden="true"/><div className="orbit orbit-two" aria-hidden="true"/>
  <div className="visual-topline"><span><i/> FTI PROTOCOL</span><span>BNB CHAIN</span></div>
  <a className="visual-card visual-members" href={app+'#network'}><span className="visual-icon"><Icon kind="member"/></span><span>{m('members')}<small>{m('workspace')}</small></span><Icon/></a>
  <div className="protocol-coin" aria-hidden="true"><div className="coin-rim"><span className="coin-inscription">FTI · PROTOCOL · FTI · PROTOCOL</span><div className="coin-core"><img src={mark} width="160" height="160" alt=""/><span>FTI</span></div></div></div>
  <a className="visual-card visual-token" href="/token/#trade"><span className="visual-icon token-icon"><Icon kind="token"/></span><span>{m('trade')}<small>FTI / USDT</small></span><Icon/></a>
  <div className="visual-footnote"><Icon kind="shield"/><span>{m('wallet')}</span></div>
 </div>;
}
function LiveSection({lang,m}){
 const holder=useRef(null),[active,setActive]=useState(false);
 useEffect(()=>{
  if(!('IntersectionObserver' in window))return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setActive(true);observer.disconnect();}},{rootMargin:'120px'});
  observer.observe(holder.current);return()=>observer.disconnect();
 },[]);
 return <div ref={holder} className="live-section" id="live-data"><div className="container live-section-intro"><div><p className="eyebrow">{m('live')}</p><h2>{m('review')}</h2><p>{m('dataNote')}</p></div><a className="text-link" href="/token/#trade">{m('trade')} <Icon/></a></div>{active?<LiveDataBoundary lang={lang}><Suspense fallback={<p className="container loading-data" role="status">{m('loading')}</p>}><LiveData lang={lang}/></Suspense></LiveDataBoundary>:<div className="container"><button className="button outline" onClick={()=>setActive(true)}>{m('loadData')} <Icon/></button></div>}</div>;
}
function App(){
 const [lang]=useState(language),[light,setLight]=useState(()=>preference('fti-theme','light')==='light'),[menu,setMenu]=useState(false),[tab,setTab]=useState(0);
 const m=key=>homeMessage(key,lang);
 const localize=value=>typeof value==='string'?translate(value,lang):Array.isArray(value)?value.map(localize):Object.fromEntries(Object.entries(value).map(([key,item])=>[key,localize(item)]));
 const t=lang==='fa'?content.fa:localize(content.en);
 useEffect(()=>{
  document.documentElement.dataset.theme=light?'light':'dark';
  try{localStorage.setItem('fti-theme',light?'light':'dark')}catch{}
  document.querySelector('meta[name=theme-color]')?.setAttribute('content',light?'#f6f8f6':'#0a1716');
 },[light]);
 useEffect(()=>{const close=event=>{if(event.key==='Escape')setMenu(false)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[]);
 const actions=[['member','members','membersBody',app+'#network'],['token','trade','tradeBody','/token/#trade'],['support','support','supportBody','/support/'],['shield','vpn','vpnBody','/vpn/']];
 return <><a className="skip" href="#main">{translate('Skip to content',lang,'رفتن به محتوا')}</a>
 <header className="header" id="top"><div className="container nav"><Logo/><nav id="navigation" className={menu?'navigation is-open':'navigation'} aria-label={t.menu}>
  {[[app,m('members')],['/token/#trade',m('trade')],['#protocol',m('how')],['/support/',m('support')]].map(([url,label])=><a key={url} href={url} onClick={()=>setMenu(false)}>{label}</a>)}
 </nav><div className="nav-tools"><select className="landing-language" aria-label={translate('Choose language',lang)} value={lang} onChange={event=>changeLanguage(event.target.value)}>{LANGUAGES.map(item=><option key={item.code} value={item.code} lang={item.code}>{item.label}</option>)}</select><button className="icon-button" onClick={()=>setLight(!light)} aria-label={t.theme} aria-pressed={light}>{light?'☾':'☀'}</button><a className="button primary nav-launch" href={app}>{m('workspace')} <Icon/></a><button className="icon-button mobile-menu" onClick={()=>setMenu(!menu)} aria-expanded={menu} aria-controls="navigation" aria-label={t.menu}>{menu?'×':'☰'}</button></div></div></header>
 <main id="main"><section className="hero container"><div className="hero-copy"><div className="eyebrow"><i/>{t.tag}</div><h1>{t.hero[0]}<br/><em>{t.hero[1]}</em></h1><p className="lead">{t.intro}</p><div className="actions"><a className="button primary" href={app}>{m('workspace')} <Icon/></a><a className="button outline" href="/token/">{t.cards[1][4]} <Icon/></a></div><div className="hero-reassurance"><span><Icon kind="shield"/>{m('wallet')}</span><a href="#resources">{t.faqTitle} <Icon/></a></div></div><ProtocolVisual m={m}/><div className="hero-bottom"><span>MEMBERSHIP · TOKEN · GOVERNANCE</span><div>{['connect','inspect','confirm'].map((key,index)=><span key={key}><b>0{index+1}</b>{m(key)}</span>)}</div></div></section>
 <section className="container shortcuts-section" aria-labelledby="start-title"><div className="section-heading"><div><p className="eyebrow">FTI / {m('services')}</p><h2 id="start-title">{m('start')}</h2></div><p>{m('choose')}</p></div><div className="quick-actions">{actions.map(([icon,title,body,url],index)=><a className={'quick-action action-'+index} href={url} key={title}><div className="quick-action-top"><span className="action-icon"><Icon kind={icon}/></span><span className="action-number">0{index+1}</span></div><h3>{m(title)}</h3><p>{m(body)}</p><span className="action-open">{m('explore')}<Icon/></span></a>)}</div></section>
 <section className="protocol-section container" id="protocol"><div className="section-heading"><div><p className="eyebrow">{t.eyebrow}</p><h2>{t.title}</h2></div><p>{t.desc}</p></div><div className="protocol-cards">{t.cards.map(([number,label,title,body,cta,url],index)=><article key={number}><div className="protocol-card-head"><Icon kind={['member','token','shield'][index]}/><span>{label}</span><small>{number}</small></div><h3>{title}</h3><p>{body}</p><a className="text-link" href={url}>{cta}<Icon/></a></article>)}</div></section>
 <section className="token-section" id="token"><div className="container token-grid"><div><p className="eyebrow">{t.tokenTag}</p><h2>{t.tokenTitle}</h2><p className="section-copy">{t.tokenBody}</p><a className="text-link" href="/token/">{t.quote}<Icon/></a></div><div className="flow-panel"><div className="flow-heading"><span>FTI / TOKEN MECHANICS</span><Icon kind="token"/></div><div className="tabs" role="tablist" aria-label={t.nav[1]}>{t.tabs.map((label,index)=><button key={label} role="tab" aria-selected={tab===index} tabIndex={tab===index?0:-1} id={'tab-'+index} aria-controls="flow-content" onClick={()=>setTab(index)} onKeyDown={event=>{let next;if(event.key==='ArrowRight')next=(index+1)%3;if(event.key==='ArrowLeft')next=(index+2)%3;if(event.key==='Home')next=0;if(event.key==='End')next=2;if(next!==undefined){event.preventDefault();setTab(next);document.getElementById('tab-'+next)?.focus()}}}>{label}</button>)}</div><div className="flow-content" role="tabpanel" id="flow-content" aria-labelledby={'tab-'+tab}><div className="flow-illustration" aria-hidden="true"><span>{tab===0?'USDT':'FTI'}</span><svg viewBox="0 0 100 24"><path d="M0 12h96m-8-8 8 8-8 8"/></svg><span>{tab===1?'USDT':'FTI'}</span></div><h3>{t.flows[tab][0]}</h3><p>{t.flows[tab][1]}</p><a className="button primary" href={'/token/#trade'}>{m('trade')}<Icon/></a></div></div></div></section>
 <LiveSection lang={lang} m={m}/>
 <section className="container evidence-section" id="resources"><div className="section-heading"><div><p className="eyebrow">FTI / {m('review')}</p><h2>{m('evidence')}</h2></div><p>{m('evidenceBody')}</p></div><div className="evidence-grid">{[['code','source','sourceNote','https://repo.sourcify.dev/56/0x43755B1E813b2d41F669ea08bcf859De07195eA1'],['book','docs','docsNote','/whitepaper/'],['code','code','codeNote','https://github.com/Rezamoradifar/fti-protocol']].map(([icon,title,body,url])=><a key={title} href={url} className="evidence-link"><Icon kind={icon}/><div><h3>{m(title)}</h3><p>{m(body)}</p></div><Icon/></a>)}</div><div className="audit-status"><Icon kind="shield"/><strong>{m('audit')}</strong><p>{m('auditNote')}</p></div></section>
 <section className="container support-section"><div className="support-emblem" aria-hidden="true"><Icon kind="support"/></div><div><p className="eyebrow">FTI / {m('support')}</p><h2>{m('guide')}</h2><p>{m('guideBody')}</p></div><a className="button primary" href="/support/">{m('ask')}<Icon/></a></section>
 <section className="container journey-section" id="journey"><div><p className="eyebrow">{t.journeyTag}</p><h2>{t.journeyTitle}</h2></div><div className="journey-steps">{t.steps.map(([title,body],index)=><article key={title}><span>0{index+1}</span><div><h3>{title}</h3><p>{body}</p></div></article>)}</div></section>
 <section className="container faq-section" id="faq"><div><p className="eyebrow">{t.faqTag}</p><h2>{t.faqTitle}</h2><a className="text-link" href="mailto:Support@FTIProtocol.com">{t.contact}<Icon/></a></div><div className="faq-list">{t.faqs.map(([question,answer])=><details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>
 <section className="container closing"><div><p className="eyebrow">FTI PROTOCOL</p><h2>{t.close}</h2><p>{t.closeBody}</p></div><a className="button primary" href={app}>{m('workspace')}<Icon/></a></section>
 </main><footer className="footer"><div className="container footer-main"><div><Logo/><p>{t.footer}</p></div><nav aria-label={t.menu}><a href={app}>{m('members')}</a><a href="/token/">{m('trade')}</a><a href="/support/">{m('support')}</a><a href="/vpn/">{m('vpn')}</a><a href="/whitepaper/">{m('docs')}</a><a href="/roadmap/">{translate('Roadmap',lang,'نقشه راه')}</a></nav><div className="footer-contact"><span>{t.community}</span><a href="https://t.me/FTIProtocol_Official" target="_blank" rel="noreferrer">Telegram <Icon/></a><a href="https://x.com/FTIProtocol" target="_blank" rel="noreferrer">X / Twitter <Icon/></a><a href="mailto:Support@FTIProtocol.com">Support@FTIProtocol.com</a></div></div><div className="container footer-bottom"><span>© {new Date().getFullYear()} FTI Protocol</span><p>{t.note}</p><a href="#top">↑</a></div></footer></>;
}
createRoot(document.getElementById('root')).render(<App/>);
