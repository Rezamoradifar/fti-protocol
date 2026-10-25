import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createActivityEvents} from '../frontend/activity-events.js';
import {activityText} from '../frontend/activity-copy.js';
import {createMemberActivity} from '../frontend/member-activity.js';

const source=fs.readFileSync(new URL('../frontend/controller.js',import.meta.url),'utf8');
const start=source.indexOf("const eventsNotice=document.createElement('p');");
const end=source.indexOf("$('#refresh-events').onclick=loadEvents;",start)+"$('#refresh-events').onclick=loadEvents;".length;
function fixture(){
 const nodes=new Map(),requests=[];let historyCanceled=0;
 function node(tag='div'){
  return {tag,children:[],dataset:{},attrs:{},disabled:false,hidden:false,value:'',_text:'',
   set textContent(value){this._text=String(value);this.children=[];},
   get textContent(){return this._text+this.children.map(child=>child.textContent).join('');},
   append(...items){this.children.push(...items);},
   setAttribute(key,value){this.attrs[key]=value;},
   before(item){nodes.set(item.id,item);},
   replaceChildren(...items){this._text='';this.children=items.flatMap(item=>item.tag==='#fragment'?item.children:[item]);},
  };
 }
 for(const id of ['events','refresh-events','activity','overview','status','page-title']){const item=node();item.id=id;nodes.set(id,item);}
 nodes.get('status').textContent='Wallet request is awaiting review';
 const context=vm.createContext({createActivityEvents,activityText,createMemberActivity,memberActivity:null,address:null,personalHistory:{cancel(){historyCanceled++;}},
  $:selector=>nodes.get(selector.slice(1)),integer:String,t:value=>value,explorer:'https://explorer.example',
  document:{createElement:node,createDocumentFragment:()=>node('#fragment'),querySelectorAll:selector=>selector==='.page'?[nodes.get('activity'),nodes.get('overview')]:[]},
  text:(id,value)=>{nodes.get(id).textContent=value;},
  titles:{overview:'Overview',activity:'Protocol activity'},defaultPage:'overview',surfacePages:[['overview','Overview'],['activity','Protocol activity']],v3Model:false,
  location:{hash:'#activity',search:''},history:{replaceState(){}},
  json:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),
  status:()=>assert.fail('Activity reads must not change global wallet status'),
 });
 assert.ok(start>0&&end>start);vm.runInContext(source.slice(start,end),context);
 const navStart=source.indexOf('function navigate('),navEnd=source.indexOf("document.querySelectorAll('[data-page],[data-go]')",navStart);
 vm.runInContext(source.slice(navStart,navEnd),context);
 return {context,nodes,requests,historyCanceled:()=>historyCanceled,load:()=>context.loadEvents(),cancel:()=>context.cancelEvents()};
}
const row=name=>({name,block:123,args:[{name:'amount',value:'10'}],hash:'0x'+'a'.repeat(64)});
const walk=node=>[node,...node.children.flatMap(walk)];
const byClass=(f,name)=>walk(f.nodes.get('events')).filter(node=>node.className?.split(' ').includes(name));
const results=f=>byClass(f,'member-activity-results')[0];
const cards=f=>byClass(f,'member-event');
const title=f=>walk(cards(f)[0]).find(node=>node.tag==='strong').textContent;

test('the actual controller coalesces activity refreshes and renders verified events locally',async()=>{
 const f=fixture(),first=f.load(),second=f.load();assert.equal(f.requests.length,1);
 assert.equal(f.nodes.get('refresh-events').disabled,true);
 assert.equal(f.nodes.get('events-status').dataset.state,'loading');
 f.requests[0].resolve([row('Actual event')]);await Promise.all([first,second]);
 assert.equal(title(f),'Actual event');
 assert.match(cards(f)[0].textContent,/Block 123/);
 assert.equal(byClass(f,'member-activity-count')[0].textContent,'Matching events: 1 / 1');
 assert.equal(f.nodes.get('events').dataset.state,'verified');
 assert.equal(f.nodes.get('events-status').dataset.state,'ready');
 assert.equal(f.nodes.get('refresh-events').disabled,false);
 assert.equal(f.nodes.get('status').textContent,'Wallet request is awaiting review');
});

test('a failed activity refresh retains the prior result and marks it stale instead of inventing empty history',async()=>{
 const f=fixture();let pending=f.load();f.requests[0].resolve([row('Earlier event')]);await pending;
 const rendered=results(f).children,earlierCard=cards(f)[0];
 pending=f.load();assert.strictEqual(results(f).children,rendered);
 f.requests[1].reject(Error('RPC unavailable'));await pending;
 assert.strictEqual(results(f).children,rendered);
 assert.strictEqual(cards(f)[0],earlierCard);
 assert.equal(title(f),'Earlier event');
 assert.equal(f.nodes.get('events').dataset.state,'stale');
 assert.equal(f.nodes.get('events-status').dataset.state,'stale');
 assert.equal(f.nodes.get('status').textContent,'Wallet request is awaiting review');
});

