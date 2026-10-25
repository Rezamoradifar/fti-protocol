import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {panelMarketTranslations} from '../frontend/panel-market-translations.js';
import {completeTranslations} from '../frontend/complete-translations.js';
import {coreTranslations} from '../frontend/core-translations.js';
import {landingTranslations} from '../frontend/landing-translations.js';
import {memberTranslations} from '../frontend/member-translations.js';
import {panelCompletionTranslations} from '../frontend/panel-completion-translations.js';
import {translate} from '../frontend/locale.js';
const canonical=(key,language)=>completeTranslations[language]?.[key]??landingTranslations[language]?.[key]??coreTranslations[language]?.[key]??memberTranslations[language]?.[key]??panelCompletionTranslations[language]?.[key];
const critical=[
 'Change wallet','USDT balance','USDT · BNB Smart Chain','Estimated FTI value','Gross contract value before fees',
 'Registered wallet positions','Includes the 31 initial positions. Buying more units does not create another wallet.',
 'Add FTI to display its token balance. Your wallet decides whether a currency price is available.',
 'Add FTI to wallet','Manual token import','Copy token address','A fresh wallet balance and contract price are required.',
 'Automatic import was not confirmed. You can add FTI manually using the contract below.',
 'Copy the token contract address shown below.','FTI was added to your wallet.','Review the token import in your wallet.',
 'The previous WalletConnect session is still open. Choose another browser wallet, or close that session in your wallet before reconnecting.',
 'Token address copied.','Token import was declined.',
 // Chart axis labels are generated in loops, so they are explicit here.
 'Price range · USD','Price range · tUSD','From · UTC','To · UTC','Type','Price · USD','Price · tUSD','Date and time · UTC',
];
const chartTree=new Set();
for(const name of ['live-market.js','network-tree.js']){
 const source=readFileSync(new URL('../frontend/'+name,import.meta.url),'utf8');
 for(const match of source.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g))chartTree.add(match[2].replace(/\\'/g,"'").replace(/\\"/g,'"'));
}
for(const language of ['fa','ar','tr','zh-CN','ru','es'])test(language+': price, wallet-value and token-import copy is complete and preserves financial identifiers',()=>{
 const catalog=panelMarketTranslations[language];assert.equal(Object.keys(catalog).length,43);
 assert.deepEqual(Object.keys(catalog).sort(),Object.keys(panelMarketTranslations.fa).sort());
 for(const [key,value]of Object.entries(catalog)){
  assert.equal(typeof value,'string',key);assert(value.trim(),key);assert.notEqual(value,key,key);assert(!/[<>]|undefined|\[object Object\]/.test(value),key);
  for(const identifier of ['FTI','WalletConnect','USDT','tUSD','UTC'])if(key.includes(identifier)){
   // The source uses the established Persian name for Tether in this label.
   const localizedTether=language==='fa'&&key==='USDT balance'&&identifier==='USDT'&&value.includes('تتر');
   assert(localizedTether||value.includes(identifier),key+': '+identifier);
  }
 }
 for(const key of critical)assert.equal(typeof catalog[key],'string',key);
});
for(const language of ['ar','tr','zh-CN'])test(language+': every literal chart and genealogy label has a canonical or supplemental translation',()=>{
 assert(chartTree.size>40);
 for(const key of chartTree){const translated=canonical(key,language)??panelMarketTranslations[language]?.[key];assert.equal(typeof translated,'string',key);if(canonical(key,language)===undefined)assert.notEqual(translated,key,key);}
});
for(const language of ['fa','en','ar','tr','zh-CN','ru','es'])test(language+': new catalog supplements existing canonical wording without changing English keys',()=>{
 for(const key of Object.keys(panelMarketTranslations.fa)){
  const expected=language==='en'?key:canonical(key,language)??panelMarketTranslations[language][key];
  assert.equal(translate(key,language),expected,key);
 }
});

test('market catalogs do not treat inherited object properties as translations',()=>{
 assert.equal(panelMarketTranslations.__proto__,undefined);
 for(const catalog of Object.values(panelMarketTranslations)){assert.equal(Object.getPrototypeOf(catalog),null);assert.equal(catalog.__proto__,undefined);assert.equal(catalog.constructor,undefined);}
 assert.equal(translate('__proto__','ru'),'__proto__');assert.equal(translate('constructor','es'),'constructor');
});
