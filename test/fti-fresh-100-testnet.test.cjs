'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {digest,amount,decimal,parseArgs,KNOWN,COUNT,UNIT,TUSD_PER_WALLET,BUY}=require('../tools/fti-fresh-100-testnet.cjs');
const src=fs.readFileSync(path.join(__dirname,'../tools/fti-fresh-100-testnet.cjs'),'utf8');

test('100 unique actors on exact fresh FTI Testnet addresses',()=>{
 assert.equal(COUNT,100);
 assert.equal(UNIT,100n*10n**18n);
 assert.equal(TUSD_PER_WALLET,220n*10n**18n);
 assert.equal(BUY,10n*10n**18n);
 assert.equal(KNOWN.binary,'0xc02b4e207ACcDc020Be0dec190FEA732716B383A');
 assert.equal(KNOWN.token,'0x1C38Ab2c2F64e1bcE96Fc438Da374c4998E70411');
 assert.match(src,/importedUsers===0/);
 assert.match(src,/deploymentKind==='fresh-testnet'/);
 assert.match(src,/sourceRevision===SOURCE_REV/);
 assert.match(src,/hostname\(\)==='vps-titan-5320'/);
});

test('exact decimal conversions for test gas budget',()=>{
 assert.equal(amount('0.001',18),1000000000000000n);
 assert.equal(amount('0.1',9),100000000n);
 assert.equal(decimal(1000000000000001n,18),'0.001000000000000001');
 assert.equal(decimal(amount('0.0008',18)),'0.0008');
});

test('reject imprecise, negative and scientific budgets',()=>{
 for(const n of ['','0','-1','.01','1e-3','NaN','0.0000000000000000001'])assert.throws(()=>amount(n,18));
});

test('canonical reviewed digest binds each wallet and chain',()=>{
 assert.equal(digest({z:3,a:{y:2,x:1}}),digest({a:{x:1,y:2},z:3}));
 assert.notEqual(digest({chainId:97,actors:100}),digest({chainId:56,actors:100}));
 assert.notEqual(digest({wallets:['0x01']}),digest({wallets:['0x02']}));
});

test('send requires consent and rejects repeated flags',()=>{
 assert.deepEqual(parseArgs(['run','--send','--confirm-plan','abc']),{command:'run',opt:{'--send':true,'--confirm-plan':'abc'}});
 assert.throws(()=>parseArgs(['run','--send','--send']));
 assert.throws(()=>parseArgs(['run','--confirm-plan']));
 assert.throws(()=>parseArgs(['unknown']));
 assert.match(src,/Explicit --send and full matching --confirm-plan DIGEST required/);
});

test('100-actor sponsor tree is a bounded breadth first topology',()=>{
 const children=Array.from({length:100},(_,i)=>i<2?-1:Math.floor((i-2)/2));
 assert.equal(children.slice(0,8).join(','),'-1,-1,0,0,1,1,2,2');
 for(let i=0;i<100;i++)assert.ok(children[i]<i);
 const capacity=new Map();
 for(const parent of children)capacity.set(parent,(capacity.get(parent)||0)+1);
 assert.ok([...capacity.values()].every(x=>x<=2));
});

test('native gas is budgeted, fees are capped and raw tx is journaled before broadcast',()=>{
 assert.match(src,/TOTAL_TEST_BNB_BUDGET_REACHED/);
 assert.match(src,/GAS_PRICE_ABOVE_REVIEWED_CEILING/);
 assert.match(src,/MAXIMUM_TRANSACTION_COUNT_REACHED/);
 assert.match(src,/this\.j\.pending=\{label,hash,raw/);
 assert.match(src,/this\.save\(\);\s*try\{const response=await this\.ctx\.p\.broadcastTransaction\(raw\)/);
 assert.match(src,/UNRESOLVED_TX/);
 assert.match(src,/getTransactionReceipt\(pending\.hash\)/);
});

test('testnet-only mock faucet, 100 registration/buy/transfer/sell and payouts are covered',()=>{
 for(const method of ["'faucet'","'register'","'addUnits'","'buy'","'transfer'","'sell'",
 "'setAutoBuyPercent'","'processVolume'","'processEpoch'","'payRewards'","'claim'"])assert.ok(src.includes(method),method+' missing');
 assert.match(src,/FTI_FRESH_TESTNET_100_WALLET_JOURNEY_COMPLETE/);
 assert.match(src,/Claims|claimsThisRun|claims,/);
 assert.match(src,/binaryAutoPending/);
 assert.match(src,/walletTransactionProof/);
 assert.match(src,/NOT_ALL_TESTS_COMPLETED/);
 assert.match(src,/chainMemberCount===131/);
});

test('no editing deployed contract sources, real assets, existing nginx or keeper',()=>{
 assert.doesNotMatch(src,/systemctl\s+(restart|stop|reload)|nginx\s+-s|do-release-upgrade|git\s+pull|eth_sendTransaction/);
 assert.match(src,/Outside the pinned contract source tree/);
 assert.match(src,/Only synthetic tUSD/);
});

test('secrets live in private standalone storage, never log private key',()=>{
 assert.match(src,/wallets-PRIVATE\.json/);
 assert.match(src,/fs\.openSync\(file,'wx',0o600\)/);
 assert.match(src,/testnet key file must be root-owned, private/);
 assert.doesNotMatch(src,/console\.log\(.*privateKey/);
});

test('gas funding cannot select arbitrary outgoing recipients',()=>{
 assert.match(src,/const w=this\.actors\[i\]/);
 assert.match(src,/to:actor\.address,value:delta/);
 assert.match(src,/await this\.send\(this\.funder,usd,'transfer',\[w\.address,amount\]/);
 assert.match(src,/EXPECTED_FTI_NOT_A_REAL_COIN|tUSD synthetic/);
});
