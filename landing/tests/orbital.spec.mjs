import {test,expect} from '@playwright/test';
for(const width of [390,1440])test(`protocol visual ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/?lang=en');
 const visual=page.locator('.hero-art');
 await expect(visual).toBeVisible();
 await expect(page.locator('.quick-actions a[href="/app/#network"]')).toBeVisible();
 await expect(page.locator('.quick-actions a[href="/token/#trade"]')).toBeVisible();
 await expect.poll(()=>visual.locator('img').evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
 await page.evaluate(()=>document.fonts.ready);
 await visual.screenshot({path:`test-results/protocol-visual-${width}.png`});
});
