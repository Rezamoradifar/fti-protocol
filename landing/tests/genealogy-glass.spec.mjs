import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';

const root=path.resolve('..');
const account='0x1111111111111111111111111111111111111111';
const left='0x2222222222222222222222222222222222222222';
const right='0x3333333333333333333333333333333333333333';
let bundle,css;

test.beforeAll(async()=>{
  const result=await build({stdin:{contents:`import {initNetworkTree} from './frontend/network-tree.js';
import {ZeroAddress} from '/vendor/ethers.js';
const account=${JSON.stringify(account)},left=${JSON.stringify(left)},right=${JSON.stringify(right)};
const base={exists:true,parent:ZeroAddress,left:ZeroAddress,right:ZeroAddress,units:1n,rank:0n,carryL:0n,carryR:0n,lifetimeL:0n,lifetimeR:0n};
const rows=new Map([[account,{...base,units:3n,rank:1n,left,right,carryL:0n,carryR:5n,lifetimeL:10n,lifetimeR:15n}],[left,{...base,parent:account}],[right,{...base,parent:account,carryL:2n,carryR:0n,lifetimeL:7n,lifetimeR:4n}]]);
const binary={members:async(a,at)=>{if(window.__qaTreeFailure)throw Error('Deliberate fixture outage');if(at.blockTag!==100)throw Error('Unexpected snapshot');const value=rows.get(a.toLowerCase());if(!value)throw Error('Missing fixture member');return value;}};
initNetworkTree(binary,{getBlockNumber:async()=>100},1,1,{testAssets:false,currency:'USDT'});`,resolveDir:root,sourcefile:'genealogy-ui-fixture.js'},write:false,bundle:true,format:'esm',target:'es2022',external:['/vendor/ethers.js']});
  bundle=result.outputFiles[0].text;
  css=['web/style.css','frontend/member-landing-theme.css','frontend/glass-interface.css','frontend/global-interface.css','landing/tests/fixtures/member-panel-installed-identity.css','frontend/member-reserve-panel.css'].map(name=>fs.readFileSync(path.join(root,name),'utf8').replace("@import './glass-interface.css';",'')).join('\n');
});

async function setup(page,{width=390,lang='en',light=false}={}){
  await page.setViewportSize({width,height:1000});
  await page.addInitScript(lang=>localStorage.setItem('fti-language',lang),lang);
  await page.route('**/genealogy-fixture.js',route=>route.fulfill({contentType:'text/javascript',body:bundle}));
  await page.route('**/genealogy-fixture.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="${lang}" dir="${lang==='fa'?'rtl':'ltr'}" data-appearance="glass"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body data-surface="member" class="${light?'light':''}"><main style="margin:0!important;padding:16px!important;max-width:100%;box-sizing:border-box"><p data-qa-fixture>UI fixture · Test data · Transactions disabled</p><article class="member-readiness"><h2>Appearance preview</h2><p>Read-only test surface</p></article><article id="network-explorer"></article></main><script type="module" src="/genealogy-fixture.js"></script></body></html>`}));
  await page.goto('/genealogy-fixture.html');
  await page.locator('#network-explorer form input').fill(account);
  await page.locator('#network-explorer form button').click();
  await expect(page.locator('.binary-node')).toHaveCount(3);
}

for(const width of [320,390,1440])for(const lang of ['en','fa'])test(`genealogy preserves branch values and stays usable ${width} ${lang}`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await setup(page,{width,lang});
  const rootCard=page.locator('.binary-node[data-branch="root"]');
  await expect(rootCard.locator('.binary-node-address')).toHaveText('0x1111…1111');
  const format=new Intl.NumberFormat(lang==='fa'?'fa-IR':'en-US');
  await expect(rootCard.locator('.binary-metric-row b')).toHaveText([format.format(0)+' / '+format.format(5),format.format(10)+' / '+format.format(15)]);
  await expect(page.locator('.tree-details')).not.toContainText(/test USD|دلار آزمایشی/);
  await expect(page.locator('.tree-details')).toContainText('300');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if(width===390&&lang==='fa')await page.screenshot({path:test.info().outputPath('genealogy-fa-390.png'),fullPage:true});
  await page.locator('.binary-node[data-branch="R"]').click();
  await expect(page.locator('.binary-node')).toHaveCount(1);
  await expect(page.locator('.binary-node-address')).toHaveText('0x3333…3333');
  await expect(page.locator('.binary-metric-row b')).toHaveText([format.format(2)+' / '+format.format(0),format.format(7)+' / '+format.format(4)]);
  await page.locator('.binary-tree-actions button').nth(1).click();
  await expect(page.locator('.binary-node')).toHaveCount(3);
  await page.locator('.binary-tree-actions button').first().click();
  await expect(page.locator('.binary-node-address')).toHaveText('0x3333…3333');
  expect(errors).toEqual([]);
});

test('a tree read failure removes the previous cards rather than inventing zero balances',async({page})=>{
  await setup(page);
  await page.evaluate(()=>{window.__qaTreeFailure=true;});
  await page.locator('.binary-tree-actions button').last().click();
  await expect(page.locator('#network-explorer [role=status]')).toContainText('Tree could not be read.');
  await expect(page.locator('.binary-node')).toHaveCount(0);
  await expect(page.locator('.tree-details')).toBeEmpty();
  await expect(page.locator('.binary-tree-scroll')).toHaveAttribute('aria-busy','false');
  await expect(page.locator('#network-explorer form button')).toBeEnabled();
});

for(const light of [false,true])test(`glass and solid visibly change mobile surfaces ${light?'light':'dark'}`,async({page})=>{
  await setup(page,{light});
  const surface=page.locator('.member-readiness');
  const glass=await surface.evaluate(el=>({background:getComputedStyle(el).backgroundColor,filter:getComputedStyle(el).backdropFilter||getComputedStyle(el).webkitBackdropFilter}));
  expect(glass.background).toMatch(/^rgba\(/);
  expect(glass.filter).toContain('blur');
  await page.evaluate(()=>{document.documentElement.dataset.appearance='solid';});
  const solid=await surface.evaluate(el=>({background:getComputedStyle(el).backgroundColor,filter:getComputedStyle(el).backdropFilter||getComputedStyle(el).webkitBackdropFilter}));
  expect(solid.background).toMatch(/^rgb\(/);
  expect(solid.filter).toBe('none');
  expect(solid.background).not.toBe(glass.background);
  await page.evaluate(()=>{document.documentElement.dataset.appearance='glass';});
  await expect(surface).toHaveCSS('background-color',glass.background);
});
