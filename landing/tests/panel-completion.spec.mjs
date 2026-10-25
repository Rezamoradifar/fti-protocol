import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import {Wallet, Interface, getBytes, toUtf8String, verifyMessage, parseEther, ZeroAddress} from 'ethers';
import {COLLATERAL_ABI} from '../../core/deployment-network.mjs';

// Publicly reproducible fixture keys sign only mocked support-access messages.
// The injected provider rejects every transaction and every other signature.
const member = new Wallet('0x' + '11'.repeat(32));
const second = new Wallet('0x' + '22'.repeat(32));
const guardian = new Wallet('0x' + '33'.repeat(32));
const cfg = {...JSON.parse(fs.readFileSync(new URL('../../deployments/mainnet-20261016.json', import.meta.url))), supportTicketVersion: 1, memberHistoryVersion: 1};
const publicState = JSON.parse(fs.readFileSync(new URL('../../preview/state.json', import.meta.url)));
const installedIdentity = fs.readFileSync(new URL('./fixtures/member-panel-installed-identity.css', import.meta.url));
const councilABI = new Interface(['function isGuardian(address) view returns (bool)', 'function proposalCount() view returns (uint256)']);
const H = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
const ticketId = '1'.repeat(32), nonce = '2'.repeat(32), token = '3'.repeat(64);
const wei = value => parseEther(value).toString();
const supportEnd = 'Sign only to access private support tickets. This does not authorize a transaction or spending.';

