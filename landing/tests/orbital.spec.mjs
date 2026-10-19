import {test,expect} from '@playwright/test';
for(const width of [390,1440])test(`orbital concept ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/?lang=en');
 const art=page.locator('.orbital-hero-art');
 await expect(art.locator('.fti-header-mark image')).toHaveAttribute('href',/^data:image\/jpeg;base64,/);
 await expect(art.locator('.hud-ring')).toHaveCount(3);
 await page.getByRole('button',{name:'Pause motion',exact:true}).click();
 await expect(art.locator('.fti-header-mark')).toHaveCSS('animation-play-state','paused');
 await expect(art.locator('.ring-a')).toHaveCSS('animation-play-state','paused');
 await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:`test-results/orbital-preview-${width}.png`});
 await page.getByRole('button',{name:'Interactive 3D',exact:true}).click();
 await expect(page.locator('.token-axis')).toBeVisible();
 await expect(art).toBeHidden();
 await page.getByRole('button',{name:'Artwork view',exact:true}).click();
 await expect(art).toBeVisible();
});
