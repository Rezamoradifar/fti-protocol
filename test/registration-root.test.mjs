import test from 'node:test';
import assert from 'node:assert/strict';
import {registrationRoot,selectRootSponsor} from '../frontend/registration-root.js';

const root='0xD6492377C2C33047aFE61768930b2aedFF2B2704';
test('root invitations are bound to the first address of the configured deployment',()=>{
 assert.equal(registrationRoot({chainId:56,genesis:[root]}),root);
 for(const wrong of [undefined,[],['0x'+'0'.repeat(40)],['0x'+'1'.repeat(40)],[{},root]]){
  assert.equal(registrationRoot({chainId:56,genesis:wrong}),null);
 }
 const local='0x'+'1'.repeat(40);
 assert.equal(registrationRoot({chainId:31337,genesis:[local]}),local);
});

test('explicit root choice sets the invitation once without sending a wallet request',()=>{
 let url,events=0;
 const win={location:{href:'https://ftiprotocol.com/app/?lang=fa&ref=previous&other=1'},history:{replaceState(_,__,value){url=new URL(value);}}};
 const field={disabled:true,value:'existing',setCustomValidity(){},dispatchEvent(event){assert.equal(event.type,'input');events++;}};
 selectRootSponsor(field,root,win);assert.equal(field.value,'existing');assert.equal(events,0);
 field.disabled=false;selectRootSponsor(field,root,win);assert.equal(field.value,root);assert.equal(events,1);
 assert.equal(url.hash,'#network');assert.equal(url.searchParams.get('sponsor'),root);
 assert.equal(url.searchParams.get('lang'),'fa');assert.equal(url.searchParams.get('other'),'1');assert.equal(url.searchParams.has('ref'),false);
});
