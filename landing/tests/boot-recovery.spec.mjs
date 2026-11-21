import {test, expect} from '@playwright/test';

test.use({screenshot: 'only-on-failure', trace: 'retain-on-failure'});

const readyModule = `
  const main = document.createElement('main');
  main.id = 'main';
  main.textContent = 'Workspace boot fixture';
  document.getElementById('root').replaceChildren(main);
`;

test('a cold mobile visit shows workspace navigation before either script starts', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/app/boot-guard.js', async route => { await gate; await route.continue(); });
  await page.route('**/app/app.js', async route => {
    await gate;
    await route.fulfill({contentType:'text/javascript',body:readyModule});
  });
  try {
    await page.goto('/app/?lang=fa#overview',{waitUntil:'commit'});
    const preview = page.locator('[data-fti-boot]');
    await expect(preview).toBeVisible();
    await expect(page.locator('[data-fti-preview-title]')).toHaveText('پنل اعضا');
    await expect(page.locator('[data-fti-preview-home]')).toBeVisible();
    await expect(page.locator('[data-fti-preview-market]')).toBeVisible();
    await expect(page.locator('[data-fti-recovery]')).toBeHidden();
    await expect(page.locator('[data-fti-native-retry]')).toBeHidden();
  } finally { release(); }
  await expect(page.locator('main#main')).toHaveText('Workspace boot fixture');
});

for (const [lang, error] of [
  ['fa','پنل باز نشد'],
  ['en','The workspace could not open'],
]) {
  test(`a failed application module enables an inline retry in ${lang}`, async ({page}) => {
    await page.route('**/app/app.js',route => route.fulfill({status:404,contentType:'text/javascript',body:''}));
    await page.goto('/app/?lang='+lang);
    const preview = page.locator('[data-fti-boot]');
    await expect(preview).toHaveAttribute('data-state','error');
    await expect(page.locator('[data-fti-boot-message]')).toContainText(error);
    await expect(page.locator('[data-fti-boot-retry]')).toBeVisible();
    await expect(page.locator('[data-fti-native-retry]')).toBeHidden();
    await expect(preview).toHaveAttribute('lang',lang);
    await expect(preview).toHaveAttribute('dir',lang==='fa'?'rtl':'ltr');
  });
}

test('manual retry preserves the invitation, language and requested section', async ({page}) => {
  let requests = 0;
  await page.route('**/app/app.js', route => {
    requests++;
    return requests === 1
      ? route.fulfill({status:404,contentType:'text/javascript',body:''})
      : route.fulfill({contentType:'text/javascript',body:readyModule});
  });
  const path = '/app/?lang=en&sponsor=0x1111111111111111111111111111111111111111#network';
  await page.goto(path);
  await expect(page.locator('[data-fti-boot]')).toHaveAttribute('data-state','error');
  await expect(page.locator('[data-fti-preview-member]')).toHaveAttribute('href','#overview');
  const originalUrl = page.url();
  expect(requests).toBe(1);
  await page.locator('[data-fti-boot-retry]').click();
  await expect(page.locator('main#main')).toHaveText('Workspace boot fixture');
  await expect(page.locator('[data-fti-boot]')).toHaveCount(0);
  await expect(page).toHaveURL(originalUrl);
  expect(requests).toBe(2);
});

test('a slow module can still open after the inline delay notice', async ({page}) => {
  let requests = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.clock.install();
  await page.route('**/app/app.js', async route => {
    requests++;
    await gate;
    await route.fulfill({contentType:'text/javascript',body:readyModule});
  });
  try {
    await page.goto('/app/?lang=en',{waitUntil:'commit'});
    const preview = page.locator('[data-fti-boot]');
    await expect(preview).toHaveAttribute('data-fti-guarded','');
    await expect(page.locator('[data-fti-recovery]')).toBeHidden();
    await page.clock.fastForward(18001);
    await expect(preview).toHaveAttribute('data-state','slow');
    await expect(page.locator('[data-fti-boot-retry]')).toBeVisible();
    expect(requests).toBe(1);
  } finally { release(); }
  await expect(page.locator('main#main')).toHaveText('Workspace boot fixture');
  await expect(page.locator('[data-fti-boot]')).toHaveCount(0);
  expect(requests).toBe(1);
});

test('a blocked guard leaves usable navigation and a delayed native retry', async ({page, context}) => {
  let requests = 0;
  await context.route('**/app/app.js',route => {
    requests++;
    return requests === 1 ? route.abort('failed') : route.fulfill({contentType:'text/javascript',body:readyModule});
  });
  await context.route('**/app/boot-guard.js',route => route.abort('failed'));
  const path = '/app/?lang=fa&ref=0x1111111111111111111111111111111111111111#network';
  await page.goto(path);
  await expect(page.locator('[data-fti-preview-home]')).toBeVisible();
  const nativeRetry = page.locator('[data-fti-native-retry]');
  await expect(nativeRetry).toBeHidden();
  await nativeRetry.evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
  await expect(nativeRetry).toBeVisible();
  await expect(nativeRetry).toHaveAttribute('target','_blank');
  expect(requests).toBe(1);
  const popupPromise = page.waitForEvent('popup');
  await nativeRetry.click();
  const popup = await popupPromise;
  await expect(popup.locator('main#main')).toHaveText('Workspace boot fixture');
  expect(new URL(popup.url()).search).toBe(new URL(page.url()).search);
  expect(requests).toBe(2);
});

test('an entry exception restores an emptied root with recovery controls',async ({page}) => {
  await page.route('**/app/app.js',route => route.fulfill({contentType:'text/javascript',body:`
    document.getElementById('root').replaceChildren(document.createComment('React root cleared'));
    throw new Error('Startup failure fixture');
  `}));
  await page.goto('/app/?lang=en');
  await expect(page.locator('[data-fti-boot]')).toHaveAttribute('data-state','error');
  await expect(page.locator('[data-fti-boot-retry]')).toBeVisible();
});
