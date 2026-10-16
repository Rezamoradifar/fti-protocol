import test from 'node:test';
import assert from 'node:assert/strict';
import {contentSecurityPolicy} from '../scripts/content-security-policy.mjs';
import http from 'node:http';
import {repairPolicy} from '../tools/wallet-image-fix/preload.mjs';

function directives(enabled) {
 return Object.fromEntries(contentSecurityPolicy(enabled).split(';').map(part => {
  const [name, ...values] = part.trim().split(/\s+/);
  return [name, values];
 }));
}

test('AppKit object URL images are permitted without permitting blob scripts or frames', () => {
 const policy = directives('a'.repeat(32));
 assert(policy['img-src'].includes('blob:'));
 assert(policy['connect-src'].includes('https://api.web3modal.org'));
 assert.deepEqual(policy['script-src'], ["'self'"]);
 for (const [name, values] of Object.entries(policy)) {
  if (name !== 'img-src') assert(!values.includes('blob:'), name);
  assert(!values.includes('*'), name);
 }
 assert.deepEqual(policy['frame-ancestors'], ["'none'"]);
});

test('WalletConnect-disabled deployments retain local-only image permissions', () => {
 const policy = directives('');
 assert.deepEqual(policy['img-src'], ["'self'", 'data:']);
 assert.deepEqual(policy['connect-src'], ["'self'"]);
});

test('compatibility overlay changes only image permission and is idempotent', () => {
 const current = contentSecurityPolicy('enabled');
 const previous = current.replace('blob: ', '');
 assert.equal(repairPolicy(previous).replace('img-src blob: ', 'img-src '), previous);
 assert.equal(repairPolicy(current), current);
 assert.equal(repairPolicy(contentSecurityPolicy('')), contentSecurityPolicy(''));
});

test('real HTTP responses receive the image-only correction', async () => {
 const previous = contentSecurityPolicy('enabled').replace('blob: ', '');
 const server = http.createServer((req, res) => {
  res.setHeader('Content-Security-Policy', previous);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end('ok');
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(response.headers.get('content-security-policy'), repairPolicy(previous));
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await response.text(), 'ok');
 } finally { await new Promise(resolve => server.close(resolve)); }
});
