import {test,expect} from '@playwright/test';
for(const width of [390,1440])test(`protocol visual ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/?lang=en');
 const visual=page.locator('.protocol-visual');
 await expect(visual).toBeVisible();
 await expect(visual.locator('.orbit')).toHaveCount(2);
 await expect(visual.locator('.visual-members')).toHaveAttribute('href','/app/#network');
 await expect(visual.locator('.visual-token')).toHaveAttribute('href','/token/#trade');
 await expect.poll(()=>visual.locator('.coin-core img').evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
 await page.evaluate(()=>document.fonts.ready);
 await visual.screenshot({path:`test-results/protocol-visual-${width}.png`});
});
