import {test,expect} from '@playwright/test';
test('HUD logo animates and respects reduced motion with the matching hero emblem',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 const logo=page.locator('.header .fti-header-mark');
 await expect(logo).toHaveCSS('animation-name','fti-hud-spin');
 const first=await logo.evaluate(el=>getComputedStyle(el).transform);
 await expect.poll(()=>logo.evaluate(el=>getComputedStyle(el).transform)).not.toBe(first);
 await expect(page.locator('.orbital-hero-art')).toBeVisible();
 await page.emulateMedia({reducedMotion:'reduce'});
 await expect(logo).toHaveCSS('animation-name','none');
 await expect(page.locator('.hero-hud .fti-header-mark')).toHaveCSS('animation-name','none');
 await expect(page.locator('.hero-hud .ring-a')).toHaveCSS('animation-name','none');
 await page.screenshot({path:'test-results/hologram-mobile.png'});
});
