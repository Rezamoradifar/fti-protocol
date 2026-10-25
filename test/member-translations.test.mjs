import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {memberTranslations} from '../frontend/member-translations.js';
import {coreTranslations} from '../frontend/core-translations.js';
import {completeTranslations} from '../frontend/complete-translations.js';
import {landingTranslations} from '../frontend/landing-translations.js';
import {translate} from '../frontend/locale.js';

// Read the actual view copy, including event titles selected dynamically by
// contract name. New untranslated member controls must fail this check.
const required=new Set(['Help center','Account unavailable']);
for(const name of ['member-desk.jsx','member-activity.js']){
 const source=readFileSync(new URL('../frontend/'+name,import.meta.url),'utf8');
 for(const match of source.matchAll(/\b(?:t|translate)\('((?:\\.|[^'\\])*)'/g))required.add(match[1]);
 if(name==='member-activity.js')for(const match of source.matchAll(/(?:\w+:|return)\s*\['([^']+)'\s*,\s*'[\u0600-\u06ff]/g))required.add(match[1]);
}

for(const language of ['ar','tr','zh-CN'])test(language+': every new member control, help message and event title is localized',()=>{
 const catalog=memberTranslations[language];
 assert.ok(required.size>100);
 assert.deepEqual(Object.keys(catalog).sort(),Object.keys(memberTranslations.ar).sort());
 for(const key of required){
  assert.equal(typeof catalog[key],'string',key);
  assert.ok(catalog[key].trim(),key);
  assert.notEqual(catalog[key],key,key);
  if(key.includes('FTI'))assert.ok(catalog[key].includes('FTI'),key);
 }
});

for(const language of ['fa','en','ar','tr','zh-CN','ru','es'])test(language+': new member copy preserves established shared labels',()=>{
 for(const key of Object.keys(memberTranslations.ar)){
  const existing=completeTranslations[language]?.[key]??landingTranslations[language]?.[key]??coreTranslations[language]?.[key];
  const expected=language==='en'?key:existing??memberTranslations[language]?.[key];
  if(expected!==undefined)assert.equal(translate(key,language),expected,key);
 }
});

test('wallet and Chinese membership navigation retain the canonical accessible names',()=>{
 assert.equal(translate('Connect wallet','tr'),'Cüzdanı bağla');
 assert.equal(translate('Membership','zh-CN'),'会员');
 assert.equal(translate('Manage membership','zh-CN'),'管理会员信息');
});
