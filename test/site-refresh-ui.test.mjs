// Browser-independent flow checks. React renders the real landing components;
// the widget runs its real entrypoint with a controlled optional-UI module.
// These checks do not claim to exercise layout, hydration or native dialogs.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
const languages=['en','ar','tr','zh-CN','ru','es','fa'];

async function landingBundle(){
 const result=await build({
  absWorkingDir:root,
  stdin:{contents:`import './landing/src/main.jsx';
   import {renderToStaticMarkup} from 'react-dom/server.edge';
   export function renderForReview(){return renderToStaticMarkup(globalThis.__ftiReviewRoot);}`,
   resolveDir:root,loader:'jsx'},
  bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true,
  define:{'process.env.NODE_ENV':'"production"','__FTI_APP_URL__':'"/app/"'},
  loader:{'.css':'empty','.jpg':'dataurl'},
  alias:{react:path.join(root,'node_modules/react'),'react-dom':path.join(root,'node_modules/react-dom')},
  plugins:[{name:'nonbrowser-render',setup(builder){
   // Capture the real entrypoint's root element, then render it with React's
   // server renderer. No source rewriting or mock React hooks are involved.
   builder.onResolve({filter:/^react-dom\/client$/},()=>({path:'client',namespace:'review-client'}));
   builder.onLoad({filter:/.*/,namespace:'review-client'},()=>({contents:
    'export function createRoot(container){if(!container)throw Error("Missing mount");return {render(node){globalThis.__ftiReviewRoot=node}}}',loader:'js'}));
   // Fonts have no role in this semantic check. Root npm ci is sufficient;
   // it must not depend on a second landing/node_modules installation.
   builder.onResolve({filter:/^@fontsource(?:-variable)?\//},args=>({path:args.path,namespace:'review-font'}));
   builder.onLoad({filter:/.*/,namespace:'review-font'},()=>({contents:'',loader:'js'}));
  }}],
 });
 return result.outputFiles[0].text;
}

test('real landing renders language choices and working routes before optional contract data',async()=>{
 const code=await landingBundle();
 const keys=['localStorage','location','document','fetch','__ftiReviewRoot'];
 const previous=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 let requests=0;
 const set=(key,value)=>Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 try{
  set('fetch',async()=>{requests++;throw Error('Unexpected eager network request');});
  const cases=[...languages.map(lang=>({lang,query:lang==='en'?'':'?lang='+lang,stored:lang==='en'?null:'en'})),
   {lang:'fa',query:'',stored:'fa'}];
  for(const [index,{lang,query,stored}]of cases.entries()){
   const values=new Map(stored?[['fti-language',stored]]:[]);
   set('localStorage',{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)});
   set('location',{href:'https://ftiprotocol.com/'+query,pathname:'/'});
   const document={documentElement:{dataset:{}},addEventListener(){},getElementById:id=>id==='root'?{}:null};
   set('document',document);
   // Isolate the module-level language selection for each real visit.
   const module=await import('data:text/javascript;base64,'+Buffer.from(code+'\n// visit '+index).toString('base64'));
   const html=module.renderForReview();
   assert.equal(document.documentElement.lang,lang);
   assert.equal(document.documentElement.dir,['fa','ar'].includes(lang)?'rtl':'ltr');
   assert.equal(values.get('fti-language'),lang);
   const selector=html.match(/<select[^>]*class="landing-language"[\s\S]*?<\/select>/)?.[0];
   assert(selector,'Language selector should be rendered');
   assert.deepEqual([...selector.matchAll(/<option[^>]*value="([^"]+)"/g)].map(match=>match[1]),languages);
   assert.match(selector,new RegExp('<option[^>]*value="'+lang+'"[^>]*selected'));
   assert.equal((html.match(/class="quick-action action-/g)||[]).length,4);
   for(const href of ['/app/#network','/token/#trade','/support/','/vpn/','/admin/','/whitepaper/','/roadmap/']){
    assert(html.includes('href="'+href+'"'),lang+': missing '+href);
   }
   assert(html.includes('id="live-data"'));
   assert(!html.includes('id="hourly-pool"'),'Optional data should not mount in the initial tree');
   assert.equal(requests,0);
  }
 }finally{
  for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 }
});

class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.listeners={};this.attributes={};this.open=false;}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(type,listener){this.listeners[type]=listener;}
 showModal(){this.open=true;}
 close(){this.open=false;this.listeners.close?.();}
 focus(){this.focused=true;}
}

const optionalUi=`globalThis.uiModuleLoads++;
 export function mountCustomerServices(options){
  globalThis.mounts.push(options.language);
  return {refresh(){globalThis.refreshes++},destroy(){globalThis.destroyed++}};
 }`;
let readyWidget;
function widgetBundle(fail=false){
 if(!fail&&readyWidget)return readyWidget;
 const result=build({absWorkingDir:root,entryPoints:['frontend/customer-widget.js'],bundle:true,write:false,
  format:'iife',target:'es2022',loader:{'.css':'empty'},plugins:[{name:'controlled-optional-ui',setup(builder){
   builder.onResolve({filter:/customer-services\.js$/},()=>({path:'service',namespace:'review-service'}));
   builder.onLoad({filter:/.*/,namespace:'review-service'},()=>({contents:fail?
    'throw Error("Optional UI unavailable");export function mountCustomerServices(){}':optionalUi,loader:'js'}));
  }}]}).then(result=>result.outputFiles[0].text);
 if(!fail)readyWidget=result;
 return result;
}
function widgetFixture(code,{href='https://ftiprotocol.com/?lang=fa',storageBlocked=false}={}){
 const body=new Element('body'),listeners={},values=new Map([['fti-language','en']]);
 const context={URL,Intl,JSON,Object,Map,
  document:{body,createElement:tag=>new Element(tag),
   querySelector:()=>body.children.find(node=>Object.hasOwn(node.dataset,'ftiCustomerWidget'))||null},
  location:{href,pathname:new URL(href).pathname,assign:value=>{context.destination=value;}},
  localStorage:{getItem(key){if(storageBlocked)throw Error('Storage blocked');return values.get(key);},
   setItem(key,value){if(storageBlocked)throw Error('Storage blocked');values.set(key,value);}},
  addEventListener:(type,listener)=>{listeners[type]=listener;},
  uiModuleLoads:0,mounts:[],refreshes:0,destroyed:0,
 };
 vm.createContext(context);vm.runInContext(code,context);
 return {context,body,listeners};
}

test('widget opens on demand, refreshes on return and survives back-forward cache',async()=>{
 const {context,body,listeners}=widgetFixture(await widgetBundle());
 assert.equal(body.children.length,1);
 const launcher=body.children[0];
 assert.equal(launcher.textContent,'پشتیبانی','Explicit URL language must win before main boot');
 assert.equal(context.uiModuleLoads,0);assert.equal(context.mounts.length,0);
 await launcher.onclick();
 assert.equal(context.uiModuleLoads,1);assert.deepEqual([...context.mounts],['fa']);
 const dialog=body.children.find(node=>node.tag==='dialog');assert.equal(dialog.open,true);
 dialog.close();assert.equal(launcher.focused,true);
 listeners.pagehide({persisted:true});assert.equal(context.destroyed,0);assert.equal(body.children.length,2);
 await launcher.onclick();assert.equal(dialog.open,true);assert.equal(context.mounts.length,1);assert.equal(context.refreshes,1);
 listeners.pagehide({persisted:false});assert.equal(context.destroyed,1);assert.equal(body.children.length,0);
});

test('failed optional widget keeps the chosen language when browser storage is blocked',async()=>{
 const {context,body}=widgetFixture(await widgetBundle(true),{storageBlocked:true});
 const launcher=body.children[0];assert.equal(launcher.textContent,'پشتیبانی');
 await launcher.onclick();
 const destination=new URL(context.destination);
 assert.equal(destination.origin,'https://ftiprotocol.com');assert.equal(destination.pathname,'/support/');
 assert.equal(destination.searchParams.get('lang'),'fa');
 assert.equal(launcher.disabled,false);
});

test('dedicated support and VPN pages do not add a second support launcher',async()=>{
 const code=await widgetBundle();
 for(const route of ['/support/','/vpn/']){
  const {context,body}=widgetFixture(code,{href:'https://ftiprotocol.com'+route+'?lang=fa'});
  assert.equal(body.children.length,0);assert.equal(context.uiModuleLoads,0);assert.equal(context.mounts.length,0);
 }
});
