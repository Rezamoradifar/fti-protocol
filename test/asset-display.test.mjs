import test from 'node:test';
import assert from 'node:assert/strict';
import {exactAssetAmount,formatAssetAmount,tokenValuation} from '../frontend/asset-display.js';

const UNIT=10n**18n,ADDRESS='0x'+'a'.repeat(40),OTHER='0x'+'b'.repeat(40),NOW=1_800_000_000_000;
const snapshot=()=>({tokenValuationVerified:true,block:1234,timestamp:NOW/1000-3,
 price:UNIT/10n,reserve:100n*UNIT,supply:1000n*UNIT,wallet:{address:ADDRESS,ftiBalance:25n*UNIT}});

test('asset display preserves integers larger than Number precision and rounds with BigInt',()=>{
 assert.equal(formatAssetAmount('900719925474099312345678901234567890'),'900,719,925,474,099,312.35');
 assert.equal(formatAssetAmount('137907553424081186546'),'137.91');
 assert.equal(formatAssetAmount('596537457909496382480',{digits:5}),'596.53746');
 assert.equal(formatAssetAmount('999999999999999999'),'1');
 assert.equal(formatAssetAmount(2n*UNIT),'2');
 assert.equal(formatAssetAmount(0n),'0');
 assert.equal(formatAssetAmount(15n*UNIT/10n,{digits:0}),'2');
});

test('tiny positive assets remain visible at every configured display precision',()=>{
 for(const value of [1n,999n,UNIT/1000n,UNIT/100n-1n])assert.equal(formatAssetAmount(value),'<0.01');
 assert.equal(formatAssetAmount(UNIT/100n),'0.01');
 assert.equal(formatAssetAmount(1n,{digits:6}),'<0.000001');
 assert.equal(formatAssetAmount(UNIT-1n,{digits:0}),'<1');
 assert.equal(formatAssetAmount(1n,{digits:18}),'0.000000000000000001');
 assert.equal(formatAssetAmount(0n,{digits:18}),'0');
});

test('localized asset display preserves exact integer grouping, decimal marks and digits',()=>{
 const large='900719925474099312345678901234567890';
 assert.equal(formatAssetAmount(large,{locale:'fa-IR'}),'۹۰۰٬۷۱۹٬۹۲۵٬۴۷۴٬۰۹۹٬۳۱۲٫۳۵');
 assert.equal(formatAssetAmount(large,{locale:'de-DE'}),'900.719.925.474.099.312,35');
 assert.equal(formatAssetAmount(1n,{locale:'fa-IR'}),'<۰٫۰۱');
 assert.equal(formatAssetAmount(1n,{locale:'de-DE'}),'<0,01');
});

test('full-precision asset output retains every base unit without exponent notation',()=>{
 assert.equal(exactAssetAmount('137907553424081186546'),'137.907553424081186546');
 assert.equal(exactAssetAmount('596537457909496382480'),'596.53745790949638248');
 assert.equal(exactAssetAmount(1n),'0.000000000000000001');
 assert.equal(exactAssetAmount(0n),'0');
 assert.equal(exactAssetAmount((1n<<256n)-1n),'115792089237316195423570985008687907853269984665640564039457.584007913129639935');
});

test('invalid and unknown assets never become zero or accidentally precise amounts',()=>{
 for(const value of [undefined,null,'',false,true,-1n,1.1,'1.5','1e18',' 1','01','+1',NaN,Infinity,Number.MAX_SAFE_INTEGER+1,1n<<256n,{},[]]){
  assert.equal(formatAssetAmount(value),'—',String(value));assert.equal(exactAssetAmount(value),'—',String(value));
 }
 for(const digits of [-1,19,1.2,'2',null])assert.equal(formatAssetAmount(UNIT,{digits}),'—');
 assert.equal(formatAssetAmount(UNIT,{locale:'not_a_locale'}),'—');
});

test('valuation computes a gross before-fee estimate from the exact contract price',()=>{
 const value=tokenValuation(snapshot(),ADDRESS,{now:NOW});
 assert.deepEqual(value,{grossValueWei:2500000000000000000n,priceWei:UNIT/10n,balanceWei:25n*UNIT,block:1234,timestamp:NOW/1000-3});
 const actual=snapshot();actual.price='106288920698652181';actual.reserve='73215033067566345607';actual.supply='688830337031494230607';actual.wallet.ftiBalance='596537457909496382480';
 const observed=tokenValuation(actual,ADDRESS,{now:NOW});
 assert.equal(observed.grossValueWei,63405322557518024254n);
 assert.equal(observed.grossValueWei,BigInt(actual.wallet.ftiBalance)*BigInt(actual.price)/UNIT);
});

