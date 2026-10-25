import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import {parseEther, ZeroAddress} from 'ethers';
import {COLLATERAL_ABI} from '../../core/deployment-network.mjs';

const cfg = JSON.parse(fs.readFileSync(new URL('../../deployments/mainnet-20261016.json', import.meta.url)));
const publicFixture = JSON.parse(fs.readFileSync(new URL('../../preview/state.json', import.meta.url)));
// The installer keeps this already deployed shared stylesheet; a fresh local
// build must not hide incompatibilities between it and the new member skin.
const installedIdentity = fs.readFileSync(new URL('./fixtures/member-panel-installed-identity.css', import.meta.url));
const account = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const wei = value => parseEther(value).toString();

async function previewScreenshot(page, path, options = {}) {
  // Label the capture in the test document itself; do not edit image pixels or
  // present synthetic account values as a live production-wallet screenshot.
  await page.evaluate(() => {
    const note = document.createElement('p');
    note.dataset.qaFixture = '';
    note.textContent = 'UI preview · Test data · Transactions disabled';
    note.setAttribute('role', 'note');
    note.style.cssText = 'position:sticky;top:0;z-index:2147483647;margin:0;padding:5px 8px;background:#17251c;color:#e0ffcc;border-bottom:1px solid #54705b;font:11px/1.4 Arial,sans-serif;text-align:center;direction:ltr;pointer-events:none';
    document.body.prepend(note);
  });
  try { await page.screenshot({path, ...options}); }
  finally { await page.evaluate(() => document.querySelector('[data-qa-fixture]')?.remove()); }
}

// Deliberately simulated UI data, not an assertion about a production wallet.
// The provider authorizes only this synthetic account and rejects every write.
async function setup(page, {width = 390, lang = 'en', theme = 'dark', healthy = false, pendingAuto = '3.45'} = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({width, height: width === 390 ? 844 : 1000});
  await page.addInitScript(({lang, theme, account}) => {
    localStorage.setItem('fti-language', lang);
    localStorage.setItem('fti-theme', theme);
    window.__qaWalletMethods = [];
    window.ethereum = {isMetaMask: true, on() {}, removeListener() {}, request: async ({method}) => {
      window.__qaWalletMethods.push(method);
      if (method === 'eth_chainId') return '0x38';
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
      throw Error('QA wallet rejects all other methods: ' + method);
    }};
  }, {lang, theme, account});
  let outage = !healthy;
  await page.route('**/panel-identity.css', route => route.fulfill({contentType: 'text/css', body: installedIdentity}));
  await page.route('**/api/config', route => route.fulfill({json: cfg}));
  await page.route('**/api/state*', route => {
    if (outage) return route.fulfill({status: 503, json: {error: 'Deliberate UI fixture outage'}});
    const wallet = new URL(route.request().url()).searchParams.has('wallet') ? {
      address: account, exists: true, rank: 1, units: '3', lifetimeL: '125', lifetimeR: '200', carryL: '4', carryR: '8',
      creditL: wei('20'), creditR: wei('30'), autoPending: wei(pendingAuto), claimable: wei('2.5'), usdBalance: wei('500'),
      ftiBalance: wei('12.34567'), unlocked: wei('12.34567'), remaining: wei('700'),
      autoEnabled: true, maxAutoPrice: '0', locks: [], lockCount: '0', directReferrals: '2',
      referrer: other, parent: other, left: ZeroAddress, right: ZeroAddress,
    } : null;
    return route.fulfill({json: {...publicFixture, block: 129333333, timestamp: Math.floor(Date.now() / 1000), level: '0',
      tokenStateVerified: true, tokenPaused: false, emergencyUnwind: false, paused: false, wallet}});
  });
  await page.route('**/api/events', route => route.fulfill({json: [
    {name: 'Registered', block: 129333330, hash: '0x' + '1'.repeat(64), args: [{name: 'member', value: account}]},
    {name: 'Bought', block: 129333331, hash: '0x' + '2'.repeat(64), args: [{name: 'buyer', value: other}]},
    {name: 'Claimed', block: 129333332, hash: '0x' + '3'.repeat(64), args: [{name: 'member', value: account}]},
  ]}));
  await page.route('**/abi/*', route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({json: name === 'Collateral' ? COLLATERAL_ABI
      : JSON.parse(fs.readFileSync(new URL('../../artifacts/' + name + '.json', import.meta.url))).abi});
  });
  await page.route('**/rpc', route => {
    const calls = route.request().postDataJSON();
    const answer = call => ({jsonrpc: '2.0', id: call.id, ...(call.method === 'eth_chainId'
      ? {result: '0x38'} : {error: {code: -32000, message: 'Contract capability reads intentionally unavailable in UI fixture'}})});
    return route.fulfill({json: Array.isArray(calls) ? calls.map(answer) : answer(calls)});
  });
  await page.goto('/app/');
  await expect(page.locator('#connect')).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  return {errors, outage: value => {outage = value;}};
}

