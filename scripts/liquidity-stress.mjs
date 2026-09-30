import assert from 'node:assert/strict';import {Curve,W} from '../core/reference.mjs';
const results=[];
for(const mode of ['full-exit','split-exit','reverse-order']){
 const c=new Curve(),ids=Array.from({length:100},(_,i)=>i);for(const id of ids){c.inject(5n*W);c.buy(id,400n*W);}c.advance(86400n);
 let payout=0n,operations=0,maxDD=0,bbBudget,floorBudget;
 const order=mode==='reverse-order'?[...ids].reverse():ids;
 for(const id of order){const pieces=mode==='split-exit'?10:1;for(let n=0;n<pieces;n++){const b=c.balances.get(id);const t=n===pieces-1?b:b/BigInt(pieces-n);payout+=c.sell(id,t);operations++;c.check();if(bbBudget!==undefined){assert(c.bbBudget<=bbBudget);assert(c.floorBudget<=floorBudget);}bbBudget=c.bbBudget;floorBudget=c.floorBudget;maxDD=Math.max(maxDD,1-Number(c.price())/Number(c.ath));}}
 assert.equal(c.supply,0n);results.push({mode,holders:100,operations,totalPaidUSD:Number(payout)/1e18,remainingReserveUSD:Number(c.reserve)/1e18,remainingSupportUSD:Number(c.bb+c.floor)/1e18,maxDrawdownPct:maxDD*100,accounting:'PASS',exactK:'PASS',budgetNeverRefilledWithinWindow:'PASS'});
}
console.log(JSON.stringify({assumptions:'Independent BigInt model; all holdings unlocked; no new inflows during exit; no elapsed time during exit; sustained-fee flag false. Not a price guarantee.',results},null,2));
