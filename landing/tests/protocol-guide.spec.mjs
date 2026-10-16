import {test,expect} from '@playwright/test';
for(const lang of ['en','fa'])test(`workspace guide ${lang}: keyboard and destinations`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(lang=>localStorage.setItem('fti-language',lang),lang);
 await page.goto('/');
 const tabs=page.locator('.guide-toolbar [role=tab]');
 await tabs.nth(0).focus();
 await tabs.nth(0).press('ArrowRight');
 await expect(tabs.nth(1)).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#guide-content .button')).toHaveAttribute('href','/app/');
 await tabs.nth(2).click();
 await expect(page.locator('#guide-content .button')).toHaveAttribute('href','https://council.ftiprotocol.com/');
 await tabs.nth(2).press('Home');
 await expect(page.locator('#guide-content .button')).toHaveAttribute('href','/token/');
 await page.locator('.discovery-card summary').first().click();
 await expect(page.locator('.discovery-card').first()).toHaveAttribute('open','');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('.protocol-terminal').screenshot({path:`test-results/guide-${lang}-390.png`});
});
