// Dependency-free input/budget policy. No network or signing in this file.
import fs from 'node:fs';
const address=/^0x[0-9a-fA-F]{40}$/;
const hash=/^0x[0-9a-fA-F]{64}$/;
export function requireAddress(value,label='address') {
  if(typeof value!=='string'||!address.test(value)||/^0x0{40}$/.test(value))throw Error('Invalid '+label);
  return value.toLowerCase();
}
export function requireHash(value,label='hash') {
  if(typeof value!=='string'||!hash.test(value)||/^0x0{64}$/.test(value))throw Error('Invalid '+label);
  return value.toLowerCase();
}
export function uint(value,label) {
  if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('Unsafe '+label);
  if(!/^(0|[1-9][0-9]*)$/.test(String(value)))throw Error('Invalid '+label);
  const n=BigInt(value);if(n>=1n<<256n)throw Error('Overflow '+label);return n;
}
export function pageIndex(copied,count,pageSize=64) {
  const n=uint(copied,'cursor'),total=uint(count,'count');
  if(n>total||n!==total&&n%BigInt(pageSize)!==0n)throw Error('Invalid on-chain cursor');
  const page=Number(n/BigInt(pageSize));if(!Number.isSafeInteger(page))throw Error('Cursor too large');
  return n===total?null:page;
}
export function requireSourceConfig(c) {
  if(!c||!['97','31337'].includes(String(c.chainId)))throw Error('Testnet/local source configuration required');
  if(c.binaryContract!=='FundedBinaryPlanUpgradeable'||c.tokenContract!=='FTIReserveTokenUpgradeable')throw Error('Unsupported source contract model');
  const values=['binary','token','usd','council','timelock'];
  for(const key of values){requireAddress(c[key],key);requireHash(c.codeHashes?.[key],key+' code hash');}
  if(new Set(values.map(k=>c[k].toLowerCase())).size!==values.length)throw Error('Source addresses must be distinct');
  for(const key of ['binary','token']){requireAddress(c[key+'Implementation'],key+' logic');requireHash(c.implementationCodeHashes?.[key],key+' logic hash');}
  if(!Number.isSafeInteger(c.deployedBlock)||c.deployedBlock<1)throw Error('Verified creation block required');
  if(!Array.isArray(c.daoPartners)||c.daoPartners.length!==7||new Set(c.daoPartners.map(a=>requireAddress(a,'guardian'))).size!==7)throw Error('Seven unique guardians required');
  return c;
}
export function requireSendConsent({chainId,expectedChain,coordinator,expectedCoordinator}) {
  if(!['97','31337'].includes(String(chainId))||String(chainId)!==String(expectedChain))throw Error('Explicit matching testnet/local chain required');
  if(requireAddress(coordinator)!==requireAddress(expectedCoordinator,'confirmation address'))throw Error('Explicit coordinator confirmation mismatch');
}
export function createBudget({maxFeeWei,maxGasPriceWei,maxGas=12000000,maxTransactions=100}) {
  const fee=uint(maxFeeWei,'fee budget'),price=uint(maxGasPriceWei,'gas price ceiling'),gas=uint(maxGas,'gas limit');
  if(fee===0n||price===0n||gas===0n||gas>28000000n||!Number.isSafeInteger(maxTransactions)||maxTransactions<1||maxTransactions>1000)throw Error('Invalid transaction limits');
  let reserved=0n,transactions=0;
  return {maxGas:gas,maxGasPriceWei:price,get reserved(){return reserved;},get transactions(){return transactions;},
    reserve(estimatedGas,gasPrice){
      const g=uint(estimatedGas,'estimated gas'),p=uint(gasPrice,'gas price');
      if(g===0n||p===0n||g>gas||p>price||transactions>=maxTransactions||reserved+g*p>fee)throw Error('Transaction budget exceeded');
      reserved+=g*p;transactions++;return {gasLimit:g,gasPrice:p};
    }};
}
// A live signer key is loaded ONLY by an explicit write command. Never print it.
export function readPrivateKey(file) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    const s=fs.fstatSync(fd);
    if(!s.isFile()||s.size<64||s.size>128||(s.mode&0o077)!==0)throw Error('Key file must be a private regular file (0600)');
    const key=fs.readFileSync(fd,'utf8').trim();if(!/^(0x)?[0-9a-fA-F]{64}$/.test(key))throw Error('Invalid signing key file');
    return key.startsWith('0x')?key:'0x'+key;
  }finally{fs.closeSync(fd);}
}
