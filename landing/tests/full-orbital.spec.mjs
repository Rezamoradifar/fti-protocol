import {test,expect} from '@playwright/test';
for(const width of [390,1440])test(`complete orbital page ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.route('**/api/config',r=>r.fulfill({json:{chainId:56,mode:'bnb-mainnet'}}));
 await page.goto('/');
 for(const img of await page.locator('.protocol-art').all()){
   await img.scrollIntoViewIfNeeded();
   await expect.poll(()=>img.evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
 }
 await expect(page.locator('.feature-card .protocol-art')).toHaveCount(3);
 await expect(page.locator('.architecture-card .protocol-art')).toHaveCount(3);
 await expect(page.locator('.steps .protocol-art')).toHaveCount(3);
 await expect(page.locator('.closing .protocol-art')).toHaveCount(1);
 await page.evaluate(()=>document.fonts.ready);
 for(const id of ['protocol','architecture','journey','roadmap']){
  await page.locator('#'+id).screenshot({path:`test-results/full-${id}-${width}.png`});
 }
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:`test-results/full-orbital-${width}.png`,fullPage:true});
});
