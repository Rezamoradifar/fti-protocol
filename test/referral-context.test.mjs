import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {REFERRAL_KEY,REFERRAL_TTL,referralFromUrl,referralUrl,loadReferral,saveReferral,installReferralContext} from '../frontend/referral-context.js';
const A='0x'+'1'.repeat(40),B='0x'+'2'.repeat(40),ZERO='0x'+'0'.repeat(40),time=100000000;
function store(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function hub(){const handlers=new Map();return {
 addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn);},
 removeEventListener(type,fn){handlers.get(type)?.delete(fn);},
 emit(type,target){for(const fn of handlers.get(type)||[])fn({type,target});}
};}
function browser(href='https://ftiprotocol.com/app/',storage=store()){
 const doc=Object.assign(hub(),{documentElement:{},field:null,querySelector(){return this.field;}});
 let current=href,mutation=()=>{};
 const win=Object.assign(hub(),{document:doc,sessionStorage:storage,
  history:{state:{keep:'wallet-return'},replaceState(state,_title,url){this.state=state;current=new URL(url,current).href;}},
  MutationObserver:class {constructor(fn){mutation=fn;}observe(){}disconnect(){mutation=()=>{};}}
 });
 Object.defineProperty(win,'location',{get(){const url=new URL(current);return {href:current,origin:url.origin};}});
 return {win,doc,storage,
  install:()=>installReferralContext(win,{now:()=>time}),
  mount(value='',disabled=false){doc.field={value,disabled,validationMessage:'',setCustomValidity(message){this.validationMessage=message;}};mutation();return doc.field;},
  edit(value){doc.field.value=value;doc.emit('input',doc.field);},
  click(href,{download=false,type='click'}={}){let value=href;const anchor={getAttribute:()=>value,setAttribute:(_key,next)=>{value=next;},hasAttribute:key=>key==='download'&&download,closest:()=>anchor};doc.emit(type,anchor);return {anchor,get href(){return value;}};}
 };
}

