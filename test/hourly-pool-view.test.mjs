import test from 'node:test';
import assert from 'node:assert/strict';
import {poolInteger,poolAmount,exactPoolAmount,hourlyPoolView} from '../landing/src/hourly-pool-view.mjs';
const UNIT=10n**18n;
test('amounts use exact integers and never round tiny positive pools to zero',()=>{
 assert.equal(poolAmount('0'),'0');assert.equal(poolAmount(String(90n*UNIT)),'90');
 assert.equal(poolAmount(String(123456789n*UNIT+123456789000000000n)),'123,456,789.123456');
 assert.equal(poolAmount('1'),'< 0.000001');assert.equal(exactPoolAmount('1'),'0.000000000000000001');
 assert.equal(poolAmount(undefined),'—');assert.equal(poolAmount('-1'),'—');assert.equal(poolAmount('not a number'),'—');
 assert.equal(poolInteger('100000000000000000001'),'100,000,000,000,000,000,001');
});
test('current pool and settled points keep their different epoch labels',()=>{
 const v=hourlyPoolView({current:{epoch:'12',poolWei:String(90n*UNIT),phase:0},settled:{epoch:'11',poolWei:String(100n*UNIT),points:'5',pointValueWei:String(20n*UNIT)}});
 assert.deepEqual(v,{pool:'90',points:'5',pointValue:'20',settledPool:'100',epoch:'12',settledEpoch:'11',processing:false,noEligiblePoints:false});
});
test('unavailable, processing and zero-point settlements never invent a point price',()=>{
 const missing=hourlyPoolView(null);assert.equal(missing.pool,'—');assert.equal(missing.points,'—');assert.equal(missing.pointValue,'—');
 const active=hourlyPoolView({current:{epoch:'12',poolWei:'0',phase:1},settled:null});assert.equal(active.processing,true);assert.equal(active.points,'—');assert.equal(active.pointValue,'—');
 const empty=hourlyPoolView({current:{epoch:'13',poolWei:'0',phase:0},settled:{epoch:'12',poolWei:'0',points:'0',pointValueWei:null}});assert.equal(empty.points,'0');assert.equal(empty.noEligiblePoints,true);assert.equal(empty.pointValue,'—');
});
test('Persian formatting localizes both decimal fractions and whole counts',()=>{
 assert.equal(poolInteger('12','fa'),'۱۲');assert.equal(poolAmount(String(12n*UNIT+500000000000000000n),'fa'),'۱۲٫۵');
 assert.equal(poolAmount('1','fa'),'< ۰٫۰۰۰۰۰۱');
});
