import {test,expect} from '@playwright/test';
for(const width of [390,1440])test(`orbital concept ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/');
 const art=page.locator('.orbital-hero-art');
 await expect.poll(()=>art.evaluate(img=>img.complete&&img.naturalWidth===1200)).toBe(true);
 const response=await page.request.get(await art.getAttribute('src'));
 expect(response.headers()['content-type']).toContain('image/webp');
 await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:`test-results/orbital-preview-${width}.png`});
 await page.getByRole('button',{name:'Interactive 3D',exact:true}).click();
 await expect(page.locator('.token-axis')).toBeVisible();
 await expect(art).toBeHidden();
 await page.getByRole('button',{name:'Artwork view',exact:true}).click();
 await expect(art).toBeVisible();
});
