import {test,expect} from '@playwright/test';

for(const width of [320,390,768,1440]){
  for(const lang of ['en','fa']){
    for(const theme of ['dark','light']){
      test(`${width}px ${lang} ${theme}: mount, assets, RTL, layout and links`,async({page})=>{
        await page.setViewportSize({width,height:900});
        await page.addInitScript(({lang,theme})=>{localStorage.setItem('fti-language',lang);localStorage.setItem('fti-theme',theme)},{lang,theme});
        const errors=[],failed=[];
        page.on('pageerror',e=>errors.push(e.message));
        page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
        page.on('requestfailed',r=>failed.push(r.url()));
        page.on('response',r=>{if(r.status()>=400)failed.push(`${r.status()} ${r.url()}`)});
        await page.goto('/');
        await expect(page.locator('h1')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang',lang);
        await expect(page.locator('html')).toHaveAttribute('dir',lang==='fa'?'rtl':'ltr');
        await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
        await page.evaluate(()=>document.fonts.ready);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        const overflow=await page.locator('a,button,h1,h2,h3,p').evaluateAll(els=>els.filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&(r.left< -1||r.right>innerWidth+1)}).map(e=>e.textContent));
        expect(overflow).toEqual([]);
        const broken=await page.locator('a[href^="#"]').evaluateAll(links=>links.filter(a=>!document.getElementById(a.hash.slice(1))).map(a=>a.hash));
        expect(broken).toEqual([]);
        expect(await page.locator('a[href="/app/"]').count()).toBeGreaterThan(0);
        expect(await page.locator('a[href="/token/"]').count()).toBeGreaterThan(0);
        await expect(page.locator('a[href="https://t.me/FTIProtocol"]')).toHaveCount(1);
        await expect(page.locator('a[href="mailto:Support@FTIProtocol.com"]')).toHaveCount(2);
        await page.screenshot({path:`test-results/${width}-${lang}-${theme}.png`,fullPage:true});
        expect(errors).toEqual([]);expect(failed).toEqual([]);
      });
    }
  }
}

test('language/theme persistence, mobile menu, anchors, tabs and FAQ',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.getByRole('button',{name:'Switch to Persian'}).click();
  await expect(page.locator('html')).toHaveAttribute('dir','rtl');
  await page.getByRole('button',{name:'تغییر حالت رنگ'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang','fa');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  const menu=page.getByRole('button',{name:'منو',exact:true});
  await expect(page.locator('#navigation')).toBeHidden();
  await menu.click();await expect(menu).toHaveAttribute('aria-expanded','true');
  await page.keyboard.press('Escape');await expect(menu).toHaveAttribute('aria-expanded','false');
  await menu.click();await page.locator('#navigation a[href="#token"]').click();
  await expect(page).toHaveURL(/#token$/);await expect(menu).toHaveAttribute('aria-expanded','false');
  await page.getByRole('tab',{name:'فروش',exact:true}).click();
  await expect(page.getByRole('tabpanel')).toContainText('بازخرید FTI');
  await page.getByRole('tab',{name:'فروش',exact:true}).press('ArrowRight');
  await expect(page.getByRole('tab',{name:'انتقال',exact:true})).toBeFocused();
  await expect(page.getByRole('tab',{name:'انتقال',exact:true})).toHaveAttribute('aria-selected','true');
  await page.locator('summary').first().click();await expect(page.locator('details').first()).toHaveAttribute('open','');
});

test('font files are local and static paths fail honestly',async({page,request})=>{
  await page.goto('/');await page.evaluate(()=>document.fonts.ready);
  const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name));
  expect(resources.some(r=>r.includes('.woff2'))).toBe(true);
  expect(resources.filter(r=>new URL(r).origin!==new URL(page.url()).origin)).toEqual([]);
  expect((await request.get('/assets/missing.js')).status()).toBe(404);
});

test('mainnet badge follows verified runtime config and failed JS leaves a readable fallback',async({page})=>{
  await page.route('**/api/config',route=>route.fulfill({json:{chainId:56,mode:'bnb-mainnet'}}));
  await page.goto('/');await expect(page.locator('.status')).toContainText('BNB Mainnet · 56');
  await page.route('**/assets/*.js',route=>route.abort());
  await page.reload();await expect(page.locator('#fti-boot')).toBeVisible();
  await expect(page.locator('#fti-boot a')).toHaveAttribute('href','/app/');
});

for(const route of ['token-site','whitepaper','roadmap'])test(`preserves public ${route} document with unavailable data`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/state',r=>r.fulfill({status:503,json:{error:'Test fixture: data unavailable'}}));
  await page.route('**/api/config',r=>r.fulfill({status:503,json:{error:'Test fixture: config unavailable'}}));
  await page.goto('/'+route+'/');await expect(page.locator('h1')).toBeVisible();
  expect(await page.locator('body').innerText()).toContain('FTI');expect(errors).toEqual([]);
});

test('3D controls, reduced motion and educational binary calculations',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/');
 await expect(page.locator('.token-solid')).toHaveCSS('animation-name','none');
 const initial=await page.locator('.token-axis').getAttribute('style');
 await page.getByRole('button',{name:'Rotate token',exact:true}).click();
 expect(await page.locator('.token-axis').getAttribute('style')).not.toBe(initial);
 await page.getByRole('button',{name:'Pause motion',exact:true}).click();
 await expect(page.getByRole('button',{name:'Resume motion',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByLabel('Left points',{exact:true}).fill('15');
 await page.getByLabel('Right points',{exact:true}).fill('20');
 await page.getByLabel('Hourly point cap',{exact:true}).fill('5');
 await expect(page.locator('.lab-results strong')).toHaveText(['5','10','5']);
 await page.getByLabel('Hourly point cap',{exact:true}).fill('0');
 await expect(page.locator('.lab-results strong')).toHaveText(['0','15','5']);
 for(const id of ['binary','architecture','roadmap','resources'])await expect(page.locator('#'+id)).toHaveCount(1);
 for(const route of ['/whitepaper/','/roadmap/','/token-site/'])await expect(page.locator('.resource-links a[href="'+route+'"]').first()).toBeAttached();
});
