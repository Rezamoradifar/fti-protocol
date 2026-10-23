import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {productionOrigin, requestViolation} from './helpers/production-policy.mjs';

// Ordinary unit/layout CI never contacts production through this file.
const enabled = process.env.FTI_PRODUCTION_SMOKE === '1';
test.skip(!enabled, 'Explicit read-only production verification only.');
if (enabled && !process.env.FTI_TEST_ORIGIN)
  throw Error('Set FTI_TEST_ORIGIN to an allowlisted FTI HTTPS origin.');
const origin = enabled ? productionOrigin(process.env.FTI_TEST_ORIGIN) : null;
const expectedApp = (process.env.FTI_EXPECTED_APP_SHA || '').toLowerCase();
if (enabled && expectedApp && !/^[a-f0-9]{64}$/.test(expectedApp))
  throw Error('FTI_EXPECTED_APP_SHA must be an application SHA-256 or empty.');

test.setTimeout(90000);
test.use({screenshot: 'only-on-failure', trace: 'retain-on-failure', serviceWorkers: 'block'});
const diagnostics = new WeakMap();
const appBundle = /\/(?:fti-[^/]+\/app-[^/]+\.js|app\.js)$/;
const publicReadReady = {
  en: 'Contract data loaded. Connect a wallet to manage your account.',
  fa: 'اطلاعات قرارداد خوانده شد. برای مدیریت حساب، ولت را متصل کنید.',
};

