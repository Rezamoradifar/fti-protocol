import test from 'node:test';
import assert from 'node:assert/strict';
import {completeTranslations} from '../frontend/complete-translations.js';
import {translate} from '../frontend/locale.js';
import {languageFrom,normalizeLanguage,withLanguage,LANGUAGES} from '../frontend/language-policy.js';
for(const lang of ['ar','tr','zh-CN'])test(`${lang}: complete catalog and transaction copy`,()=>{
 const entries=Object.entries(completeTranslations[lang]);assert.ok(entries.length>500);
 assert.deepEqual(Object.keys(completeTranslations[lang]).sort(),Object.keys(completeTranslations.ar).sort());
 for(const [key,value] of entries){assert.ok(value.trim(),key);assert.equal(translate(key,lang),value);assert.equal(translate(key,'en'),key);}
 for(const key of ['Register your wallet in Membership before buying FTI.','Add at least one membership unit before buying FTI.','Your inviter and position stay unchanged when you add units.'])assert.notEqual(translate(key,lang),key);
 const address='0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9';assert.equal(translate(address,lang),address);
 assert.equal(translate('RPC error: execution reverted 0x1234',lang),'RPC error: execution reverted 0x1234');
});
test('language continuity preserves referrals and hashes',()=>{
 const url=withLanguage('https://ftiprotocol.com/app/?sponsor=0x123#membership','ar');
 assert.equal(new URL(url).searchParams.get('sponsor'),'0x123');assert.equal(new URL(url).hash,'#membership');assert.equal(languageFrom(url,'en'),'ar');
 assert.equal(normalizeLanguage('zh-Hans'),'zh-CN');assert.equal(LANGUAGES.find(x=>x.code==='ar').dir,'rtl');assert.equal(languageFrom('https://ftiprotocol.com',null),'fa');
});

test('all mainnet NetworkText copy is localized, including when real API data arrives',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../frontend/main.jsx',import.meta.url),'utf8');
 const keys=[...source.matchAll(/main="([^"]+)"/g)].map(x=>x[1]);
 for(const lang of ['ar','tr','zh-CN'])for(const key of keys){
  if(['100 USD','USD / FTI'].includes(key))continue;
  assert.notEqual(translate(key,lang),key,`${lang}: ${key}`);
 }
});
