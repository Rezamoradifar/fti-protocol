import test from 'node:test';
import assert from 'node:assert/strict';
import {workspacePages,surfaceForPath,resolvePage,pagePath,createWorkspaceRouter} from '../frontend/surfaces.js';
function harness(surface,hash=''){
 const sections=Object.values(workspacePages).flat().map(([id])=>({id,hidden:true})),buttons=workspacePages[surface].map(([id])=>({dataset:{page:id},classList:{toggle(){}},setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];}}));
 let focused=0,scrolled=0,index=0;const entries=[hash],listeners={};
 const window={location:{hash,assign(url){this.assigned=url;}},addEventListener(name,fn){listeners[name]=fn;},history:{pushState(_s,_t,next){entries.splice(++index);entries.push(next);window.location.hash=next;},replaceState(_s,_t,next){entries[index]=next;window.location.hash=next;},back(){if(index>0)window.location.hash=entries[--index];listeners.popstate();},forward(){if(index<entries.length-1)window.location.hash=entries[++index];listeners.popstate();}}};
 const title={textContent:'',focus(){focused++;}},document={title:'',querySelectorAll(selector){return selector==='.page'?sections:buttons;},getElementById(id){return id==='page-title'?title:{scrollIntoView(){scrolled++;}};}};
 const seen=[],navigate=createWorkspaceRouter({window,document,currentSurface:surface,onNavigate:page=>seen.push(page)});
 return {window,document,navigate,buttons,sections,entries,seen,title,get focused(){return focused;},get scrolled(){return scrolled;}};
}
test('workspace paths use exact segments and each surface has a distinct navigation contract',()=>{
 for(const[surface,path]of [['member','/app/'],['token','/token/'],['admin','/admin/']])assert.equal(surfaceForPath(path),surface);
 assert.equal(surfaceForPath('/administrator'),'member');assert.equal(surfaceForPath('/tokenized'),'member');
 assert.deepEqual(workspacePages.member.map(x=>x[0]),['overview','network','rewards','activity']);
 assert.deepEqual(workspacePages.token.map(x=>x[0]),['token-home','trade','activity']);assert.deepEqual(workspacePages.admin.map(x=>x[0]),['admin','activity']);
});
test('navigation uses history entries; repeated clicks do not duplicate entries',()=>{
 const h=harness('member');h.navigate('overview',{historyMode:'replace'});h.navigate('network',{focus:true});h.navigate('rewards',{focus:true});h.navigate('rewards',{focus:true});
 assert.deepEqual(h.entries,['#overview','#network','#rewards']);assert.equal(h.focused,3);assert.equal(h.scrolled,3);
 h.window.history.back();assert.equal(h.title.textContent,'Membership & network');assert.equal(h.sections.find(p=>p.id==='network').hidden,false);
 h.window.history.back();assert.equal(h.title.textContent,'Overview');h.window.history.forward();assert.equal(h.title.textContent,'Membership & network');
});
test('deep links and unknown hashes render a valid local page without history loops',()=>{
 for(const[surface,page]of [['member','rewards'],['token','trade'],['admin','activity']]){const h=harness(surface,'#'+page);h.navigate(page,{historyMode:'replace'});assert.equal(h.entries.length,1);assert.equal(h.sections.find(p=>p.id===page).hidden,false);}
 assert.equal(resolvePage('not-a-page','token'),'token-home');const h=harness('admin','#bad');h.navigate('bad',{historyMode:'replace'});assert.equal(h.window.location.hash,'#admin');
});
test('cross-panel links preserve their target and activity remains in the current panel',()=>{
 const h=harness('member');h.navigate('trade');assert.equal(h.window.location.assigned,'/token/#trade');
 assert.equal(pagePath('activity','admin'),'/admin/#activity');assert.equal(pagePath('network'),'/app/#network');assert.equal(pagePath('admin'),'/admin/#admin');
});
