'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const m=require('./fti-sell-all-testnet.cjs');
const src=fs.readFileSync(path.join(__dirname,'fti-sell-all-testnet.cjs'),'utf8');
const E=10n**18n;
test('hard-pin public BNB testnet contracts; no real assets',()=>{
 assert.equal(m.ADDR.token,'0x1C38Ab2c2F64e1bcE96Fc438Da374c4998E70411');
 assert.equal(m.ADDR.binary,'0xc02b4e207ACcDc020Be0dec190FEA732716B383A');
 assert.match(src,/CHAIN_NOT_BNB_TESTNET_97/);
 assert.match(src,/NOT_SYNTHETIC_TEST_USD/);
 assert.match(src,/DEPLOYED_CODE_HASH_MISMATCH/);
 assert.match(src,/NO_REAL_ASSETS|No real assets/);
});
test('whole-position sale for small balances (never manufacture exempt sub-orders)',()=>{
 let a=m.clampSale({held:200n*E,supply:1000n*E,reserve:1000n*E,hourHeadroom:0n});
 assert.equal(a.amount,200n*E);assert.equal(a.reason,'NATURALLY_SMALL_WALLET');
 a=m.clampSale({held:900n*E,supply:1000n*E,reserve:1000n*E,hourHeadroom:0n});
 assert.equal(a.amount,0n);assert.equal(a.reason,'NEXT_HOURLY_WINDOW_REQUIRED');
});
test('final supply holder can exit in one ordinary cycle-close transaction',()=>{
 let a=m.clampSale({held:10000n*E,supply:10000n*E,reserve:500000n*E,hourHeadroom:0n});
 assert.equal(a.amount,10000n*E);assert.equal(a.reason,'FINAL_CYCLE_EXIT');
});
test('large sales always take less than 5 percent reserve and less than 20 percent hourly headroom',()=>{
 for(const reserve of [1000n,10000n,100000n,800000n,2000000n].map(x=>x*E)){
  for(const hour of [0n,1000n,10000n,100000n,800000n].map(x=>x*E)){
   const a=m.clampSale({held:900000n*E,supply:1000000n*E,reserve,hourHeadroom:hour});
   if(a.amount>0n){let gross=a.amount*reserve/(1000000n*E);assert(gross<=reserve*3n/100n);assert(gross<=hour*75n/100n);assert(gross<=m.MAX_GROSS_PER_TX);}
  }
 }
});
test('no sign or broadcast for prepare/status; affirmative sale consent and exact digest',()=>{
 assert.deepEqual(m.argsParse(['prepare']),{command:'prepare',a:{}});
 assert.deepEqual(m.argsParse(['status']),{command:'status',a:{}});
 assert.throws(()=>m.argsParse(['status','--send']));
 assert.throws(()=>m.argsParse(['sell','--send','--send']));
 assert.match(src,/EXPLICIT_SEND_AND_REVIEWED_DIGEST_REQUIRED/);
 assert.match(src,/WRONG_FUNDING_TEST_KEY/);
});
test('private wallet vault, no arbitrary key export and no operations on mainnet',()=>{
 assert.match(src,/wallets-PRIVATE\.json/);
 assert.match(src,/eth\.computeAddress\(x\.privateKey\)/);
 assert.match(src,/100_WALLET_PLAN_INVALID/);
 assert.match(src,/CONFIRMED_ADDRESSES_ONLY|confirmedAddressesOnly/);
 assert.match(src,/fs\.openSync\(create\?p:q,'wx',0o600\)/);
 assert.doesNotMatch(src,/eth_sendTransaction|systemctl restart|nginx -s|git pull/);
});
test('no concurrent stress or large-trade script, journal first then receipt',()=>{
 assert.match(src,/CONCURRENT_OR_STALE_LOCK/);
 assert.match(src,/fti-large-trade-testnet\/operation\.lock/);
 assert.match(src,/this\.j\.pending=\{hash,raw,label/);
 assert.match(src,/await this\.c\.provider\.getTransactionReceipt\(q\.hash\)/);
 assert.match(src,/PENDING_UNKNOWN_HASH/);
 assert.match(src,/SELL_EVENT_AMOUNT_MISMATCH/);
});
test('gas topups only reach locally derived actor addresses',()=>{
 assert.match(src,/UNAPPROVED_TOPUP_ADDRESS/);
 assert.match(src,/UNREVIEWED_GAS_BENEFICIARY/);
 assert.match(src,/MAX_TRANSACTIONS_REACHED/);
 assert.match(src,/STOP_TEST_BNB_BUDGET_EXHAUSTED/);
});
test('accounting and incomplete sales stay visibly pending',()=>{
 assert.match(src,/TOKEN_RESERVE_DEFICIT_AFTER_SELL/);
 assert.match(src,/FTI_100_TESTNET_LIQUIDATION_PARTIAL_OR_PENDING/);
 assert.match(src,/FTI_100_TESTNET_ALL_CONTROLLED_FTI_SOLD/);
 assert.match(src,/NEXT_HOURLY_WINDOW_REQUIRED/);
});
test('exact large amounts and budget decimals',()=>{
 assert.equal(m.ethAmount('300000'),300000n*E);
 assert.equal(m.ethAmount('0.12'),120000000000000000n);
 assert.equal(m.decimal(1230000000000000001n),'1.230000000000000001');
 for(const bad of ['-1','1e7','NaN','0.00000000000000000001'])assert.throws(()=>m.ethAmount(bad));
});
