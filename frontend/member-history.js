// Personal FTI events are fetched separately from the recent protocol feed.
// Wallet changes clear the entire search; errors retain earlier verified pages.
const ADDRESS=/^0x[0-9a-fA-F]{40}$/,HASH=/^0x[0-9a-fA-F]{64}$/;
const validTime=n=>Number.isSafeInteger(n)&&n>0&&n<=8640000000000;
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const lower=v=>typeof v==='string'?v.toLowerCase():'';
const identity=value=>typeof value==='string'&&ADDRESS.test(value)&&!/^0x0{40}$/i.test(value)?value:null;
const csvCell=value=>{const raw=String(value??'');return '"'+(/^[\s\u0000-\u0020]*[=+\-@]/.test(raw)?"'"+raw:raw).replaceAll('"','""')+'"';};
export function memberHistoryCSV(rows){
 const header=['Block','Log index','UTC time','Contract','Event','Transaction hash','Arguments'];
 return '\ufeff'+[header,...rows.map(row=>[row.block,row.index,new Date(row.timestamp*1000).toISOString(),row.contract,row.name,row.hash,JSON.stringify(row.args)])].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
function pageResult(value,wallet,chainId,snapshot){
 if(!value||value.version!==1||value.scope!=='FTI_CONTRACT_ADDRESS_EVENTS'||lower(value.wallet)!==lower(wallet)||!integer(value.chainId)||value.chainId===0||(chainId!=null&&value.chainId!==chainId)||!integer(value.snapshot?.number)||!HASH.test(value.snapshot?.hash||'')||!integer(value.range?.from)||!integer(value.range?.to)||!integer(value.range?.deployedBlock)||value.range.from<value.range.deployedBlock||value.range.from>value.range.to||value.range.to-value.range.from>999||value.range.to>value.snapshot.number||value.range.complete&&value.range.from!==value.range.deployedBlock||typeof value.range.complete!=='boolean'||!Array.isArray(value.rows)||value.rows.length>50||!(value.nextCursor===null||typeof value.nextCursor==='string'&&value.nextCursor.length>0&&value.nextCursor.length<=1600)||value.range.complete!==(value.nextCursor===null)||(snapshot&&(snapshot.number!==value.snapshot.number||lower(snapshot.hash)!==lower(value.snapshot.hash))))throw Error('Invalid member history response');
 const rows=value.rows.map(row=>{
  if(!row||!['binary','token'].includes(row.contract)||typeof row.name!=='string'||!row.name.trim()||row.name.length>120||!integer(row.block)||row.block<value.range.from||row.block>value.range.to||!integer(row.index)||!validTime(row.timestamp)||!HASH.test(row.hash||'')||!Array.isArray(row.args)||row.args.length>32)throw Error('Invalid member history event');
  const args=row.args.map(arg=>{if(!arg||typeof arg.name!=='string'||arg.name.length>120||!['string','number','boolean'].includes(typeof arg.value)||(typeof arg.value==='number'&&!Number.isSafeInteger(arg.value))||String(arg.value).length>4096)throw Error('Invalid member history argument');return {name:arg.name,value:String(arg.value)};});
  if(!args.some(arg=>ADDRESS.test(arg.value)&&lower(arg.value)===lower(wallet)))throw Error('History event does not belong to the selected wallet');
  return {...row,args};
 });
 for(let i=1;i<rows.length;i++)if(rows[i].block>rows[i-1].block||rows[i].block===rows[i-1].block&&rows[i].index>=rows[i-1].index)throw Error('Unordered member history page');
 return {...value,rows};
}
function explorerOrigin(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'?u.origin:null;}catch{return null;}}
export function createMemberHistory({container,document,getAddress=()=>null,request,translate=(en)=>en,explorer,chainId,download}){
 const t=translate,origin=explorerOrigin(explorer);
 let wallet=null,rows=[],cursor=null,snapshot=null,lastRange=null,loaded=false,busy=false,error=false,controller=null,generation=0,disposed=false;
 const make=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
 const note=make('p',t('Search FTI contract events back to deployment. This covers wallet-address events exposed by the installed FTI contracts, not unrelated assets or internal transfers.','رویدادهای قراردادهای FTI را تا زمان راه‌اندازی جست‌وجو کنید. این بخش، رویدادهای مرتبط با آدرس ولت در قراردادهای نصب‌شدهٔ FTI را پوشش می‌دهد؛ نه دارایی‌های دیگر یا انتقال‌های داخلی.'));
 const tools=make('div',undefined,'member-activity-tools');
 const older=make('button',t('Search wallet history','جست‌وجوی تاریخچهٔ ولت'),'secondary');older.type='button';older.dataset.historyAction='older';
 const restart=make('button',t('Start a new search','شروع جست‌وجوی جدید'),'secondary');restart.type='button';restart.dataset.historyAction='restart';
 const exportButton=make('button',t('Export loaded records · CSV','خروجی سوابق خوانده‌شده · CSV'),'secondary');exportButton.type='button';exportButton.dataset.historyAction='export';
 const clear=make('button',t('Clear displayed records · export first','پاک کردن نمایش سوابق · ابتدا خروجی بگیرید'),'secondary');clear.type='button';clear.dataset.historyAction='clear';
 const cancel=make('button',t('Cancel search','لغو جست‌وجو'),'secondary');cancel.type='button';cancel.dataset.historyAction='cancel';
 tools.append(older,restart,exportButton,clear,cancel);
 const status=make('p',undefined,'member-history-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const results=make('div',undefined,'member-history-results');
 container.replaceChildren(note,tools,status,results);
 const current=()=>{try{return identity(getAddress());}catch{return null;}};
 function syncIdentity(){const next=current();if(lower(next)!==lower(wallet)){generation++;controller?.abort();controller=null;wallet=next;rows=[];cursor=null;snapshot=null;lastRange=null;loaded=false;busy=false;error=false;return true;}return false;}
 function paint(){
  older.disabled=!wallet||busy||loaded&&cursor===null;restart.disabled=!wallet||busy;exportButton.disabled=!rows.length;clear.hidden=rows.length<4950;clear.disabled=busy;cancel.hidden=!busy;
  older.textContent=busy?t('Reading wallet history…','در حال خواندن تاریخچهٔ ولت…'):loaded?t('Load older records','خواندن سوابق قدیمی‌تر'):t('Search wallet history','جست‌وجوی تاریخچهٔ ولت');
  if(!wallet)status.textContent=t('Connect your wallet to search its FTI history.','برای جست‌وجوی تاریخچهٔ FTI، ولت خود را متصل کنید.');
  else if(error)status.textContent=t('This page could not be verified. Earlier records are retained. Retry or start a new search.','این صفحه تأیید نشد. سوابق قبلی حفظ شده‌اند. دوباره تلاش کنید یا جست‌وجوی جدیدی آغاز کنید.');
  else if(busy)status.textContent=t('Checking a bounded block range. You can cancel the search.','در حال بررسی بازه‌ای محدود از بلاک‌ها؛ می‌توانید جست‌وجو را لغو کنید.');
  else if(lastRange)status.textContent=t('Last page checked blocks','بلاک‌های بررسی‌شده در آخرین صفحه')+' '+lastRange.from+'–'+lastRange.to+' · '+t('Loaded events','رویدادهای خوانده‌شده')+': '+rows.length+' · '+(lastRange.complete?t('Search complete to deployment for the installed FTI event definitions.','جست‌وجو تا زمان راه‌اندازی، برای تعریف رویدادهای نصب‌شدهٔ FTI کامل شد.'):t('Older blocks remain. Continue to search them.','بلاک‌های قدیمی‌تر باقی مانده‌اند؛ برای جست‌وجوی آن‌ها ادامه دهید.'));
  else status.textContent=t('Start a search. Each page checks at most 1,000 blocks; an empty page does not mean the wallet has no earlier history.','جست‌وجو را آغاز کنید. هر صفحه حداکثر ۱٬۰۰۰ بلاک را بررسی می‌کند؛ خالی بودن یک صفحه به معنی نداشتن سابقهٔ قدیمی‌تر نیست.');
  const cards=[];
  for(const row of rows){const card=make('article',undefined,'event member-event');const title=make('strong',row.name.replace(/([a-z0-9])([A-Z])/g,'$1 $2'));const meta=make('p',t('Block','بلاک')+' '+row.block,'member-event-meta');const timestamp=make('time',new Date(row.timestamp*1000).toISOString());timestamp.dir='ltr';timestamp.dateTime=new Date(row.timestamp*1000).toISOString();meta.append(make('span',' · '),timestamp);const details=make('details',undefined,'member-event-details');details.append(make('summary',t('Event details','جزئیات رویداد')));const args=make('dl',undefined,'member-event-args');for(const arg of row.args){const line=make('div');const value=make('dd',arg.value);value.dir='ltr';line.append(make('dt',arg.name),value);args.append(line);}details.append(args);card.append(title,meta,details);if(origin){const link=make('a',t('View transaction ↗','مشاهده تراکنش ↗'),'member-event-link');link.href=origin+'/tx/'+row.hash;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}cards.push(card);}
  if(!cards.length&&loaded)cards.push(make('p',t('No matching FTI events in the pages checked so far.','تا این مرحله، رویداد منطبقی از FTI در صفحه‌های بررسی‌شده یافت نشد.')));
  results.replaceChildren(...cards);
 }
 async function load(restartSearch=false){
  if(disposed)return;syncIdentity();if(!wallet||busy||loaded&&cursor===null&&!restartSearch){paint();return;}
  const requestedWallet=wallet,run=++generation,abort=new AbortController();controller=abort;busy=true;error=false;paint();
  try{
   const previousCursor=restartSearch?null:cursor;
   const raw=await request({wallet:requestedWallet,cursor:previousCursor,limit:50,signal:abort.signal});
   if(disposed||abort.signal.aborted||run!==generation||lower(current())!==lower(requestedWallet))return;
   const page=pageResult(raw,requestedWallet,chainId,restartSearch?null:snapshot);
   if(previousCursor&&page.nextCursor===previousCursor)throw Error('History cursor did not advance');
   const prior=restartSearch?[]:rows,seen=new Map(prior.map(row=>[lower(row.hash)+':'+row.index,row]));
   for(const row of page.rows){const key=lower(row.hash)+':'+row.index,old=seen.get(key);if(old&&JSON.stringify(old)!==JSON.stringify(row))throw Error('Conflicting history event');seen.set(key,row);}
   if(seen.size>5000)throw Error('Loaded history limit reached; export then clear displayed records to continue');
   rows=[...seen.values()].sort((a,b)=>b.block-a.block||b.index-a.index);cursor=page.nextCursor;snapshot=page.snapshot;lastRange=page.range;loaded=true;
  }catch(e){if(!abort.signal.aborted&&run===generation&&!disposed&&lower(current())===lower(requestedWallet))error=true;}
  finally{if(run===generation&&!disposed){busy=false;controller=null;syncIdentity();paint();}}
 }
 older.onclick=()=>load();restart.onclick=()=>load(true);clear.onclick=()=>{if(!disposed&&!busy){syncIdentity();rows=[];error=false;paint();}};
 cancel.onclick=()=>{generation++;controller?.abort();controller=null;busy=false;error=false;paint();};
 exportButton.onclick=()=>{
  if(disposed||syncIdentity()){paint();return;}if(!wallet||!rows.length)return;
  const content=memberHistoryCSV(rows),filename='FTI_History_'+wallet.slice(2,10)+'_'+snapshot.number+'.csv';
  if(download){download({filename,content,mime:'text/csv;charset=utf-8'});return;}
  const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));const link=make('a');link.href=url;link.download=filename;link.click();URL.revokeObjectURL(url);
 };
 syncIdentity();paint();
 return {load,refresh(){if(!disposed){syncIdentity();paint();}},cancel(){if(!disposed)cancel.onclick();},destroy(){disposed=true;generation++;controller?.abort();controller=null;rows=[];container.replaceChildren();}};
}
