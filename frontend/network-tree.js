import {isAddress,getAddress,ZeroAddress} from '/vendor/ethers.js';
import {t} from './locale.js';
import {memberMetrics,readTreeMember} from './network-data.mjs';
export function initNetworkTree(binary,rpc){
 const host=document.getElementById('network-explorer');if(!host)return;
 let sequence=0,current,parent,history=[];
 const make=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt)e.textContent=txt;if(cls)e.className=cls;return e;};
 const title=make('h2',t('Explore the binary tree','نمایش درخت باینری'));
 const form=make('form'),label=make('label',t('Root wallet address','آدرس ولت ریشه')),input=make('input');input.placeholder='0x…';input.dir='ltr';input.required=true;input.autocomplete='off';input.spellcheck=false;label.append(input);
 const depthLabel=make('label',t('Depth','عمق'),'tree-depth-label'),depthSelect=make('select');for(let n=2;n<=6;n++){const option=make('option',n+' '+t('levels','سطح'));option.value=String(n);depthSelect.append(option);}depthSelect.value='3';depthLabel.append(depthSelect);
 const load=make('button',t('Show tree','نمایش درخت'),'primary');form.append(label,depthLabel,load);
 const actions=make('div',null,'actions'),back=make('button',t('Back','بازگشت'),'secondary'),up=make('button',t('Sponsor','رفتن به معرف'),'secondary'),refresh=make('button',t('Refresh tree','به‌روزرسانی درخت'),'secondary');for(const b of [back,up,refresh])b.type='button';actions.append(back,up,refresh);
 const details=make('div',null,'tree-details');
 const status=make('p');status.setAttribute('role','status');const view=make('div',null,'binary-tree-scroll');
 host.append(title,make('p',t('Select any wallet to explore its children. No wallet connection is required.','روی هر ولت بزنید تا زیرمجموعه‌اش نمایش داده شود. اتصال ولت لازم نیست.')),form,actions,status,details,view);
 back.disabled=true;up.disabled=true;
 async function show(value,push=true){
  const ticket=++sequence;
  if(!isAddress(value)||value.toLowerCase()===ZeroAddress){status.textContent=t('Enter a valid wallet address.','آدرس معتبر ولت وارد کنید.');return;}
  const root=getAddress(value),maxDepth=Number(depthSelect.value);load.disabled=true;status.textContent=t('Reading the tree…','در حال خواندن درخت…');
  try{
   const blockTag=await rpc.getBlockNumber(),context={blockTag,approximate:false},cache=new Map();
   async function node(a,depth,branch){
    const empty=a===ZeroAddress;if(empty){const li=make('li');li.append(make('span',t('Empty position','جایگاه خالی'),'binary-empty'));return li;}
    if(cache.has(a.toLowerCase()))throw Error(t('Invalid repeated tree node','گره تکراری نامعتبر در درخت'));
    const m=await readTreeMember(binary,a,context);cache.set(a.toLowerCase(),m);if(!m.exists)throw Error(t('This wallet is not registered.','این ولت ثبت‌نام نکرده است.'));
    const li=make('li'),b=make('button',null,'binary-node');if(branch)b.append(make('span',branch==='L'?t('Left','چپ'):t('Right','راست'),'binary-side'));b.type='button';b.title=a;b.append(make('strong',a.slice(0,6)+'…'+a.slice(-4)),make('small',t('Units','واحد')+': '+m.units.toString()+' · '+t('Rank','رنک')+': '+m.rank.toString()),make('small',t('Remaining L / R','مانده چپ / راست')+': '+m.carryL+' / '+m.carryR),make('small',t('Lifetime L / R','کل تاریخی چپ / راست')+': '+m.lifetimeL+' / '+m.lifetimeR));b.setAttribute('aria-label',t('Explore wallet','نمایش زیرمجموعه ولت')+' '+a);b.onclick=()=>show(a);li.append(b);
    if(depth<maxDepth-1){const ul=make('ul');ul.append(await node(m.left,depth+1,'L'),await node(m.right,depth+1,'R'));li.append(ul);}return li;
   }
   const tree=make('ul',null,'binary-tree');tree.dir='ltr';tree.append(await node(root,0));if(ticket!==sequence)return;
   if(push&&current&&current!==root)history.push(current);current=root;parent=cache.get(root.toLowerCase()).parent;input.value=root;back.disabled=!history.length;up.disabled=parent===ZeroAddress;view.replaceChildren(tree);
   const metrics=memberMetrics(cache.get(root.toLowerCase()));
   const rankNames=[t('Member','عضو'),t('Builder I','بیلدر ۱'),t('Builder II','بیلدر ۲'),t('Builder III','بیلدر ۳'),t('Builder IV','بیلدر ۴')];
   const dl=make('dl');
   for(const [label,value] of [[t('Root wallet','ولت ریشه'),root],[t('Purchased units','واحدهای خریداری‌شده'),metrics.units],[t('Membership contribution · test USD','مبلغ معادل عضویت · دلار آزمایشی'),metrics.contribution],[t('Rank recorded by contract','رنک ثبت‌شده در قرارداد'),rankNames[metrics.rank]||String(metrics.rank)],[t('Lifetime L / R · units','حجم تاریخی چپ / راست · واحد'),metrics.lifetimeL+' / '+metrics.lifetimeR],[t('Remaining L / R · units','مانده چپ / راست · واحد'),metrics.carryL+' / '+metrics.carryR],[t('Raw remaining matches · not paid points','تعادل خام باقی‌مانده · نه پوینت پرداخت‌شده'),metrics.matchedCarry]]){const row=make('div');row.append(make('dt',label),make('dd',String(value)));dl.append(row);}
   details.replaceChildren(dl,make('p',t('Branch volume counts units, not people or dollars. Unpaid matches remain; payouts also require funding and rank/protection limits. Click a wallet to view its details and children.','حجم شاخه تعداد واحد است، نه تعداد افراد یا دلار. تعادل پرداخت‌نشده حفظ می‌شود؛ پرداخت به پشتوانه مالی و سقف رنک و حفاظت هم وابسته است. با انتخاب هر ولت، جزئیات و فرزندان آن نمایش داده می‌شود.')));
   status.textContent=(context.approximate?t('Current-state reads; snapshot unavailable. Values may span multiple blocks.','خواندن وضعیت جاری؛ اسنپ‌شات در دسترس نبود. اعداد ممکن است از چند بلاک باشند.')+' · ':'')+maxDepth+' '+t('levels','سطح')+' · '+cache.size+' '+t('wallets','ولت')+' · '+t('Starting block','بلاک آغاز خواندن')+': '+blockTag;
  }catch(e){if(ticket===sequence){view.replaceChildren();details.replaceChildren();status.textContent=t('Tree could not be read. Retry; no missing value is displayed as zero.','خواندن درخت انجام نشد. دوباره تلاش کنید؛ داده ناموجود صفر نمایش داده نمی‌شود.')+' '+(e.info?.error?.message||e.reason||e.shortMessage||e.message);}}
  finally{if(ticket===sequence)load.disabled=false;}
 }
 form.onsubmit=e=>{e.preventDefault();show(input.value.trim());};back.onclick=()=>{const a=history.pop();if(a)show(a,false);};up.onclick=()=>{if(parent&&parent!==ZeroAddress)show(parent);};refresh.onclick=()=>show(current||input.value.trim(),false);
 depthSelect.onchange=()=>{if(current)show(current,false);};
 const initial=new URLSearchParams(location.search).get('root');if(initial)show(initial);
}
