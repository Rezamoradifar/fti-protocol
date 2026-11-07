import {test,expect} from '@playwright/test';
for(const lang of ['en','fa'])test(`workspace guide ${lang}: keyboard and destinations`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(lang=>localStorage.setItem('fti-language',lang),lang);
 await page.goto('/');
 const tabs=page.locator('.tabs [role=tab]');
 await tabs.nth(0).focus();
 await tabs.nth(0).press('ArrowRight');
 await expect(tabs.nth(1)).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#flow-content .button')).toHaveAttribute('href','/token/#trade');
 await tabs.nth(2).click();
 await expect(tabs.nth(2)).toHaveAttribute('aria-selected','true');
 await tabs.nth(2).press('Home');
 await expect(tabs.nth(0)).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#flow-content .button')).toHaveAttribute('href','/token/#trade');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('.flow-panel').screenshot({path:`test-results/guide-${lang}-390.png`});
});
