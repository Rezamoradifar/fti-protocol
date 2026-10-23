// Production smoke checks may read public state, but never request accounts,
// signatures, transactions, permissions, or administrative API operations.
const hosts = new Set(['ftiprotocol.com', 'www.ftiprotocol.com', 'app.ftiprotocol.com',
  'token.ftiprotocol.com', 'council.ftiprotocol.com']);
const readRpc = new Set(['eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_getBalance',
  'eth_getCode', 'eth_getStorageAt', 'eth_getTransactionCount', 'eth_getLogs',
  'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getTransactionByHash',
  'eth_getTransactionReceipt', 'eth_feeHistory', 'eth_gasPrice', 'eth_estimateGas',
  'eth_maxPriorityFeePerGas', 'eth_getProof', 'net_version', 'web3_clientVersion']);
const readApi = /^\/api\/(config|state|events|market|locks|placement)\/?$/;

export function productionOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.port ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw Error('Production smoke requires an allowlisted FTI HTTPS origin, without a path or credentials.');
  return url.origin;
}

export function requestViolation({url: value, method, body}) {
  const url = new URL(value);
  const trusted = url.protocol === 'https:' && hosts.has(url.hostname) && !url.port &&
    !url.username && !url.password;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!trusted) return 'Request outside the FTI HTTPS origin allowlist';
    if (url.pathname.startsWith('/api/') && !readApi.test(url.pathname))
      return 'Unrecognized production API endpoint';
    return null;
  }
  if (method !== 'POST' || !trusted || url.pathname !== '/rpc')
    return 'Non-read HTTP operation';
  let calls;
  try { const payload = JSON.parse(body); calls = Array.isArray(payload) ? payload : [payload]; }
  catch { return 'Malformed RPC payload'; }
  if (!calls.length || calls.some(call => !call || call.jsonrpc !== '2.0' || !readRpc.has(call.method)))
    return 'Account, signature, transaction or unknown RPC operation';
  return null;
}
