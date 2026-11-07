import {test,expect} from '@playwright/test';
test('protocol visual uses the supplied mark and respects reduced motion',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 const mark=page.locator('.protocol-coin .coin-core img');
 await expect.poll(()=>mark.evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
 await expect(page.locator('.visual-members')).toHaveAttribute('href','/app/#network');
 await expect(page.locator('.visual-token')).toHaveAttribute('href','/token/#trade');
 await page.emulateMedia({reducedMotion:'reduce'});
 await expect(page.locator('.visual-card').first()).toHaveCSS('transition-property','none');
 await page.screenshot({path:'test-results/protocol-visual-mobile.png'});
});
