import {test} from 'node:test';
import assert from 'node:assert/strict';
import {purchaseError} from '../frontend/purchase-error.js';
test('same mobile transport failure identifies its precise operation without exposing RPC credentials',()=>{
 for(const stage of ['NETWORK','BALANCE','ALLOWANCE','GAS','NONCE','SIGN']){
  const result=purchaseError(stage,{message:'Load failed https://private.example/secret'});
  assert.match(result,new RegExp('\\[FTI-'+stage+'\\]'));assert.ok(!result.includes('private.example'));assert.ok(!result.includes('secret'));
 }
});
test('unknown stage cannot inject an arbitrary diagnostic code',()=>{assert.match(purchaseError('https://secret',{message:'Load failed'}),/^\[FTI-UNKNOWN\]/);});
