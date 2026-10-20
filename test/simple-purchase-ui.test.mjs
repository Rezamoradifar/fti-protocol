import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const source=fs.readFileSync(new URL('../frontend/main.jsx',import.meta.url),'utf8');
const definitions=['Membership','WalletReview','TransactionHash','PendingRequest'].map(name=>{
 const start=source.indexOf('function '+name+'(');
 const end=source.indexOf('\nfunction ',start+1);
 return source.slice(start,end<0?undefined:end);
}).join('\n');
const result=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';const t=(en,fa)=>fa||en;const NetworkText=({fa,main})=>fa||main;const Icon=()=>null;const sites={};${definitions};export const render=name=>renderToStaticMarkup(React.createElement({Membership,WalletReview,TransactionHash,PendingRequest}[name]));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'cjs',write:false,define:{'process.env.NODE_ENV':'"production"'}});
const module={exports:{}};
new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const render=module.exports.render;

test('membership has one visible purchase action and a collapsible sponsor guide',()=>{
 const html=render('Membership');
 const form=html.match(/<form id="register-form">([\s\S]*?)<\/form>/)[1];
 assert.match(form,/<button[^>]+id="approve-units-button"[^>]+hidden=""/);
 assert.equal((form.match(/type="submit"/g)||[]).length,1);
 assert.match(form,/<button[^>]+id="register-button"[^>]*>خرید یونیت<\/button>/);
 assert.match(form,/<div id="registration-sponsor-field">[\s\S]*?<details[^>]*>[\s\S]*?<p[^>]+id="sponsor-help"/);
 assert.match(form,/<p id="membership-flow-status"[^>]*hidden=""/);
 assert.doesNotMatch(form,/مرحله ۱|مرحله ۲/);
});

test('wallet amount remains visible while network and nonce details start collapsed',()=>{
 const html=render('WalletReview');
 assert.match(html,/<p id="wallet-review-description"><\/p><details id="wallet-review-details"/);
 assert.match(html,/<details id="wallet-review-details"(?![^>]*\bopen\b)[^>]*>[\s\S]*?id="wallet-review-network"[\s\S]*?id="wallet-review-nonce"/);
 assert.match(html,/<\/details><div class="actions"><button id="confirm-wallet-request"/);
});

test('network panels and invitation guidance start collapsed without hiding the invitation link',()=>{
 const html=render('Membership');
 for(const id of ['membership-network-details','network-explorer-details'])assert.match(html,new RegExp('<details id="'+id+'"(?![^>]*\\bopen\\b)'));
 assert.match(html,/<details id="membership-network-details"[\s\S]*?id="tree"[\s\S]*?id="units"/);
 assert.match(html,/<details id="network-explorer-details"[\s\S]*?<article id="network-explorer"><\/article><\/details>/);
 assert.doesNotMatch(html,/<article id="network-explorer" class="panel"/);
 assert.match(html,/راهنمای دعوت[\s\S]*?<\/details><input id="referral-link"/);
 assert.match(html,/<button id="copy-referral"/);
});

test('unknown-request cancellation remains visible and manual recovery starts collapsed',()=>{
 const html=render('PendingRequest');
 const details=html.indexOf('<details id="transaction-recovery-details"');
 assert(html.indexOf('id="cancel-unknown"')<details);
 assert(html.indexOf('id="find-transaction-hash"')>details);
 assert(html.indexOf('name="hash"')>details);
 assert.match(html,/تراکنش صفر BNB[\s\S]*کارمزد شبکه[\s\S]*خرید یونیت نیست/);
 assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
});

test('a full returned hash and its copy action stay visible outside explanatory details',()=>{
 const html=render('TransactionHash');
 const details=html.indexOf('<details');
 assert(html.indexOf('id="copy-transaction-hash"')<details);
 assert(html.indexOf('id="transaction-hash-value"')<details);
 assert.match(html,/<input[^>]*id="transaction-hash-value"[^>]*readOnly=""[^>]*dir="ltr"/);
});
