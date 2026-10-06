import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {autoBuyPresentation,autoPreferenceReadiness,validateAutoPreference,autoBuyPolicy,IMMEDIATE_AUTO_POLICY} from '../frontend/auto-buy-state.mjs';
import {actionAvailability} from '../frontend/workspace-state.mjs';
const data={autoBuyPolicy:IMMEDIATE_AUTO_POLICY,timestamp:100,epochEnd:'200',phase:'0',restartSupported:true};
const wallet={exists:true,autoEnabled:false,autoStoredEnabled:false,autoPending:'10',nextAutoSetting:{enabled:false,effectiveAt:'0'}};
const options=(enabled,patch={},w=wallet)=>({data:{...data,...patch},wallet:w,enabled,lifecycle:{}});
test('default off and future next-hour intent are distinct from effective permission',()=>{
 assert.deepEqual(autoBuyPresentation(data,wallet),{enabled:false,scheduled:false,requested:false,label:'Disabled · default off',effectiveAt:null});
 const scheduled={...wallet,nextAutoSetting:{enabled:true,effectiveAt:'200'}};
 assert.deepEqual(autoBuyPresentation(data,scheduled),{enabled:false,scheduled:true,requested:true,label:'Scheduled for next UTC boundary',effectiveAt:'200'});
 const active={...scheduled,autoEnabled:true};
 assert.deepEqual(autoBuyPresentation({...data,timestamp:200},active),{enabled:true,scheduled:false,requested:true,label:'Enabled · fixed 5%',effectiveAt:null});
 assert.equal(active.autoStoredEnabled,false,'effective API flag need not match lazily rolled member storage');
 assert.equal(autoBuyPresentation(data,active).label,'Enabled · fixed 5%','a redundant future true setting must not hide current permission');
});
test('enable targets a future wall-clock boundary even during overdue settlement; opt-out stays immediate',()=>{
 assert.doesNotThrow(()=>validateAutoPreference(options(true)));
 for(const patch of [{phase:'1'},{phase:'2'},{timestamp:200},{timestamp:500}]){
  assert.equal(autoPreferenceReadiness(options(true,patch)).ready,true);
  assert.doesNotThrow(()=>validateAutoPreference(options(true,patch)));
  assert.doesNotThrow(()=>validateAutoPreference(options(false,patch)));
 }
 const blocked={...options(true),lifecycle:{buyingBlocked:true}};
 assert.throws(()=>validateAutoPreference(blocked),/purchases are unavailable/);
 assert.doesNotThrow(()=>validateAutoPreference({...blocked,enabled:false}));
});
test('disconnected, stale and historical capability states cannot submit unsupported preferences',()=>{
 assert.equal(autoPreferenceReadiness({...options(true),data:null}).ready,false);
 assert.equal(autoPreferenceReadiness(options(true,{},null)).ready,false);
 assert.equal(autoPreferenceReadiness(options(true,{autoBuyPolicy:'historical-price-cap'})).ready,false);
 for(const connected of [false,true])for(const fresh of [false,true]){
  const a=actionAvailability({data:{...data,phase:'2'},wallet:{...wallet,autoEnabled:true},connected,fresh});
  assert.equal(a.member,connected&&fresh,'disable remains available during matching and allocation');
  assert.equal(a.autoBuyer,connected&&fresh);
 }
});
test('inactive and scheduled requests cannot execute pending funds, but owner cash release remains',()=>{
 const access=w=>actionAvailability({data,wallet:w,connected:true,fresh:true,lifecycle:{buyingBlocked:false}});
 for(const w of [wallet,{...wallet,nextAutoSetting:{enabled:true,effectiveAt:'200'}}]){
  assert.equal(access(w).autoBuyer,false);assert.equal(access(w).auto,true);
 }
 assert.equal(access({...wallet,autoEnabled:true}).autoBuyer,true);
});
test('copy explains bounded current-quote retries without a price cap, deadline or wallet re-debit promise',()=>{
 const copy=autoBuyPolicy(data);
 for(const phrase of ['off by default','fixed 5%','immediately during allocation','full-precision quote','including fees','without a user price cap','Only that new allocation','same beneficiary','Bounded keeper retries','no execution deadline or service-uptime guarantee','never re-debited'])assert(copy.includes(phrase),phrase);
 assert(autoBuyPolicy(data,{buyingBlocked:true}).startsWith('New token purchases are currently unavailable.'));
 const source=fs.readFileSync('frontend/controller.js','utf8'),markup=fs.readFileSync('frontend/main.jsx','utf8');
 assert(source.includes("write('binary').setAutoBuy(enabled)"));assert(!source.includes('setAutoBuy(enabled,'));
 assert(!markup.includes('name="price"'));assert(!source.includes('elements.price'));
 assert(source.includes("if(!wallet()?.autoEnabled)throw Error"));
 assert(!markup.includes('releaseClosedTokenAutoToCash'));assert(!source.includes("write('binary').releaseClosedTokenAutoToCash"));
});
