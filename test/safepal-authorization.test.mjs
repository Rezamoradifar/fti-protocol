import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../frontend/wallet-selector.js',import.meta.url),'utf8').replace("import {t} from './locale.js';",'').replaceAll('export ','');
function fixture({safePal=true,metamask=false}={}){
 let active=false,nextTimer=0;const timers=new Map(),permissions=[];
 const target=new EventTarget(),storage=new Map();
 const provider=name=>({request:async args=>{permissions.push({name,method:args.method,active});assert.equal(args.method,'eth_requestAccounts');assert.equal(active,true,'permission must run in the original click stack');return ['0x'+'1'.repeat(40)];}});
 if(safePal)target.safepalProvider=provider('SafePal');
 if(metamask)target.ethereum={...provider('MetaMask'),isMetaMask:true};
 const document=new EventTarget();document.hidden=false;
 class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag;this.children=[];this.attributes={};this.textContent='';this.disabled=false;this.hidden=false;}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const child of this.children)child.parent=null;this.children=[];this.append(...nodes);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
  setAttribute(key,value){this.attributes[key]=value;}
  focus(){document.activeElement=this;}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  querySelectorAll(selector){const result=[];for(const child of this.children){if(selector==='button'&&child.tagName==='button')result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  showModal(){assert.fail('Native dialog methods must never be called');}
 }
 document.createElement=tag=>new Element(tag);document.body=new Element('body');
 const trigger=new Element('button');trigger.textContent='Connect';document.body.append(trigger);trigger.focus();
 const context={window:target,document,sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},Event,queueMicrotask,t:value=>value,
  setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(source,context);
 const descendants=(node=document.body)=>node.children.flatMap(child=>[child,...descendants(child)]);
 return {context,target,document,trigger,timers,permissions,
  click(fn){active=true;try{return fn();}finally{active=false;}},
  button(name){const button=descendants().find(node=>node.tagName==='button'&&node.textContent===name);assert.ok(button,'button '+name);return button;},
  dialog:()=>descendants().find(node=>node.className==='wallet-dialog'),
  async timer(delay){const task=[...timers.entries()].find(([,item])=>item.delay===delay);assert.ok(task,'timer '+delay);timers.delete(task[0]);await task[1].fn();},
  key(key,shiftKey=false){const event=new Event('keydown',{cancelable:true});event.key=key;event.shiftKey=shiftKey;document.dispatchEvent(event);return event;},
  visibility(hidden){document.hidden=hidden;document.dispatchEvent(new Event('visibilitychange'));}
 };
}

test('a single SafePal starts permission during the Connect click and the controller reuses it exactly once',async()=>{
 const f=fixture();const choice=f.click(()=>f.context.chooseWallet({chainId:56,authorize:true}));
 assert.equal(f.permissions.length,1);assert.equal(f.permissions[0].active,true);assert.equal(f.dialog(),undefined);
 const selected=await choice;assert.ok(selected.authorization);
 const accounts=await f.context.requestWalletAccounts(selected,false);assert.equal(accounts.length,1);assert.equal(f.permissions.length,1);
});

test('with multiple wallets only the clicked option requests permission inside that option click',async()=>{
 const f=fixture({metamask:true}),choice=f.context.chooseWallet({chainId:56,authorize:true});
 assert.ok(f.dialog());assert.equal(f.permissions.length,0);
 f.click(()=>f.button('SafePal').onclick());const selected=await choice;
 await f.context.requestWalletAccounts(selected);assert.equal(f.permissions.length,1);assert.equal(f.permissions[0].name,'SafePal');assert.equal(f.dialog(),undefined);
});

test('default read-only chooser never requests accounts and uses the overlay even when native dialogs cannot open',async()=>{
 const f=fixture(),choice=f.context.chooseWallet({chainId:56});
 const dialog=f.dialog();assert.equal(dialog.attributes.role,'dialog');assert.equal(dialog.attributes['aria-modal'],'true');assert.equal(dialog.attributes.open,'');
 f.click(()=>f.button('SafePal').onclick());const selected=await choice;
 assert.equal(selected.authorization,undefined);assert.equal(f.permissions.length,0);
});

test('late SafePal injection without an event appears through visible polling but never auto-authorizes',async()=>{
 const f=fixture({safePal:false}),choice=f.context.chooseWallet({chainId:56,authorize:true});
 f.target.safepalProvider={request:async args=>{f.permissions.push({method:args.method});return ['connected'];}};
 await f.timer(500);assert.equal(f.permissions.length,0);
 f.click(()=>f.button('SafePal').onclick());const selected=await choice;
 await f.context.requestWalletAccounts(selected);assert.equal(f.permissions.length,1);
});

test('polling pauses while hidden, resumes on visibility and stops after its bounded budget',async()=>{
 const f=fixture({safePal:false}),choice=f.context.chooseWallet({chainId:56});
 f.visibility(true);assert.equal(f.timers.size,0);
 f.visibility(false);await f.timer(0);
 for(let index=0;index<29;index++)await f.timer(500);
 assert.equal(f.timers.size,0);assert.equal(f.permissions.length,0);
 f.button('Cancel').onclick();await choice;assert.equal(f.timers.size,0);
});

test('unchanged discovery polling retains the focused wallet button',async()=>{
 const f=fixture(),choice=f.context.chooseWallet({chainId:56}),button=f.button('SafePal');
 button.focus();await f.timer(500);assert.equal(f.button('SafePal'),button);assert.equal(f.document.activeElement,button);
 f.button('Cancel').onclick();await choice;
});

test('overlay traps Tab and Shift-Tab, closes on Escape and restores the Connect button',async()=>{
 const f=fixture(),choice=f.context.chooseWallet({chainId:56}),dialog=f.dialog();
 const controls=dialog.querySelectorAll('button').filter(button=>!button.disabled),first=controls[0],last=controls.at(-1);
 first.focus();assert.equal(f.key('Tab',true).defaultPrevented,true);assert.equal(f.document.activeElement,last);
 assert.equal(f.key('Tab').defaultPrevented,true);assert.equal(f.document.activeElement,first);
 assert.equal(f.key('Escape').defaultPrevented,true);assert.equal(await choice,null);await Promise.resolve();
 assert.equal(f.document.activeElement,f.trigger);assert.equal(f.dialog(),undefined);assert.equal(f.timers.size,0);
});

test('silent reconnect never initiates permission even if authorize is accidentally requested',async()=>{
 const f=fixture();const selected=await f.context.chooseWallet({chainId:56,silent:true,authorize:true});
 assert.equal(selected,null);assert.equal(f.permissions.length,0);assert.equal(f.dialog(),undefined);
});
