import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const cfg=JSON.parse(fs.readFileSync(new URL('../../deployments/mainnet-20261016.json',import.meta.url)));
for(const width of [320,390,844,1280])for(const lang of ['en','fa'])for(const theme of ['dark','light'])test(`workspace identity ${width} ${lang} ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:850});
 await page.addInitScript(({lang,theme})=>{localStorage.setItem('fti-language',lang);localStorage.setItem('fti-theme',theme)},{lang,theme});
 await page.route('**/api/config',r=>r.fulfill({json:cfg}));
 // Deliberate unavailable-data fixture: these are layout checks, not financial verification.
 await page.route('**/api/state',r=>r.fulfill({status:503,json:{error:'Read-only layout fixture'}}));
 await page.goto('/app/');
 await expect(page.locator('.sidebar .brand svg')).toHaveCount(1);
 await expect(page.locator('#theme')).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);
 await expect.poll(()=>page.locator('body').evaluate(el=>el.classList.contains('light'))).toBe(theme==='light');
 expect(await page.locator('.sidebar .brand').evaluate(el=>getComputedStyle(el,'::before').content)).toBe('none');
 expect(await page.locator('body').evaluate(el=>getComputedStyle(el).getPropertyValue('--accent').trim())).toBe(theme==='light'?'#386a37':'#c9fca2');
 const overflow=await page.locator('.sidebar a,.sidebar button,.workspace-header button,.workspace-header select,.global-tabs a,.priority-actions a').evaluateAll(els=>els.filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&(r.left< -1||r.right>innerWidth+1)}).map(el=>el.textContent));
 expect(overflow).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.locator('#theme').click();
 await expect.poll(()=>page.locator('body').evaluate(el=>el.classList.contains('light'))).toBe(theme!=='light');
 await page.locator('#theme').click();
 await expect(page.locator('#connect')).toHaveCSS('background-color',theme==='light'?'rgb(56, 106, 55)':'rgb(201, 252, 162)');
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:`test-results/panel-${width}-${lang}-${theme}.png`});
});
