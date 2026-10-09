import {isAddress,getAddress,ZeroAddress} from '/vendor/ethers.js';
import {t} from './locale.js';
export function initNetworkTree(binary,rpc){
 const host=document.getElementById('network-explorer');if(!host)return;
 let sequence=0,current,parent,history=[];
 const make=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt)e.textContent=txt;if(cls)e.className=cls;return e;};
 const title=make('h2',t('Explore the binary tree','نمایش درخت باینری'));
 const form=make('form'),label=make('label',t('Root wallet address','آدرس ولت ریشه')),input=make('input');input.placeholder='0x…';input.dir='ltr';input.required=true;input.autocomplete='off';input.spellcheck=false;label.append(input);
 const load=make('button',t('Show tree','نمایش درخت'),'primary');form.append(label,load);
 const actions=make('div',null,'actions'),back=make('button',t('Back','بازگشت'),'secondary'),up=make('button',t('Sponsor','رفتن به معرف'),'secondary'),refresh=make('button',t('Refresh tree','به‌روزرسانی درخت'),'secondary');for(const b of [back,up,refresh])b.type='button';actions.append(back,up,refresh);
 const status=make('p');status.setAttribute('role','status');const view=make('div',null,'binary-tree-scroll');
 host.append(title,make('p',t('Select any wallet to explore its children. No wallet connection is required.','روی هر ولت بزنید تا زیرمجموعه‌اش نمایش داده شود. اتصال ولت لازم نیست.')),form,actions,status,view);
 back.disabled=true;up.disabled=true;
 async function show(value,push=true){
  const ticket=++sequence;
  if(!isAddress(value)||value.toLowerCase()===ZeroAddress){status.textContent=t('Enter a valid wallet address.','آدرس معتبر ولت وارد کنید.');return;}
  const root=getAddress(value);load.disabled=true;status.textContent=t('Reading the tree…','در حال خواندن درخت…');
  try{
   const blockTag=await rpc.getBlockNumber(),cache=new Map();
   async function node(a,depth){
    const empty=a===ZeroAddress;if(empty){const li=make('li');li.append(make('span',t('Empty position','جایگاه خالی'),'binary-empty'));return li;}
    if(cache.has(a.toLowerCase()))throw Error(t('Invalid repeated tree node','گره تکراری نامعتبر در درخت'));
    const m=await binary.members(a,{blockTag});cache.set(a.toLowerCase(),m);if(!m.exists)throw Error(t('This wallet is not registered.','این ولت ثبت‌نام نکرده است.'));
    const li=make('li'),b=make('button',null,'binary-node');b.type='button';b.title=a;b.append(make('strong',a.slice(0,6)+'…'+a.slice(-4)),make('small',t('Units','واحد')+': '+m.units.toString()),make('small',t('Rank','رنک')+': '+m.rank.toString()),make('small',t('Left / right volume','حجم چپ / راست')+': '+m.carryL+' / '+m.carryR));b.setAttribute('aria-label',t('Explore wallet','نمایش زیرمجموعه ولت')+' '+a);b.onclick=()=>show(a);li.append(b);
    if(depth<2){const ul=make('ul');ul.append(await node(m.left,depth+1),await node(m.right,depth+1));li.append(ul);}return li;
   }
   const tree=make('ul',null,'binary-tree');tree.dir='ltr';tree.append(await node(root,0));if(ticket!==sequence)return;
   if(push&&current&&current!==root)history.push(current);current=root;parent=cache.get(root.toLowerCase()).parent;input.value=root;back.disabled=!history.length;up.disabled=parent===ZeroAddress;view.replaceChildren(tree);
   status.textContent=t('Root','ریشه')+': '+root+' · '+t('Block','بلاک')+': '+blockTag+' · '+t('Three levels; select a leaf to continue.','سه سطح؛ برای ادامه روی برگ درخت بزنید.');
  }catch(e){if(ticket===sequence)status.textContent=e.reason||e.shortMessage||e.message;}
  finally{if(ticket===sequence)load.disabled=false;}
 }
 form.onsubmit=e=>{e.preventDefault();show(input.value.trim());};back.onclick=()=>{const a=history.pop();if(a)show(a,false);};up.onclick=()=>{if(parent&&parent!==ZeroAddress)show(parent);};refresh.onclick=()=>show(current||input.value.trim(),false);
 const initial=new URLSearchParams(location.search).get('root');if(initial)show(initial);
}
