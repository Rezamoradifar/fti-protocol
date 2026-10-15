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
