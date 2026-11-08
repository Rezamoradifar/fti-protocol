import {test,expect} from '@playwright/test';

test('visitor asks a grounded question, gives explicit consent, receives a durable receipt and withdraws',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));let writes=0;page.on('request',request=>{if(request.url().endsWith('/api/customer-services/leads')&&request.method()==='POST')writes++;});
 await page.goto('/support/');await expect(page.getByRole('heading',{name:'A clear next step.'})).toBeVisible();
 await page.getByRole('button',{name:'Getting started',exact:true}).click();await expect(page.locator('.fti-services-message-assistant').last()).toContainText('successful transaction receipt');await expect(page.locator('.fti-services-message-assistant').last().getByRole('link',{name:'Open membership'})).toHaveAttribute('href','/app/#network');
 await page.getByLabel('Email or Telegram username').fill('browser-test@example.org');await page.getByLabel('What do you need? · optional').fill('This is an isolated browser test of request delivery.');
 await page.getByRole('button',{name:'Send request',exact:true}).click();expect(writes).toBe(0);
 await page.getByLabel(/I want FTI support to contact me/).check();await page.getByRole('button',{name:'Send request',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your request is recorded.'})).toBeVisible();const reference=await page.locator('.fti-services-receipt code').textContent();expect(reference).toMatch(/^[a-f0-9]{32}$/);expect(writes).toBe(1);
 await page.reload();await expect(page.locator('.fti-services-receipt code')).toHaveText(reference);await page.getByRole('button',{name:'Withdraw this request'}).click();await expect(page.getByRole('heading',{name:'Request withdrawn.'})).toBeVisible();
 expect(errors).toEqual([]);
});

test('unconfigured VPN has no checkout and routes an availability request to VPN interest',async({page})=>{
 await page.goto('/vpn/');await expect(page.locator('.fti-services-vpn')).toContainText('VPN ordering is not open here yet.');await expect(page.getByRole('button',{name:/Continue to VPN provider/})).toHaveCount(0);
 await page.getByRole('button',{name:'Request an update',exact:true}).click();await expect(page.getByLabel('I need help with')).toHaveValue('vpn');await expect(page.getByLabel('Email or Telegram username')).toBeFocused();
});

test('Persian mobile support remains usable without horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/support/?lang=fa');await expect(page.locator('.fti-services')).toHaveAttribute('dir','rtl');await expect(page.getByRole('heading',{name:'قدم بعدی، روشن.'})).toBeVisible();
 await page.getByRole('button',{name:'اتصال کیف‌پول',exact:true}).click();await expect(page.locator('.fti-services-message-assistant').last()).toContainText('عبارت بازیابی');
 const layout=await page.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,cls:el.className,left:Math.round(el.getBoundingClientRect().left),right:Math.round(el.getBoundingClientRect().right)})).filter(el=>el.right>window.innerWidth+1||el.left< -1).slice(0,30)}));
 expect(layout.scroll,JSON.stringify(layout)).toBeLessThanOrEqual(layout.width+1);
 await page.screenshot({path:'test-results/customer-support-fa-mobile.png',fullPage:true});
});
