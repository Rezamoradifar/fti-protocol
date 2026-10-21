import React,{useEffect,useRef,useState} from 'react';
import {translate} from '../../frontend/locale.js';
import {readTokenPrice} from './token-price-data.mjs';
import {exactPoolAmount,poolAmount,poolInteger,poolTime} from './hourly-pool-view.mjs';
import {tokenPriceAmount,tokenPriceFreshness} from './token-price-view.mjs';
import './token-price.css';

function useTokenPrice(config){
 const [data,setData]=useState({snapshot:null,loading:false,error:false}),refresh=useRef(()=>{});
 useEffect(()=>{
  setData({snapshot:null,loading:!!config,error:false});
  if(!config){refresh.current=()=>{};return;}
  let stopped=false,inFlight=false,again=false,timer,controller;
  const visible=()=>document.visibilityState!=='hidden';
  async function load(){
   clearTimeout(timer);if(stopped||!visible())return;
   if(inFlight){again=true;return;}
   inFlight=true;controller=new AbortController();setData(previous=>({...previous,loading:true}));
   try{const snapshot=await readTokenPrice(config,{signal:controller.signal});if(!stopped&&!controller.signal.aborted)setData({snapshot,loading:false,error:false});}
   catch{if(!stopped&&!controller.signal.aborted)setData(previous=>({...previous,loading:false,error:true}));}
   finally{inFlight=false;if(!stopped){setData(previous=>({...previous,loading:false}));if(again&&visible()){again=false;load();}else if(visible())timer=setTimeout(load,30000);}}
  }
  function visibility(){clearTimeout(timer);if(visible())load();else{again=false;controller?.abort();}}
  refresh.current=load;document.addEventListener('visibilitychange',visibility);load();
  return()=>{stopped=true;clearTimeout(timer);controller?.abort();refresh.current=()=>{};document.removeEventListener('visibilitychange',visibility);};
 },[config]);
 return {...data,refresh:()=>refresh.current()};
}

export function TokenPrice({config,lang='en',className='container',showMetrics=false,configLoading=false,configError=false,onRetryConfig}){
 const {snapshot,loading,error,refresh}=useTokenPrice(config),t=(en,fa)=>translate(en,lang,fa),busy=loading||configLoading;
 const [,redraw]=useState(0);
 useEffect(()=>{
  if(!snapshot)return;
  const update=()=>redraw(value=>value+1),remaining=snapshot.timestamp*1000+45000-Date.now();
  // A successful RPC read can still be an old block. Re-label that snapshot
  // when it ages out, even while the next read is in flight or tab is restored.
  const timer=remaining>=0?setTimeout(update,Math.min(remaining+1,2147483647)):null;
  document.addEventListener('visibilitychange',update);
  return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',update);};
 },[snapshot]);
 const unavailable=error||configError,empty=snapshot&&snapshot.priceWei===null;
 const delayed=tokenPriceFreshness(snapshot?.timestamp)==='delayed';
 const stamp=snapshot?t('Updated','بروزرسانی')+' · '+poolTime(snapshot.timestamp,lang)+' '+(lang==='fa'?'تهران':'UTC')+' · '+t('Block','بلاک')+' '+poolInteger(String(snapshot.block),lang):'';
 const label=snapshot&&(unavailable||delayed)?t('Last verified FTI price','آخرین قیمت بررسی‌شدهٔ FTI'):snapshot?t('Current FTI price','قیمت فعلی FTI'):t('FTI price','قیمت FTI');
 const message=configError?t('Network connection failed. Refresh to retry.','اتصال شبکه برقرار نشد؛ دوباره بروزرسانی کنید.'):
  unavailable?(snapshot?t('Update unavailable · last verified price','بروزرسانی در دسترس نیست · آخرین نرخ بررسی‌شده')+' · '+stamp:t('Price is temporarily unavailable.','قیمت فعلاً در دسترس نیست.')):
  !snapshot?t('Reading the current price…','در حال دریافت قیمت فعلی…'):delayed?t('Price data is delayed · showing the last verified rate.','اطلاعات قیمت با تأخیر است؛ آخرین نرخ بررسی‌شده نمایش داده می‌شود.')+' · '+stamp:empty?t('Price is available after token supply begins.','قیمت پس از آغاز عرضهٔ توکن نمایش داده می‌شود.'):stamp;
 return <section className={className+' token-price-live'} aria-label={label+' · '+t('Contract rate','نرخ قرارداد')} aria-busy={busy}>
  <div className="token-price-main"><div className="token-price-label"><span className="token-price-dot" aria-hidden="true"/><span>{label} <small>{t('Contract rate','نرخ قرارداد')}</small></span></div><div className="token-price-number"><strong dir="ltr" title={exactPoolAmount(snapshot?.priceWei)}>{tokenPriceAmount(snapshot?.priceWei,lang)}</strong><span dir="ltr">USDT / FTI</span></div><button type="button" className="token-price-refresh" onClick={config?refresh:onRetryConfig} disabled={busy||(!config&&!onRetryConfig)} aria-label={t('Refresh FTI price','بروزرسانی قیمت FTI')}>↻</button></div>
  <p className="token-price-status" role="status" aria-live="polite" data-state={unavailable?'unavailable':delayed?'delayed':snapshot?'ready':'loading'}>{message}</p>
  {showMetrics&&<div className="token-price-metrics">{[[t('Pricing reserve','ذخیرهٔ قیمت‌گذاری'),snapshot?.reserveWei,'USDT'],[t('Support reserve','ذخیرهٔ حمایت'),snapshot?.supportWei,'USDT'],[t('Token supply','عرضهٔ توکن'),snapshot?.supplyWei,'FTI']].map(([label,value,unit])=><article key={label}><span>{label}</span><strong dir="ltr" title={exactPoolAmount(value)}>{poolAmount(value,lang)} <small>{unit}</small></strong></article>)}</div>}
 </section>;
}