async function connect(page) {
  await page.locator('#connect').click();
  await page.getByRole('button', {name: 'MetaMask', exact: true}).click();
  await expect(page.locator('#disconnect')).toBeVisible();
  await expect(page.locator('#wallet-address')).toHaveText(account);
}

for (const width of [390, 1440]) for (const lang of ['fa', 'en']) for (const theme of ['dark', 'light']) {
  test(`professional panel unavailable-data navigation ${width} ${lang} ${theme}`, async ({page}) => {
    const fixture = await setup(page, {width, lang, theme});
    await expect(page.locator('.member-personal-metrics article')).toHaveCount(4);
    await expect(page.locator('.member-personal-metrics strong')).toHaveText(['—', '—', '—', '—']);
    await expect(page.locator('.member-invite-card button')).toBeDisabled();
    await expect(page.locator('#claim')).toBeDisabled();
    for (const id of ['network', 'rewards', 'activity', 'support', 'overview']) {
      await page.locator(`.sidebar [data-page="${id}"]`).click();
      await expect(page).toHaveURL(new RegExp('#' + id + '$'));
      await expect(page.locator('#' + id)).toBeVisible();
      await expect(page.locator('.sidebar [aria-current="page"]')).toHaveAttribute('data-page', id);
      await expect(page.locator('#page-title')).toBeFocused();
    }
    await page.locator('.member-shortcuts button').last().click();
    await expect(page.locator('#support')).toBeVisible();
    await page.locator('#support .member-faq summary').first().click();
    await expect(page.locator('#support .member-faq details').first().locator('p')).toBeVisible();
    await page.locator('.member-settings-toggle').click();
    await expect(page.locator('#language-select')).toBeVisible();
    await expect(page.locator('#refresh-state')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#language-select')).toBeHidden();
    await page.locator('#theme').click();
    await expect.poll(() => page.locator('body').evaluate(el => el.classList.contains('light'))).toBe(theme !== 'light');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(fixture.errors).toEqual([]);
    expect(await page.evaluate(() => window.__qaWalletMethods.filter(method => /sendTransaction|sign/i.test(method)))).toEqual([]);
  });
}

for (const width of [390, 1440]) test(`verified account metrics, invitation and event filtering ${width}`, async ({page, browserName}) => {
  const fixture = await setup(page, {width, healthy: true});
  await connect(page);
  await expect(page.locator('.member-account-signal')).toHaveAttribute('data-state', 'verified');
  await expect(page.locator('.member-personal-metrics strong')).toHaveText(['3', '125', '10', '3.45']);
  await expect(page.locator('#fti-balance')).toHaveText('12.34567');
  await expect(page.locator('#usd-balance')).toHaveText('500');
  await expect(page.locator('#claimable')).toHaveText('2.5');
  await expect(page.locator('#dashboard-invitation')).toHaveValue(new RegExp('sponsor=' + account));
  await expect(page.locator('.member-invite-card button')).toBeEnabled();
  await previewScreenshot(page, test.info().outputPath('verified-account-' + width + '.png'));
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('.member-invite-card button').click();
  await expect.poll(async () => {
    const copied = (await page.locator('.member-invite-card button').innerText()).includes('Link copied');
    const selected = await page.locator('#referral-link').evaluate(el => el.value.length > 0 && el.selectionStart === 0 && el.selectionEnd === el.value.length && document.activeElement === el);
    return copied || selected;
  }).toBe(true);
  if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('sponsor=' + account);
  await page.locator('.sidebar [data-page="activity"]').click();
  await expect(page.locator('.member-activity-results article')).toHaveCount(3);
  await page.locator('.member-activity-search').fill('Bought');
  await expect(page.locator('.member-activity-results article')).toHaveCount(1);
  await page.locator('.member-activity-search').fill('');
  await page.locator('[data-event-scope="wallet"]').click();
  await expect(page.locator('.member-activity-results article')).toHaveCount(2);
  await page.locator('.member-activity-results article').first().locator('summary').click();
  await expect(page.locator('.member-activity-results article').first().locator('dd')).toHaveText(account);
  await page.locator('.sidebar [data-page="overview"]').click();
  fixture.outage(true);
  await page.locator('.member-settings-toggle').click();
  await page.locator('#refresh-state').click();
  await expect(page.locator('.member-account-signal')).toHaveAttribute('data-state', 'stale');
  await expect(page.locator('.member-personal-metrics strong')).toHaveText(['3', '125', '—', '3.45']);
  await expect(page.locator('.member-readiness h2')).toHaveText('Refresh before continuing.');
  await expect(page.locator('#wallet-address')).toHaveText(account);
  await previewScreenshot(page, test.info().outputPath('stale-account-' + width + '.png'));
  await page.locator('.member-settings-toggle').click();
  await page.locator('#disconnect').click();
  await expect(page.locator('.member-personal-metrics strong')).toHaveText(['—', '—', '—', '—']);
  await expect(page.locator('#dashboard-invitation')).toHaveValue('');
  expect(fixture.errors).toEqual([]);
  expect(await page.evaluate(() => window.__qaWalletMethods.filter(method => /sendTransaction|sign/i.test(method)))).toEqual([]);
});

test('support validates the hash and prepares a mailto draft without sending it', async ({page}) => {
  await setup(page);
  await page.locator('.sidebar [data-page="support"]').click();
  const form = page.locator('.member-support-form form');
  await form.locator('[name="description"]').fill('QA fixture: unable to read account data after a refresh.');
  await form.locator('[name="hash"]').fill('0x1234');
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('.member-email-draft')).toHaveCount(0);
  await form.locator('[name="hash"]').fill('0x' + 'a'.repeat(64));
  await form.locator('button[type="submit"]').click();
  const link = page.locator('.member-email-draft a');
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^mailto:Support@FTIProtocol\.com\?/i);
  expect(decodeURIComponent(href)).toContain('QA fixture: unable to read account data after a refresh.');
  expect(decodeURIComponent(href)).toContain('Wallet: Not connected');
  await previewScreenshot(page, test.info().outputPath('support-draft.png'));
  // Intentionally do not click the mailto link or send any message.
});

