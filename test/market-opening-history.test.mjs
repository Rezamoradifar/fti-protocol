import test from 'node:test';
import assert from 'node:assert/strict';
import {validOpeningQuote,readOpeningQuote,priceChartSeries,observedSeries,historicalObservations,curveGeometry} from '../frontend/spot-history.js';
const H=n=>'0x'+Number(n).toString(16).padStart(64,'0'),A='0x'+'a'.repeat(40),P='100000000000000000';
const row=(block,extra={})=>({block,time:1000+block,hash:H(block),priceWei:'106000000000000000',supplyWei:'1000000000000000000',cycle:'1',...extra});
const quote=extra=>({kind:'opening-quote',block:2,time:1002,hash:H(2),transactionHash:H(9),token:A,cycle:'1',priceWei:P,...extra});
function fixture({chain=56n,receipt:overReceipt={},block:overBlock={},initial=10n**17n,start=initial,cycle=1n,reorg=false}={}){
 const calls=[],cfg={chainId:56,token:A,deployedBlock:1,receipts:{token:{blockNumber:2,transactionHash:H(9),blockHash:H(2)}}};
 const receipt={status:1,blockNumber:2,blockHash:H(2),hash:H(9),contractAddress:A,...overReceipt};
 const rpc={getNetwork:async()=>({chainId:chain}),getTransactionReceipt:async hash=>{calls.push(['receipt',hash]);return receipt;},getBlock:async number=>{calls.push(['block',number]);return {number,hash:H(reorg&&number===10?99:number),timestamp:1000+number,...(number===2?overBlock:{})};}};
 const token={target:A,INITIAL_PRICE:async at=>{calls.push(['initial',at]);return initial;},cycleStartPrice:async at=>{calls.push(['start',at]);return start;},cycle:async at=>{calls.push(['cycle',at]);return cycle;}};
 return {cfg,rpc,token,calls};
}
test('opening reference is proven by token creation receipt and same-block contract constants, without inventing pre-supply price',async()=>{
 const f=fixture(),q=await readOpeningQuote(f.token,f.rpc,f.cfg,row(10));
 assert.deepEqual(q,quote());assert.equal(q.priceWei,P);assert(!Object.hasOwn(q,'supplyWei'));
 assert.deepEqual(f.calls.filter(([name])=>['initial','start','cycle'].includes(name)).map(([,at])=>at.blockTag),[10,10,10]);
 // Opening quote discovery does not ask a pruned deployment block for state.
 assert.equal(f.calls.filter(([name])=>name==='receipt').length,1);
});
test('a failed, foreign or noncanonical creation receipt is never accepted as an initial quote',async()=>{
 for(const receipt of [{status:0},{contractAddress:'0x'+'b'.repeat(40)},{blockHash:H(99)},{blockNumber:3},{hash:H(88)}]){
  const f=fixture({receipt});await assert.rejects(()=>readOpeningQuote(f.token,f.rpc,f.cfg,row(10)),/receipt mismatch/);
 }
 const f=fixture({block:{hash:H(3)}});await assert.rejects(()=>readOpeningQuote(f.token,f.rpc,f.cfg,row(10)),/block mismatch/);
});
test('opening quote rejects wrong chains, altered cycle quotes and a reorged current anchor',async()=>{
 const wrong=fixture({chain:97n});await assert.rejects(()=>readOpeningQuote(wrong.token,wrong.rpc,wrong.cfg,row(10)),/network/);assert.equal(wrong.calls.length,0);
 for(const options of [{start:2n*10n**17n},{initial:0n},{cycle:2n},{reorg:true}]){
  const f=fixture(options);await assert.rejects(()=>readOpeningQuote(f.token,f.rpc,f.cfg,row(10)),/mismatch|reorganized/);
 }
});
test('missing creation metadata and a mismatched token fail before performing receipt or state work',async()=>{
 const missing=fixture();delete missing.cfg.receipts;await assert.rejects(()=>readOpeningQuote(missing.token,missing.rpc,missing.cfg,row(10)),/unavailable/);assert.equal(missing.calls.length,0);
 const wrong=fixture();wrong.token.target='0x'+'b'.repeat(40);await assert.rejects(()=>readOpeningQuote(wrong.token,wrong.rpc,wrong.cfg,row(10)),/mismatch/);assert.equal(wrong.calls.length,0);
});
test('first-cycle opening reference never crosses a later cycle reset',async()=>{
 const f=fixture();assert.equal(await readOpeningQuote(f.token,f.rpc,f.cfg,row(10,{cycle:'2'})),null);assert.equal(f.calls.length,0);
 assert.deepEqual(priceChartSeries([row(10,{cycle:'2'})],0,quote()).map(p=>p.block),[10]);
});
test('all observations include a distinctly typed opening reference while recent windows retain only observations',()=>{
 const data=[row(8),row(10)];const series=priceChartSeries(data,0,quote());
 assert.deepEqual(series.map(p=>p.kind),['opening-quote','observation','observation']);assert.equal(series[0].price,.1);assert.equal(series.length,observedSeries(data).length+1);
 assert.deepEqual(priceChartSeries(data,60,quote()).map(p=>p.block),[8,10]);
 assert.deepEqual(priceChartSeries(data,0,quote({time:1011})).map(p=>p.block),[8,10]);
});
test('zero supply never becomes a fabricated spot price or a reference-only growth curve',()=>{
 assert.deepEqual(priceChartSeries([row(10,{supplyWei:'0',priceWei:'0'})],0,quote()),[]);
 assert.deepEqual(priceChartSeries([],0,quote()),[]);
});
test('downward contract observations stay downward instead of forcing an upward token curve',()=>{
 const series=priceChartSeries([row(8,{priceWei:'110000000000000000'}),row(10,{priceWei:'105000000000000000'})],0,quote());
 assert.equal(series.at(-1).price,.105);assert(series[1].price>series[2].price);assert(curveGeometry(series).xy[1][1]<curveGeometry(series).xy[2][1]);
 assert.equal(curveGeometry(observedSeries(series.slice(1))).change,(.105/.11-1)*100);
});
test('deployment-spanning history samples at most24 real blocks and starts at the TOKEN creation, after the earlier council block',async()=>{
 const tags=[],cfg={chainId:56,deployedBlock:1,receipts:{token:{blockNumber:10}}};
 const rpc={getNetwork:async()=>({chainId:56n}),getBlock:async n=>{const number=n==='latest'?1000000:n;return {number,hash:H(number),timestamp:1000+number};}};
 const token={price:async at=>{tags.push(at.blockTag);return 10n**17n;},totalSupply:async()=>1n,cycle:async()=>1n};
 const rows=await historicalObservations(token,rpc,cfg,{count:24,lookback:'deployment'});
 assert.equal(rows.length,24);assert.equal(rows[0].block,10);assert.equal(rows.at(-1).block,1000000);assert.equal(tags.length,24);assert(tags.every(Number.isSafeInteger));
 await assert.rejects(()=>historicalObservations(token,rpc,cfg,{count:25,lookback:'deployment'}),/budget/);
});
test('unavailable archive state fails as unavailable rather than repeating current price in earlier blocks',async()=>{
 let priceCalls=0;const rpc={getNetwork:async()=>({chainId:56n}),getBlock:async n=>{const number=n==='latest'?100:n;return {number,hash:H(number),timestamp:1000+number};}};
 const token={price:async at=>{priceCalls++;if(at.blockTag<100)throw Error('Historical state pruned');return 10n**17n;},totalSupply:async()=>1n,cycle:async()=>1n};
 await assert.rejects(()=>historicalObservations(token,rpc,{chainId:56,deployedBlock:1},{count:24,lookback:'deployment'}),/pruned/);assert(priceCalls<=2);
});
test('opening quote validation rejects fake reference types, invalid hashes, zero amounts and unsupported cycles',()=>{
 for(const bad of [{kind:'observation'},{hash:'0x'},{priceWei:'0'},{priceWei:100},{cycle:'2'},{transactionHash:H(1).slice(1)}])assert.throws(()=>validOpeningQuote(quote(bad)));
});
