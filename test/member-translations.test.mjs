import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {memberTranslations} from '../frontend/member-translations.js';

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
