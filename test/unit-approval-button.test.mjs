import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {requireCollateralBalance} from '../frontend/collateral-balance.js';
const source=fs.readFileSync(new URL('../frontend/controller.js',import.meta.url),'utf8');
const preflight=source.slice(source.indexOf('async function checkCollateral('),source.indexOf('async function transaction('));
const handler=source.slice(source.indexOf("$('#approve-units-button').onclick="),source.indexOf("$('#register-form').onsubmit="));
function fixture({units='1',balance=100n,snapshotBalance=balance,allowance=0n,chain='0x38',decimals=18n,readError}={}){
 const button={},calls=[];let approved=allowance*10n**18n;
 const context={$:s=>s==='#approve-units-button'?button:{elements:{units:{value:units}}},transaction:fn=>fn(),membershipBlock:()=>'',state:{},wallet:()=>({usdBalance:snapshotBalance*10n**18n}),parseEther:()=>10n**20n,transactionAddress:'member',address:'member',transactionStage:'VALIDATION',cfg:{binary:'binary',chainId:56},t:s=>s,approve:async(spender,amount)=>{calls.push({spender,amount});approved=amount;},
  requireCollateralBalance,rpc:{send:async()=>chain},read:{usd:{target:'collateral',decimals:async()=>decimals,balanceOf:async()=>{if(readError)throw Error(readError);return balance*10n**18n;},allowance:async()=>approved}}};
 vm.runInNewContext(preflight+handler,context);return {click:()=>button.onclick(),calls};
}
test('separate approval button requests only selected collateral amount and reports no purchase',async()=>{
 const f=fixture({units:'2',balance:200n});assert.match(await f.click(),/No units have been purchased/);assert.deepEqual(f.calls,[{spender:'binary',amount:200n*10n**18n}]);
});
test('invalid counts never request approval',async()=>{
 for(const units of ['0','1.5','-1']){
  const f=fixture({units});await assert.rejects(f.click(),/positive whole number/);assert.equal(f.calls.length,0);
 }
});
test('approval uses current collateral instead of stale dashboard balances',async()=>{
 const funded=fixture({units:'2',balance:200n,snapshotBalance:0n});
 await funded.click();assert.equal(funded.calls.length,1);
 const short=fixture({units:'2',balance:100n,snapshotBalance:200n});
 await assert.rejects(short.click(),error=>error.code==='FTI_INSUFFICIENT_COLLATERAL'&&error.shortfall===100n*10n**18n);
 assert.equal(short.calls.length,0);
});
test('unverifiable collateral cannot request approval',async()=>{
 for(const [options,message] of [[{chain:'0x61'},/network/],[{decimals:6n},/decimals/],[{readError:'RPC unavailable'},/RPC unavailable/]]){
  const f=fixture(options);await assert.rejects(f.click(),message);assert.equal(f.calls.length,0);
 }
});
