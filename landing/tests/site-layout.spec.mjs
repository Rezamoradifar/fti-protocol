import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const cfg=JSON.parse(fs.readFileSync(new URL('../../deployments/mainnet-20261016.json',import.meta.url)));
for(const route of ['/app/#network','/app/#rewards','/app/#activity','/token/#trade','/admin/'])for(const width of [320,390,1280])for(const lang of ['fa','en'])test(`${route} ${width} ${lang}`,async({page})=>{
 await page.setViewportSize({width,height:844});
 await page.addInitScript(({lang,width})=>{localStorage.setItem('fti-language',lang);localStorage.setItem('fti-theme',width===390?'light':'dark')},{lang,width});
 await page.route('**/abi/*',r=>{const name=new URL(r.request().url()).pathname.split('/').pop();const artifact=JSON.parse(fs.readFileSync(new URL('../../artifacts/'+(name==='Collateral'?'MockUSD':name)+'.json',import.meta.url)));return r.fulfill({json:artifact.abi});});
 await page.route('**/api/events',r=>r.fulfill({json:[]}));
 await page.route('**/api/config',r=>r.fulfill({json:cfg}));
 await page.route('**/api/state**',r=>r.fulfill({status:503,json:{error:'Layout fixture'}}));
 await page.route('**/rpc',r=>{const payload=r.request().postDataJSON();const result=q=>({jsonrpc:'2.0',id:q.id,result:q.method==='eth_chainId'?'0x38':'0x'+'0'.repeat(64)});return r.fulfill({json:Array.isArray(payload)?payload.map(result):result(payload)});});
 await page.goto(route);await expect(page.getByRole('status').first()).toContainText('Layout fixture');await page.evaluate(()=>document.fonts.ready);
 const over=await page.locator('main button,main input,main select,main h1,main h2,main p,main a').evaluateAll(els=>els.filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&(r.left< -1||r.right>innerWidth+1)}).map(el=>({tag:el.tagName,id:el.id,text:el.textContent.slice(0,50)})));
 expect(over).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:`test-results/site-${route.replaceAll(/[^a-z]/g,'')}-${width}-${lang}.png`,fullPage:true});
});
