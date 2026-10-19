import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../frontend/controller.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf("$('#approve-units-button').onclick="),source.indexOf("$('#register-form').onsubmit="));
function fixture({units='1',balance=100n,allowance=0n}={}){
 const button={},calls=[];let approved=allowance*10n**18n;
 const context={$:s=>s==='#approve-units-button'?button:{elements:{units:{value:units}}},transaction:fn=>fn(),membershipBlock:()=>'',state:{},wallet:()=>({usdBalance:balance*10n**18n}),parseEther:()=>10n**20n,transactionAddress:'member',cfg:{binary:'binary'},t:s=>s,approve:async(spender,amount)=>{calls.push({spender,amount});approved=amount;},read:{usd:{allowance:async()=>approved}}};
 vm.runInNewContext(handler,context);return {click:()=>button.onclick(),calls};
}
test('separate approval button requests only selected collateral amount and reports no purchase',async()=>{
 const f=fixture({units:'2',balance:200n});assert.match(await f.click(),/No units have been purchased/);assert.deepEqual(f.calls,[{spender:'binary',amount:200n*10n**18n}]);
});
test('invalid count or insufficient balance never requests approval',async()=>{
 for(const options of [{units:'0'},{units:'1.5'},{units:'-1'},{units:'2',balance:100n}]){
  const f=fixture(options);await assert.rejects(f.click());assert.equal(f.calls.length,0);
 }
});
