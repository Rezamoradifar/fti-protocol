import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformSync} from 'esbuild';
import {workspacePages} from '../frontend/surfaces.js';
// Server-rendered structure checks only: no browser, layout, screenshots or wallet use.
const source=fs.readFileSync('frontend/main.jsx','utf8'),controller=fs.readFileSync('frontend/controller.js','utf8');
const compiled=transformSync(source,{loader:'jsx',format:'cjs'}).code;
function markup(surface){let html;vm.runInNewContext(compiled,{require(name){if(name==='react')return React;if(name==='react-dom/client')return {createRoot:()=>({render:element=>{html=renderToStaticMarkup(element);}})};if(name==='./surfaces.js')return {surface,surfaceTitle:surface.toUpperCase(),surfacePages:workspacePages[surface],defaultPage:workspacePages[surface][0][0]};throw Error('Unexpected import '+name);},document:{getElementById:()=>({})},exports:{}});return html;}
test('all three entry points server-render a distinct labeled workspace and one initially visible page',()=>{
 for(const surface of ['member','token','admin']){const html=markup(surface);assert(html.includes('class="surface-'+surface+'"'));const sections=[...html.matchAll(/<section id="([^"]+)"[^>]*>/g)];assert.equal(sections.length,7);assert.equal(sections.filter(([tag])=>!tag.includes('hidden')).length,1);assert.equal(sections.find(([tag])=>!tag.includes('hidden'))[1],workspacePages[surface][0][0]);}
});
test('all controller literal DOM IDs exist and React markup contains no duplicate IDs',()=>{
 const html=markup('member'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 const required=new Set([...controller.matchAll(/(?:text\('|\$\('#)([a-zA-Z][\w-]*)/g)].map(m=>m[1]));for(const id of required)assert(ids.includes(id),'Missing controller element '+id);
});
test('form controls retain stable IDs, meaningful labels and current safety disclosures',()=>{
 const html=markup('token');for(const id of ['buy-form','sell-form','transfer-form','timelock-preview','stale-notice','wallet-state','member-paid-points','proposals','events','contracts'])assert(html.includes('id="'+id+'"'));
 assert.equal((html.match(/name="deadline"/g)||[]).length,2);assert(html.includes('Network gas is additional'));assert(html.includes('Funds outside this contract are never re-debited'));assert(html.includes('id="auto-effective-at"'));assert(!html.includes('name="price"'));assert(html.includes('data-requires="autoSettings"'));assert(html.includes('Authority stays on-chain'));
});
