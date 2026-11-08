import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const cfg=JSON.parse(fs.readFileSync(new URL('../../deployments/mainnet-20261016.json',import.meta.url)));
for(const theme of ['dark','light'])for(let i=0;i<8;i++)test(`theme diagnostic ${theme} ${i}`,async({page})=>{
 await page.setViewportSize({width:1280,height:850});
 await page.addInitScript(theme=>{localStorage.setItem('fti-language','en');localStorage.setItem('fti-theme',theme);globalThis.themeEvents=[];document.addEventListener('click',event=>{if(event.target?.closest?.('#theme'))globalThis.themeEvents.push({detail:event.detail,time:performance.now(),trusted:event.isTrusted})},true)},theme);
 await page.route('**/api/config',r=>r.fulfill({json:cfg}));
 await page.route('**/api/state',r=>r.fulfill({status:503,json:{error:'Read-only layout fixture'}}));
 await page.goto('/app/');await expect(page.locator('#theme')).toBeVisible();
 const snapshot=()=>page.evaluate(()=>({events:globalThis.themeEvents,light:document.body.classList.contains('light'),aria:document.querySelector('#theme').getAttribute('aria-pressed'),saved:localStorage.getItem('fti-theme'),bg:getComputedStyle(document.querySelector('#connect')).backgroundColor}));
 await expect.poll(async()=>(await snapshot()).light).toBe(theme==='light');
 await page.locator('#theme').click();await expect.poll(async()=>(await snapshot()).light).toBe(theme!=='light');
 await page.locator('#theme').click();
 try{await expect.poll(async()=>(await snapshot()).light).toBe(theme==='light');await expect(page.locator('#connect')).toHaveCSS('background-color',theme==='light'?'rgb(56, 106, 55)':'rgb(201, 252, 162)');}
 finally{console.log('THEME_DIAGNOSTIC',theme,i,JSON.stringify(await snapshot()));}
});