async function fixture(page, {lang = 'en', theme = 'dark', width = 390, admin = false, seedTicket = false} = {}) {
  const initial = admin ? guardian.address : member.address;
  const calls = [], methods = [], errors = [], signed = [];
  let current = initial, challenge, ticket = null, historyFailure = false;
  const now = () => Date.now();
  const createTicket = (message = 'QA fixture: a wallet request remained pending after refresh.') => ({version: 1, id: ticketId, wallet: member.address, topic: 'Wallet connection', hash: H(42), status: 'open', createdAt: now(), updatedAt: now(), messages: [{id: '4'.repeat(32), wallet: member.address, role: 'member', text: message, createdAt: now()}]});
  if (seedTicket) ticket = createTicket();
  const summary = r => ({id: r.id, wallet: r.wallet, topic: r.topic, hash: r.hash, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt, messageCount: r.messages.length, lastRole: r.messages.at(-1).role});
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({width, height: width === 390 ? 844 : 1000});
  await page.exposeFunction('__qaSupportSignature', async ({data, address}) => {
    const message = toUtf8String(getBytes(data));
    expect(address.toLowerCase()).toBe(current.toLowerCase());
    expect(message).toBe(challenge);
    expect(message.endsWith(supportEnd)).toBe(true);
    const wallet = current === guardian.address ? guardian : current === member.address ? member : second;
    const signature = await wallet.signMessage(message);
    signed.push({wallet: wallet.address, message});
    return signature;
  });
  await page.addInitScript(({lang, theme, initial}) => {
    localStorage.setItem('fti-language', lang);localStorage.setItem('fti-theme', theme);
    let selected = initial;const handlers = new Map();window.__qaWalletMethods = [];
    window.__qaChangeAccount = value => {selected = value;for (const listener of handlers.get('accountsChanged') || []) listener(value ? [value] : []);};
    window.ethereum = {isMetaMask: true,
      on(event, listener) {if (!handlers.has(event)) handlers.set(event, new Set());handlers.get(event).add(listener);},
      removeListener(event, listener) {handlers.get(event)?.delete(listener);},
      request: async ({method, params}) => {
        window.__qaWalletMethods.push(method);
        if (method === 'eth_chainId') return '0x38';
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return selected ? [selected] : [];
        if (method === 'personal_sign') return window.__qaSupportSignature({data: params[0], address: params[1]});
        throw Error('QA provider rejects transaction or unsupported signing method: ' + method);
      },
    };
  }, {lang, theme, initial});
  await page.route('**/panel-identity.css', route => route.fulfill({contentType: 'text/css', body: installedIdentity}));
  await page.route('**/api/config', route => route.fulfill({json: cfg}));
  await page.route('**/api/state*', route => {
    const wallet = new URL(route.request().url()).searchParams.has('wallet') ? {
      address: current, exists: true, rank: 1, units: '3', lifetimeL: '125', lifetimeR: '200', carryL: '4', carryR: '8',
      creditL: wei('20'), creditR: wei('30'), autoPending: wei('3.45'), claimable: wei('2.5'), usdBalance: wei('500'),
      ftiBalance: wei('12.34567'), unlocked: wei('12.34567'), remaining: wei('700'), autoEnabled: true, maxAutoPrice: '0',
      locks: [], lockCount: '0', directReferrals: '2', referrer: second.address, parent: second.address, left: ZeroAddress, right: ZeroAddress,
    } : null;
    return route.fulfill({json: {...publicState, block: 129333333, timestamp: Math.floor(now() / 1000), level: '0', tokenStateVerified: true, tokenPaused: false, emergencyUnwind: false, paused: false, wallet}});
  });
  await page.route('**/api/events', route => route.fulfill({json: []}));
  await page.route('**/abi/*', route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({json: name === 'Collateral' ? COLLATERAL_ABI : JSON.parse(fs.readFileSync(new URL('../../artifacts/' + name + '.json', import.meta.url))).abi});
  });
  await page.route('**/rpc', route => {
    const answer = call => {
      if (call.method === 'eth_chainId') return {jsonrpc: '2.0', id: call.id, result: '0x38'};
      if (call.method === 'eth_call' && call.params?.[0]?.to?.toLowerCase() === cfg.council.toLowerCase()) {
        try {
          const parsed = councilABI.parseTransaction({data: call.params[0].data});
          const result = parsed.name === 'isGuardian' ? parsed.args[0].toLowerCase() === guardian.address.toLowerCase() : 0;
          return {jsonrpc: '2.0', id: call.id, result: councilABI.encodeFunctionResult(parsed.name, [result])};
        } catch {}
      }
      return {jsonrpc: '2.0', id: call.id, error: {code: -32000, message: 'Other contract capability reads deliberately unavailable in QA fixture'}};
    };
    const calls = route.request().postDataJSON();
    return route.fulfill({json: Array.isArray(calls) ? calls.map(answer) : answer(calls)});
  });
  await page.route('**/api/support/**', route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const body = method === 'POST' ? request.postDataJSON() : undefined;
    calls.push({path, method, body, query: url.search, authorization: request.headers().authorization});
    if (path === '/api/support/challenge') {
      expect(body.wallet).toBe(current);
      const expiresAt = now() + 300000;
      challenge = ['FTI Protocol support access', '', 'Origin: ' + url.origin, 'Chain ID: 56', 'Binary contract: ' + cfg.binary, 'Wallet: ' + current, 'Nonce: ' + nonce, 'Issued at: ' + new Date(now()).toISOString(), 'Expires at: ' + new Date(expiresAt).toISOString(), '', supportEnd].join('\n');
      return route.fulfill({json: {nonce, message: challenge, expiresAt}});
    }
    if (path === '/api/support/session') {
      expect(body.nonce).toBe(nonce);expect(verifyMessage(challenge, body.signature)).toBe(current);
      return route.fulfill({json: {wallet: current, token, expiresAt: now() + 1800000}});
    }
    expect(request.headers().authorization).toBe('Bearer ' + token);
    const isAdmin = url.searchParams.get('scope') === 'admin';
    if (isAdmin) expect(current).toBe(guardian.address);
    if (path === '/api/support/tickets' && method === 'GET') return route.fulfill({json: {tickets: ticket && (isAdmin || ticket.wallet === current) ? [summary(ticket)] : [], nextOffset: null}});
    if (path === '/api/support/tickets' && method === 'POST') {
      expect(current).toBe(member.address);ticket = createTicket(body.message);ticket.topic = body.topic;ticket.hash = body.hash;
      return route.fulfill({status: 201, json: {ticket}});
    }
    if (path === '/api/support/tickets/' + ticketId + '/replies') {
      ticket.messages.push({id: '5'.repeat(32), wallet: current, role: isAdmin ? 'team' : 'member', text: body.message, createdAt: now()});
      ticket.status = isAdmin ? 'answered' : 'open';ticket.updatedAt = now();
      return route.fulfill({json: {ticket}});
    }
    if (path === '/api/support/tickets/' + ticketId + '/status') {
      expect(isAdmin).toBe(true);ticket.status = body.status;ticket.updatedAt = now();return route.fulfill({json: {ticket}});
    }
    if (path === '/api/support/tickets/' + ticketId && method === 'GET') return route.fulfill({json: {ticket}});
    return route.fulfill({status: 404, json: {error: 'SUPPORT_NOT_FOUND'}});
  });
  await page.route('**/api/member-history*', route => {
    const url = new URL(route.request().url()), wallet = url.searchParams.get('wallet'), cursor = url.searchParams.get('cursor');
    calls.push({path: url.pathname, method: route.request().method(), wallet, cursor});
    if (historyFailure) return route.fulfill({status: 503, json: {error: 'HISTORY_UNAVAILABLE'}});
    expect(wallet).toBe(current);
    const base = 127907000, old = cursor !== null;
    const block = base + (old ? 900 : 1900);
    return route.fulfill({json: {version: 1, scope: 'FTI_CONTRACT_ADDRESS_EVENTS', wallet, chainId: 56,
      snapshot: {number: base + 2000, hash: H(2000)}, range: {from: base + (old ? 1 : 1001), to: base + (old ? 1000 : 2000), deployedBlock: base + 1, complete: old},
      rows: [{name: old ? 'Claimed' : 'Registered', contract: 'binary', block, index: old ? 0 : 1, timestamp: 1792800000,
        hash: H(old ? 101 : 102), args: [{name: 'wallet', value: wallet}, {name: 'amount', value: '9007199254740993000000000'}]}], nextCursor: old ? null : 'qa-history-page-2'}});
  });
  await page.goto(admin ? '/admin/' : '/app/');
  await expect(page.locator('#connect')).toBeEnabled();await page.evaluate(() => document.fonts.ready);
  return {calls, signed, errors, methods,
    failHistory(value) {historyFailure = value;},
    teamReply() {ticket.messages.push({id: '6'.repeat(32), wallet: guardian.address, role: 'team', text: 'QA private team reply: please refresh the verified account data.', createdAt: now()});ticket.status = 'answered';ticket.updatedAt = now();},
    async changeWallet(value = second.address) {current = value;await page.evaluate(value => window.__qaChangeAccount(value), value);},
  };
}

