import React,{useState,useEffect} from 'react';
import {t,displayNumber,withLanguage,languageInfo} from './locale.js';
import {useMemberView} from './member-panel-store.js';
import {HeaderMark} from './header-mark.jsx';
import {siteLinks} from './site-links.js';
import social from '../config/social-links.json';

const links=siteLinks(location.href);
const number=value=>value==null?'—':displayNumber(BigInt(value));
const smallAddress=value=>value?value.slice(0,7)+'…'+value.slice(-5):'—';
const money=value=>{
 if(value==null)return '—';
 const raw=BigInt(value);
 if(raw>0n&&raw<10n**16n)return '< '+displayNumber(.01,{minimumFractionDigits:2,maximumFractionDigits:2});
 const cents=(raw+5n*10n**15n)/10n**16n;
 const decimal=new Intl.NumberFormat(languageInfo.locale).formatToParts(1.1).find(part=>part.type==='decimal')?.value||'.';
 return number((cents/100n).toString())+decimal+displayNumber(cents%100n,{minimumIntegerDigits:2,useGrouping:false});
};
const minimum=(a,b)=>a==null||b==null?null:(BigInt(a)<BigInt(b)?a:b);
function jump(page){location.hash=page;document.getElementById('page-title')?.focus({preventScroll:true});document.getElementById('main')?.scrollIntoView({behavior:'instant'});}
function action(id){const control=document.getElementById(id);if(control&&!control.disabled)control.click();}
function Arrow(){return <span aria-hidden="true">↗</span>;}
function Glyph({name}){const paths={network:'M12 8v5M5 18v-5h14v5M9 2h6v6H9zM2 18h6v4H2zM16 18h6v4h-6z',wallet:'M3 5h17v15H3zM3 5l14-3v3M16 11h5v5h-5z',trade:'M4 7h16m-5-5 5 5-5 5M20 17H4m5-5-5 5 5 5',reward:'m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z',help:'M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2M12 18h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z'};return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.wallet}/></svg>;}

export function MemberIntro(){
 const view=useMemberView();
 const state=view.stale?'stale':view.verified?'verified':view.status==='unavailable'?'unavailable':view.connected?'loading':'disconnected';
 const stateLabel=state==='stale'?t('Update needed','نیاز به به‌روزرسانی'):state==='verified'?t('Account synced','اطلاعات حساب به‌روز است'):state==='unavailable'?t('Account unavailable','اطلاعات حساب در دسترس نیست'):view.connected?t('Reading your account','در حال دریافت حساب'):t('Your personal workspace','فضای شخصی شما');
 return <section className="member-command-hero" aria-labelledby="member-command-title">
  <div className="member-command-copy"><span className="member-kicker">{t('THE FTI EXPERIENCE','تجربهٔ یکپارچهٔ FTI')}</span><h2 id="member-command-title">{t('Your FTI.','FTI شما.')}<br/><em>{t('All in focus.','همه چیز، روشن و در دسترس.')}</em></h2><p>{t('One clear view of your wallet, membership and network. Make your next move with confidence in the details.','نمایی روشن از ولت، عضویت و شبکهٔ شما؛ جزئیات را ببینید و قدم بعدی را انتخاب کنید.')}</p><div className="member-command-actions"><button type="button" onClick={()=>jump('network')}>{view.membershipStatus==='registered'?t('Manage membership','مدیریت عضویت'):t('Start your membership','شروع عضویت')}<Arrow/></button><a href={withLanguage(links.trade)}>{t('Token market','بازار توکن')}<Arrow/></a></div><div className="member-account-signal" data-state={state}><i aria-hidden="true"/><span>{stateLabel}</span>{view.address&&<b dir="ltr">{smallAddress(view.address)}</b>}</div></div>
  <div className="member-command-orbit" aria-hidden="true"><div className="member-orbit-ring ring-one"/><div className="member-orbit-ring ring-two"/><HeaderMark size={180}/><span>FTI / PROTOCOL</span></div>
 </section>;
}