test('leaving the actual activity view cancels its read; late failure cannot affect overview or a newer activity result',async()=>{
 const f=fixture(),old=f.load();
 f.context.navigate('overview');
 assert.equal(f.nodes.get('activity').hidden,true);
 assert.equal(f.requests[0].options.signal.aborted,true);
 assert.equal(f.historyCanceled(),1);
 assert.equal(f.nodes.get('refresh-events').disabled,false);
 f.context.navigate('activity');
 const fresh=f.load();assert.equal(f.requests.length,2);
 f.requests[1].resolve([row('Fresh event')]);await fresh;
 f.requests[0].reject(Error('Late error after navigation'));await old;
 assert.equal(f.nodes.get('events-status').dataset.state,'ready');
 assert.equal(title(f),'Fresh event');
 assert.match(cards(f)[0].textContent,/Block 123/);
 assert.equal(f.nodes.get('status').textContent,'Wallet request is awaiting review');
});

test('an initial activity failure stays local and a genuine empty result is distinguished from failure',async()=>{
 const f=fixture();let pending=f.load();f.requests[0].reject(Error('offline'));await pending;
 assert.equal(f.nodes.get('events-status').dataset.state,'error');
 assert.equal(f.nodes.get('events').dataset.state,'unavailable');
 assert.equal(cards(f).length,0);
 assert.doesNotMatch(results(f).textContent,/No protocol events were returned/);
 pending=f.load();f.requests[1].resolve([]);await pending;
 assert.equal(f.nodes.get('events-status').dataset.state,'empty');
 assert.equal(f.nodes.get('events').dataset.state,'verified');
 assert.equal(cards(f).length,0);
 assert.match(results(f).textContent,/No protocol events were returned/);
});

test('malformed activity cannot erase an earlier verified result during partial rendering',async()=>{
 const f=fixture();let pending=f.load();f.requests[0].resolve([row('Earlier')]);await pending;
 const rendered=results(f).children,earlierCard=cards(f)[0];
 pending=f.load();f.requests[1].resolve([row('Partial new'),{name:'Malformed',args:null}]);await pending;
 assert.strictEqual(results(f).children,rendered);
 assert.strictEqual(cards(f)[0],earlierCard);
 assert.equal(title(f),'Earlier');
 assert.equal(f.nodes.get('events-status').dataset.state,'stale');
 assert.equal(f.nodes.get('events').dataset.state,'stale');
});

test('the actual controller renderer filters the current wallet without fetching again or clearing stale history notices',async()=>{
 const f=fixture(),a='0x'+'1'.repeat(40),b='0x'+'2'.repeat(40);
 let pending=f.load();
 f.requests[0].resolve([
  {...row('Registered'),args:[{name:'wallet',value:a}]},
  {...row('Bought'),args:[{name:'buyer',value:b}]},
 ]);await pending;
 const mine=walk(f.nodes.get('events')).find(node=>node.dataset.eventScope==='wallet');
 assert.equal(mine.disabled,true);
 f.context.address=a;f.context.memberActivity.refresh();mine.onclick();
 assert.equal(cards(f).length,1);assert.equal(title(f),'Membership registered');
 assert.equal(f.requests.length,1);
 pending=f.load();f.requests[1].reject(Error('History read unavailable'));await pending;
 f.context.address=b;f.context.memberActivity.refresh();
 assert.equal(cards(f).length,1);assert.equal(title(f),'FTI purchased');
 assert.equal(f.nodes.get('events').dataset.state,'stale');
 assert.equal(f.nodes.get('events-status').dataset.state,'stale');
 assert.equal(f.requests.length,2);
 assert.equal(f.nodes.get('status').textContent,'Wallet request is awaiting review');
 f.context.address=null;f.context.memberActivity.refresh();
 assert.equal(mine.disabled,true);assert.equal(cards(f).length,2);
 assert.equal(f.nodes.get('events-status').dataset.state,'stale');
});

test('activity status text is available in each supported language',()=>{
 for(const lang of ['en','fa','ar','tr','zh-CN','ru','es'])for(const state of ['loading','refreshing','ready','empty','error','stale']){
  const text=activityText(state,lang);assert.equal(typeof text,'string');assert.ok(text.trim());
  if(lang!=='en')assert.notEqual(text,activityText(state,'en'));
 }
});