test('valuation uses precise uint256 arithmetic beyond Number limits',()=>{
 const s=snapshot();s.supply=1n<<200n;s.reserve=1n<<199n;s.price=UNIT/2n;s.wallet.ftiBalance=(1n<<199n)+1n;
 assert.equal(tokenValuation(s,ADDRESS,{now:NOW}).grossValueWei,((1n<<199n)+1n)/2n);
 const boundary=snapshot();boundary.reserve=1n;boundary.supply=3n;boundary.price=UNIT/3n;boundary.wallet.ftiBalance=2n;
 assert.equal(tokenValuation(boundary,ADDRESS,{now:NOW}).grossValueWei,0n,'Use token.price integer basis; do not round a redeemable output up');
});

test('unverified, partial or different-wallet snapshots cannot value a connected account',()=>{
 for(const flag of [undefined,false,1,'true'])assert.equal(tokenValuation({...snapshot(),tokenValuationVerified:flag},ADDRESS,{now:NOW}),null);
 assert.equal(tokenValuation({...snapshot(),wallet:{address:OTHER,ftiBalance:25n*UNIT}},ADDRESS,{now:NOW}),null);
 assert.equal(tokenValuation({...snapshot(),wallet:undefined},ADDRESS,{now:NOW}),null);
 assert.equal(tokenValuation(snapshot(),'not-an-address',{now:NOW}),null);
 assert.equal(tokenValuation(snapshot(),ADDRESS.toUpperCase().replace('0X','0x'),{now:NOW}).balanceWei,25n*UNIT);
});

test('valuation requires a fresh valid anchor and rejects stale or future mixed snapshots',()=>{
 const exact=snapshot();exact.timestamp=NOW/1000-45;assert.ok(tokenValuation(exact,ADDRESS,{now:NOW}));
 exact.timestamp=NOW/1000-46;assert.equal(tokenValuation(exact,ADDRESS,{now:NOW}),null);
 exact.timestamp=NOW/1000+15;assert.ok(tokenValuation(exact,ADDRESS,{now:NOW}));
 exact.timestamp=NOW/1000+16;assert.equal(tokenValuation(exact,ADDRESS,{now:NOW}),null);
 for(const change of [{block:null},{block:-1},{block:Number.MAX_SAFE_INTEGER+1},{timestamp:null},{timestamp:0},{timestamp:'invalid'}])assert.equal(tokenValuation({...snapshot(),...change},ADDRESS,{now:NOW}),null);
 for(const now of [NaN,Infinity,0,'1800000000000',NOW+0.1])assert.equal(tokenValuation(snapshot(),ADDRESS,{now}),null);
});

test('zero supply, malformed balances and inconsistent reserve prices have no valuation',()=>{
 const zero=snapshot();zero.supply=0n;zero.reserve=0n;zero.price=0n;assert.equal(tokenValuation(zero,ADDRESS,{now:NOW}),null);
 assert.equal(tokenValuation({...snapshot(),price:UNIT/10n+1n},ADDRESS,{now:NOW}),null);
 for(const key of ['price','reserve','supply'])for(const value of [undefined,null,'',false,-1n,'0.1',1n<<256n])assert.equal(tokenValuation({...snapshot(),[key]:value},ADDRESS,{now:NOW}),null);
 for(const value of [undefined,null,'',false,-1n,'0.1',1n<<256n,1001n*UNIT])assert.equal(tokenValuation({...snapshot(),wallet:{address:ADDRESS,ftiBalance:value}},ADDRESS,{now:NOW}),null);
 const noBalance=snapshot();noBalance.wallet.ftiBalance=0n;assert.equal(tokenValuation(noBalance,ADDRESS,{now:NOW}).grossValueWei,0n);
 const noReserve=snapshot();noReserve.reserve=0n;noReserve.price=0n;assert.equal(tokenValuation(noReserve,ADDRESS,{now:NOW}).grossValueWei,0n);
});