export function MemberMetrics(){const view=useMemberView();const matched=minimum(view.lifetimeL,view.lifetimeR);const items=[
 [t('Membership units','یونیت‌های عضویت'),number(view.units),t('Your personal position','جایگاه شخصی شما'),'network'],
 [t('Lifetime matched volume','حجم تعادل تاریخی'),number(matched),t('Weaker branch · units','شاخهٔ ضعیف‌تر · واحد'),'network'],
 [t('Current point cap','سقف فعلی پوینت'),view.hourlyCap==null?'—':number(String(view.hourlyCap)),t('Points / hour · protection applies','پوینت در ساعت · با اعمال حفاظت'),'reward'],
 [t('Pending auto-buy','خرید خودکار در انتظار'),money(view.autoPending),t('Collateral reserved for FTI','دارایی کنارگذاشته‌شده برای FTI'),'wallet']
 ];return <div className="member-personal-metrics" aria-label={t('Your account at a glance','حساب شما در یک نگاه')}>{items.map(([label,value,note,icon])=><article key={label}><div><span>{label}</span><Glyph name={icon}/></div><strong dir="ltr">{value}</strong><small>{note}</small></article>)}</div>;}

export function MemberQuickActions(){return <nav className="member-shortcuts" aria-label={t('Account shortcuts','دسترسی سریع حساب')}>{[
 ['network','network',t('Membership','عضویت و شبکه'),t('Join or add units','ثبت‌نام یا افزایش یونیت')],
 ['rewards','reward',t('Your rewards','پاداش‌های شما'),t('Claim and manage auto-buy','دریافت و تنظیم خرید خودکار')],
 ['activity','trade',t('Recent activity','فعالیت‌های اخیر'),t('Review on-chain records','بررسی رویدادهای شبکه')],
 ['support','help',t('Help center','مرکز راهنما'),t('Guides and official support','آموزش و پشتیبانی رسمی')]
 ].map(([page,icon,title,description])=><button type="button" key={page} onClick={()=>jump(page)}><Glyph name={icon}/><span><b>{title}</b><small>{description}</small></span><Arrow/></button>)}</nav>;}

export function MemberAccountSummary(){
 const view=useMemberView();const [copied,setCopied]=useState(false);
 const invite=view.membershipStatus==='registered'&&view.address?withLanguage(links.member+'?sponsor='+encodeURIComponent(view.address)+'#network'):'';
 useEffect(()=>setCopied(false),[invite]);
 const larger=view.lifetimeL!=null&&view.lifetimeR!=null?(BigInt(view.lifetimeL)>BigInt(view.lifetimeR)?BigInt(view.lifetimeL):BigInt(view.lifetimeR)):null;
 const ratio=value=>value==null||larger==null||larger===0n?0:Number(BigInt(value)*10000n/larger)/100;
 const copy=async()=>{try{await navigator.clipboard.writeText(invite);setCopied(true);}catch{jump('network');document.getElementById('referral-link')?.select();}};
 return <div className="member-account-summary"><article className="panel member-branches"><div className="panel-head"><div><span className="member-kicker">{t('YOUR NETWORK','شبکهٔ شما')}</span><h2>{t('Two branches. One view.','دو شاخه، یک نمای روشن.')}</h2></div><Glyph name="network"/></div><p className="muted">{t('Lifetime volume and carried units, read from your account.','حجم تاریخی و واحدهای ذخیره‌شده، از اطلاعات حساب شما.')}</p>{[['L',t('Left branch','شاخهٔ چپ'),view.lifetimeL,view.carryL],['R',t('Right branch','شاخهٔ راست'),view.lifetimeR,view.carryR]].map(([side,label,volume,carry])=><div className="member-branch-row" key={side}><div><b>{label}</b><strong>{number(volume)} <small>{t('units','واحد')}</small></strong></div><div className="member-volume-track" aria-hidden="true"><span style={{width:ratio(volume)+'%'}}/></div><small>{t('Carried volume','حجم ذخیره‌شده')}: {number(carry)}</small></div>)}<div className="member-branch-foot"><span>{t('Direct invitations','معرفی‌های مستقیم')}<b>{number(view.directReferrals)}</b></span><button className="text-button" type="button" onClick={()=>{jump('network');const details=document.getElementById('network-explorer-details');if(details)details.open=true;requestAnimationFrame(()=>details?.scrollIntoView({block:'start'}));}}>{t('Explore the tree','مشاهدهٔ درخت')}<Arrow/></button></div><small className="member-volume-note">{t('Volume measures membership units, not people or cash rewards.','حجم، تعداد یونیت عضویت است؛ نه تعداد افراد یا مبلغ پاداش.')}</small></article>
 <article className="panel member-invite-card"><div className="member-invite-symbol"><Glyph name="network"/></div><span className="member-kicker">{t('BUILD YOUR CONNECTIONS','ارتباط‌های خود را بسازید')}</span><h2>{t('Your invitation,','دعوت شما،')}<br/>{t('ready to share.','آمادهٔ اشتراک‌گذاری.')}</h2><p>{t('Use your personal link to introduce FTI. Your wallet identifies the inviter; placement follows the installed network rules.','با لینک شخصی خود FTI را معرفی کنید. ولت شما معرف را مشخص می‌کند و جای‌گذاری طبق قوانین شبکه انجام می‌شود.')}</p><label className="member-sr-only" htmlFor="dashboard-invitation">{t('Your invitation link','لینک دعوت شما')}</label><input id="dashboard-invitation" readOnly dir="ltr" value={invite} placeholder={t('Available after registration','پس از ثبت‌نام فعال می‌شود')}/><button type="button" disabled={!invite} onClick={copy}>{copied?t('Link copied','لینک کپی شد'):t('Copy invitation link','کپی لینک دعوت')}<Arrow/></button><small>{t('Only a registered account has a personal invitation link.','لینک شخصی پس از ثبت عضویت در دسترس است.')}</small></article></div>;
}

