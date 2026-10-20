import {test,expect} from '@playwright/test';
for(const width of [320,390,1280])test(`readable fallback with blocked application at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});
 await page.route('**/assets/*.js',r=>r.abort());
 await page.goto('/');
 await expect(page.locator('#fti-boot')).toBeVisible();
 await expect(page.locator('#fti-boot h1')).toHaveCSS('font-size','26px');
 await expect(page.locator('#fti-boot a')).toHaveAttribute('href','/app/');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 const card=await page.locator('.fti-boot-card').boundingBox();expect(card.x).toBeGreaterThanOrEqual(0);expect(card.x+card.width).toBeLessThanOrEqual(width);
 await page.screenshot({path:`test-results/boot-${width}.png`});
});
test('fallback is replaced when application loads',async({page})=>{
 await page.goto('/');await expect(page.locator('.hero')).toBeVisible();await expect(page.locator('#fti-boot')).toHaveCount(0);
});
