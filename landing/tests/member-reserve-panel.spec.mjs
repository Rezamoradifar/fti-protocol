import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import {COLLATERAL_ABI} from '../../core/deployment-network.mjs';

const cfg = JSON.parse(fs.readFileSync(new URL('../../deployments/mainnet-20261016.json', import.meta.url)));
// Actual installed shared CSS from bbe304272f1c014425e29c80fe7be375dd3137b1.
// The no-restart panel installer publishes only app.js and the new member skin;
// it does not replace the existing panel-identity.css with a fresh local build.
const installedIdentity = fs.readFileSync(new URL('./fixtures/member-panel-installed-identity.css', import.meta.url));
const requiredHooks = ['fti-balance', 'usd-balance', 'claimable', 'unlocked', 'locked-summary', 'rank', 'rank-description', 'rank-progress', 'rank-points', 'rank-next', 'updated-at', 'welcome-copy', 'membership-status', 'wallet-address', 'allowance', 'account-units', 'account-network', 'copy-address', 'claim', 'faucet', 'step-wallet', 'step-funds', 'step-member', 'price', 'price-status', 'reserve', 'members', 'accounting'];

// Explicit unavailable-data fixture: exercises the real mounted controller and
// navigation without a wallet, signatures, fake balances or production writes.
async function panel(page, {width = 390, lang = 'en', theme = 'dark'} = {}) {
  await page.setViewportSize({width, height: 844});
  await page.addInitScript(({lang, theme}) => {
    localStorage.setItem('fti-language', lang);
    localStorage.setItem('fti-theme', theme);
  }, {lang, theme});
  await page.route('**/panel-identity.css', route => route.fulfill({contentType: 'text/css', body: installedIdentity}));
  await page.route('**/api/config', route => route.fulfill({json: cfg}));
  await page.route('**/api/state*', route => route.fulfill({status: 503, json: {error: 'Unavailable-data UI fixture'}}));
  await page.route('**/api/events', route => route.fulfill({json: []}));
  await page.route('**/abi/*', route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    // Match scripts/server.mjs: real mainnet collateral has a shared ERC20 ABI,
    // not a Solidity artifact named Collateral (and never the test faucet ABI).
    if (name === 'Collateral') return route.fulfill({json: COLLATERAL_ABI});
    if (name === 'MockUSD' && cfg.chainId === 56) return route.fulfill({status: 404, json: {error: 'Test ABI unavailable on mainnet'}});
    const artifact = JSON.parse(fs.readFileSync(new URL(`../../artifacts/${name}.json`, import.meta.url)));
    return route.fulfill({json: artifact.abi});
  });
  await page.route('**/rpc', async route => {
    const body = route.request().postDataJSON();
    const answer = call => call.method === 'eth_chainId'
      ? {jsonrpc: '2.0', id: call.id, result: '0x38'}
      : {jsonrpc: '2.0', id: call.id, error: {code: -32000, message: 'Read-only unavailable-data fixture'}};
    await route.fulfill({json: Array.isArray(body) ? body.map(answer) : answer(body)});
  });
  await page.goto('/app/');
  // Connect is enabled by the controller only after its DOM hooks are bound.
  await expect(page.locator('#connect')).toBeEnabled();
  await expect(page.locator('#global-network')).toHaveText('BNB Mainnet · 56');
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [320, 390, 1280]) for (const lang of ['fa', 'en']) for (const theme of ['dark', 'light']) {
  test(`unavailable-data panel navigation and layout ${width} ${lang} ${theme}`, async ({page}) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await panel(page, {width, lang, theme});
    for (const id of requiredHooks) await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
    for (const id of ['fti-balance', 'usd-balance', 'claimable']) await expect(page.locator('#' + id)).toHaveText('—');
    await expect(page.locator('#claim')).toBeDisabled();
    await expect(page.locator('#faucet')).toBeHidden();
    for (const id of ['network', 'rewards', 'activity', 'overview']) {
      await page.locator(`.sidebar nav [data-page="${id}"]`).click();
      await expect(page).toHaveURL(new RegExp('#' + id + '$'));
      await expect(page.locator('#' + id)).toBeVisible();
      await expect(page.locator('.sidebar nav [aria-current="page"]')).toHaveAttribute('data-page', id);
      await expect(page.locator('#page-title')).toBeFocused();
      await expect(page.locator('.page:not([hidden])')).toHaveCount(1);
    }
    await page.locator('.member-account-details > summary').click();
    await expect(page.locator('#wallet-address')).toBeVisible();
    await expect(page.locator('#unlocked')).toHaveText('—');
    await page.locator('.member-protocol-details > summary').click();
    await expect(page.locator('#price-status')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
  });
}

