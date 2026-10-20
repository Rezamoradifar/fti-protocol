import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../frontend/controller.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf("$('#register-form').onsubmit="),source.indexOf("$('#auto-form').addEventListener("));
const approve=source.slice(source.indexOf('async function approve('),source.indexOf('let walletProvider,',source.indexOf('async function approve(')));
const sponsor='0x'+'3'.repeat(40),member='0x'+'1'.repeat(40),unit=100n*10n**18n;
function fixture({allowance=0n,units='1',exists=true,approvalError,unverified=false,balanceFailure=false,blockedAfterApproval=false,membershipChanged=false,automaticReferral=false}={}){
 const calls=[],form={elements:{units:{value:units},sponsor:{value:sponsor}}};let currentAllowance=allowance,snapshot=0,operation;
 const context={$:()=>form,transaction:fn=>{operation=fn();return operation;},state:{},transactionStage:'',transactionAddress:member,address:member,cfg:{binary:'binary'},automaticReferral,
  membershipBlock:()=>snapshot&&blockedAfterApproval?'Settlement is processing.':'',wallet:()=>({exists:snapshot&&membershipChanged?!exists:exists}),
  isAddress:value=>/^0x[0-9a-f]{40}$/i.test(value),ZeroAddress:'0x'+'0'.repeat(40),parseEther:value=>BigInt(value)*10n**18n,t:(key,fa)=>key,status(){},networkProfile:{testAssets:false},
  checkCollateral:async amount=>{calls.push(['balance',amount]);if(balanceFailure&&snapshot)throw Error('Collateral changed.');},
  refreshMembershipState:async()=>{calls.push(['refresh']);snapshot++;},json:async()=>({referrer:sponsor,placementParent:'0x'+'4'.repeat(40)}),
  read:{usd:{allowance:async()=>currentAllowance}},sendContract:async(key,method,...args)=>{calls.push([key,method,...args]);if(method==='approve'){if(approvalError)throw approvalError;if(!unverified)currentAllowance=args[1];}},
 };
 vm.runInNewContext(approve+handler,context);
 return {calls,context,start(){form.onsubmit({preventDefault(){},target:form});return operation;}};
}
test('one purchase action skips an already sufficient approval and buys the captured units once',async()=>{
 const f=fixture({allowance:unit*3n,units:'2'});await f.start();
 assert.deepEqual(f.calls.filter(x=>x[0]==='usd'),[]);
 assert.deepEqual(f.calls.filter(x=>x[0]==='binary'),[['binary','addUnits',2n]]);
});
test('one purchase action approves only the exact selected amount before buying',async()=>{
 const f=fixture({units:'2'});await f.start();
 assert.deepEqual(f.calls.filter(x=>x[0]==='usd'||x[0]==='binary'),[['usd','approve','binary',unit*2n],['binary','addUnits',2n]]);
 assert(f.calls.findIndex(x=>x[0]==='refresh')>f.calls.findIndex(x=>x[1]==='approve'));
});
test('partial allowance is reset to zero before exact approval and purchase',async()=>{
 const f=fixture({allowance:unit/2n});await f.start();
 assert.deepEqual(f.calls.filter(x=>x[0]==='usd'),[['usd','approve','binary',0],['usd','approve','binary',unit]]);
 assert.equal(f.calls.filter(x=>x[0]==='binary').length,1);
});
test('approval rejection or an unverified allowance never proceeds to a purchase',async()=>{
 for(const options of [{approvalError:Object.assign(Error('Rejected'),{code:4001})},{unverified:true}]){
  const f=fixture(options);await assert.rejects(f.start());assert.equal(f.calls.filter(x=>x[0]==='binary').length,0);
 }
});
test('fresh balance, settlement and membership checks after approval prevent a changed purchase',async()=>{
 for(const options of [{balanceFailure:true},{blockedAfterApproval:true},{membershipChanged:true}]){
  const f=fixture(options);await assert.rejects(f.start());assert.equal(f.calls.filter(x=>x[0]==='binary').length,0);
 }
});
test('new membership uses its sponsor and optional automatic placement in the same flow',async()=>{
 for(const automaticReferral of [false,true]){
  const f=fixture({exists:false,automaticReferral});await f.start();
  const sends=f.calls.filter(x=>x[0]==='binary');assert.equal(sends.length,1);
  assert.equal(sends[0][1],automaticReferral?'registerWithPlacement':'register');assert.equal(sends[0][2],sponsor);assert.equal(sends[0].at(-1),1n);
 }
});
test('invalid unit counts cannot approve collateral or request a purchase',async()=>{
 for(const units of ['0','-1','1.5','']){const f=fixture({units});await assert.rejects(f.start());assert.equal(f.calls.filter(x=>['usd','binary'].includes(x[0])).length,0);}
});