export function MemberReadiness(){
 const view=useMemberView();const connected=view.connected,registered=view.membershipStatus==='registered';
 const refreshNeeded=view.stale||view.status==='unavailable';
 const ready=view.verified&&registered&&view.units!=null&&BigInt(view.units)>0n;
 return <article className="member-readiness panel"><div><span className="member-kicker">{t('YOUR NEXT STEP','قدم بعدی شما')}</span><h2>{refreshNeeded?t('Refresh before continuing.','پیش از ادامه، اطلاعات را تازه کنید.'):ready?t('Your workspace is ready.','فضای کار شما آماده است.'):!connected?t('Start with your wallet.','از ولت خود شروع کنید.'):registered?t('Review your membership.','عضویت خود را بررسی کنید.'):t('Make it your account.','عضویت خود را آغاز کنید.')}</h2><p>{view.stale?t('The last account snapshot is retained. Refresh to check the current state.','آخرین اطلاعات حساب حفظ شده است. برای بررسی وضعیت فعلی، به‌روزرسانی کنید.'):t('Connect, review your funds, then manage your membership. Each transaction stays under your control.','متصل شوید، موجودی را بررسی کنید و عضویت را مدیریت کنید. هر تراکنش با تأیید خود شما انجام می‌شود.')}</p></div><ol>{[[connected,t('Connect wallet','اتصال ولت')],[view.usdBalance!=null&&BigInt(view.usdBalance)>0n,t('Review collateral','بررسی موجودی پشتوانه')],[registered,t('Membership registered','عضویت ثبت‌شده')]].map(([done,label],i)=><li key={i} data-done={done?'true':'false'}><span aria-hidden="true">{done?'✓':String(i+1).padStart(2,'0')}</span><b>{label}</b></li>)}</ol><button className="secondary" type="button" disabled={view.busy} onClick={()=>refreshNeeded?action('refresh-state'):!connected?action('connect'):jump('network')}>{refreshNeeded?t('Refresh account','به‌روزرسانی حساب'):!connected?t('Connect wallet','اتصال ولت'):t('Open membership','ورود به عضویت')}<Arrow/></button></article>;
}

