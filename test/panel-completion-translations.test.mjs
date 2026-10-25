import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {panelCompletionTranslations} from '../frontend/panel-completion-translations.js';
import {memberTranslations} from '../frontend/member-translations.js';
import {coreTranslations} from '../frontend/core-translations.js';
import {completeTranslations} from '../frontend/complete-translations.js';
import {landingTranslations} from '../frontend/landing-translations.js';
import {translate} from '../frontend/locale.js';

// Extract literal UI copy from the actual new modules without evaluating the
// browser code. Dynamic topic/status keys and conditional guardian copy are
// explicitly enumerated so the same runtime labels receive coverage.
const required=new Set([
 'Wallet connection','Membership and referral','Rewards and auto-buy','Token transaction','Other',
 'open','answered','closed','GUARDIAN','COUNCIL OWNER',
 'Your connected wallet can propose and approve council actions.',
 'Five of seven guardian approvals are required.',
 'Three approvals are required to execute a proposal.',
 'This wallet is not a council guardian. Ready, already-authorized settlement operations remain available.',
 'Support inbox','Wallet history',
]);
for(const filename of ['member-history.js','support-tickets.js']){
 const source=readFileSync(new URL('../frontend/'+filename,import.meta.url),'utf8');
 for(const match of source.matchAll(/\bt\('((?:\\.|[^'\\])*)'/g)){
  const key=JSON.parse('"'+match[1].replace(/\\'/g,"'").replace(/"/g,'\\"')+'"');
  required.add(key);
 }
}
for(const language of ['ar','tr','zh-CN'])test(language+': every wallet-history, ticket and guardian control is localized',()=>{
 const catalog=panelCompletionTranslations[language];
 assert(required.size>=60);
 assert.deepEqual(Object.keys(catalog).sort(),Object.keys(panelCompletionTranslations.ar).sort());
 for(const key of required){
  assert.equal(typeof catalog[key],'string',key);assert(catalog[key].trim(),key);assert.notEqual(catalog[key],key,key);assert(!/[<>]/.test(catalog[key]),key);
  if(key.includes('FTI'))assert(catalog[key].includes('FTI'),key);
 }
});
for(const language of ['fa','en','ar','tr','zh-CN','ru','es'])test(language+': completion copy supplements existing canonical labels',()=>{
 for(const key of required){
  const canonical=completeTranslations[language]?.[key]??landingTranslations[language]?.[key]??coreTranslations[language]?.[key]??memberTranslations[language]?.[key];
  const expected=language==='en'?key:canonical??panelCompletionTranslations[language]?.[key];
  if(expected!==undefined)assert.equal(translate(key,language),expected,key);
 }
});
test('Persian inline copy is retained and unsupported languages keep an honest English fallback',()=>{
 const key='Verify wallet for support';
 assert.equal(translate(key,'fa','تأیید ولت برای پشتیبانی'),'تأیید ولت برای پشتیبانی');
 assert.equal(translate(key,'en'),key);assert.equal(translate(key,'ru'),key);assert.equal(translate(key,'es'),key);
});
