import React,{useEffect,useRef,useState} from 'react';
import {translate} from '../../frontend/locale.js';
import {readHourlyPool} from '../../frontend/hourly-pool-data.js';
import {exactPoolAmount,hourlyPoolView,poolTime} from './hourly-pool-view.mjs';
import './hourly-pool.css';

function useHourlyPool(config){
 const [data,setData]=useState({snapshot:null,loading:false,error:false});
 const refresh=useRef(()=>{});
 useEffect(()=>{
  setData({snapshot:null,loading:!!config,error:false});
  if(!config){refresh.current=()=>{};return;}
  let stopped=false,inFlight=false,again=false,timer,controller;
  const visible=()=>document.visibilityState!=='hidden';
  async function load(){
   clearTimeout(timer);if(stopped||!visible())return;
   if(inFlight){again=true;return;}
   inFlight=true;controller=new AbortController();
   setData(previous=>({...previous,loading:true}));
   try{
    const snapshot=await readHourlyPool(config,{signal:controller.signal,timeoutMs:10000});
    if(!stopped&&!controller.signal.aborted)setData({snapshot,loading:false,error:false});
   }catch{
    if(!stopped&&!controller.signal.aborted)setData(previous=>({...previous,loading:false,error:true}));
   }finally{
    inFlight=false;
    if(!stopped){
     setData(previous=>({...previous,loading:false}));
     if(again&&visible()){again=false;load();}
     else if(visible())timer=setTimeout(load,30000);
    }
   }
  }
  function visibility(){
   clearTimeout(timer);
   if(visible())load();else{again=false;controller?.abort();}
  }
  refresh.current=load;document.addEventListener('visibilitychange',visibility);load();
  return()=>{stopped=true;clearTimeout(timer);controller?.abort();refresh.current=()=>{};document.removeEventListener('visibilitychange',visibility);};
 },[config]);
 return {...data,refresh:()=>refresh.current()};
}

export function HourlyPool({config,lang='en',configLoading=false,configError=false,onRetryConfig}){
 const {snapshot,loading,error,refresh}=useHourlyPool(config);
 const t=(en,fa)=>translate(en,lang,fa),view=hourlyPoolView(snapshot,lang);
 const busy=loading||configLoading,unavailable=error||configError;
 const settled=snapshot?.settled,zone=lang==='fa'?'تهران':'UTC';
 const currentPeriod=snapshot?(view.processing?t('Settling epoch','دورهٔ در حال تسویه'):t('Current epoch','دورهٔ جاری'))+' '+view.epoch:'—';
 const settledPeriod=settled?t('Settled epoch','دورهٔ تسویه‌شده')+' '+view.settledEpoch:t('After hourly settlement','پس از تسویهٔ ساعت');
 const unsettled=t('Available after settlement completes.','پس از پایان تسویه نمایش داده می‌شود.');
 const pointNote=view.noEligiblePoints?t('No eligible points in this settlement.','این تسویه پوینت واجد شرایط نداشته است.'):!settled?unsettled:settledPeriod;
 return <section className="container hourly-pool" id="hourly-pool" aria-labelledby="hourly-pool-heading" aria-busy={busy}>
  <div className="hourly-pool-heading"><div><div className="eyebrow"><span className="hourly-pool-dot"/>{t('ON-CHAIN / HOURLY POOL','دادهٔ شبکه / استخر ساعتی')}</div><h2 id="hourly-pool-heading">{t('The hourly pool, in view.','استخر ساعتی، پیش چشم شما.')}</h2><p>{t('The pool balance includes funds carried from earlier epochs. Points and point value are final after settlement.','موجودی استخر شامل ماندهٔ دوره‌های قبل است. تعداد پوینت‌ها و ارزش هر پوینت پس از تسویه قطعی می‌شوند.')}</p></div><button type="button" className="button hourly-pool-refresh" onClick={config?refresh:onRetryConfig} disabled={busy||(!config&&!onRetryConfig)} aria-label={t('Refresh hourly pool','بروزرسانی استخر ساعتی')}>{busy?t('Updating…','در حال بروزرسانی…'):t('Refresh data','بروزرسانی اطلاعات')}<span aria-hidden="true">↻</span></button></div>
  <div className="hourly-pool-status" role="status" aria-live="polite" data-state={unavailable?'unavailable':snapshot?'ready':'loading'}>
   {configError?t('Network connection failed. Tap Refresh data to retry.','اتصال شبکه برقرار نشد؛ «بروزرسانی اطلاعات» را بزنید.'):error?(snapshot?t('Update unavailable. Showing the last verified snapshot.','بروزرسانی در دسترس نیست؛ آخرین دادهٔ بررسی‌شده نمایش داده می‌شود.'):t('Hourly data is temporarily unavailable. Retry with Refresh data.','دادهٔ ساعتی فعلاً در دسترس نیست؛ «بروزرسانی اطلاعات» را بزنید.')):!snapshot?t('Reading the hourly pool from the network…','در حال دریافت اطلاعات استخر ساعتی از شبکه…'):view.processing?t('Hourly settlement is in progress. Point totals are not final yet.','تسویهٔ ساعت در حال انجام است؛ تعداد و ارزش پوینت‌ها هنوز نهایی نیست.'):t('Verified at block','بررسی‌شده در بلاک')+' '+new Intl.NumberFormat(lang).format(snapshot.block)}
  </div>
  <div className="hourly-pool-grid">
   <article className="hourly-pool-card hourly-pool-current"><span className="hourly-pool-period">{currentPeriod}</span><h3>{t('Hourly pool balance','موجودی استخر ساعتی')}</h3><div className="hourly-pool-value"><strong dir="ltr" title={exactPoolAmount(snapshot?.current?.poolWei)}>{view.pool}</strong><span dir="ltr">USDT</span></div><p>{snapshot?t('Includes prior carry · settlement boundary','شامل ماندهٔ دوره‌های قبل · مرز تسویه')+' · '+poolTime(snapshot.current.end,lang)+' '+zone:t('Waiting for network data.','در انتظار اطلاعات شبکه.')}</p></article>
   <article className="hourly-pool-card"><span className="hourly-pool-period">{settledPeriod}</span><h3>{t('Eligible hourly points','پوینت‌های واجد شرایط ساعت')}</h3><div className="hourly-pool-value"><strong dir="ltr">{view.points}</strong><span>{t('points','پوینت')}</span></div><p>{settled?poolTime(settled.closedAt,lang)+' '+zone:unsettled}</p></article>
   <article className="hourly-pool-card"><span className="hourly-pool-period">{settledPeriod}</span><h3>{t('Value per hourly point','ارزش هر پوینت ساعت')}</h3><div className="hourly-pool-value"><strong dir="ltr" title={exactPoolAmount(settled?.pointValueWei)}>{view.pointValue}</strong><span dir="ltr">USDT / {t('point','پوینت')}</span></div><p>{pointNote}</p></article>
  </div>
  <div className="hourly-pool-footer">{settled?<p>{t('Pool in the last settled hour','استخر آخرین ساعت تسویه‌شده')} <strong dir="ltr">{view.settledPool} USDT</strong><span> · {settledPeriod}</span></p>:<p>{unsettled}</p>}<p>{snapshot?t('Snapshot time','زمان داده')+' · '+poolTime(snapshot.timestamp,lang)+' '+zone:t('No wallet connection required.','بدون نیاز به اتصال ولت.')}</p></div>
 </section>;
}
