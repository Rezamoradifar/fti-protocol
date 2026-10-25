import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemberActivity} from '../frontend/member-activity.js';

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.value = ''; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children.flatMap(child => child.tag === '#fragment' ? child.children : [child]); }
  setAttribute(name, value) { this.attrs[name] = value; }
}
const walk = node => [node, ...node.children.flatMap(walk)];
const byClass = (node, name) => walk(node).filter(child => child.className?.split(' ').includes(name));
const A = '0x' + 'a1'.repeat(20), B = '0x' + 'b2'.repeat(20);
function fixture(explorer = 'https://bscscan.com') {
  let wallet = null;
  const container = new Node('div');
  const document = {createElement: tag => new Node(tag), createDocumentFragment: () => new Node('#fragment')};
  const view = createMemberActivity({container, document, explorer,
    getAddress: () => wallet, translate: en => en, formatBlock: value => String(value)});
  return {view, container, setWallet: value => {wallet = value;},
    cards: () => byClass(container, 'member-event'),
    mine: () => walk(container).find(node => node.dataset.eventScope === 'wallet'),
    all: () => walk(container).find(node => node.dataset.eventScope === 'all'),
    search: () => byClass(container, 'member-activity-search')[0],
    count: () => byClass(container, 'member-activity-count')[0]};
}
function row(name, args, seed = 'a', block = 123) {
  return {name, args, block, hash: '0x' + seed.repeat(64)};
}

test('recent event cards expose readable titles, exact contract fields and a validated explorer link', () => {
  const f = fixture();
  f.view.render([row('Bought', [{name: 'buyer', value: A}, {name: 'usdIn', value: '1000000000000000000'}])]);
  assert.equal(f.cards().length, 1);
  const card = f.cards()[0];
  assert.match(card.textContent, /FTI purchased/);
  assert.match(card.textContent, /Bought/);
  assert.match(card.textContent, /Block 123/);
  assert.match(card.textContent, /1000000000000000000/);
  const link = walk(card).find(node => node.tag === 'a');
  assert.equal(link.href, 'https://bscscan.com/tx/0x' + 'a'.repeat(64));
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(f.count().textContent, 'Matching events: 1 / 1');
});

test('wallet filtering matches complete address arguments, ignores embedded addresses and tracks account changes', () => {
  const f = fixture();
  f.view.render([
    row('Registered', [{name: 'wallet', value: '0x' + A.slice(2).toUpperCase()}], 'a'),
    row('Sold', [{name: 'seller', value: B}], 'b'),
    row('Note', [{name: 'description', value: 'prefix ' + A}], 'c'),
  ]);
  assert.equal(f.mine().disabled, true);
  f.setWallet(A); f.view.refresh();
  assert.equal(f.mine().disabled, false);
  f.mine().onclick();
  assert.equal(f.cards().length, 1);
  assert.match(f.cards()[0].textContent, /Membership registered/);
  assert.equal(f.mine().attrs['aria-pressed'], 'true');
  f.setWallet(B); f.view.refresh();
  assert.equal(f.cards().length, 1);
  assert.match(f.cards()[0].textContent, /FTI sold/);
  f.setWallet(null); f.view.refresh();
  assert.equal(f.mine().disabled, true);
  assert.equal(f.all().attrs['aria-pressed'], 'true');
  assert.equal(f.cards().length, 3);
});

test('search filters the verified snapshot and distinguishes no matches from empty or unrequested history', () => {
  const f = fixture();
  assert.match(f.container.textContent, /Open activity or refresh/);
  f.view.render([row('Claimed', [{name: 'wallet', value: A}], 'a'), row('Bought', [{name: 'buyer', value: B}], 'b')]);
  f.search().value = B; f.search().oninput();
  assert.equal(f.cards().length, 1);
  assert.match(f.cards()[0].textContent, /FTI purchased/);
  f.search().value = '0x' + 'a'.repeat(64); f.search().oninput();
  assert.equal(f.cards().length, 1);
  assert.match(f.cards()[0].textContent, /Rewards claimed/);
  f.search().value = 'not-found'; f.search().oninput();
  assert.equal(f.cards().length, 0);
  assert.match(f.container.textContent, /No events match these filters/);
  assert.match(f.container.textContent, /not a complete wallet history/);
  f.view.render([]);
  assert.match(f.container.textContent, /No protocol events were returned/);
});

test('an invalid refreshed batch does not replace or partially render an earlier verified snapshot', () => {
  const f = fixture();
  f.view.render([row('Claimed', [{name: 'wallet', value: A}])]);
  const before = f.container.textContent, card = f.cards()[0];
  for (const invalid of [
    {...row('Sold', []), hash: 'javascript:alert(1)'},
    {...row('Sold', []), block: Number.MAX_SAFE_INTEGER + 1},
    {...row('Sold', []), args: null},
    row('Sold', [{name: 'amount', value: {malformed: true}}]),
    row('Sold', [{name: 'amount', value: Infinity}]),
  ]) {
    assert.throws(() => f.view.render([row('Bought', []), invalid]), /Events are unavailable/);
    assert.equal(f.container.textContent, before);
    assert.strictEqual(f.cards()[0], card);
  }
});

test('unsafe explorer bases never create links and untrusted fields remain literal text', () => {
  for (const explorer of ['javascript:alert(1)', 'http://bscscan.com', 'https://user:pass@bscscan.com', 'https://bscscan.com/?redirect=evil', 'https://bscscan.com/path']) {
    const f = fixture(explorer);
    f.view.render([row('<img src=x onerror=alert(1)>', [{name: '<script>', value: '<svg onload=alert(1)>'}])]);
    assert.equal(walk(f.container).filter(node => node.tag === 'a').length, 0);
    assert.match(f.container.textContent, /<svg onload=alert\(1\)>/);
    assert.equal(walk(f.container).some(node => node.tag === 'img' || node.tag === 'script' || node.tag === 'svg'), false);
  }
});

test('invalid and zero wallet identities cannot enable account filtering', () => {
  const f = fixture();
  for (const wallet of ['not-a-wallet', '0x' + '0'.repeat(40), {address: A}]) {
    f.setWallet(wallet); f.view.refresh();
    assert.equal(f.mine().disabled, true);
    assert.equal(f.all().attrs['aria-pressed'], 'true');
  }
});

test('unknown event names cannot invoke inherited title-map properties or poison later refreshes', () => {
  const f = fixture();
  for (const name of ['toString', 'constructor', '__proto__']) {
    assert.doesNotThrow(() => f.view.render([row(name, [])]));
    assert.match(f.cards()[0].textContent, new RegExp(name));
    assert.doesNotThrow(() => f.view.refresh());
  }
  f.view.render([row('Bought', [])]);
  assert.match(f.cards()[0].textContent, /FTI purchased/);
});
