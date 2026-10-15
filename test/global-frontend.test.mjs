import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {LANGUAGES,languageFrom,normalizeLanguage,withLanguage} from '../frontend/language-policy.js';
import {coreTranslations,coreKeys} from '../frontend/core-translations.js';
import {landingTranslations} from '../frontend/landing-translations.js';
import {translate} from '../frontend/locale.js';
import {validatedSocialLinks} from '../frontend/social-policy.js';
import {readBuilderMode,builderMonthState,autoPercent} from '../frontend/builder-view.js';
import {validObservation,mergeObservations,observedSeries,curveGeometry,historicalObservations,readObservation,tradeHistory} from '../frontend/spot-history.js';
const H=n=>'0x'+n.toString(16).padStart(64,'0');
const row=(block,overrides={})=>({block,hash:H(block),time:1000+block,cycle:'1',supplyWei:'1000000000000000000',priceWei:String(BigInt(block)*10n**17n),...overrides});
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('exactly seven languages, native names, Persian/Arabic RTL and all others LTR',()=>{
 assert.deepEqual(LANGUAGES.map(l=>l.code),['fa','en','ar','tr','zh-CN','ru','es']);
 assert.deepEqual(LANGUAGES.filter(l=>l.dir==='rtl').map(l=>l.code),['fa','ar']);
 assert.equal(normalizeLanguage('zh-Hans'),'zh-CN');assert.equal(normalizeLanguage('zh'),'zh-CN');
 assert.equal(normalizeLanguage('de'),null);assert.equal(normalizeLanguage('__proto__'),null);
});
test('URL language wins across subdomains, invalid preferences are not accepted',()=>{
 assert.equal(languageFrom('https://app.ftiprotocol.com/app/?lang=ar','fa'),'ar');
 assert.equal(languageFrom('https://app.ftiprotocol.com/app/?lang=evil','es'),'es');
 assert.equal(languageFrom('invalid',null),'fa');
});
test('language changes preserve route, existing query, referral and fragment',()=>{
 const result=new URL(withLanguage('https://app.ftiprotocol.com/app/?sponsor=0x123&view=tree#network','ru'));
 assert.equal(result.pathname,'/app/');assert.equal(result.searchParams.get('sponsor'),'0x123');assert.equal(result.searchParams.get('view'),'tree');assert.equal(result.hash,'#network');
 assert.equal(result.searchParams.get('lang'),'ru');assert.throws(()=>withLanguage('javascript:alert(1)','fa'));assert.throws(()=>withLanguage(result.href,'xx'));
});
test('all core copy keys have nonempty translations in all six non-English languages',()=>{
 assert(coreKeys.length>=250);
 for(const code of ['fa','ar','tr','zh-CN','ru','es']){
  assert.deepEqual(Object.keys(coreTranslations[code]),coreKeys);
  for(const key of coreKeys){const value=coreTranslations[code][key];assert.equal(typeof value,'string');assert(value.trim());assert(!/[<>]/.test(value));assert.equal(translate(key,code),landingTranslations[code]?.[key]??value);}
 }
 assert.equal(translate('Connect wallet','en'),'Connect wallet');assert.equal(translate('__proto__','ru'),'__proto__');
});
test('untranslated detailed prose is not represented as a completed translation',()=>{
 assert.equal(translate('Not in the catalogue.','ar'),'Not in the catalogue.');
 assert(read('frontend/global-components.jsx').includes('Some detailed explanations are still shown in English.'));
});
test('owner-supplied social accounts are exact and each URL matches its platform',()=>{
 assert.deepEqual(validatedSocialLinks(JSON.parse(read('config/social-links.json'))),[
  {id:'telegram',name:'Telegram',href:'https://t.me/FTIProtocol'},
  {id:'x',name:'X',href:'https://x.com/FTIProtocol'}
 ]);
 const rows=validatedSocialLinks({telegram:'https://t.me/fti_demo',x:'https://x.com/fti_demo',instagram:'https://instagram.com/fti_demo',youtube:'https://youtube.com/@fti_demo',linkedin:'https://linkedin.com/company/fti_demo',discord:'https://discord.gg/test'});
 assert.equal(rows.length,6);assert(rows.every(r=>r.href.startsWith('https://')));
});
for(const url of ['javascript:alert(1)','http://x.com/account','https://evil.test/x.com/account','https://x.com.evil.test/a','https://user:pass@x.com/a','https://x.com:123/a','https://x.com/','https://x.com/intent/tweet','https://x.com/\naccount'])test('social link rejects '+JSON.stringify(url),()=>assert.deepEqual(validatedSocialLinks({x:url}),[]));
const contract=(functions,behavior={})=>({interface:{hasFunction:n=>functions.includes(n)},...behavior});
const known=['setAutoBuy','members','autoBuyPercent','setAutoBuyPercent'];
test('new auto-buy is verified by a deployed read, not the API boolean',async()=>{
 let call;const b=contract(known,{autoBuyPercent:async(a,o)=>{call=o;return 5n;}});
 assert.equal(await readBuilderMode(b,123),'selectable');assert.deepEqual(call,{blockTag:123});
 assert.equal(await readBuilderMode(contract(known,{autoBuyPercent:async()=>99n}),123),'unknown');
});
test('new ABI against an old implementation falls back only after a successful legacy read',async()=>{
 assert.equal(await readBuilderMode(contract(known,{autoBuyPercent:async()=>{throw {code:'CALL_EXCEPTION'};},members:async()=>({exists:false})}),1),'legacy');
 assert.equal(await readBuilderMode(contract(known,{autoBuyPercent:async()=>{throw {code:'NETWORK_ERROR'};}}),1),'unknown');
 assert.equal(await readBuilderMode(contract(['setAutoBuy','members']),1),'legacy');
 assert.equal(await readBuilderMode(contract([]),1),'unknown');
});
test('whole auto-buy percentages are 5 through 100, not maximum token prices',()=>{
 for(const value of [5,37,100,'5','100'])assert.equal(autoPercent(value),Number(value));
 for(const value of [0,4,101,37.2,'','5e1','0x32','05',null])assert.throws(()=>autoPercent(value));
});
const state=(date,overrides={})=>({nextMonth:2026*12,timestamp:Date.parse(date)/1000,lastClosedAt:Date.parse(date)/1000,monthPhase:0,...overrides});
test('month close uses the first next Gregorian month at UTC, never a rolling interval',()=>{
 const s=state('2026-01-15T13:00:00Z'),old=builderMonthState(s,'legacy'),newer=builderMonthState(s,'selectable');
 assert.equal(old.boundary,Date.parse('2026-02-01T00:00:00Z')/1000);assert.equal(old.canBegin,false);assert.equal(newer.canBegin,true);assert.equal(newer.kind,'waiting-month');
 const wait=builderMonthState(state('2026-02-01T00:00:01Z',{lastClosedAt:0}),'legacy');assert.equal(wait.kind,'waiting-hour');assert.equal(wait.canBegin,false);
 assert.equal(builderMonthState(state('2026-02-01T00:00:01Z'),'legacy').canBegin,true);
});
test('leap February, December rollover, frozen and incomplete monthly state',()=>{
 for(const [year,month,boundary]of [[2028,1,'2028-03-01'],[2100,1,'2100-03-01'],[2026,11,'2027-01-01']]){
  const result=builderMonthState(state(`${year}-01-01T00:00:00Z`,{nextMonth:year*12+month}),'selectable');assert.equal(result.boundary,Date.parse(boundary+'T00:00:00Z')/1000);
 }
 assert.equal(builderMonthState({...state('2026-02-02'),binaryRecoveryFrozen:true},'selectable').canBegin,false);
 assert.equal(builderMonthState({...state('2026-02-02'),monthPhase:1},'legacy').kind,'processing');
 assert.equal(builderMonthState({...state('2026-02-02'),lastClosedAt:null},'legacy').kind,'unknown');
});
test('observations retain exact raw amounts and reject malformed rows',()=>{
 assert.equal(validObservation(row(1,{priceWei:'9007199254740993'})).priceWei,'9007199254740993');
 for(const bad of [{priceWei:9007199254740992},{priceWei:'-1'},{priceWei:'1.2'},{hash:'0x'},{block:1.5},{time:-1},{cycle:'0'}])assert.throws(()=>validObservation(row(1,bad)));
});
test('repeated polling does not fabricate samples; cycles and known reorgs do not join',()=>{
 const a=mergeObservations([row(1),row(2)],[row(2)]);assert.equal(a.length,2);
 assert.deepEqual(mergeObservations(a,[row(3,{cycle:'2'})]).map(r=>r.block),[3]);
 assert.deepEqual(mergeObservations([row(1),row(2),row(3)],[row(2,{hash:H(99)})]).map(r=>r.block),[1,2]);
});
test('price curve excludes zero supply and honours its displayed window',()=>{
 const rows=[row(1,{supplyWei:'0',priceWei:'0'}),row(2),row(70),row(100)];
 assert.deepEqual(observedSeries(rows).map(r=>r.block),[2,70,100]);
 assert.deepEqual(observedSeries(rows,60).map(r=>r.block),[70,100]);
 assert.equal(observedSeries([row(1,{supplyWei:'0',priceWei:'0'})]).length,0);
});
test('curved geometry preserves observed endpoints without creating price points',()=>{
 const series=observedSeries([row(1),row(2),row(3,{priceWei:'100000000000000000'})]),g=curveGeometry(series);
 assert.equal(g.xy.length,3);assert.equal((g.path.match(/C/g)||[]).length,2);assert.equal(g.change,0);
 assert.equal(curveGeometry([]),null);assert.equal(curveGeometry(observedSeries([row(1)])).change,0);
});
test('zero price change baseline is unknown, not infinite growth',()=>{
 const g=curveGeometry(observedSeries([row(1,{priceWei:'0'}),row(2)]));assert.equal(g.change,null);
});
test('trade volume remains separate, exact and limited to supplied block range',()=>{
 const p={fromBlock:1,toBlock:3,trades:[{event:'Bought',block:2,time:1234,hash:H(9),usd:'900719925474099300000',tokens:'300'}]};
 assert.equal(tradeHistory(p).volumeWei,900719925474099300000n);
 for(const bad of [{usd:'0'},{tokens:'NaN'},{block:4},{event:'Invented'}])assert.throws(()=>tradeHistory({...p,trades:[{...p.trades[0],...bad}]}));
 assert(!read('frontend/live-market.js').includes('localStorage'));assert(!read('frontend/live-market.js').includes('tradeData'));assert(!read('frontend/live-market.js').includes('candles('));
});
function source({failure=false,reorg=false,chain=97n}={}){
 const calls=[];
 const rpc={getNetwork:async()=>({chainId:chain}),getBlock:async n=>{const number=n==='latest'?10:n;return {number,hash:H(reorg&&n!== 'latest'?99:number),timestamp:1000+number};}};
 const token=Object.fromEntries(['price','totalSupply','cycle'].map((name,i)=>[name,async o=>{calls.push(o);if(failure&&o.blockTag===5)throw Error('pruned');return [10n**17n,10n**18n,1n][i];}]));
 return {rpc,token,calls};
}
test('historical prices use explicit block tags and a bounded read budget',async()=>{
 const f=source(),rows=await historicalObservations(f.token,f.rpc,{chainId:97,deployedBlock:1},{count:4,lookback:9});
 assert.deepEqual(rows.map(r=>r.block),[1,4,7,10]);assert.equal(f.calls.length,12);assert(f.calls.every(c=>Number.isInteger(c.blockTag)));
});
test('missing historical state fails instead of substituting zero or latest',async()=>{
 const f=source({failure:true});await assert.rejects(()=>historicalObservations(f.token,f.rpc,{chainId:97,deployedBlock:1},{count:10,lookback:9}),/pruned/);
 const r=source({reorg:true});await assert.rejects(()=>readObservation(r.token,r.rpc,{number:10,hash:H(10),timestamp:1010}),/reorganized/);
});
test('wrong-chain and excessive historical reads are rejected before collecting prices',async()=>{
 const f=source({chain:56n});await assert.rejects(()=>historicalObservations(f.token,f.rpc,{chainId:97,deployedBlock:1}),/network/);assert.equal(f.calls.length,0);
 const g=source();await assert.rejects(()=>historicalObservations(g.token,g.rpc,{chainId:97,deployedBlock:1},{count:500,lookback:10}),/budget/);
});
test('all frontend surfaces build local controls and keep write guards',()=>{
 const main=read('frontend/main.jsx'),controller=read('frontend/controller.js');
 assert(main.includes('<LanguageSelect/>'));assert(!main.includes('id="language-toggle"'));
 assert(controller.includes("$('#language-select').disabled=busy||connecting"));assert(!controller.includes('cfg.selectableHourlyAutoBuy===true'));
 assert(controller.includes("Request recorded on-chain; no monthly funds have been paid by this request."));
 assert(read('web/index.html').includes('./global-interface.css'));
 assert(read('landing/src/initial-landing.jsx').includes('lang={language}'));
 assert(read('landing/src/initial-landing.jsx').includes('<TranslationNotice includePersian/>'));
});

test('conflicting values for an unchanged block hash are rejected',()=>{
 assert.throws(()=>mergeObservations([row(1)],[row(1,{priceWei:'999'})]),/Conflicting/);
});
