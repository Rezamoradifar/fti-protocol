import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryHints,readRecoveryHints} from '../frontend/recovery-hints.js';
import {recoverPending} from '../frontend/recover-pending.js';

const address='0x'+'1'.repeat(40),hash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64);
function fixture(){
 let record='unknown:3';const writes=[],calls=[];
 const tracker={read:()=>record,remember:value=>writes.push(['remember',value]),clear:()=>{writes.push(['clear']);record=null;}};
 const tx={hash,from:address,nonce:3,chainId:56n,blockNumber:100,blockHash};
 const receipt={hash,status:1,blockNumber:100,blockHash};
 const provider={
  getNetwork:async()=>({chainId:56n}),getBlockNumber:async()=>200,
  getTransaction:async value=>{calls.push(['transaction',value]);return tx;},
  getTransactionReceipt:async value=>{calls.push(['receipt',value]);return receipt;},
  getBlock:async number=>{calls.push(['block',number]);return {number,hash:blockHash};},
  getTransactionCount:async()=>{calls.push(['history']);throw Error('missing trie node');},
  getLogs:async()=>{calls.push(['logs']);throw Error('limit exceeded');},
 };
 return {tracker,provider,tx,receipt,writes,calls,setRecord:value=>{record=value;}};
}
const hints={candidateHashes:[hash]};

test('parses only bounded hash hints and never treats nonce or wallet URL parameters as proof',()=>{
 assert.deepEqual(recoveryHints('https://ftiprotocol.com/token/?recover='+hash+'&recover='+hash.toUpperCase().replace('0X','0x')+'&recover=unknown:3&nonce=3&wallet='+address),[hash]);
 assert.deepEqual(recoveryHints('not a URL'),[]);
 assert.deepEqual(recoveryHints('https://ftiprotocol.com/?'+Array.from({length:17},()=>`recover=${hash}`).join('&')),[]);
});

test('reads only the matching public wallet manifest with a bounded same-origin request',async()=>{
 const result=await readRecoveryHints({address,chainId:56,fetchImpl:async(url,options)=>{
  assert.equal(url,`/token/recovery/56/${address}.json`);assert.equal(options.method,'GET');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert(options.signal);
  return {ok:true,text:async()=>JSON.stringify({schema:'FTI_RECOVERY_HINTS_V1',chainId:56,address,hashes:[hash,hash]})};
 }});
 assert.deepEqual(result,[hash]);
 assert.deepEqual(await readRecoveryHints({address,chainId:56,fetchImpl:async()=>({status:404})}),[]);
});

test('a missing, malformed or wrong-identity manifest cannot supply recovery candidates',async()=>{
 for(const mode of ['status','schema','chain','wallet','hash','many','large']){
  const value={schema:'FTI_RECOVERY_HINTS_V1',chainId:56,address,hashes:[hash]};
  if(mode==='schema')value.schema='OTHER';if(mode==='chain')value.chainId=97;
  if(mode==='wallet')value.address='0x'+'2'.repeat(40);if(mode==='hash')value.hashes=['unknown:3'];if(mode==='many')value.hashes=Array(17).fill(hash);
  await assert.rejects(readRecoveryHints({address,chainId:56,fetchImpl:async()=>({ok:mode!=='status',text:async()=>mode==='large'?' '.repeat(16385):JSON.stringify(value)})}));
 }
});

test('a verified hint resolves the matching request without any historical state or logs',async()=>{
 const f=fixture();const result=await recoverPending(f.tracker,f.provider,address,56,hints);
 assert.equal(result.hash,hash);assert.equal(f.tracker.read(),null);
 assert.deepEqual(f.writes,[['remember',hash],['clear']]);
 assert(!f.calls.some(([kind])=>kind==='history'||kind==='logs'));
});

test('a remembered cancellation hash recovers an unknown request when archive state and logs are unavailable',async()=>{
 const f=fixture();f.tracker.last=()=>hash;
 const result=await recoverPending(f.tracker,f.provider,address,56);
 assert.equal(result.hash,hash);assert.equal(f.tracker.read(),null);
 assert.deepEqual(f.writes,[['remember',hash],['clear']]);
 assert(!f.calls.some(([kind])=>kind==='history'||kind==='logs'));
});

