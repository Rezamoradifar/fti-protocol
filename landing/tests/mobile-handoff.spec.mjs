import {test,expect} from '@playwright/test';
for(const route of ['/','/token-site/','/whitepaper/','/roadmap/'])for(const width of [320,390,844])test(`${route} mobile ${width}: readable and contained`,async({page})=>{
 await page.setViewportSize({width,height:width===844?390:844});
 await page.addInitScript(()=>{localStorage.setItem('fti-language','fa')});
 await page.route('**/api/config',r=>r.fulfill({json:{chainId:56,mode:'bnb-mainnet'}}));
 await page.route('**/api/state',r=>r.fulfill({json:{}}));
 await page.goto(route);await page.evaluate(()=>document.fonts.ready);
 const over=await page.locator('h1,h2,h3,p,a,button,input,select,code').evaluateAll(els=>els.filter(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.visibility!=='hidden'&&r.width&&r.height&&(r.left < -1||r.right > innerWidth+1)}).map(el=>({tag:el.tagName,text:el.textContent.slice(0,70),width:Math.round(el.getBoundingClientRect().width)})));
 expect(over).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:`test-results/mobile-${route.replaceAll('/','')||'home'}-${width}.png`});
});