async function connect(page, admin = false) {
  await page.locator('#connect').click();await page.getByRole('button', {name: 'MetaMask', exact: true}).click();
  await expect(page.locator('#disconnect')).toBeVisible();await expect(page.locator('#wallet-address')).toHaveText(admin ? guardian.address : member.address);
}
const memberTickets = page => page.locator('#member-support-tickets');
const adminTickets = page => page.locator('#admin-support-tickets');
async function openSupport(page) {await page.locator('.sidebar [data-page="support"]').click();await expect(page.locator('#member-support-panel')).toBeVisible();}
async function authorize(box) {await box.locator('.panel-head button').click();await expect(box.locator('.member-ticket-create')).toBeVisible();}
async function createReport(box, text = 'QA fixture: a wallet request stayed pending after refreshing the page.') {
  const form = box.locator('.member-ticket-create');await form.locator('textarea').fill(text);await form.locator('[name="hash"]').fill(H(42));await form.locator('button[type="submit"]').click();
  await expect(box.locator('.member-ticket-thread')).toContainText(ticketId);
}
async function assertNoTransactions(page, f) {
  expect(await page.evaluate(() => window.__qaWalletMethods.filter(method => /sendTransaction|eth_sign|signTypedData/.test(method)))).toEqual([]);
  expect(f.errors).toEqual([]);
}
async function labeledScreenshot(page, filename) {
  await page.evaluate(() => {const note = document.createElement('p');note.dataset.completionQa = '';note.textContent = 'UI preview · Test support and history data · No financial transactions';note.style.cssText = 'position:sticky;top:0;z-index:2147483647;margin:0;padding:5px 8px;background:#17251c;color:#e0ffcc;border-bottom:1px solid #54705b;font:11px/1.4 Arial,sans-serif;text-align:center;direction:ltr;pointer-events:none';document.body.prepend(note);});
  try {await page.screenshot({path: test.info().outputPath(filename), fullPage: true});}
  finally {await page.evaluate(() => document.querySelector('[data-completion-qa]')?.remove());}
}

test('member support signs a scoped message, creates a reference, exchanges replies and clears private state on account change', async ({page}) => {
  const f = await fixture(page);await connect(page);await openSupport(page);const box = memberTickets(page);
  expect(f.signed).toHaveLength(0);expect(f.calls.filter(call => call.path.startsWith('/api/support/'))).toHaveLength(0);
  await authorize(box);expect(f.signed).toHaveLength(1);await expect(box.locator('.member-ticket-list')).toContainText('No support tickets yet.');
  await createReport(box, 'QA fixture: <img src=x onerror=alert(1)> appears only as literal support text.');
  await expect(box.locator('.member-ticket-list .member-ticket-row')).toHaveCount(1);
  await expect(box.locator('.member-ticket-thread img')).toHaveCount(0);
  await expect(box.locator('.member-ticket-thread')).toContainText('<img src=x onerror=alert(1)>');
  const reply = box.locator('.member-ticket-thread form');await reply.locator('textarea').fill('QA member follow-up: the account still needs a verified refresh.');await reply.locator('button').click();
  await expect(box.locator('.member-ticket-message')).toHaveCount(2);
  f.teamReply();await box.getByRole('button', {name: 'Refresh tickets', exact: true}).click();
  await expect(box.locator('.member-ticket-message')).toHaveCount(3);await expect(box.locator('.member-ticket-thread')).toContainText('QA private team reply');await expect(box.locator('.member-ticket-thread')).toContainText('answered');
  expect(f.calls.filter(call => call.path === '/api/support/tickets' && call.method === 'POST')).toHaveLength(1);
  expect(await page.evaluate(() => Object.values(localStorage).some(value => /^[a-f0-9]{64}$/.test(value)))).toBe(false);
  const count = f.calls.length;await f.changeWallet();await expect(box.locator('.member-ticket-message')).toHaveCount(0);await expect(box.locator('.member-ticket-row')).toHaveCount(0);await expect(box.locator('.member-ticket-create')).toBeHidden();
  expect(f.calls.length).toBe(count);await assertNoTransactions(page, f);
});

