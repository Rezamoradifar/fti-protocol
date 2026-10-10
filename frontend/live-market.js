import {formatEther} from '/vendor/ethers.js';
import {t,language} from './locale.js';
import {candles} from './candles.js';
export function initLiveMarket(token,rpc,cfg){
 const hosts=[...document.querySelectorAll('[data-live-market]')];if(!hosts.length)return;
 const make=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e;};
  const number=v=>new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(v);
 const widgets=hosts.map((host,i)=>{
  host.className='live-market';const head=make('div',undefined,'market-heading');head.append(make('span','FTI / tUSD','market-pair'),make('span',cfg.chainId===97?'BNB TESTNET':'LOCAL','market-chain'));
  const price=make('strong','—','market-price'),change=make('span','—','market-change'),summary=make('div',undefined,'market-summary');const changeBox=make('div',undefined,'market-change-box');changeBox.append(make('span',t('Chart-window change','تغییر در بازه نمودار'),'market-change-label'),change);const growth=make('strong','—','market-growth'),growthBox=make('div',undefined,'market-change-box');growthBox.append(make('span',t('Growth since cycle start','رشد از آغاز چرخه'),'market-change-label'),growth);summary.append(price,growthBox,changeBox);
  const indicator=make('p',t('Connecting to live prices…','در حال اتصال به قیمت زنده…'),'market-live');indicator.setAttribute('role','status');
  let interval=60,selected=null;
  const toolbar=make('div',undefined,'candle-toolbar'),readout=make('p','—','candle-readout');
  const canvas=make('canvas',undefined,'market-chart');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',t('Observed price candles','کندل قیمت‌های مشاهده‌شده'));canvas.tabIndex=0;
  const controls=[];for(const [seconds,label]of [[60,'1m'],[300,'5m'],[900,'15m']]){const button=make('button',label,'secondary');button.type='button';button.setAttribute('aria-pressed',String(seconds===interval));button.addEventListener('click',()=>{interval=seconds;selected=null;controls.forEach(([n,b])=>b.setAttribute('aria-pressed',String(n===seconds)));draw();});controls.push([seconds,button]);toolbar.append(button);}
  let data=[],tradeData=[];
  const volume=make('p','—','market-volume'),tradeList=make('div',undefined,'market-trades');
  function draw(){
   if(!host.getBoundingClientRect().width)return;
   const rows=candles(tradeData.length?tradeData:data,interval).slice(-80),width=Math.max(240,canvas.clientWidth),height=360,dpr=Math.min(devicePixelRatio||1,2);
   canvas.width=width*dpr;canvas.height=height*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,width,height);
   ctx.font='11px sans-serif';ctx.fillStyle='#a5a5ad';
   if(!rows.length){ctx.fillText(t('Waiting for observed prices','در انتظار قیمت‌های مشاهده‌شده'),20,180);return;}
   const high=Math.max(...rows.map(c=>c.high)),low=Math.min(...rows.map(c=>c.low)),pad=Math.max((high-low)*.12,high*.001,1e-9),left=10,right=width-80,top=24,bottom=260;
   const y=v=>top+(high+pad-v)/(high-low+2*pad)*(bottom-top),step=(right-left)/Math.max(rows.length,24),start=right-step*rows.length;
   ctx.strokeStyle='#202024';ctx.lineWidth=1;
   for(let i=0;i<6;i++){const yy=top+i*(bottom-top)/5;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();ctx.fillText(number(high+pad-i*(high-low+2*pad)/5),right+8,yy+4);}
   rows.forEach((c,index)=>{const x=start+step*(index+.5);ctx.strokeStyle=ctx.fillStyle=c.close>=c.open?'#26d7a0':'#f05b6d';ctx.beginPath();ctx.moveTo(x,y(c.high));ctx.lineTo(x,y(c.low));ctx.stroke();ctx.fillRect(x-Math.max(2,step*.6)/2,Math.min(y(c.open),y(c.close)),Math.max(2,step*.6),Math.max(1,Math.abs(y(c.close)-y(c.open))));});
   const maxVolume=Math.max(...rows.map(c=>c.volume||0),1);
   rows.forEach((c,index)=>{if(c.volume>0){const x=start+step*(index+.5),h=c.volume/maxVolume*44;ctx.fillStyle=c.close>=c.open?'#26d7a080':'#f05b6d80';ctx.fillRect(x-step*.3,324-h,step*.6,h);}});
   const index=selected===null?rows.length-1:Math.max(0,Math.min(rows.length-1,Math.floor((selected-start)/step))),c=rows[index];
   readout.textContent='O '+number(c.open)+'  H '+number(c.high)+'  L '+number(c.low)+'  C '+number(c.close)+(tradeData.length?' · V '+number(c.volume||0)+' tUSD':'')+' · '+new Date(c.time*1000).toLocaleTimeString(language==='fa'?'fa-IR':'en-US');
   if(selected!==null){ctx.strokeStyle='#7e7e87';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(start+step*(index+.5),top);ctx.lineTo(start+step*(index+.5),bottom);ctx.stroke();ctx.setLineDash([]);}
   for(const [c,x]of [[rows[0],left],[rows.at(-1),Math.max(left,right-50)]])ctx.fillText(new Date(c.time*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),x,347);
  }
  canvas.addEventListener('pointermove',e=>{selected=e.clientX-canvas.getBoundingClientRect().left;draw();});canvas.addEventListener('pointerleave',()=>{selected=null;draw();});
  new ResizeObserver(draw).observe(host);
  const metrics=make('div',undefined,'market-metrics');const values={};for(const[key,en,fa]of [['reserve','Reserve · tUSD','ذخیره · tUSD'],['support','Support · tUSD','حمایت · tUSD'],['supply','Supply · FTI','عرضه · FTI']]){const c=make('div');values[key]=make('strong','—');c.append(make('span',t(en,fa)),values[key]);metrics.append(c);}
  host.append(head,summary,indicator,toolbar,readout,canvas,metrics,volume,tradeList,make('p',t('Candles from executed buy/sell prices when trade history is available; otherwise observed spot samples. Recent-block volume, not 24h.','کندل از قیمت اجرای خرید و فروش؛ در نبود تاریخچه، نمونه‌های قیمت قرارداد. حجم مربوط به بلاک‌های اخیر است، نه حجم ۲۴ ساعته.'),'market-note'));
  return {price,change,growth,indicator,values,history(payload){
   const trades=payload.trades||[];tradeData=trades.map(r=>({time:r.time,price:Number(formatEther(BigInt(r.usd)))/Number(formatEther(BigInt(r.tokens))),volume:Number(formatEther(BigInt(r.usd)))})).filter(r=>Number.isFinite(r.price)&&r.price>0);
   const sum=trades.reduce((a,r)=>a+BigInt(r.usd),0n);volume.textContent=t('Executed volume · recent blocks','حجم اجراشده · بلاک‌های اخیر')+': '+number(Number(formatEther(sum)))+' tUSD · '+payload.fromBlock+'–'+payload.toBlock;
   tradeList.replaceChildren(make('h3',t('Recent trades','معاملات اخیر')));
   for(const r of trades.slice(-8).reverse()){const row=make('div',undefined,'market-trade-row '+(r.event==='Bought'?'buy':'sell'));row.append(make('span',r.event==='Bought'?t('Buy','خرید'):t('Sell','فروش')),make('span',number(Number(formatEther(BigInt(r.usd))))+' tUSD'),make('span',new Date(r.time*1000).toLocaleTimeString()));tradeList.append(row);}draw();
  },historyError(){volume.textContent=t('Volume unavailable · RPC history could not be loaded','حجم در دسترس نیست · تاریخچه RPC دریافت نشد');},render(samples){data=samples;draw();}};
 });
 const points=[];let fetching=false,lastBlock=-1,lastCycle;const cacheKey='fti-observed:'+cfg.chainId+':'+cfg.token.toLowerCase();try{const cached=JSON.parse(localStorage.getItem(cacheKey)||'null');if(cached&&Array.isArray(cached.points)){lastCycle=BigInt(cached.cycle);points.push(...cached.points.filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.price)&&p.price>=0&&p.time<=Date.now()/1000&&p.time>Date.now()/1000-172800).slice(-2160));}}catch{}
 for(const w of widgets)w.render(points);
 async function update(){
  if(fetching||document.hidden||hosts.every(h=>h.closest('section')?.hidden))return;fetching=true;
  try{
   const block=await rpc.getBlock('latest');if(!block)throw Error('No block');const blockTag=block.number;
   const [raw,reserve,supply,support,cycle,startPrice]=await Promise.all([token.price({blockTag}),token.reserve({blockTag}),token.totalSupply({blockTag}),token.supportReserve({blockTag}),token.cycle({blockTag}),token.cycleStartPrice({blockTag})]);
   if(lastCycle!==undefined&&cycle!==lastCycle)points.length=0;lastCycle=cycle;
   const price=Number(formatEther(raw));if(blockTag!==lastBlock){points.push({time:block.timestamp,price});if(points.length>2160)points.shift();lastBlock=blockTag;try{localStorage.setItem(cacheKey,JSON.stringify({cycle:String(cycle),points}));}catch{}}
   const change=points[0]?.price?(price/points[0].price-1)*100:null,time=new Date(block.timestamp*1000).toLocaleTimeString(language==='fa'?'fa-IR':'en-US');
   for(const w of widgets){
    const base=Number(formatEther(startPrice)),growth=base>0?(price/base-1)*100:null;const percent=v=>v===null?'—':(v>0?'+':v<0?'−':'')+Math.abs(v).toFixed(4)+'%';w.growth.textContent=percent(growth);w.growth.classList.toggle('negative',growth<0);w.growth.title=t('Cycle start price','قیمت آغاز چرخه')+': '+number(base)+' tUSD';w.price.textContent=number(price)+' tUSD';w.change.textContent=percent(change);w.change.classList.toggle('negative',change<0);
    w.indicator.textContent=t('Live','زنده')+' · '+time+' · '+t('Block','بلاک')+' '+blockTag;w.indicator.classList.toggle('stale',Date.now()/1000-block.timestamp>45);if(Date.now()/1000-block.timestamp>45)w.indicator.textContent=t('Delayed chain data','داده شبکه با تأخیر')+' · '+time;
    w.render(points);
    for(const[key,value]of Object.entries({reserve,supply,support}))w.values[key].textContent=number(Number(formatEther(value)));
   }
  }catch{for(const w of widgets){w.indicator.textContent=t('Price feed unavailable · last observed data retained','ارتباط قیمت قطع شده · آخرین داده حفظ شده');w.indicator.classList.add('stale');}}
  finally{fetching=false;}
 }
 async function history(){try{const response=await fetch('/api/market',{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('History unavailable');const payload=await response.json();if(!Array.isArray(payload.trades)||!Number.isInteger(payload.fromBlock)||!Number.isInteger(payload.toBlock))throw Error('Invalid trade history');for(const w of widgets)w.history(payload);}catch{for(const w of widgets)w.historyError();}}
 history();setInterval(history,30000);update();setInterval(update,5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});window.addEventListener('hashchange',update);
}
