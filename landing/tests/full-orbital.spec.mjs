import {test,expect} from '@playwright/test';
for(const width of [390,1440])test(`complete protocol landing ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.route('**/api/config',r=>r.fulfill({json:{chainId:56,mode:'bnb-mainnet'}}));
 await page.goto('/');
 await expect(page.locator('.protocol-visual')).toBeVisible();
 await expect(page.locator('.quick-actions > a')).toHaveCount(4);
 await expect(page.locator('.protocol-cards > article')).toHaveCount(3);
 await expect(page.locator('.journey-steps > article')).toHaveCount(3);
 const mark=page.locator('.protocol-coin .coin-core img');
 await expect.poll(()=>mark.evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
 await page.evaluate(()=>document.fonts.ready);
 for(const id of ['protocol','live-data','journey','faq']){
  await page.locator('#'+id).screenshot({path:`test-results/full-${id}-${width}.png`});
 }
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:`test-results/full-protocol-${width}.png`,fullPage:true});
});