test.beforeEach(async ({page, context}) => {
  const state = {unsafe: [], errors: [], assets: [], appHashes: [], pending: [], workspace: false};
  diagnostics.set(page, state);
  // Continue real read requests without replacing their responses. Any possible
  // mutation is stopped before it leaves the browser and fails the smoke check.
  await context.route('**/*', async route => {
    const request = route.request();
    const violation = requestViolation({url: request.url(), method: request.method(), body: request.postData()});
    if (violation) {
      state.unsafe.push({reason: violation, method: request.method(), url: new URL(request.url()).origin + new URL(request.url()).pathname});
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  // This check never selects WalletConnect or establishes a wallet session.
  // Block sockets before connecting, including any unexpected signing channel.
  await context.routeWebSocket('**/*', async socket => {
    state.unsafe.push({reason: 'Unexpected WebSocket; no wallet transport is allowed.'});
    await socket.close({code: 1008, reason: 'Read-only production smoke'});
  });
  page.on('pageerror', error => {
    if (!/chrome-extension:|moz-extension:/.test(error.stack || '')) state.errors.push(error.message);
  });
  page.on('console', message => {
    if (/content security policy|refused to (load|execute)|violates.+policy/i.test(message.text()))
      state.errors.push(message.text());
  });
  page.on('response', response => {
    const kind = response.request().resourceType();
    const url = response.url(), mime = response.headers()['content-type'] || '';
    const webp = kind === 'image' && /\.webp$/i.test(new URL(url).pathname);
    if (!['script', 'stylesheet'].includes(kind) && !webp) return;
    const expectedMime = webp ? /^image\/webp\b/i : kind === 'stylesheet' ? /^text\/css\b/i : /^(text|application)\/(javascript|ecmascript)\b/i;
    if (response.status() >= 400) state.assets.push({url, status: response.status()});
    if (response.ok() && !expectedMime.test(mime))
      state.assets.push({url, status: response.status(), mime});
    if (expectedApp && response.ok() && appBundle.test(new URL(url).pathname)) {
      state.pending.push(response.body().then(bytes => {
        state.appHashes.push({url, sha256: createHash('sha256').update(bytes).digest('hex')});
      }).catch(() => state.assets.push({url, error: 'Application body unavailable for digest verification.'})));
    }
  });
  page.on('requestfailed', request => {
    if (['script', 'stylesheet'].includes(request.resourceType()) ||
        request.resourceType() === 'image' && /\.webp$/i.test(new URL(request.url()).pathname))
      state.assets.push({url: request.url(), error: request.failure()?.errorText});
  });
});

test.afterEach(async ({page}, testInfo) => {
  const state = diagnostics.get(page);
  if (!state) return;
  await Promise.allSettled(state.pending);
  await testInfo.attach('production-read-only-checks', {
    body: JSON.stringify({unsafe: state.unsafe, pageErrors: state.errors, assetErrors: state.assets,
      applicationDigests: state.appHashes}, null, 2), contentType: 'application/json',
  });
  expect(state.unsafe, 'No account, signing, transaction, API mutation or wallet transport request may escape.').toEqual([]);
  expect(state.errors, 'No application JavaScript or CSP error.').toEqual([]);
  expect(state.assets, 'Real script, stylesheet and requested WebP downloads must succeed with their expected MIME types.').toEqual([]);
  if (expectedApp && state.workspace)
    expect(state.appHashes.some(asset => asset.sha256 === expectedApp), 'The actually downloaded workspace application must match the requested release digest.').toBe(true);
});

async function workspace(page, path = '/app/', language = 'en') {
  await page.addInitScript(language => {
    if (!sessionStorage.getItem('fti-production-smoke-initialized')) {
      localStorage.setItem('fti-language', language);
      localStorage.setItem('fti-theme', 'dark');
      sessionStorage.setItem('fti-production-smoke-initialized', '1');
    }
  }, language);
  const response = await page.goto(origin + path, {waitUntil: 'domcontentloaded', timeout: 45000});
  expect(response?.status()).toBe(200);
  productionOrigin(new URL(page.url()).origin);
  diagnostics.get(page).workspace = true;
  if (path === '/token/') {
    // The token layout deliberately hides the shared workspace title at desktop
    // and mobile widths; its visible content starts with the token hero instead.
    await expect(page.locator('#token-home')).toBeVisible({timeout: 35000});
    await expect(page.locator('#token-home .token-hero h2')).toBeVisible();
    await expect(page.locator('#token-home .token-hero h2')).toHaveText(/A token with\s*visible mechanics\./);
  } else await expect(page.locator('#page-title')).toBeVisible({timeout: 35000});
  await expect(page.locator('#connect')).toBeEnabled({timeout: 35000});
  // Enabled wallet controls do not imply the initial public data read finished.
  // Wait for real read success before a language change reloads the document.
  await expect(page.locator('#status')).toHaveText(publicReadReady[language], {timeout: 35000});
  await expect(page.locator('#global-network')).toHaveText('BNB Mainnet · 56');
  await expect(page.locator('#wallet-review-panel')).toBeHidden();
  await page.evaluate(() => document.fonts.ready);
}

test('actual landing page renders its content and application link', async ({page}) => {
  const response = await page.goto(origin + '/', {waitUntil: 'domcontentloaded', timeout: 45000});
  expect(response?.status()).toBe(200);
  productionOrigin(new URL(page.url()).origin);
  await expect(page.locator('#root h1')).toBeVisible({timeout: 35000});
  await expect(page.locator('a[href="/app/"]').first()).toBeVisible();
});

test('actual mobile member navigation, settings, language and theme work', async ({page}, testInfo) => {
  await page.setViewportSize({width: 390, height: 844});
  await workspace(page, '/app/', 'fa');
  const toggle = page.locator('.member-settings-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#language-select')).toBeVisible();
  const popup = await page.locator('.member-settings-panel').boundingBox();
  expect(popup.x).toBeGreaterThanOrEqual(0);
  expect(popup.x + popup.width).toBeLessThanOrEqual(391);
  await page.locator('#language-select').selectOption('en');
  await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('en');
  await expect(page.locator('#connect')).toBeEnabled({timeout: 35000});
  await expect(page.locator('#status')).toHaveText(publicReadReady.en, {timeout: 35000});
  await toggle.click();
  await expect(page.locator('#language-select')).toBeVisible();
  await toggle.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  await page.locator('#theme').click();
  await expect(page.locator('body')).toHaveClass(/light/);
  for (const id of ['network', 'rewards', 'activity', 'overview']) {
    await page.locator(`.sidebar nav [data-page="${id}"]`).click();
    await expect(page.locator('#' + id)).toBeVisible();
    await expect(page.locator('#page-title')).toBeFocused();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path: testInfo.outputPath('actual-member-panel.png')});
});

test('actual wallet chooser opens and cancels without authorization or signing', async ({page}) => {
  await page.addInitScript(() => {
    window.__ftiSmokeWalletAnnounced = false;
    window.addEventListener('eip6963:announceProvider', () => { window.__ftiSmokeWalletAnnounced = true; });
  });
  await workspace(page);
  // An injected provider could auto-authorize the single-wallet SafePal path.
  // Fail before clicking if this is not a clean, wallet-free test context.
  expect(await page.evaluate(() => Boolean(window.ethereum || window.safepalProvider || window.__ftiSmokeWalletAnnounced))).toBe(false);
  await page.locator('#connect').click();
  const dialog = page.locator('.wallet-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#disconnect')).toBeHidden();
  await expect(page.locator('#wallet-review-panel')).toBeHidden();
});

for (const path of ['/token/', '/admin/']) test(`actual ${path} workspace renders without a wallet`, async ({page}) => {
  await workspace(page, path);
  await expect(page.locator('#disconnect')).toBeHidden();
});
