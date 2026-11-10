import {test,expect} from '@playwright/test';
test('protocol artwork loads and primary destinations respect reduced motion',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 const mark=page.locator('.hero-art img');
 await expect.poll(()=>mark.evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
 await expect(page.locator('.quick-actions a[href="/app/#network"]')).toBeVisible();
 await expect(page.locator('.quick-actions a[href="/token/#trade"]')).toBeVisible();
 await page.emulateMedia({reducedMotion:'reduce'});
 await expect(page.locator('.quick-action').first()).toHaveCSS('transition-property','none');
 await page.screenshot({path:'test-results/protocol-visual-mobile.png'});
});