test('an old remembered hash never releases a different pending nonce',async()=>{
 const f=fixture();f.tracker.last=()=>hash;f.tx.nonce=2;
 await assert.rejects(recoverPending(f.tracker,f.provider,address,56),/missing trie node/);
 assert.equal(f.tracker.read(),'unknown:3');assert.deepEqual(f.writes,[]);
});

test('the remembered hash has priority over the bounded external hint list',async()=>{
 const f=fixture();f.tracker.last=()=>hash;
 const other='0x'+'c'.repeat(64);
 f.provider.getTransaction=async value=>{f.calls.push(['transaction',value]);return value===hash?f.tx:null;};
 assert.equal((await recoverPending(f.tracker,f.provider,address,56,{candidateHashes:Array(16).fill(other)})).hash,hash);
 assert.equal(f.calls.find(([kind])=>kind==='transaction')[1],hash);
});

test('hint cannot unlock another sender, nonce, chain, transaction or noncanonical receipt',async()=>{
 for(const mode of ['sender','nonce','chain','hash','pending','young','receipt-hash','receipt-block','tx-block','status','reorg','network-change']){
  const f=fixture();
  if(mode==='sender')f.tx.from='0x'+'2'.repeat(40);
  if(mode==='nonce')f.tx.nonce=4;
  if(mode==='chain')f.tx.chainId=97n;
  if(mode==='hash')f.tx.hash='0x'+'c'.repeat(64);
  if(mode==='pending')f.provider.getTransactionReceipt=async()=>null;
  if(mode==='young'){f.tx.blockNumber=199;f.receipt.blockNumber=199;}
  if(mode==='receipt-hash')f.receipt.hash='0x'+'c'.repeat(64);
  if(mode==='receipt-block')f.receipt.blockHash='0x'+'c'.repeat(64);
  if(mode==='tx-block')f.tx.blockNumber=101;
  if(mode==='status')f.receipt.status=2;
  if(mode==='reorg')f.provider.getBlock=async number=>({number,hash:'0x'+'c'.repeat(64)});
  if(mode==='network-change'){let reads=0;f.provider.getNetwork=async()=>({chainId:++reads===1?56n:97n});}
  await assert.rejects(recoverPending(f.tracker,f.provider,address,56,hints),/missing trie node/);
  assert.equal(f.tracker.read(),'unknown:3',mode);assert.deepEqual(f.writes,[],mode);
 }
});

test('a reverted but canonical confirmed hint resolves the old request without implying a successful purchase',async()=>{
 const f=fixture();f.receipt.status=0;
 assert.equal((await recoverPending(f.tracker,f.provider,address,56,hints)).receipt.status,0);
 assert.equal(f.tracker.read(),null);
});

test('concurrent monitors share a read-only search while only the current record may be resolved',async()=>{
 const f=fixture();let release,reads=0;
 f.provider.getTransaction=async()=>{reads++;await new Promise(resolve=>{release=resolve;});return f.tx;};
 let stale=true;const guarded={read:()=>stale?'unknown:3':null,remember:()=>assert.fail('stale monitor cannot write'),clear:()=>assert.fail('stale monitor cannot clear')};
 const old=recoverPending(guarded,f.provider,address,56,hints),current=recoverPending(f.tracker,f.provider,address,56,hints);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,1);stale=false;release();
 assert.equal(await old,null);assert.equal((await current).hash,hash);assert.equal(f.tracker.read(),null);
});

test('changing the pending record during verification preserves the replacement request',async()=>{
 const f=fixture();f.provider.getBlock=async number=>{f.setRecord('unknown:4');return {number,hash:blockHash};};
 assert.equal(await recoverPending(f.tracker,f.provider,address,56,hints),null);
 assert.equal(f.tracker.read(),'unknown:4');assert.deepEqual(f.writes,[]);
});

test('a failed search is not cached and invalid hints fail before network reads',async()=>{
 const f=fixture();await assert.rejects(recoverPending(f.tracker,f.provider,address,56),/missing trie node/);
 assert.equal((await recoverPending(f.tracker,f.provider,address,56,hints)).hash,hash);
 const g=fixture();await assert.rejects(recoverPending(g.tracker,g.provider,address,56,{candidateHashes:['unknown:3']}),/Invalid recovery/);
 await assert.rejects(recoverPending(g.tracker,g.provider,address,56,{candidateHashes:Array(17).fill(hash)}),/Invalid recovery/);
 assert.deepEqual(g.calls,[]);assert.equal(g.tracker.read(),'unknown:3');
});
