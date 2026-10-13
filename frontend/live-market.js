import {deploymentNetwork} from '../core/deployment-network.mjs';
import {formatEther} from '/vendor/ethers.js';
import {t,displayNumber,displayUTC} from './locale.js';
import {mergeObservations,observedSeries,curveGeometry,readObservation,historicalObservations,tradeHistory} from './spot-history.js';
export function initLiveMarket(token,rpc,cfg){
 const network=deploymentNetwork(cfg),currency=network.currency;

 const hosts=[...document.querySelectorAll('[data-live-market]')];if(!hosts.length)return;
 const make=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e;};
 const svg=(tag,attributes={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attributes))n.setAttribute(k,String(v));return n;};
 const number=v=>displayNumber(v,{maximumSignificantDigits:8});
 const percent=v=>v===null||!Number.isFinite(v)?'—':(v>0?'+':'')+displayNumber(v,{maximumFractionDigits:4})+'%';
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
  const note=make('p',t('The curve connects observed contract prices, not trade execution prices or a forecast. Only the displayed observations are covered.'),'market-note');
  let data=[],windowSeconds=0,selected=null;
  const controls=[];
  for(const[seconds,label]of [[0,'All observations'],[60,'One minute'],[300,'Five minutes'],[900,'Fifteen minutes']]){
   const b=make('button',t(label),'secondary');b.type='button';b.setAttribute('aria-pressed',String(seconds===windowSeconds));b.onclick=()=>{windowSeconds=seconds;selected=null;controls.forEach(([s,e])=>e.setAttribute('aria-pressed',String(s===seconds)));draw();};controls.push([seconds,b]);toolbar.append(b);
  }
  function draw(){
   const series=observedSeries(data,windowSeconds),geometry=curveGeometry(series);chart.replaceChildren();
   change.textContent=percent(geometry?.change??null);change.classList.toggle('negative',geometry?.change<0);
   if(!geometry){readout.textContent=t(data.length&&BigInt(data.at(-1).supplyWei)===0n?'No price exists while token supply is zero.':'Waiting for observed prices');return;}
   for(let j=0;j<5;j++){
    const y=25+j*210/4;chart.append(svg('line',{x1:54,x2:704,y1:y,y2:y,class:'price-grid'}));
    const label=svg('text',{x:712,y:y+4});label.textContent=number(geometry.max-j*(geometry.max-geometry.min)/4);chart.append(label);
   }
   if(series.length>1)chart.append(svg('path',{d:geometry.path,class:'price-line'}));
   const at=selected===null?series.length-1:Math.max(0,Math.min(series.length-1,selected));
   const [x,y]=geometry.xy[at],sample=series[at];
   chart.append(svg('line',{x1:x,x2:x,y1:25,y2:235,class:'price-cursor'}),svg('circle',{cx:x,cy:y,r:4,class:'price-dot'}));
   for(const[index,xpos,anchor]of [[0,54,'start'],[series.length-1,704,'end']]){
    const label=svg('text',{x:xpos,y:270,'text-anchor':anchor});label.textContent=displayUTC(series[index].time);chart.append(label);
   }
   readout.textContent=t('Price')+': '+number(sample.price)+' '+currency+' · '+displayUTC(sample.time)+' · '+t('Block')+' '+sample.block+' · '+t('Observations')+': '+series.length;
  }
  chart.addEventListener('pointermove',event=>{
   const series=observedSeries(data,windowSeconds),g=curveGeometry(series);if(!g)return;
   const box=chart.getBoundingClientRect();if(!box.width)return;const x=(event.clientX-box.left)/box.width*780;
   selected=g.xy.reduce((best,p,index)=>Math.abs(p[0]-x)<Math.abs(g.xy[best][0]-x)?index:best,0);draw();
  });
  chart.addEventListener('pointerleave',()=>{selected=null;draw();});
  chart.addEventListener('keydown',event=>{
   const length=observedSeries(data,windowSeconds).length;if(!length)return;
   if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
   selected=event.key==='Home'?0:event.key==='End'?length-1:Math.max(0,Math.min(length-1,(selected??length-1)+(event.key==='ArrowLeft'?-1:1)));draw();
  });
  const metrics=make('div',undefined,'market-metrics'),values={};
  for(const[key,label]of [['reserve','Reserve · '+currency],['support','Support · '+currency],['supply','Supply · FTI']]){
   const item=make('div');values[key]=make('strong','—');item.append(make('span',t(label)),values[key]);metrics.append(item);
  }
  const historyNote=make('p','', 'market-note'),volume=make('p','—','market-volume'),tradeList=make('div',undefined,'market-trades');
  host.append(head,summary,indicator,toolbar,readout,chart,metrics,historyNote,volume,tradeList,note);
  return {price,growth,indicator,values,render(samples){data=samples;draw();},historyNote,
   history(payload){const verified=tradeHistory(payload);volume.textContent=t('Executed volume · recent blocks')+': '+number(Number(formatEther(verified.volumeWei)))+' '+currency+' · '+payload.fromBlock+'–'+payload.toBlock;
    tradeList.replaceChildren(make('h3',t('Recent trades')));
    for(const r of verified.rows.slice(-8).reverse()){
     const row=make('div',undefined,'market-trade-row '+(r.event==='Bought'?'buy':'sell'));
     row.append(make('span',t(r.event==='Bought'?'Buy':'Sell')),make('span',number(Number(formatEther(r.usd)))+' '+currency),make('span',displayUTC(r.time)));tradeList.append(row);
    }
   },historyError(){volume.textContent=t('Volume unavailable · RPC history could not be loaded');tradeList.replaceChildren();}
  };
 });
 let observations=[],fetching=false,historyFlight=false,historyAttempted=false,stopped=false;
 const hidden=()=>document.hidden||hosts.every(h=>h.closest('section')?.hidden);
 async function loadSamples(){
  try{const samples=await historicalObservations(token,rpc,cfg);if(stopped)return;
   // Do not replace a newer observation with a slower historical response.
   let newer=observations.filter(r=>r.block>samples.at(-1).block);
   if(newer.length&&(await rpc.getBlock(newer.at(-1).block))?.hash!==newer.at(-1).hash)newer=[];
   observations=mergeObservations(samples,newer);
   widgets.forEach(w=>w.render(observations));
  }catch{widgets.forEach(w=>w.historyNote.textContent=t("Historical samples unavailable. Only this session's verified observations are shown."));}
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
   const price=Number(formatEther(sample.priceWei)),base=Number(formatEther(startPrice)),hasPrice=BigInt(sample.supplyWei)>0n;
   const delta=hasPrice&&base>0?(price/base-1)*100:null;
   for(const w of widgets){
    w.price.textContent=hasPrice?number(price)+' '+currency:'—';w.growth.textContent=percent(delta);w.growth.classList.toggle('negative',delta!==null&&delta<0);
    const delayed=Date.now()/1000-block.timestamp>45;w.indicator.textContent=t(delayed?'Delayed chain data':'Live')+' · '+displayUTC(block.timestamp)+' · '+t('Block')+' '+block.number;w.indicator.classList.toggle('stale',delayed);
    for(const[key,raw]of Object.entries({reserve,support,supply:sample.supplyWei}))w.values[key].textContent=number(Number(formatEther(raw)));
    w.render(observations);
   }
   if(!historyAttempted){historyAttempted=true;void loadSamples();}
  }catch{widgets.forEach(w=>{w.indicator.textContent=t('Price feed unavailable · last observed data retained');w.indicator.classList.add('stale');});}
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
