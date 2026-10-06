import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ratio,ratioDelta,formatRatio,exactFraction,deltaDecimals,readRatioSnapshot,confirmedTransactionDelta} from '../frontend/exact-price.mjs';
const W=10n**18n;
for(const [reserve,expected] of [[1000000n,'+0.000000003'],[1000000000n,'+0.000000000003']])test('exact 3% fee growth at reserve '+reserve,()=>{
 const before={reserve:reserve*W,supply:reserve*10n*W};
 // A=1, gross redemption burns 10 FTI at P=.1, fee=.03 remains.
 const after={reserve:before.reserve-97n*W/100n,supply:before.supply-10n*W};
 const d=ratioDelta(before,after);assert.equal(d.numerator,3n*W*before.supply/100n);assert(formatRatio(d,{sign:true}).startsWith(expected));
 assert.notEqual(formatRatio(ratio(before.reserve,before.supply)),formatRatio(ratio(after.reserve,after.supply),{minDecimals:deltaDecimals(d)}));
});
test('6e-20 growth is visible without changing a floor-to-18 getter',()=>{
 const before={reserve:10n**37n,supply:10n**38n},after={reserve:10n**37n+6n*10n**18n,supply:10n**38n};
 const d=ratioDelta(before,after);assert.equal(formatRatio(d,{sign:true}),'+0.00000000000000000006');
 assert.equal(formatRatio(ratio(after.reserve,after.supply)),'0.10000000000000000006');
 assert.equal(before.reserve*W/before.supply,after.reserve*W/after.supply);
});
test('zero, negative, repeating and extreme deltas do not fabricate increments',()=>{
 assert.equal(formatRatio(ratioDelta({reserve:1n,supply:10n},{reserve:1n,supply:10n}),{sign:true}),'0');
 assert.equal(formatRatio({numerator:-1n,denominator:10n},{sign:true}),'-0.1');
 assert.equal(formatRatio(ratio(1n,3n)),'0.'+'3'.repeat(24)+'…');
 assert.equal(ratio(0n,0n),null);assert.equal(ratio(5n,0n),null);
 assert.equal(ratioDelta({reserve:1n,supply:1n},{reserve:0n,supply:0n}),null);
 assert.equal(formatRatio(ratio(0n,1n)),'0');
 assert.throws(()=>ratio(9007199254740992,1n));
 const tiny={numerator:1n,denominator:10n**154n};assert.equal(formatRatio(tiny),'0.'+'0'.repeat(153)+'1');
});
function fixture({shared=false,reorg=false}={}){
 const blocks={1:{number:1,hash:'parent',parentHash:'older',transactions:['0xprev']},2:{number:2,hash:'current',parentHash:'parent',transactions:shared?['0xtx','0xother']:['0xtx']}};
 let reads=0;return {provider:{async getBlock(n){if(n==='latest')n=2;reads++;return {...blocks[n],hash:reorg&&reads>1?'changed':blocks[n].hash};}},token:{reserve:async({blockTag})=>blockTag===1?10n:11n,totalSupply:async()=>100n,price:async()=>W/10n},receipt:{status:1,hash:'0xtx',blockHash:'current',blockNumber:2}};
}
test('pinned snapshots and receipt-isolated delta verify hashes',async()=>{
 const {provider,token,receipt}=fixture();const value=await confirmedTransactionDelta(provider,token,receipt);assert.equal(formatRatio(value.delta,{sign:true}),'+0.01');assert.equal(value.before.blockNumber,1);assert.equal(value.after.blockNumber,2);
});
test('shared blocks, reorgs, unconfirmed receipts and failed RPC never produce deltas',async()=>{
 for(const options of [{shared:true},{reorg:true}]){const f=fixture(options);await assert.rejects(confirmedTransactionDelta(f.provider,f.token,f.receipt));}
 const f=fixture();await assert.rejects(confirmedTransactionDelta(f.provider,f.token,{...f.receipt,status:0}));
 await assert.rejects(readRatioSnapshot({getBlock:async()=>{throw Error('Disconnected');}},f.token));
});
test('actual controller renderer uses calculated ratio; stale and terminal states are distinct',()=>{
 const source=fs.readFileSync('frontend/controller.js','utf8');const fn=source.slice(source.indexOf('function renderCalculatedPrice(){'),source.indexOf('function renderFreshness(){'));
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
 const context={reserveModel:true,priceSnapshot:{reserve:10000000000000000006n,supply:100000000000000000000n,getter:100000000000000000n,blockNumber:7},priceDecimals:0,ratio,formatRatio,exactFraction,formatEther:n=>(n/W)+'.'+(n%W).toString().padStart(18,'0'),freshness:()=>({stale:false}),text:(id,v)=>node(id).textContent=v,$:id=>node(id.slice(1))};
 vm.createContext(context);vm.runInContext(fn+';renderCalculatedPrice();',context);assert.equal(node('price').textContent,'0.10000000000000000006');assert.match(node('exact-price-details').textContent,/unchanged/);
 context.priceSnapshot.supply=0n;vm.runInContext('renderCalculatedPrice()',context);assert.equal(node('price').textContent,'Undefined (zero supply)');assert.match(node('exact-price-details').textContent,/historical reference only/);
 context.freshness=()=>({stale:true});vm.runInContext('renderCalculatedPrice()',context);assert.equal(node('price').textContent,'Unavailable');
});
test('one USD buy at P=.1 preserves the exact fee-derived change instead of rounding it to 3e-9',()=>{
 for(const R of [1000000n,1000000000n]){
  const before={reserve:R*W,supply:R*10n*W};
  const after={reserve:before.reserve+W,supply:before.supply+97n*W/10n};
  const d=ratioDelta(before,after);
  assert.equal(d.numerator,3n*W*before.supply/100n);
  const text=formatRatio(d,{sign:true});assert(text.startsWith(R===1000000n?'+0.000000002999':'+0.000000000002999'));
  assert.notEqual(text,R===1000000n?'+0.000000003':'+0.000000000003');
 }
});
