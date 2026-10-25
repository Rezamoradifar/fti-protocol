import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupportTickets} from '../frontend/support-tickets.js';
class Node{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.value='';this.attrs={};this._text='';}
 set textContent(v){this._text=String(v);this.children=[];}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this._text='';this.children=nodes;}
 setAttribute(n,v){this.attrs[n]=v;}
 querySelectorAll(tag){return walk(this).filter(n=>n!==this&&n.tag===tag);}
}
const walk=n=>[n,...n.children.flatMap(walk)];
const A='0x'+'a1'.repeat(20),B='0x'+'b2'.repeat(20),ID='1'.repeat(32),origin='https://ftiprotocol.com';
function fixture(requestImpl){let wallet=A,signatures=0,admin=false;const container=new Node('div'),calls=[];const message=()=>['FTI Protocol support access','',`Origin: ${origin}`,'Chain ID: 56','Binary contract: '+B,`Wallet: ${wallet}`,'Nonce: '+ID,'','Sign only to access private support tickets. This does not authorize a transaction or spending.'].join('\n');
 const request=async(path,options={})=>{calls.push({path,options});if(requestImpl)return requestImpl(path,options);if(path.endsWith('/challenge'))return {nonce:ID,message:message(),expiresAt:Date.now()+300_000};if(path.endsWith('/session'))return {token:'a'.repeat(64),wallet,expiresAt:Date.now()+1_800_000};if(path.includes('/tickets/'+ID))return {ticket:record()};return {tickets:[],nextOffset:null};};
 const view=createSupportTickets({container,document:{createElement:t=>new Node(t)},getAddress:()=>wallet,isAdmin:()=>admin,signMessage:async()=>{signatures++;return '0x'+'12'.repeat(65);},request,origin});
 return {container,view,calls,setWallet:v=>{wallet=v;},setAdmin:v=>{admin=v;},signatures:()=>signatures,auth:()=>walk(container).find(n=>n.tag==='button'&&n.textContent==='Verify wallet for support'),reload:()=>walk(container).find(n=>n.tag==='button'&&n.textContent==='Refresh tickets')};}
const record=()=>({id:ID,wallet:A,topic:'Wallet connection',status:'open',createdAt:Date.now(),updatedAt:Date.now(),messages:[{id:'2'.repeat(32),role:'member',wallet:A,text:'<img src=x onerror=alert(1)>',createdAt:Date.now()}]});

test('refresh never signs or posts, access starts only on click and wallet change drops all private state',async()=>{
 const f=fixture();for(let i=0;i<3;i++)f.view.refresh();assert.equal(f.calls.length,0);assert.equal(f.signatures(),0);
 await f.auth().onclick();assert.equal(f.signatures(),1);assert.equal(f.calls.filter(c=>c.path.endsWith('/session')).length,1);assert.equal(f.auth().hidden,true);assert.equal(f.reload().disabled,false);
 assert.equal(walk(f.container).some(n=>n.textContent.includes('a'.repeat(64))),false);
 f.setWallet(B);f.view.refresh();assert.equal(f.auth().hidden,false);assert.equal(f.reload().disabled,true);assert.equal(f.calls.length,3);f.view.destroy();assert.equal(f.container.textContent,'');
});
test('stale wallet challenge is ignored before requesting any signature',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>{resolve=r;}));const running=f.auth().onclick();await Promise.resolve();f.setWallet(B);f.view.refresh();resolve({nonce:ID,message:'Untrusted prior wallet request',expiresAt:Date.now()+300_000});await running;assert.equal(f.signatures(),0);assert.equal(f.auth().hidden,false);
});
test('an unexpected challenge origin never reaches the wallet signer',async()=>{
 const f=fixture(async()=>({nonce:ID,message:'FTI Protocol support access\n\nOrigin: https://evil.example\nWallet: '+A+'\nNonce: '+ID+'\nSign only to access private support tickets. This does not authorize a transaction or spending.',expiresAt:Date.now()+300_000}));await f.auth().onclick();assert.equal(f.signatures(),0);assert.match(f.container.textContent,/Support is unavailable/);
});
test('team messages stay literal text and role changes clear admin records without another request',async()=>{
 let wallet=A;const f=fixture(async(path)=>{if(path.endsWith('/challenge'))return {nonce:ID,message:['FTI Protocol support access','',`Origin: ${origin}`,`Wallet: ${wallet}`,`Nonce: ${ID}`,'','Sign only to access private support tickets. This does not authorize a transaction or spending.'].join('\n'),expiresAt:Date.now()+300_000};if(path.endsWith('/session'))return {token:'a'.repeat(64),wallet,expiresAt:Date.now()+1_800_000};if(path.includes('/tickets/'+ID))return {ticket:record()};return {tickets:[{id:ID,wallet:A,topic:'Wallet connection',status:'answered',createdAt:Date.now(),updatedAt:Date.now(),messageCount:1,lastRole:'team'}],nextOffset:null};});
 await f.auth().onclick();const row=walk(f.container).find(n=>n.dataset.ticketId===ID);await row.onclick();assert.match(f.container.textContent,/<img src=x onerror=alert\(1\)>/);assert.equal(walk(f.container).some(n=>n.tag==='img'),false);
 const count=f.calls.length;f.setAdmin(true);f.view.refresh();assert.equal(f.calls.length,count);assert(!f.container.textContent.includes('<img'));assert.equal(f.auth().hidden,false);
});
test('failed ticket submission preserves the entered message and never retries automatically',async()=>{
 const f=fixture();await f.auth().onclick();const form=walk(f.container).find(n=>n.tag==='form'&&n.className==='member-ticket-create'),input=walk(form).find(n=>n.tag==='textarea');input.value='This carefully written support report remains available.';
 // The normal fixture returns a list in place of a create response: validation
 // must reject it while retaining the user's unsent text and allowing review.
 await form.onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));assert.equal(input.value,'This carefully written support report remains available.');assert.equal(f.calls.filter(c=>c.path==='/api/support/tickets'&&c.options.method==='POST').length,1);
});