test('personal history appends older pages, retains verified rows on failure, exports exact CSV and resets on account change', async ({page}) => {
  const f = await fixture(page);await connect(page);await page.locator('.sidebar [data-page="activity"]').click();const box = page.locator('#member-history');
  await expect(page.locator('#member-history-panel')).toBeVisible();expect(f.calls.filter(call => call.path === '/api/member-history')).toHaveLength(0);
  await box.locator('[data-history-action="older"]').click();await expect(box.locator('.member-history-results article')).toHaveCount(1);await expect(box.locator('[role="status"]')).toContainText('Older blocks remain');
  f.failHistory(true);await box.locator('[data-history-action="older"]').click();await expect(box.locator('[role="status"]')).toContainText('Earlier records are retained');await expect(box.locator('.member-history-results article')).toHaveCount(1);
  f.failHistory(false);await box.locator('[data-history-action="older"]').click();await expect(box.locator('.member-history-results article')).toHaveCount(2);await expect(box.locator('[role="status"]')).toContainText('Search complete to deployment');await expect(box.locator('[data-history-action="older"]')).toBeDisabled();
  const downloading = page.waitForEvent('download');await box.locator('[data-history-action="export"]').click();const download = await downloading;expect(download.suggestedFilename()).toMatch(/^FTI_History_[a-fA-F0-9]{8}_127909000\.csv$/);
  const csv = fs.readFileSync(await download.path(), 'utf8');expect(csv).toContain(H(101));expect(csv).toContain(H(102));expect(csv).toContain('9007199254740993000000000');
  await f.changeWallet();await expect(box.locator('.member-history-results article')).toHaveCount(0);await expect(box.locator('[data-history-action="export"]')).toBeDisabled();await expect(box.locator('[data-history-action="older"]')).toBeDisabled();await assertNoTransactions(page, f);
});

test('guardian support inbox exposes the role, replies as the team and closes a ticket without financial transactions', async ({page}) => {
  const f = await fixture(page, {admin: true, seedTicket: true});await connect(page, true);await expect(page.locator('#admin-role')).toHaveText('GUARDIAN');await expect(page.locator('#admin-access-copy')).toContainText('Five of seven guardian approvals');
  const box = adminTickets(page);await expect(page.locator('#admin-support-panel')).toBeVisible();await box.locator('.panel-head button').click();await expect(box.locator('.member-ticket-row')).toHaveCount(1);await expect(box.locator('.member-ticket-create')).toBeHidden();
  await box.locator('.member-ticket-row').click();await box.locator('.member-ticket-thread textarea').fill('QA team response: we reviewed the report and its transaction reference.');await box.locator('.member-ticket-thread form button').click();await expect(box.locator('.member-ticket-message')).toHaveCount(2);await expect(box.locator('.member-ticket-thread')).toContainText('answered');
  await box.locator('.member-ticket-thread').getByRole('button', {name: 'closed', exact: true}).click();await expect(box.locator('.member-ticket-thread')).toContainText('closed');await expect(box.locator('.member-ticket-thread form')).toHaveCount(0);
  expect(f.calls.some(call => call.path.endsWith('/status') && call.query === '?scope=admin')).toBe(true);await f.changeWallet();await expect(box.locator('.member-ticket-message')).toHaveCount(0);await assertNoTransactions(page, f);
});

for (const lang of ['fa', 'en']) for (const theme of ['dark', 'light']) test(`completed support and history mobile layout ${lang} ${theme}`, async ({page}) => {
  const f = await fixture(page, {lang, theme});await connect(page);await openSupport(page);const box = memberTickets(page);await authorize(box);await createReport(box, 'QA mobile fixture: a complete support report with a transaction reference and private reply history.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await labeledScreenshot(page, 'support-' + lang + '-' + theme + '.png');
  await page.locator('.sidebar [data-page="activity"]').click();const history = page.locator('#member-history');await history.locator('[data-history-action="older"]').click();await expect(history.locator('.member-history-results article')).toHaveCount(1);await history.locator('.member-history-results summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await labeledScreenshot(page, 'history-' + lang + '-' + theme + '.png');await assertNoTransactions(page, f);
});