for(const alias of ['sponsor','referrer','ref'])test(`reads ${alias} and canonicalizes before controller startup`,()=>{
 const b=browser('https://ftiprotocol.com/app/?lang=fa&'+alias+'='+A+'#network');b.install();
 assert.equal(new URL(b.win.location.href).searchParams.get('sponsor'),A);
 assert.equal(new URL(b.win.location.href).searchParams.get('lang'),'fa');
 assert.equal(new URL(b.win.location.href).hash,'#network');
 assert.equal(b.mount().value,A);
});
test('rejects zero, malformed and conflicting explicit invitations',()=>{
 for(const query of ['sponsor='+ZERO,'sponsor=oops','sponsor=','sponsor='+A+'&ref='+B,'sponsor='+A+'&sponsor='+B])
  assert.deepEqual(referralFromUrl('https://ftiprotocol.com/?'+query),{present:true,value:'',valid:false});
 assert.equal(referralFromUrl('https://ftiprotocol.com/?sponsor='+A+'&ref='+A).value,A);
});
test('URL helper preserves other query parameters and route hash',()=>{
 const next=new URL(referralUrl('https://ftiprotocol.com/app/?view=tree&lang=fa&ref='+A+'#network',B));
 assert.equal(next.searchParams.get('view'),'tree');assert.equal(next.searchParams.get('lang'),'fa');
 assert.equal(next.searchParams.get('ref'),null);assert.equal(next.searchParams.get('sponsor'),B);assert.equal(next.hash,'#network');
});
test('draft record has a bounded lifetime and rejects malformed storage',()=>{
 const s=store();saveReferral(s,A,time);assert.equal(loadReferral(s,time),A);
 assert.equal(loadReferral(s,time+REFERRAL_TTL),null);assert.equal(loadReferral(s,time-1),null);
 s.setItem(REFERRAL_KEY,'bad JSON');assert.equal(loadReferral(s,time),null);
 s.setItem(REFERRAL_KEY,JSON.stringify({version:1,at:time,value:'oops'}));assert.equal(loadReferral(s,time),null);
});
test('manual inviter survives reload and navigation without query parameters',()=>{
 const b=browser();b.install();b.mount();b.edit(A);
 assert.equal(new URL(b.win.location.href).searchParams.get('sponsor'),A);
 const reload=browser('https://ftiprotocol.com/app/#network',b.storage);reload.install();assert.equal(reload.mount().value,A);
});
test('explicit new invitation wins over remembered inviter',()=>{
 const s=store();saveReferral(s,A,time);const b=browser('https://ftiprotocol.com/app/?sponsor='+B,s);b.install();
 assert.equal(b.mount().value,B);assert.equal(loadReferral(s,time),B);
});
test('invalid explicit invitation never falls back to an old inviter',()=>{
 const s=store();saveReferral(s,A,time);const b=browser('https://ftiprotocol.com/app/?ref=invalid',s);b.install();
 assert.equal(b.mount().value,'');assert.equal(loadReferral(s,time),'');
 assert.equal(new URL(b.click('/app/').href).searchParams.get('sponsor'),'');
});
test('remounted form and wallet-return pageshow restore an empty draft field',()=>{
 const b=browser('https://ftiprotocol.com/app/?sponsor='+A);b.install();const first=b.mount();
 const second=b.mount();assert.notEqual(first,second);assert.equal(second.value,A);
 second.value='';b.win.emit('pageshow');assert.equal(second.value,A);
});
test('manual clear does not resurrect a stored or linked inviter',()=>{
 const b=browser('https://ftiprotocol.com/app/?sponsor='+A);b.install();b.mount();b.edit('');
 assert.equal(b.mount().value,'');assert.equal(loadReferral(b.storage,time),'');
 const again=browser(b.win.location.href,b.storage);again.install();assert.equal(again.mount().value,'');
});
test('partial invalid edits are not replaced with the previous address',()=>{
 const b=browser('https://ftiprotocol.com/app/?sponsor='+A);b.install();b.mount();b.edit('0x123');
 b.win.emit('pageshow');assert.equal(b.doc.field.value,'0x123');assert.equal(loadReferral(b.storage,time),'');
});
test('registered disabled fields and nonempty live fields are not overwritten',()=>{
 const b=browser('https://ftiprotocol.com/app/?sponsor='+A);b.install();
 assert.equal(b.mount(B,true).value,B);assert.equal(b.mount('',true).value,'');assert.equal(b.mount(B).value,B);
});
test('internal navigation carries draft and preserves language and fragment',()=>{
 const b=browser('https://ftiprotocol.com/app/?sponsor='+A);b.install();
 const link=new URL(b.click('/token/?lang=fa#trade').href);
 assert.equal(link.searchParams.get('sponsor'),A);assert.equal(link.searchParams.get('lang'),'fa');assert.equal(link.hash,'#trade');
});
test('already decorated links track later manual edits and clears',()=>{
 const b=browser('https://ftiprotocol.com/app/?sponsor='+A);b.install();b.mount();const link=b.click('/app/#network');
 b.edit(B);b.doc.emit('click',link.anchor);assert.equal(new URL(link.href).searchParams.get('sponsor'),B);
 b.edit('');b.doc.emit('click',link.anchor);assert.equal(new URL(link.href).searchParams.get('sponsor'),'');
});
test('destination explicit invitation is never silently replaced',()=>{
 const b=browser('https://ftiprotocol.com/app/?sponsor='+A);b.install();
 for(const suffix of ['?sponsor='+B,'?ref=invalid','?sponsor='])assert.equal(b.click('/app/'+suffix).href,'/app/'+suffix);
});
test('does not leak drafts to third parties, RPC/API, downloads or wallet URI schemes',()=>{
 const b=browser('https://ftiprotocol.com/app/?sponsor='+A);b.install();
 for(const link of ['https://example.com/app/','/api/state','/rpc','/admin/','https://ftiprotocol.com.evil.test/app/','wc:session','mailto:a@example.com'])assert.equal(b.click(link).href,link);
 assert.equal(b.click('/app/',{download:true}).href,'/app/');
});
test('middle-click to another tab also carries the invitation in the URL',()=>{
 const b=browser('https://ftiprotocol.com/app/?sponsor='+A);b.install();assert.equal(new URL(b.click('/app/',{type:'auxclick'}).href).searchParams.get('sponsor'),A);
});
test('denied storage and restricted history do not prevent startup',()=>{
 const b=browser('https://ftiprotocol.com/app/?sponsor='+A);
 Object.defineProperty(b.win,'sessionStorage',{get(){throw Error('denied');}});
 b.win.history.replaceState=()=>{throw Error('restricted');};
 assert.doesNotThrow(()=>b.install());assert.equal(b.mount().value,A);assert.doesNotThrow(()=>b.edit(B));
});
test('failed storage writes cannot resurrect a cleared inviter on reload',()=>{
 const s=store();saveReferral(s,A,time);s.setItem=()=>{throw Error('quota');};
 const b=browser('https://ftiprotocol.com/app/?sponsor='+A,s);b.install();b.mount();b.edit('');
 const reload=browser(b.win.location.href,s);reload.install();assert.equal(reload.mount().value,'');
});
test('preserves unrelated history state and never uses localStorage',()=>{
 const b=browser('https://ftiprotocol.com/app/?ref='+A);Object.defineProperty(b.win,'localStorage',{get(){throw Error('must not access');}});
 b.install();assert.deepEqual(b.win.history.state,{keep:'wallet-return'});
});
test('installation is idempotent and teardown removes all observers and handlers',()=>{
 const b=browser();const first=b.install();assert.equal(b.install(),first);b.mount();first.dispose();b.edit(A);
 assert.equal(new URL(b.win.location.href).searchParams.get('sponsor'),null);assert.notEqual(b.install(),first);
});
test('production build installs draft context before loading the existing workspace',()=>{
 const build=fs.readFileSync(new URL('../scripts/build-web.mjs',import.meta.url),'utf8');
 const entry=fs.readFileSync(new URL('../frontend/workspace-entry.js',import.meta.url),'utf8');
 assert.match(build,/entryPoints:\['frontend\/workspace-entry\.js'\]/);
 assert.ok(entry.indexOf('installReferralContext(window)')<entry.indexOf("await import('./main.jsx')"));
});

test('legacy controller cannot choose the first address from an ambiguous link',()=>{
 for(const query of ['sponsor='+A+'&ref='+B,'sponsor='+A+'&sponsor='+B,'sponsor='+A+'&ref=invalid']){
  const b=browser('https://ftiprotocol.com/app/?'+query);b.install();const field=b.mount();
  const legacy=new URL(b.win.location.href).searchParams.get('sponsor');
  if(legacy&&/^0x[0-9a-fA-F]{40}$/.test(legacy))field.value=legacy;
  assert.equal(field.value,'');assert.ok(field.validationMessage);
  b.edit(B);assert.equal(field.validationMessage,'');assert.equal(new URL(b.win.location.href).searchParams.get('sponsor'),B);
 }
});
test('restricted history cannot silently authorize an ambiguous inviter',()=>{
 const b=browser('https://ftiprotocol.com/app/?sponsor='+A+'&ref='+B);b.win.history.replaceState=()=>{throw Error('restricted');};
 b.install();const field=b.mount();field.value=new URL(b.win.location.href).searchParams.get('sponsor');
 assert.equal(field.value,A);assert.ok(field.validationMessage);
 b.edit(B);assert.equal(field.validationMessage,'');
});
