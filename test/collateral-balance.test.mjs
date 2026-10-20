import test from 'node:test';
import assert from 'node:assert/strict';
import {requireCollateralBalance,collateralAmount,collateralBalanceMessage} from '../frontend/collateral-balance.js';
import {purchaseError} from '../frontend/purchase-error.js';
const unit=10n**18n, wallet='0x1111111111111111111111111111111111111111';
const tokenAddress='0x55d398326f99059fF775485246999027B3197955';
function fixture(balance=100n*unit){
 const calls=[];
 return {calls,options:{wallet,chainId:56,required:100n*unit,
  rpc:{send:async(method,args)=>{calls.push([method,args]);return '0x38';}},
  token:{target:tokenAddress,decimals:async()=>18n,balanceOf:async address=>{calls.push(['balanceOf',address]);return balance;}},
 }};
}
test('fresh token balance accepts exact cost, independently of a stale dashboard snapshot',async()=>{
 const {calls,options}=fixture();
 assert.equal(await requireCollateralBalance({...options,dashboardBalance:0n}),100n*unit);
 assert.deepEqual(calls,[['eth_chainId',[]],['balanceOf',wallet]]);
});
test('one smallest unit short is blocked and displayed exactly without rounding to enough',async()=>{
 const {options}=fixture(100n*unit-1n);
 await assert.rejects(requireCollateralBalance(options),e=>{
  assert.equal(e.code,'FTI_INSUFFICIENT_COLLATERAL');assert.equal(e.shortfall,1n);
  const message=collateralBalanceMessage(e);
  assert.match(message,/Required: 100 USDT/);
  assert.match(message,/Balance: 99\.999999999999999999 USDT/);
  assert.match(message,/Shortfall: 0\.000000000000000001 USDT/);
  assert.ok(message.includes(wallet));assert.ok(message.includes(tokenAddress));
  assert.match(purchaseError('VALIDATION',e),/^\[FTI-COLLATERAL\]/);
  for(const lang of ['fa','ar','tr','zh-CN','ru','es'])assert.ok(collateralBalanceMessage(e,lang).includes('USDT'));
  return true;
 });
});
test('multiple units and zero balance keep the complete payment requirement',async()=>{
 const {options}=fixture(0n);
 await assert.rejects(requireCollateralBalance({...options,required:300n*unit}),e=>e.required===300n*unit&&e.shortfall===300n*unit);
 assert.equal(collateralAmount(1000000n*100n*unit),'100000000');
});
test('wrong chain and wrong decimals fail before accepting any balance',async()=>{
 const {options,calls}=fixture();
 await assert.rejects(requireCollateralBalance({...options,chainId:97}),/network/);
 await assert.rejects(requireCollateralBalance({...options,token:{...options.token,decimals:async()=>6n}}),/decimals/);
 assert.ok(calls.every(([name])=>name!=='balanceOf'));
});
test('RPC failures propagate as unreadable balance, never as zero or insufficient funds',async()=>{
 const {options}=fixture();
 for(const method of ['decimals','balanceOf'])await assert.rejects(requireCollateralBalance({...options,token:{...options.token,[method]:async()=>{throw Error('read unavailable');}}}),/read unavailable/);
 for(const required of [0n,-1n,100])await assert.rejects(requireCollateralBalance({...options,required}),/Invalid collateral amount/);
});
