import {formatEther} from '/vendor/ethers.js';
import {t,language} from './locale.js';
import {chartGeometry} from './market-series.js';
export function initLiveMarket(token,rpc,cfg){
 const hosts=[...document.querySelectorAll('[data-live-market]')];if(!hosts.length)return;
 const make=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e;};
 const ns='http://www.w3.org/2000/svg',svgEl=(tag,attrs)=>{const e=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
 const number=v=>new Intl.NumberFormat(language==='fa'?'fa-IR':'en-US',{maximumFractionDigits:8}).format(v);
 const widgets=hosts.map((host,i)=>{
  host.className='live-market';const head=make('div',undefined,'market-heading');head.append(make('span','FTI / tUSD','market-pair'),make('span',cfg.chainId===97?'BNB TESTNET':'LOCAL','market-chain'));
  const price=make('strong','—','market-price'),change=make('span','—','market-change'),summary=make('div',undefined,'market-summary');const changeBox=make('div',undefined,'market-change-box');changeBox.append(make('span',t('Chart-window change','تغییر در بازه نمودار'),'market-change-label'),change);const growth=make('strong','—','market-growth'),growthBox=make('div',undefined,'market-change-box');growthBox.append(make('span',t('Growth since cycle start','رشد از آغاز چرخه'),'market-change-label'),growth);summary.append(price,growthBox,changeBox);
  const indicator=make('p',t('Connecting to live prices…','در حال اتصال به قیمت زنده…'),'market-live');indicator.setAttribute('role','status');
  const svg=svgEl('svg',{viewBox:'0 0 800 270',role:'img','aria-label':t('Observed on-chain FTI price','نمودار قیمت مشاهده‌شده FTI روی شبکه'),class:'market-chart'});
  const defs=svgEl('defs',{}),gradient=svgEl('linearGradient',{id:'market-fill-'+i,x1:'0',y1:'0',x2:'0',y2:'1'});gradient.append(svgEl('stop',{offset:'0%','stop-color':'#60ebbd','stop-opacity':'.32'}),svgEl('stop',{offset:'100%','stop-color':'#60ebbd','stop-opacity':'0'}));defs.append(gradient);svg.append(defs);
  for(let y=24;y<=234;y+=42)svg.append(svgEl('line',{x1:54,x2:734,y1:y,y2:y,stroke:'currentColor',opacity:'.12'}));
  const area=svgEl('path',{fill:'url(#market-fill-'+i+')'}),line=svgEl('path',{fill:'none',stroke:'#60ebbd','stroke-width':'2.5'}),dot=svgEl('circle',{r:4,fill:'#dfc68b'}),labels=svgEl('g',{});svg.append(area,line,dot,labels);
  const metrics=make('div',undefined,'market-metrics');const values={};for(const[key,en,fa]of [['reserve','Reserve · tUSD','ذخیره · tUSD'],['support','Support · tUSD','حمایت · tUSD'],['supply','Supply · FTI','عرضه · FTI']]){const c=make('div');values[key]=make('strong','—');c.append(make('span',t(en,fa)),values[key]);metrics.append(c);}
  host.append(head,summary,indicator,svg,metrics,make('p',t('Last 240 observed spot prices · 5-second updates while visible. Change is relative to the displayed window.','آخرین ۲۴۰ قیمت مشاهده‌شده · هر ۵ ثانیه در صفحه فعال · تغییر نسبت به ابتدای نمودار'),'market-note'));
  return {price,change,growth,indicator,line,area,dot,labels,values};
 });
 const points=[];let fetching=false,lastBlock=-1,lastCycle;
 async function update(){
  if(fetching||document.hidden||hosts.every(h=>h.closest('section')?.hidden))return;fetching=true;
  try{
   const block=await rpc.getBlock('latest');if(!block)throw Error('No block');const blockTag=block.number;
   const [raw,reserve,supply,support,cycle,startPrice]=await Promise.all([token.price({blockTag}),token.reserve({blockTag}),token.totalSupply({blockTag}),token.supportReserve({blockTag}),token.cycle({blockTag}),token.cycleStartPrice({blockTag})]);
   if(lastCycle!==undefined&&cycle!==lastCycle)points.length=0;lastCycle=cycle;
   const price=Number(formatEther(raw));if(blockTag!==lastBlock){points.push({time:block.timestamp,price});if(points.length>240)points.shift();lastBlock=blockTag;}
   const geometry=chartGeometry(points),time=new Date(block.timestamp*1000).toLocaleTimeString(language==='fa'?'fa-IR':'en-US');
   for(const w of widgets){
    const base=Number(formatEther(startPrice)),growth=base>0?(price/base-1)*100:null;const percent=v=>v===null?'—':(v>0?'+':v<0?'−':'')+Math.abs(v).toFixed(4)+'%';w.growth.textContent=percent(growth);w.growth.classList.toggle('negative',growth<0);w.growth.title=t('Cycle start price','قیمت آغاز چرخه')+': '+number(base)+' tUSD';w.price.textContent=number(price)+' tUSD';w.change.textContent=percent(geometry.change);w.change.classList.toggle('negative',geometry.change<0);
    w.indicator.textContent=t('Live','زنده')+' · '+time+' · '+t('Block','بلاک')+' '+blockTag;w.indicator.classList.toggle('stale',Date.now()/1000-block.timestamp>45);if(Date.now()/1000-block.timestamp>45)w.indicator.textContent=t('Delayed chain data','داده شبکه با تأخیر')+' · '+time;
    w.line.setAttribute('d',geometry.line);w.area.setAttribute('d',geometry.line+' L '+geometry.xy.at(-1)[0]+' 234 L 54 234 Z');const [x,y]=geometry.xy.at(-1);w.dot.setAttribute('cx',x);w.dot.setAttribute('cy',y);w.labels.replaceChildren();
    for(const[txt,x,y]of [[number(geometry.high),746,32],[number(geometry.low),746,230],[new Date(points[0].time*1000).toLocaleTimeString(),54,258],[time,640,258]]){const label=svgEl('text',{x,y,fill:'currentColor','font-size':'10'});label.textContent=txt;w.labels.append(label);}
    for(const[key,value]of Object.entries({reserve,supply,support}))w.values[key].textContent=number(Number(formatEther(value)));
   }
  }catch{for(const w of widgets){w.indicator.textContent=t('Price feed unavailable · last observed data retained','ارتباط قیمت قطع شده · آخرین داده حفظ شده');w.indicator.classList.add('stale');}}
  finally{fetching=false;}
 }
 update();setInterval(update,5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});window.addEventListener('hashchange',update);
}
