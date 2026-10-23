import {test, expect} from '@playwright/test';

test.use({screenshot: 'only-on-failure', trace: 'retain-on-failure'});

const readyModule = `
  const main = document.createElement('main');
  main.textContent = 'Workspace boot fixture';
  document.getElementById('root').replaceChildren(main);
`;

for (const [lang, title] of [
  ['fa', 'بازشدن پنل کامل نشد'],
  ['en', 'The workspace did not finish opening'],
]) {
  test(`missing application module shows an actionable ${lang} fallback`, async ({page}) => {
    await page.route('**/app/app.js', route => route.fulfill({status: 404, contentType: 'text/javascript', body: ''}));
    await page.goto('/app/?lang=' + lang);
    const fallback = page.locator('[data-fti-boot]');
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute('data-state', 'error', {timeout: 15000});
    await expect(page.locator('[data-fti-boot-title]')).toHaveText(title);
    await expect(page.locator('[data-fti-boot-retry]')).toBeEnabled();
    await expect(fallback).toHaveAttribute('lang', lang);
    await expect(fallback).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
  });
}

test('manual retry preserves language, referral and the selected page without automatic retries', async ({page}) => {
  let requests = 0;
  await page.route('**/app/app.js', route => {
    requests++;
    return requests === 1
      ? route.fulfill({status: 404, contentType: 'text/javascript', body: ''})
      : route.fulfill({contentType: 'text/javascript', body: readyModule});
  });
  const path = '/app/?lang=en&ref=0x1111111111111111111111111111111111111111#network';
  await page.goto(path);
  await expect(page.locator('[data-fti-boot]')).toHaveAttribute('data-state', 'error', {timeout: 15000});
  expect(requests).toBe(1);
  const originalUrl = page.url();
  await page.locator('[data-fti-boot-retry]').click();
  await expect(page.locator('main')).toHaveText('Workspace boot fixture');
  await expect(page.locator('[data-fti-boot]')).toHaveCount(0);
  await expect(page).toHaveURL(originalUrl);
  expect(requests).toBe(2);
});

test('a stalled module reaches a bounded error and can still finish later', async ({page}) => {
  let requests = 0;
  let resolveRoute;
  const pendingRoute = new Promise(resolve => { resolveRoute = resolve; });
  await page.route('**/app/app.js', route => { requests++; resolveRoute(route); });
  await page.goto('/app/?lang=en', {waitUntil: 'commit'});
  const route = await pendingRoute;
  await expect(page.locator('[data-fti-boot]')).toBeVisible();
  await expect(page.locator('[data-fti-boot]')).toHaveAttribute('data-state', 'error', {timeout: 15000});
  expect(requests).toBe(1);
  await route.fulfill({contentType: 'text/javascript', body: readyModule});
  await expect(page.locator('main')).toHaveText('Workspace boot fixture');
  await expect(page.locator('[data-fti-boot]')).toHaveCount(0);
  expect(requests).toBe(1);
});

test('a blocked boot guard leaves a native retry that starts a fresh document', async ({page, context}) => {
  let requests = 0;
  await context.route('**/app/app.js', route => {
    requests++;
    return requests === 1
      ? route.abort('failed')
      : route.fulfill({contentType: 'text/javascript', body: readyModule});
  });
  await context.route('**/app/boot-guard.js', route => route.abort('failed'));
  const path = '/app/?lang=en&ref=0x1111111111111111111111111111111111111111#network';
  await page.goto(path);
  await expect(page.locator('[data-fti-boot-title]')).toHaveText('در حال بازشدن پنل FTI');
  await expect(page.locator('[data-fti-boot-help]')).toBeVisible();
  const retry = page.locator('[data-fti-boot-retry]');
  await expect(retry).toHaveText('بازکردن دوباره در برگهٔ جدید');
  await expect(retry).toHaveAttribute('target', '_blank');
  expect(requests).toBe(1);
  const popupPromise = page.waitForEvent('popup');
  await retry.click();
  const popup = await popupPromise;
  await expect(popup.locator('main')).toHaveText('Workspace boot fixture');
  expect(new URL(popup.url()).search).toBe(new URL(page.url()).search);
  expect(requests).toBe(2);
});

test('a startup exception cannot leave an emptied root blank', async ({page}) => {
  await page.route('**/app/app.js', route => route.fulfill({contentType: 'text/javascript', body: `
    document.getElementById('root').replaceChildren(document.createComment('React root cleared'));
    throw new Error('Startup failure fixture');
  `}));
  await page.goto('/app/?lang=en');
  await expect(page.locator('[data-fti-boot]')).toBeVisible();
  await expect(page.locator('[data-fti-boot]')).toHaveAttribute('data-state', 'error', {timeout: 15000});
  await expect(page.locator('[data-fti-boot-retry]')).toBeEnabled();
});