for (const width of [320, 390]) for (const lang of ['fa', 'en']) test(`member settings remain inside the viewport ${width} ${lang}`, async ({page}) => {
  await panel(page, {width, lang});
  await expect(page.locator('#language-select')).toBeHidden();
  await page.locator('.member-settings > summary').click();
  await expect(page.locator('#language-select')).toBeVisible();
  await expect(page.locator('.member-settings .fti-appearance')).toBeVisible();
  await expect(page.locator('#refresh-state')).toBeVisible();
  const popup = await page.locator('.member-settings-panel').boundingBox();
  expect(popup).not.toBeNull();
  expect(popup.x).toBeGreaterThanOrEqual(0);
  expect(popup.y).toBeGreaterThanOrEqual(0);
  expect(popup.x + popup.width).toBeLessThanOrEqual(width + 1);
  expect(popup.y + popup.height).toBeLessThanOrEqual(845);
  for (const selector of ['#language-select', '.member-settings .fti-appearance', '#refresh-state']) {
    const control = await page.locator(selector).boundingBox();
    expect(control, selector).not.toBeNull();
    expect(control.x, selector).toBeGreaterThanOrEqual(popup.x - 1);
    expect(control.y, selector).toBeGreaterThanOrEqual(popup.y - 1);
    expect(control.x + control.width, selector).toBeLessThanOrEqual(popup.x + popup.width + 1);
    expect(control.y + control.height, selector).toBeLessThanOrEqual(popup.y + popup.height + 1);
  }
  const requests = [];
  page.on('request', request => {if (new URL(request.url()).pathname === '/api/state') requests.push(request.url());});
  await page.locator('#refresh-state').click();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  const glass = page.locator('.member-settings .fti-appearance');
  const wasGlass = await glass.getAttribute('aria-pressed');
  await glass.click();
  await expect(glass).toHaveAttribute('aria-pressed', wasGlass === 'true' ? 'false' : 'true');
  await page.locator('.member-settings > summary').click();
  await page.locator('#theme').click();
  await expect(page.locator('body')).toHaveClass(/light/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('fti-theme'))).toBe('light');
});

test('motion can be paused, persists on reload and stops away from the artwork', async ({page}) => {
  await panel(page);
  const art = page.locator('.member-reserve-art');
  const toggle = page.locator('.member-art-toggle');
  await toggle.scrollIntoViewIfNeeded();
  await expect(art).toHaveCSS('animation-play-state', 'running');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(art).toHaveCSS('animation-play-state', 'paused');
  await page.reload();
  await expect(page.locator('#connect')).toBeEnabled();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await expect(art).toHaveCSS('animation-play-state', 'running');
  await page.locator('.sidebar [data-page="network"]').click();
  await expect(art).toHaveCSS('animation-play-state', 'paused');
});

test('reduced motion disables the decorative animation', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await panel(page);
  await expect(page.locator('.member-reserve-art')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.member-art-toggle')).toBeHidden();
});

test('mobile bottom navigation leaves a focused membership input unobscured', async ({page}) => {
  await panel(page, {width: 320});
  await page.locator('.sidebar [data-page="network"]').click();
  const units = page.locator('#register-form input[name="units"]');
  await units.focus();
  await units.scrollIntoViewIfNeeded();
  await expect(units).toBeFocused();
  // WebKit settles native focus/keyboard scrolling on animation frames.
  // Assert the resulting usable position, including our fixed navigation dock.
  await expect.poll(async () => {
    const input = await units.boundingBox();
    const nav = await page.locator('.sidebar nav').boundingBox();
    return input.y + input.height - nav.y;
  }).toBeLessThanOrEqual(0);
  await expect(page.locator('#register-button')).toBeDisabled();
  await expect(page.locator('#retry-pending-check')).toHaveCount(1);
});