export function MemberHelp(){
 const view=useMemberView();const [draft,setDraft]=useState(null);
 useEffect(()=>setDraft(null),[view.address]);
 const email=typeof social.email==='string'&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(social.email)?social.email:null;
 const prepare=event=>{event.preventDefault();const data=new FormData(event.currentTarget);const subject=String(data.get('topic'));const body=['FTI support request','Page: '+location.origin+location.pathname,'Network: '+(view.network?.label||'Unavailable'),'Wallet: '+(view.address||'Not connected'),'Transaction hash: '+(data.get('hash')||'Not provided'),'','Description:',String(data.get('description'))].join('\n');setDraft('mailto:'+email+'?subject='+encodeURIComponent('FTI Support — '+subject)+'&body='+encodeURIComponent(body));};
 const faq=[
 [t('How do I get started?','چگونه شروع کنم؟'),t('Connect your wallet on the configured network. Check your collateral and BNB for network fees, then open Membership to review the inviter and purchase units.','ولت خود را به شبکهٔ تنظیم‌شده متصل کنید. موجودی پشتوانه و BNB برای کارمزد را بررسی کنید؛ سپس در بخش عضویت، معرف و تعداد یونیت را بررسی کنید.')],
 [t('Why can a purchase need more than one confirmation?','چرا خرید گاهی بیش از یک تأیید می‌خواهد؟'),t('A spending approval and a membership purchase are separate transactions. Follow the current prompt and review each request in your wallet.','مجوز مصرف دارایی و خرید عضویت، تراکنش‌های جداگانه‌اند. پیام فعلی را دنبال و هر درخواست را در ولت بررسی کنید.')],
 [t('What should I do with a pending request?','با درخواست در انتظار چه کنم؟'),t('Use the previous-request check shown in the panel. A transaction hash identifies a request; its confirmed receipt determines the outcome.','از گزینهٔ بررسی درخواست قبلی در پنل استفاده کنید. هش، شناسهٔ درخواست است و نتیجه با رسید تأییدشده مشخص می‌شود.')],
 [t('Are branch volumes the same as rewards?','آیا حجم شاخه همان پاداش است؟'),t('No. Branch volume counts membership units. Eligible points, current protection, funded pools and settlement determine reward allocation.','خیر. حجم شاخه تعداد یونیت است. پوینت واجد شرایط، حفاظت فعلی، منابع صندوق و تسویه، تخصیص پاداش را تعیین می‌کنند.')]
 ];
 return <section id="support" className="page member-help" hidden><div className="member-section-heading"><span className="member-kicker">{t('HELP & RESOURCES','راهنما و منابع')}</span><h2>{t('A clear path forward.','مسیر بعدی، روشن است.')}</h2><p>{t('Practical guidance for your account, wallet and transactions.','راهنمای کاربردی حساب، ولت و تراکنش‌های شما.')}</p></div><div className="member-resource-grid">{[
 ['https://t.me/FTIProtocol_Official/29','05:05',t('Watch the user guide','تماشای راهنمای کاربران'),t('Membership, token and governance explained.','آشنایی با عضویت، توکن و حاکمیت.')],
 [links.whitepaper,'01',t('Read the whitepaper','مطالعهٔ وایت‌پیپر'),t('Understand the protocol and its rules.','آشنایی با پروتکل و قوانین آن.')],
 ['https://t.me/FTIProtocol_Official','FTI',t('Official announcements','اطلاعیه‌های رسمی'),t('Follow published platform updates.','پیگیری خبرها و به‌روزرسانی‌های منتشرشده.')]
 ].map(([href,tag,title,description])=><a href={href} key={href} target="_blank" rel="noopener noreferrer"><span>{tag}</span><h3>{title}</h3><p>{description}</p><Arrow/></a>)}</div><article id="member-support-panel" className="panel member-support-tickets" hidden><div id="member-support-tickets"/></article><div className="split"><article className="panel member-faq"><h2>{t('Frequently asked questions','پرسش‌های متداول')}</h2>{faq.map(([q,a])=><details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>)}</article><article className="panel member-support-form"><span className="member-kicker">{t('CONTACT THE TEAM','ارتباط با تیم')}</span><h2>{t('Prepare a support report.','گزارش پشتیبانی آماده کنید.')}</h2><p>{t('Create an email draft with the details needed to review your issue.','پیش‌نویس ایمیل را با اطلاعات لازم برای بررسی مشکل آماده کنید.')}</p>{email&&<form onSubmit={prepare}><label>{t('Topic','موضوع')}<select name="topic"><option value="Wallet connection">{t('Wallet connection','اتصال ولت')}</option><option value="Membership and referral">{t('Membership and referral','عضویت و معرف')}</option><option value="Rewards and auto-buy">{t('Rewards and auto-buy','پاداش و خرید خودکار')}</option><option value="Token transaction">{t('Token transaction','تراکنش توکن')}</option><option value="Other">{t('Other','سایر')}</option></select></label><label>{t('Transaction hash · optional','هش تراکنش · اختیاری')}<input name="hash" dir="ltr" pattern="0x[0-9a-fA-F]{64}" maxLength={66} placeholder="0x…"/></label><label>{t('What happened?','چه اتفاقی افتاد؟')}<textarea name="description" required minLength={15} maxLength={2000} rows={4} placeholder={t('Describe the action and exact message you saw.','اقدام انجام‌شده و متن دقیق پیامی را که دیدید بنویسید.')}/></label><button type="submit">{t('Prepare email draft','آماده‌سازی پیش‌نویس ایمیل')}<Arrow/></button></form>}{draft&&<p className="member-email-draft" role="status"><a href={draft}>{t('Open your email application','باز کردن برنامهٔ ایمیل')}<Arrow/></a><small>{t('Review and send the draft in your email application.','پیش‌نویس را در برنامهٔ ایمیل بررسی و ارسال کنید.')}</small></p>}<small className="member-safety-note">{t('Keep your recovery phrase and private key private. Support never needs them.','عبارت بازیابی و کلید خصوصی را محرمانه نگه دارید؛ پشتیبانی به آن‌ها نیاز ندارد.')}</small></article></div></section>;
}
