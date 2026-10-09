import test from 'node:test';import assert from 'node:assert/strict';import {readMarket} from '../scripts/market-reader.mjs';
test('execution volume uses bought USD and actual sale payout, with ordered block timestamps',async()=>{
 const token={target:'token',interface:{getEvent:n=>({topicHash:n}),parseLog:l=>l.event}};
 const p={getLogs:async()=>[{blockNumber:2,index:1,transactionHash:'sell',event:{name:'Sold',args:{usdOut:970n,tokensIn:100n}}},{blockNumber:1,index:0,transactionHash:'buy',event:{name:'Bought',args:{usdIn:1000n,userTokens:97n}}}],getBlock:async n=>({timestamp:n*60})};
 const result=await readMarket(p,token,0,2);assert.equal(result.trades[0].usd,'1000');assert.equal(result.trades[1].usd,'970');assert.equal(result.trades[1].time,120);
});
test('RPC failure is not reported as zero volume',async()=>{
 const token={target:'t',interface:{getEvent:n=>({topicHash:n})}};
 await assert.rejects(readMarket({getLogs:async()=>{throw Error('rate limit');}},token,0,2));
});