test('Persian connected amounts use localized digits and the help tab is translated', async ({page}) => {
  await setup(page, {lang: 'fa', healthy: true});
  await connect(page);
  await expect(page.locator('.member-account-signal')).toHaveAttribute('data-state', 'verified');
  await expect(page.locator('.member-personal-metrics strong').last()).toHaveText(new Intl.NumberFormat('fa-IR', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(3.45));
  await expect(page.locator('.sidebar [data-page="support"]')).toHaveText('مرکز راهنما');
  await previewScreenshot(page, test.info().outputPath('verified-account-fa-390.png'));
});

test('network lookup distinguishes invalid addresses from unavailable contract reads', async ({page}) => {
  const fixture = await setup(page);
  await page.locator('.sidebar [data-page="network"]').click();
  await page.locator('#network-explorer-details > summary').click();
  const form = page.locator('#network-explorer form');
  await form.locator('input').fill('not-an-address');
  await form.locator('button').click();
  await expect(page.locator('#network-explorer [role="status"]')).toHaveText('Enter a valid wallet address.');
  await form.locator('select').selectOption('6');
  await form.locator('input').fill(account);
  await form.locator('button').click();
  await expect(page.locator('#network-explorer [role="status"]')).toContainText('Tree could not be read. Retry; no missing value is displayed as zero.');
  await expect(page.locator('#network-explorer .binary-node')).toHaveCount(0);
  await expect(form.locator('button')).toBeEnabled();
  expect(fixture.errors).toEqual([]);
});

for (const [lang, amount] of [['en', '< 0.01'], ['fa', '< ۰٫۰۱']]) test(`a small nonzero pending amount does not become zero ${lang}`, async ({page}) => {
  await setup(page, {lang, healthy: true, pendingAuto: '0.004'});
  await connect(page);
  await expect(page.locator('.member-account-signal')).toHaveAttribute('data-state', 'verified');
  await expect(page.locator('.member-personal-metrics strong').last()).toHaveText(amount);
});

test('an authorized wallet with every account read failing stays connected and visibly unavailable', async ({page}) => {
  const fixture = await setup(page);
  await connect(page);
  await expect(page.locator('.member-account-signal')).toHaveAttribute('data-state', 'unavailable');
  await expect(page.locator('.member-account-signal')).toContainText('Account unavailable');
  await expect(page.locator('.member-personal-metrics strong')).toHaveText(['—', '—', '—', '—']);
  for (const id of ['fti-balance', 'usd-balance', 'claimable', 'unlocked']) await expect(page.locator('#' + id)).toHaveText('—');
  await expect(page.locator('#dashboard-invitation')).toHaveValue('');
  await expect(page.locator('#register-button')).toBeDisabled();
  await expect(page.locator('#claim')).toBeDisabled();
  await expect(page.locator('#disconnect')).toBeVisible();
  expect(await page.evaluate(() => window.__qaWalletMethods.filter(method => /sendTransaction|sign/i.test(method)))).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
