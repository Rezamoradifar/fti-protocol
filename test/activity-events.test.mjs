import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createActivityEvents} from '../frontend/activity-events.js';
import {activityText} from '../frontend/activity-copy.js';

const source=fs.readFileSync(new URL('../frontend/controller.js',import.meta.url),'utf8');
const start=source.indexOf("const eventsNotice=document.createElement('p');");
const end=source.indexOf("$('#refresh-events').onclick=loadEvents;",start)+"$('#refresh-events').onclick=loadEvents;".length;
function fixture(){
 const nodes=new Map(),requests=[];
 function node(tag='div'){
  return {tag,children:[],dataset:{},attrs:{},disabled:false,hidden:false,textContent:'',
   append(...items){this.children.push(...items);},
   setAttribute(key,value){this.attrs[key]=value;},
   before(item){nodes.set(item.id,item);},
   replaceChildren(...items){this.children=items.flatMap(item=>item.tag==='#fragment'?item.children:[item]);},
  };
 }
 for(const id of ['events','refresh-events','activity','overview','status','page-title']){const item=node();item.id=id;nodes.set(id,item);}
 nodes.get('status').textContent='Wallet request is awaiting review';
 const context=vm.createContext({createActivityEvents,activityText,
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
 return {context,nodes,requests,load:()=>context.loadEvents(),cancel:()=>context.cancelEvents()};
}
const row=name=>({name,block:123,args:[{name:'amount',value:'10'}],hash:'0x'+'a'.repeat(64)});

test('the actual controller coalesces activity refreshes and renders verified events locally',async()=>{
 const f=fixture(),first=f.load(),second=f.load();assert.equal(f.requests.length,1);
 assert.equal(f.nodes.get('refresh-events').disabled,true);
 assert.equal(f.nodes.get('events-status').dataset.state,'loading');
 f.requests[0].resolve([row('Actual event')]);await Promise.all([first,second]);
 assert.equal(f.nodes.get('events').children[0].children[0].textContent,'Actual event · Block 123');
 assert.equal(f.nodes.get('events').dataset.state,'verified');
 assert.equal(f.nodes.get('events-status').dataset.state,'ready');
 assert.equal(f.nodes.get('refresh-events').disabled,false);
 assert.equal(f.nodes.get('status').textContent,'Wallet request is awaiting review');
});

test('a failed activity refresh retains the prior result and marks it stale instead of inventing empty history',async()=>{
 const f=fixture();let pending=f.load();f.requests[0].resolve([row('Earlier event')]);await pending;
 const rendered=f.nodes.get('events').children;
 pending=f.load();assert.strictEqual(f.nodes.get('events').children,rendered);
 f.requests[1].reject(Error('RPC unavailable'));await pending;
 assert.strictEqual(f.nodes.get('events').children,rendered);
 assert.equal(f.nodes.get('events').dataset.state,'stale');
 assert.equal(f.nodes.get('events-status').dataset.state,'stale');
 assert.equal(f.nodes.get('status').textContent,'Wallet request is awaiting review');
});

test('leaving the actual activity view cancels its read; late failure cannot affect overview or a newer activity result',async()=>{
 const f=fixture(),old=f.load();
 f.context.navigate('overview');
 assert.equal(f.nodes.get('activity').hidden,true);
 assert.equal(f.requests[0].options.signal.aborted,true);
 assert.equal(f.nodes.get('refresh-events').disabled,false);
 f.context.navigate('activity');
 const fresh=f.load();assert.equal(f.requests.length,2);
 f.requests[1].resolve([row('Fresh event')]);await fresh;
 f.requests[0].reject(Error('Late error after navigation'));await old;
 assert.equal(f.nodes.get('events-status').dataset.state,'ready');
 assert.equal(f.nodes.get('events').children[0].children[0].textContent,'Fresh event · Block 123');
 assert.equal(f.nodes.get('status').textContent,'Wallet request is awaiting review');
});

test('an initial activity failure stays local and a genuine empty result is distinguished from failure',async()=>{
 const f=fixture();let pending=f.load();f.requests[0].reject(Error('offline'));await pending;
 assert.equal(f.nodes.get('events-status').dataset.state,'error');
 assert.equal(f.nodes.get('events').dataset.state,'unavailable');
 pending=f.load();f.requests[1].resolve([]);await pending;
 assert.equal(f.nodes.get('events-status').dataset.state,'empty');
 assert.equal(f.nodes.get('events').dataset.state,'verified');
});

test('malformed activity cannot erase an earlier verified result during partial rendering',async()=>{
 const f=fixture();let pending=f.load();f.requests[0].resolve([row('Earlier')]);await pending;
 const rendered=f.nodes.get('events').children;
 pending=f.load();f.requests[1].resolve([row('Partial new'),{name:'Malformed',args:null}]);await pending;
 assert.strictEqual(f.nodes.get('events').children,rendered);
 assert.equal(f.nodes.get('events-status').dataset.state,'stale');
});

test('activity status text is available in each supported language',()=>{
 for(const lang of ['en','fa','ar','tr','zh-CN','ru','es'])for(const state of ['loading','refreshing','ready','empty','error','stale']){
  const text=activityText(state,lang);assert.equal(typeof text,'string');assert.ok(text.trim());
  if(lang!=='en')assert.notEqual(text,activityText(state,'en'));
 }
});
