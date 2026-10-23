import test from 'node:test';
import assert from 'node:assert/strict';
import {productionOrigin, requestViolation} from '../landing/tests/helpers/production-policy.mjs';

test('production smoke rejects credentials, alternate servers and non-origin URLs', () => {
  assert.equal(productionOrigin('https://ftiprotocol.com'), 'https://ftiprotocol.com');
  for (const url of ['http://ftiprotocol.com', 'https://ftiprotocol.com.evil.test',
    'https://127.0.0.1', 'https://ftiprotocol.com:444', 'https://user:secret@ftiprotocol.com',
    'https://ftiprotocol.com/app/', 'https://ftiprotocol.com/?token=secret'])
    assert.throws(() => productionOrigin(url));
});

test('production tripwire allows read-only RPC batches and public GETs', () => {
  const call = method => ({jsonrpc: '2.0', id: 1, method, params: []});
  assert.equal(requestViolation({url: 'https://ftiprotocol.com/rpc', method: 'POST',
    body: JSON.stringify([call('eth_chainId'), call('eth_call')])}), null);
  assert.equal(requestViolation({url: 'https://ftiprotocol.com/api/state', method: 'GET'}), null);
  assert.equal(requestViolation({url: 'https://ftiprotocol.com/assets/main.js', method: 'GET'}), null);
});

test('production tripwire blocks wallet authorization, signing, sends and mixed batches', () => {
  const call = method => ({jsonrpc: '2.0', id: 1, method, params: []});
  for (const method of ['eth_requestAccounts', 'personal_sign', 'eth_signTypedData_v4',
    'eth_sendTransaction', 'eth_sendRawTransaction', 'wallet_addEthereumChain']) {
    assert.ok(requestViolation({url: 'https://ftiprotocol.com/rpc', method: 'POST',
      body: JSON.stringify([call('eth_chainId'), call(method)])}));
  }
  assert.ok(requestViolation({url: 'https://ftiprotocol.com/api/dev/time', method: 'GET'}));
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.ok(requestViolation({url: 'https://third-party.test/asset.webp', method}));
    assert.ok(requestViolation({url: 'http://ftiprotocol.com/assets/main.js', method}));
  }
  assert.ok(requestViolation({url: 'https://ftiprotocol.com/api/dev/time', method: 'POST', body: '{}'}));
  assert.ok(requestViolation({url: 'https://third-party.test/rpc', method: 'POST', body: '{}'}));
  assert.ok(requestViolation({url: 'https://ftiprotocol.com/rpc', method: 'POST', body: '[]'}));
});
