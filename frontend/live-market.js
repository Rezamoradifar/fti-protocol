import {deploymentNetwork} from '../core/deployment-network.mjs';
import {formatEther} from '/vendor/ethers.js';
import {t,displayNumber,displayUTC} from './locale.js';
import {mergeObservations,observedSeries,priceChartSeries,curveGeometry,readObservation,historicalObservations,readOpeningQuote,tradeHistory} from './spot-history.js';
export function initLiveMarket(token,rpc,cfg){
 const network=deploymentNetwork(cfg),currency=network.currency;
 const hosts=[...document.querySelectorAll('[data-live-market]')];if(!hosts.length)return;
 const make=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e;};
 const svg=(tag,attributes={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attributes))n.setAttribute(k,String(v));return n;};
 const number=v=>displayNumber(v,{maximumSignificantDigits:8});
 const percent=v=>v===null||!Number.isFinite(v)?'—':(v>0?'+':'')+displayNumber(v,{maximumFractionDigits:4})+'%';
 const path=points=>points.map(([x,y],i)=>`${i?'L':'M'}${x} ${y}`).join(' ');
 const widgets=hosts.map((host,i)=>{
  host.className='live-market';
  const head=make('div',undefined,'market-heading');head.append(make('span','FTI / '+currency,'market-pair'),make('span',network.label,'market-chain'));
  const price=make('strong','—','market-price'),change=make('span','—','market-change'),growth=make('strong','—','market-growth');
  const summary=make('div',undefined,'market-summary');
  for(const[label,element]of [['Observed contract price',price],['Price vs cycle opening quote',growth],['Chart-window change',change]]){
   const box=make('div',undefined,'market-change-box');box.append(make('span',t(label),'market-change-label'),element);summary.append(box);
  }
  const indicator=make('p',t('Connecting to live prices…'),'market-live');indicator.setAttribute('role','status');
  const toolbar=make('div',undefined,'candle-toolbar'),readout=make('p','—','candle-readout');readout.id='price-readout-'+i;
  const chart=svg('svg',{viewBox:'0 0 780 300',class:'market-chart',role:'img',tabindex:0,'aria-label':t('Observed price curve'),'aria-describedby':readout.id});
  // These ordinary text labels remain visible on small screens, even with an
  // older installed stylesheet that hides SVG text at mobile widths.
  const axes=make('div',undefined,'market-axis-labels'),axisValues={};
  for(const[key,label,fa]of [['price','Price range · '+currency,'بازه قیمت · '+currency],['from','From · UTC','از · UTC'],['to','To · UTC','تا · UTC']]){
   const item=make('div');axisValues[key]=make('strong','—');item.append(make('span',t(label,fa)),axisValues[key]);axes.append(item);
  }
  const openingNote=make('p','', 'market-opening-quote');openingNote.hidden=true;
  const note=make('p',t('Lines connect verified price samples. The dashed opening quote is a reference, not a trade or a price observation before supply existed. Prices between samples are not shown.','خط‌ها نمونه‌های تأییدشده قیمت را به هم وصل می‌کنند. نرخ آغازین خط‌چین یک مرجع است؛ معامله یا قیمت پیش از ایجاد عرضه نیست. قیمت بین نمونه‌ها نمایش داده نمی‌شود.'),'market-note');
  let data=[],openingQuote=null,windowSeconds=0,selected=null;
  const controls=[];
  for(const[seconds,label]of [[0,'All observations'],[60,'One minute'],[300,'Five minutes'],[900,'Fifteen minutes']]){
   const b=make('button',t(label),'secondary');b.type='button';b.setAttribute('aria-pressed',String(seconds===windowSeconds));b.onclick=()=>{windowSeconds=seconds;selected=null;controls.forEach(([s,e])=>e.setAttribute('aria-pressed',String(s===seconds)));draw();};controls.push([seconds,b]);toolbar.append(b);
  }
  const earlier=make('button',t('Load earlier prices','دریافت قیمت‌های قدیمی‌تر'),'secondary');earlier.type='button';earlier.onclick=()=>{if(!openingQuote&&observations.length){quoteAttemptedCycle=null;quoteAttempts=0;quoteRetryAfter=0;void loadOpening(observations.at(-1));}void loadSamples(true);};toolbar.append(earlier);
  const priceHistory=make('details',undefined,'market-price-history'),priceTableWrap=make('div',undefined,'market-price-table-wrap'),priceTable=make('table',undefined,'market-price-table');
  const thead=make('thead'),header=make('tr'),tbody=make('tbody');
  for(const[label,fa]of [['Type','نوع'],['Price · '+currency,'قیمت · '+currency],['Date and time · UTC','تاریخ و ساعت · UTC']]){const th=make('th',t(label,fa));th.scope='col';header.append(th);}
  thead.append(header);priceTable.append(thead,tbody);priceTableWrap.append(priceTable);priceHistory.append(make('summary',t('Price observations','نمونه‌های قیمت')),priceTableWrap);
  const series=()=>priceChartSeries(data,windowSeconds,openingQuote);
  function draw(){
   const plotted=series(),geometry=curveGeometry(plotted),observed=observedSeries(data,windowSeconds);chart.replaceChildren();tbody.replaceChildren();
   const observedChange=curveGeometry(observed)?.change??null;change.textContent=percent(observedChange);change.classList.toggle('negative',observedChange<0);
   if(!geometry){readout.textContent=t(data.length&&BigInt(data.at(-1).supplyWei)===0n?'No price exists while token supply is zero.':'Waiting for observed prices');for(const value of Object.values(axisValues))value.textContent='—';return;}
   axisValues.price.textContent=number(Math.min(...plotted.map(p=>p.price)))+' – '+number(Math.max(...plotted.map(p=>p.price)))+' '+currency;
   axisValues.from.textContent=displayUTC(plotted[0].time);axisValues.to.textContent=displayUTC(plotted.at(-1).time);
   for(let j=0;j<5;j++){
    const y=25+j*210/4;chart.append(svg('line',{x1:54,x2:684,y1:y,y2:y,class:'price-grid'}));
    const label=svg('text',{x:692,y:y+4});label.textContent=number(geometry.max-j*(geometry.max-geometry.min)/4);chart.append(label);
   }
   const hasOpening=plotted[0].kind==='opening-quote',start=hasOpening?1:0;
   if(hasOpening){
    chart.append(svg('path',{d:path(geometry.xy.slice(0,2)),class:'price-line price-opening-reference','stroke-dasharray':'6 5','stroke-opacity':'.7'}));
    chart.append(svg('circle',{cx:geometry.xy[0][0],cy:geometry.xy[0][1],r:5,class:'price-dot price-opening-dot'}));
   }
   if(plotted.length-start>1)chart.append(svg('path',{d:path(geometry.xy.slice(start)),class:'price-line'}));
   const at=selected===null?plotted.length-1:Math.max(0,Math.min(plotted.length-1,selected));
   const [x,y]=geometry.xy[at],sample=plotted[at];
   chart.append(svg('line',{x1:x,x2:x,y1:25,y2:235,class:'price-cursor'}),svg('circle',{cx:x,cy:y,r:4,class:'price-dot'}));
   for(const[index,xpos,anchor]of [[0,54,'start'],[plotted.length-1,684,'end']]){
    const label=svg('text',{x:xpos,y:270,'text-anchor':anchor});label.textContent=displayUTC(plotted[index].time);chart.append(label);
   }
   const kind=sample.kind==='opening-quote'?t('Initial contract quote','نرخ آغازین قرارداد'):t('Observed contract price');
   readout.textContent=kind+': '+number(sample.price)+' '+currency+' · '+displayUTC(sample.time)+' · '+t('Block')+' '+sample.block+' · '+t('Observations')+': '+observed.length;
   // Exact selected endpoints are readable without hover, and accessible in a
   // native table on mobile. A reference row is always clearly identified.
   const rows=plotted.length<=8?plotted:[plotted[0],...plotted.slice(-7)];
   for(const row of rows){const tr=make('tr');tr.append(make('td',row.kind==='opening-quote'?t('Opening reference','مرجع آغازین'):t('Observed','مشاهده‌شده')),make('td',number(row.price)+' '+currency),make('td',displayUTC(row.time)));tbody.append(tr);}
  }
  const select=event=>{
   const g=curveGeometry(series());if(!g)return;const box=chart.getBoundingClientRect();if(!box.width)return;
   const x=(event.clientX-box.left)/box.width*780;selected=g.xy.reduce((best,p,index)=>Math.abs(p[0]-x)<Math.abs(g.xy[best][0]-x)?index:best,0);draw();
  };
  chart.addEventListener('pointermove',select);chart.addEventListener('pointerdown',select);
  chart.addEventListener('pointerleave',event=>{if(event.pointerType==='touch')return;selected=null;draw();});
  chart.addEventListener('keydown',event=>{
   const length=series().length;if(!length||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
   selected=event.key==='Home'?0:event.key==='End'?length-1:Math.max(0,Math.min(length-1,(selected??length-1)+(event.key==='ArrowLeft'?-1:1)));draw();
  });
  const metrics=make('div',undefined,'market-metrics'),values={};
  for(const[key,label]of [['reserve','Reserve · '+currency],['support','Support · '+currency],['supply','Supply · FTI']]){
   const item=make('div');values[key]=make('strong','—');item.append(make('span',t(label)),values[key]);metrics.append(item);
  }
  const historyNote=make('p','', 'market-note'),volume=make('p','—','market-volume'),tradeList=make('div',undefined,'market-trades');
  host.append(head,summary,indicator,openingNote,toolbar,readout,chart,axes,priceHistory,metrics,historyNote,volume,tradeList,note);
  return {price,growth,indicator,values,earlier,render(samples,quote){data=samples;openingQuote=quote?.cycle===samples.at(-1)?.cycle?quote:null;openingNote.hidden=!openingQuote;
   if(openingQuote)openingNote.textContent=t('Initial contract quote','نرخ آغازین قرارداد')+': '+number(Number(formatEther(openingQuote.priceWei)))+' '+currency+' · '+displayUTC(openingQuote.time)+' · '+t('Dashed reference; not an executed trade.','مرجع خط‌چین؛ معامله انجام‌شده نیست.');draw();},historyNote,
   history(payload){const verified=tradeHistory(payload);volume.textContent=t('Executed volume · recent blocks')+': '+number(Number(formatEther(verified.volumeWei)))+' '+currency+' · '+payload.fromBlock+'–'+payload.toBlock;
    tradeList.replaceChildren(make('h3',t('Recent trades')));
    for(const r of verified.rows.slice(-8).reverse()){
     const row=make('div',undefined,'market-trade-row '+(r.event==='Bought'?'buy':'sell'));
     row.append(make('span',t(r.event==='Bought'?'Buy':'Sell')),make('span',number(Number(formatEther(r.usd)))+' '+currency),make('span',displayUTC(r.time)));tradeList.append(row);
    }
   },historyError(){volume.textContent=t('Volume unavailable · RPC history could not be loaded');tradeList.replaceChildren();}
  };
 });
 let observations=[],openingQuote=null,fetching=false,historyFlight=false,samplesFlight=false,historyAttempted=false,quoteFlight=false,quoteAttemptedCycle=null,quoteAttempts=0,quoteRetryAfter=0,stopped=false;
 const hidden=()=>document.hidden||hosts.every(h=>h.closest('section')?.hidden);
 const render=()=>widgets.forEach(w=>w.render(observations,openingQuote));
 async function loadSamples(full=false){
  if(samplesFlight||stopped)return;samplesFlight=true;widgets.forEach(w=>{w.earlier.disabled=true;w.historyNote.textContent=t('Reading verified historical price samples…','در حال دریافت نمونه‌های تأییدشده قیمت گذشته…');});
  try{const samples=await historicalObservations(token,rpc,cfg,full?{count:24,lookback:'deployment'}:{});if(stopped)return;
   // Do not replace a newer observation with a slower historical response.
   let newer=observations.filter(r=>r.block>samples.at(-1).block);
   if(newer.length&&(await rpc.getBlock(newer.at(-1).block))?.hash!==newer.at(-1).hash)newer=[];
   observations=mergeObservations(samples,newer);render();
   widgets.forEach(w=>w.historyNote.textContent=full?t('Earlier prices loaded as sparse verified samples; gaps are not recorded price history.','قیمت‌های گذشته به‌صورت نمونه‌های پراکنده و تأییدشده دریافت شد؛ فاصله میان نمونه‌ها تاریخچه ثبت‌شده نیست.'):t('Recent verified price samples. Load earlier prices to include older available blocks.','نمونه‌های تأییدشده اخیر. برای مشاهده بلاک‌های قدیمی‌تر، دریافت قیمت‌های قدیمی‌تر را بزنید.'));
  }catch{if(!stopped)widgets.forEach(w=>w.historyNote.textContent=t('Historical samples unavailable. Verified prices and the opening reference are retained.','نمونه‌های تاریخی در دسترس نیست. قیمت‌های تأییدشده و مرجع آغازین حفظ شده‌اند.'));}
  finally{samplesFlight=false;if(!stopped)widgets.forEach(w=>w.earlier.disabled=false);}
 }
 async function loadOpening(sample){
  if(quoteFlight||quoteAttemptedCycle===sample.cycle||quoteAttempts>=3||Date.now()<quoteRetryAfter||stopped)return;quoteAttempts++;quoteRetryAfter=Date.now()+30000;quoteFlight=true;
  try{const quote=await readOpeningQuote(token,rpc,cfg,sample);if(!stopped&&observations.at(-1)?.cycle===sample.cycle){openingQuote=quote;quoteAttemptedCycle=sample.cycle;render();}}
  catch{/* Missing receipt/history never becomes an invented opening point. */}
  finally{quoteFlight=false;}
 }
 async function update(){
  if(fetching||stopped||hidden())return;fetching=true;
  try{
   if(String((await rpc.getNetwork()).chainId)!==String(cfg.chainId))throw Error('Wrong price network');
   const block=await rpc.getBlock('latest'),sample=await readObservation(token,rpc,block),at={blockTag:block.number};
   const [reserve,support,startPrice]=await Promise.all([token.reserve(at),token.supportReserve(at),token.cycleStartPrice(at)]);
   if((await rpc.getBlock(block.number))?.hash!==block.hash)throw Error('Price block changed');if(stopped)return;
   if(observations.at(-1)?.block>sample.block)observations=observations.filter(r=>r.block<=sample.block);
   observations=mergeObservations(observations,[sample]);
   if(openingQuote?.cycle!==sample.cycle)openingQuote=null;
   const price=Number(formatEther(sample.priceWei)),base=Number(formatEther(startPrice)),hasPrice=BigInt(sample.supplyWei)>0n;
   const delta=hasPrice&&base>0?(price/base-1)*100:null;
   for(const w of widgets){
    w.price.textContent=hasPrice?number(price)+' '+currency:'—';w.growth.textContent=percent(delta);w.growth.classList.toggle('negative',delta!==null&&delta<0);
    const delayed=Date.now()/1000-block.timestamp>45;w.indicator.textContent=t(delayed?'Delayed chain data':'Live')+' · '+displayUTC(block.timestamp)+' · '+t('Block')+' '+block.number;w.indicator.classList.toggle('stale',delayed);
    for(const[key,raw]of Object.entries({reserve,support,supply:sample.supplyWei}))w.values[key].textContent=number(Number(formatEther(raw)));
   }
   render();void loadOpening(sample);
   if(!historyAttempted){historyAttempted=true;void loadSamples();}
  }catch{if(!stopped)widgets.forEach(w=>{w.indicator.textContent=t('Price feed unavailable · last observed data retained');w.indicator.classList.add('stale');});}
  finally{fetching=false;}
 }
 async function history(){
  if(historyFlight||stopped||hidden())return;historyFlight=true;
  try{const response=await fetch('/api/market',{signal:AbortSignal.timeout(20000),cache:'no-store'});if(!response.ok)throw Error('Unavailable history');const payload=await response.json();tradeHistory(payload);if(!stopped)widgets.forEach(w=>w.history(payload));}
  catch{if(!stopped)widgets.forEach(w=>w.historyError());}finally{historyFlight=false;}
 }
 const wake=()=>{void update();void history();};
 const poll=setInterval(update,10000),tradePoll=setInterval(history,30000);
 document.addEventListener('visibilitychange',wake);window.addEventListener('hashchange',wake);wake();
 const stop=()=>{stopped=true;clearInterval(poll);clearInterval(tradePoll);document.removeEventListener('visibilitychange',wake);window.removeEventListener('hashchange',wake);};
 window.addEventListener('pagehide',stop,{once:true});return stop;
}
