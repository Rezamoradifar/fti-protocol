import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemberHistory,memberHistoryCSV} from '../frontend/member-history.js';
class Node{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this._text='';}
 set textContent(value){this._text=String(value);this.children=[];}
 get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this._text='';this.children=children;}
 setAttribute(name,value){this.attrs[name]=value;}
}
const walk=n=>[n,...n.children.flatMap(walk)],A='0x'+'a1'.repeat(20),B='0x'+'b2'.repeat(20),H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const event=(block=1100,index=1,wallet=A)=>({name:'Registered',contract:'binary',block,index,hash:H(block+index),timestamp:1800000000,args:[{name:'wallet',value:wallet},{name:'units',value:'1'}]});
const page=(rows=[event()],overrides={})=>({version:1,scope:'FTI_CONTRACT_ADDRESS_EVENTS',wallet:A,chainId:56,snapshot:{number:2000,hash:H(2000)},range:{from:1001,to:2000,deployedBlock:1,complete:false},rows,nextCursor:'first-cursor',...overrides});
function fixture(request=async()=>page()){
 let wallet=null;const container=new Node('div'),requests=[],downloads=[];
 const view=createMemberHistory({container,document:{createElement:tag=>new Node(tag)},getAddress:()=>wallet,request:async input=>{requests.push(input);return request(input);},chainId:56,explorer:'https://bscscan.com',translate:en=>en,download:value=>downloads.push(value)});
 const action=name=>walk(container).find(n=>n.dataset.historyAction===name);
 return {view,container,requests,downloads,action,wallet:value=>{wallet=value;view.refresh();},cards:()=>walk(container).filter(n=>n.className==='event member-event')};
}
test('wallet history starts only on an explicit request, and exposes bounded progress and a validated explorer',async()=>{
 const f=fixture();assert.match(f.container.textContent,/Connect your wallet/);assert.equal(f.action('older').disabled,true);
 f.wallet(A);for(let i=0;i<20;i++)f.view.refresh();assert.equal(f.requests.length,0);assert.match(f.container.textContent,/1,000 blocks/);
 await f.view.load();assert.equal(f.requests.length,1);assert.equal(f.requests[0].wallet,A);assert.equal(f.cards().length,1);assert.match(f.container.textContent,/1001–2000/);assert.match(f.container.textContent,/Older blocks remain/);
 const link=walk(f.cards()[0]).find(n=>n.tag==='a');assert.equal(link.href,'https://bscscan.com/tx/'+H(1101));
});
test('older pages append and export only loaded verified records, and a failed page retains earlier rows',async()=>{
 let calls=0;const f=fixture(async input=>{calls++;if(calls===1)return page();if(calls===2){assert.equal(input.cursor,'first-cursor');return page([event(900,0)],{range:{from:1,to:1000,deployedBlock:1,complete:true},nextCursor:null});}throw Error('Unavailable');});
 f.wallet(A);await f.view.load();await f.view.load();assert.equal(f.cards().length,2);assert.match(f.container.textContent,/Search complete to deployment/);assert.equal(f.action('older').disabled,true);
 f.action('export').onclick();assert.equal(f.downloads.length,1);assert.match(f.downloads[0].filename,/FTI_History_a1a1a1a1_2000\.csv/);assert.match(f.downloads[0].content,/Registered/);
 await f.view.load(true);assert.equal(f.cards().length,2);assert.match(f.container.textContent,/Earlier records are retained/);
});
test('an empty page continues rather than incorrectly claiming an empty wallet history',async()=>{
 const f=fixture(async()=>page([]));f.wallet(A);await f.view.load();assert.equal(f.cards().length,0);assert.equal(f.action('older').disabled,false);assert.match(f.container.textContent,/No matching FTI events in the pages checked so far/);assert.match(f.container.textContent,/Older blocks remain/);
});
test('account changes cancel pending work, erase private pages and reject a late response',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));f.wallet(A);const pending=f.view.load();const signal=f.requests[0].signal;f.wallet(B);assert.equal(signal.aborted,true);resolve(page());await pending;assert.equal(f.cards().length,0);assert.equal(f.action('export').disabled,true);assert.doesNotMatch(f.container.textContent,/Registered/);
 f.wallet(null);assert.equal(f.action('older').disabled,true);
});
test('wrong-wallet, changed-snapshot, malformed and conflicting rows never replace verified data',async()=>{
 const invalid=[page([],{wallet:B}),page([{...event(),timestamp:Number.MAX_SAFE_INTEGER}]),page([],{range:{from:1001,to:2000,deployedBlock:1,complete:true},nextCursor:null}),page([],{range:{from:1,to:2000,deployedBlock:1,complete:false}}),page([event(5000)]),page([event(900,0,B)]),page([],{chainId:97}),page([],{snapshot:{number:2000,hash:H(99)}})];
 for(const bad of invalid){let first=true;const f=fixture(async()=>{if(first){first=false;return page();}return bad;});f.wallet(A);await f.view.load();const before=f.cards()[0].textContent;await f.view.load();assert.equal(f.cards().length,1);assert.equal(f.cards()[0].textContent,before);assert.match(f.container.textContent,/could not be verified/);}
});
test('manual cancellation preserves records and does not accept an in-flight page',async()=>{
 let nextResolve,calls=0;const f=fixture(async()=>++calls===1?page():new Promise(r=>nextResolve=r));f.wallet(A);await f.view.load();const pending=f.view.load();f.view.cancel();nextResolve(page([event(900,0)]));await pending;assert.equal(f.cards().length,1);assert.equal(f.action('older').disabled,false);
});
test('CSV quotes commas and newlines, preserves exact values, and neutralizes formula prefixes',()=>{
 const e={...event(),name:' =HYPERLINK("evil")',contract:'@SUM(1)',args:[{name:'amount',value:'9007199254740993000000000'},{name:'note',value:'one, two\nthree'}]};const csv=memberHistoryCSV([e]);
 assert(csv.startsWith('\ufeff"Block"'));assert.match(csv,/"' =HYPERLINK\(""evil""\)"/);assert.match(csv,/"'@SUM\(1\)"/);assert.match(csv,/9007199254740993000000000/);assert.match(csv,/one, two\\nthree/);
});
test('untrusted event copy is rendered as literal text and a destroyed view releases all records',async()=>{
 const f=fixture(async()=>page([{...event(),name:'<img src=x onerror=alert(1)>'}]));f.wallet(A);await f.view.load();assert.match(f.container.textContent,/<img/);assert.equal(walk(f.container).some(n=>n.tag==='img'),false);f.view.destroy();assert.equal(f.container.textContent,'');await f.view.load();assert.equal(f.requests.length,1);
});
