import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {formatEther, parseEther, ZeroAddress} from 'ethers';

const jsx = fs.readFileSync(new URL('../frontend/main.jsx', import.meta.url), 'utf8');
const controller = fs.readFileSync(new URL('../frontend/controller.js', import.meta.url), 'utf8');
const start = controller.indexOf('function renderWallet(){');
const end = controller.indexOf("\n$('#reward-all-panel')", start);
assert(start > 0 && end > start);
const mountedIds = new Set([...jsx.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));

// Exercise the actual controller renderer against only IDs that remain mounted
// in the redesigned JSX. This checks data binding, not wallet authorization or
// mainnet transactions. Unknown IDs fail instead of being silently fabricated.
function fixture() {
  const nodes = new Map();
  function node(id) {
    assert(mountedIds.has(id), 'Controller uses a missing mounted hook: ' + id);
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '—', value: '', hidden: false, disabled: false,
      elements: {sponsor: {}, enabled: {}, percent: {}, price: {}},
      classList: {toggle() {}}, replaceChildren() {}, append() {},
    });
    return nodes.get(id);
  }
  const context = {
    address: null, signer: null, state: null, councilOwner: false, v3Model: true, fundedModel: true,
    automaticReferral: true, selectableAuto: false, autoDirty: false, busy: false, lockOffset: 0,
    cfg: {lockVersion: 0, tokenContract: 'FTIReserveTokenUpgradeable'},
    networkProfile: {testAssets: false}, ranks: ['Member', 'Builder 1', 'Builder 2', 'Builder 3', 'Builder 4'],
    thresholds: [100n, 200n, 500n, 1000n], ZeroAddress, sites: {member: 'https://example.invalid/app/'},
    wallet: () => context.state?.wallet,
    $: selector => node(selector.slice(1)), text: (id, value) => {node(id).textContent = value;},
    t: value => value, fmt: (value, digits = 2) => value === undefined ? '—' : new Intl.NumberFormat('en-US', {maximumFractionDigits: digits}).format(Number(formatEther(value))),
    integer: value => String(value), formatEther, utc: value => String(value), withLanguage: value => value,
    settledPoints: () => ({raw: null, paid: null, count: null}),
    document: {createElement: () => ({textContent: '', append() {}})},
  };
  vm.runInNewContext(controller.slice(start, end), context);
  return {context, node};
}

test('redesigned balance and membership hooks show the actual connected wallet snapshot', () => {
  const {context, node} = fixture();
  context.address = '0x' + '1'.repeat(40);
  context.signer = {};
  context.state = {clock: 0n, timestamp: 1000, wallet: {
    exists: true, rank: 1, ftiBalance: parseEther('12.34567'), unlocked: parseEther('10'), usdBalance: parseEther('456.78'),
    claimable: parseEther('3.25'), remaining: parseEther('400'), units: 2n,
    lifetimeL: 125n, lifetimeR: 155n, carryL: 1n, carryR: 4n, directReferrals: 2n,
    creditL: 0n, creditR: 0n, autoPending: 0n, locks: [], autoEnabled: false, maxAutoPrice: 0n,
    referrer: ZeroAddress, parent: ZeroAddress, left: ZeroAddress, right: ZeroAddress,
  }};
  context.renderWallet();
  assert.equal(node('fti-balance').textContent, '12.34567');
  assert.equal(node('usd-balance').textContent, '456.78');
  assert.equal(node('claimable').textContent, '3.25');
  assert.equal(node('unlocked').textContent, '10');
  assert.equal(node('account-units').textContent, '2');
  assert.equal(node('rank').textContent, 'Builder 1');
  assert.equal(node('membership-status').textContent, 'Registered member');
  assert.equal(node('rank-progress').value, 25);
  assert.equal(node('wallet-address').textContent, context.address);
  assert.match(node('referral-link').value, new RegExp('sponsor=' + context.address));
  assert.equal(node('register-form').elements.sponsor.disabled, true);
});

test('an authorized wallet with unavailable contract data keeps unknown values and identity', () => {
  const {context, node} = fixture();
  context.address = '0x' + '2'.repeat(40);
  context.signer = {};
  context.renderWallet();
  for (const id of ['fti-balance', 'usd-balance', 'claimable', 'unlocked', 'account-units']) assert.equal(node(id).textContent, '—');
  assert.equal(node('rank').textContent, 'Waiting for contract data');
  assert.equal(node('membership-status').textContent, 'Waiting for contract data');
  assert.equal(node('wallet-address').textContent, context.address);
  assert.equal(node('referral-link').value, '');
  assert.equal(node('rank-progress').value, 0);
});

test('disconnect clears connected balances rather than leaving another account visible', () => {
  const {context, node} = fixture();
  node('fti-balance').textContent = '99';
  node('usd-balance').textContent = '500';
  node('claimable').textContent = '12';
  context.renderWallet();
  for (const id of ['fti-balance', 'usd-balance', 'claimable']) assert.equal(node(id).textContent, '—');
  assert.equal(node('rank').textContent, 'Not connected');
  assert.equal(node('wallet-address').textContent, 'No wallet connected');
});
