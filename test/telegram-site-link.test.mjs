import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {OFFICIAL_TELEGRAM, updateTelegramLinks} from '../tools/telegram-site-link.js';

function anchor(href, label = '@FTIProtocol') {
  const attrs = {href};
  const small = {textContent: label};
  return {attrs, small, childNodes: [],
    matches: selector => selector === 'a[href]',
    querySelectorAll: selector => selector === 'small' ? [small] : [],
    getAttribute: key => attrs[key] ?? null,
    setAttribute: (key, value) => { attrs[key] = value; }};
}
const root = anchors => ({querySelectorAll: () => anchors});

test('official destination and visible handle replace only FTI Telegram cards', () => {
  const telegram = anchor('https://t.me/FTIProtocol');
  telegram.attrs.title = 'Telegram @FTIProtocol';
  const x = anchor('https://x.com/FTIProtocol');
  const other = anchor('https://t.me/SomeOtherChannel', '@SomeOtherChannel');
  const bot = anchor('https://t.me/FTIProtocol_OfficialBot');
  const disguised = anchor('https://t.me.attacker.example/FTIProtocol');
  const values = [telegram, x, other, bot, disguised];
  const before = values.slice(1).map(a => JSON.stringify([a.attrs, a.small]));
  updateTelegramLinks(root(values));
  assert.equal(telegram.attrs.href, OFFICIAL_TELEGRAM);
  assert.equal(telegram.small.textContent, '@FTIProtocol_Official');
  assert.equal(telegram.attrs.title, 'Telegram @FTIProtocol_Official');
  assert.deepEqual(values.slice(1).map(a => JSON.stringify([a.attrs, a.small])), before);
  updateTelegramLinks(root(values));
  assert.equal(telegram.small.textContent, '@FTIProtocol_Official');
});

test('legacy variants and direct text are updated without altering nested icons', () => {
  const a = anchor('http://telegram.me/fti_protocol/', '@fti_protocol');
  const icon = {nodeType: 1, textContent: 'icon'};
  const text = {nodeType: 3, textContent: 'https://t.me/FTIProtocol'};
  a.childNodes = [icon, text];
  updateTelegramLinks(a);
  assert.equal(a.attrs.href, OFFICIAL_TELEGRAM);
  assert.equal(a.small.textContent, '@FTIProtocol_Official');
  assert.equal(text.textContent, OFFICIAL_TELEGRAM);
  assert.equal(icon.textContent, 'icon');
});

test('observer handles late React links and subsequent href changes', async () => {
  let callback;
  const globals = {document: globalThis.document, MutationObserver: globalThis.MutationObserver};
  const options = [];
  globalThis.document = {...root([]), documentElement: {}};
  globalThis.MutationObserver = class {
    constructor(fn) { callback = fn; }
    observe(target, config) { options.push([target, config]); }
  };
  try {
    const source = await fs.readFile(new URL('../tools/telegram-site-link.js', import.meta.url), 'utf8');
    await import('data:text/javascript,' + encodeURIComponent(source));
    assert.equal(options.length, 1);
    assert.deepEqual(options[0][1].attributeFilter, ['href']);
    const a = anchor('https://t.me/FTIProtocol');
    callback([{type: 'childList', target: {}, addedNodes: [a]}]);
    assert.equal(a.attrs.href, OFFICIAL_TELEGRAM);
    a.attrs.href = 'https://telegram.me/fti_protocol';
    callback([{type: 'attributes', target: a}]);
    assert.equal(a.attrs.href, OFFICIAL_TELEGRAM);
  } finally {
    for (const [name, value] of Object.entries(globals)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
});
