import test from 'node:test';
import assert from 'node:assert/strict';
import {contentSecurityPolicy} from '../scripts/content-security-policy.mjs';

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
