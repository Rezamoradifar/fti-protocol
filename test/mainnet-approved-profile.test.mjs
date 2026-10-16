import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createApprovedMainnetInput} from '../scripts/create-mainnet-input.mjs';
import {selectedMainnetCouncil,assertSelectedMainnetCouncil} from '../scripts/mainnet-council.mjs';
import {loadWallets} from '../scripts/v3-wallets.mjs';
import {assertApprovedMainnetProfile,APPROVED_MAINNET_PROFILE} from '../scripts/approved-mainnet-profile.mjs';
import {validateMainnetInput} from '../scripts/prepare-mainnet.mjs';
const approved=loadWallets();
const sample=()=>({...JSON.parse(fs.readFileSync('config/mainnet-approved-input.REQUIRED.json')),deployer:'0x'+'1'.repeat(40)});
test('release profile pins exact 31-wallet order and external roles without any testnet migration',()=>{
 const input=validateMainnetInput(assertApprovedMainnetProfile(sample()));
 assert.equal(input.walletProfile,APPROVED_MAINNET_PROFILE);
 assert.equal(input.owner,approved.owner);assert.equal(input.development,approved.development);
 assert.deepEqual(input.genesis,approved.genesis);
 for(const change of [x=>x.genesis.reverse(),x=>x.genesis.pop(),x=>{x.genesis[1]=x.genesis[0]},x=>{x.owner=x.deployer},x=>{x.development=x.deployer},x=>{delete x.walletProfile},x=>{x.walletProfile='FTI_APPROVED_FRESH_MAINNET_20261016'},x=>{x.chainId=97},x=>{x.deploymentKind='migration'}]){
  const changed=sample();change(changed);assert.throws(()=>assertApprovedMainnetProfile(changed));
 }
});
test('generic planner refuses owner/development role membership and overlap',()=>{
 for(const role of ['owner','development']){
  const input=sample();delete input.walletProfile;input.genesis[0]=input[role];
  assert.throws(()=>validateMainnetInput(input),/cannot occupy genesis/);
 }
 const input=sample();delete input.walletProfile;input.owner=input.development;
 assert.throws(()=>validateMainnetInput(input),/remain distinct/);
});
test('shipped profile validates the supplied deployer, approved council, roles and USDT',()=>{
 const input=JSON.parse(fs.readFileSync('config/mainnet-approved-input.REQUIRED.json'));
 assert.equal(assertApprovedMainnetProfile(input),input);
 const checked=validateMainnetInput(input);
 assert.equal(checked.deployer,'0x8F18Ba93C3792037A7eb59485Ad79726615419a0');
 assert(![checked.owner,checked.development,...checked.partners,...checked.genesis].some(a=>a.toLowerCase()===checked.deployer.toLowerCase()));
 assert.deepEqual(createApprovedMainnetInput({deployer:checked.deployer}),checked);
 for(const deployer of ['REQUIRED_PUBLIC_DEPLOYER_ADDRESS','0x'+'0'.repeat(40)])assert.throws(()=>validateMainnetInput({...input,deployer}));
 assert.deepEqual(input.partners,selectedMainnetCouncil().partners);
 assert.equal(input.usd,'0x55d398326f99059fF775485246999027B3197955');
 assert.match(input.usdCodeHash,/^0x[a-f0-9]{64}$/);
});

test('testnet wallet-config environment cannot replace pinned mainnet roles/order',()=>{
 const previous=process.env.V3_WALLETS_CONFIG;process.env.V3_WALLETS_CONFIG='config/mainnet-input.example.json';
 try{assertApprovedMainnetProfile(sample())}finally{if(previous===undefined)delete process.env.V3_WALLETS_CONFIG;else process.env.V3_WALLETS_CONFIG=previous}
});

test('public input builder pins approved wallets and safely refuses overwrite or incomplete council',()=>{
 const fixture=sample();
 const council={threshold:5,partners:fixture.partners};
 const result=createApprovedMainnetInput({...fixture,council});
 assert.deepEqual(result.genesis,approved.genesis);assert.equal(result.owner,approved.owner);
 assert.throws(()=>createApprovedMainnetInput({...fixture,council:{threshold:7,partners:council.partners}}),/threshold/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-public-mainnet-input-'));
 try{
  const dao=path.join(dir,'dao.json'),out=path.join(dir,'input.json');fs.writeFileSync(dao,JSON.stringify(council));
  const args=['scripts/create-mainnet-input.mjs','--deployer',fixture.deployer,'--collateral',fixture.usd,'--collateral-code-hash',fixture.usdCodeHash,'--out',out];
  const run=()=>spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(run().status,0);assert.equal(fs.statSync(out).mode&0o777,0o600);
  const contents=fs.readFileSync(out,'utf8');assert.equal(JSON.parse(contents).genesis.length,31);assert.deepEqual(JSON.parse(contents).partners,council.partners);
  assert.notEqual(run().status,0);assert.equal(fs.readFileSync(out,'utf8'),contents);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});


test('production council pins all seven user-approved addresses and rejects membership/order/threshold drift',()=>{
 const expected=[
 '0x66Bccec30D27d780A23b2cBe467f20D4a1FC56F8',
 '0xe7efd5bfBa19cC1c6D50b5ddfBC972Fa5524851f',
 '0xF2637A6Ab93b13DEF1F46E49A1F39d1B9Ec1fC16',
 '0x1c8E8FFF893aFa573e0F616DDA333B1f0c7A8740',
 '0x3d6282594649f2E023209346779977293cFD481a',
 '0x202cA4f915E6dA048fb44d20c5FE852eb00FE3fe',
 '0x25D88f0B8ac6e1495112F3EB17DBC57271A92fa7'];
 assert.deepEqual(selectedMainnetCouncil().partners,expected);
 const input=sample();assert.equal(assertSelectedMainnetCouncil(input),input);
 assert.deepEqual(createApprovedMainnetInput({deployer:input.deployer}).partners,expected);
 for(const mutate of [x=>x.partners.reverse(),x=>x.partners.pop(),x=>{x.partners[1]=x.partners[0]},x=>{x.partners[0]='0x'+'0'.repeat(40)},x=>{x.daoThreshold=4}]){
  const changed=sample();mutate(changed);
  assert.throws(()=>assertSelectedMainnetCouncil(changed),/council/);
  assert.throws(()=>createApprovedMainnetInput({deployer:input.deployer,council:{threshold:changed.daoThreshold,partners:changed.partners}}),/council/);
 }
});


test('council-only wallets are excluded from all 31 initial positions, including generic planning',()=>{
 const input=sample();
 assert.equal(input.genesis.filter(a=>input.partners.some(p=>p.toLowerCase()===a.toLowerCase())).length,0);
 for(const member of input.partners){
  const changed=sample();delete changed.walletProfile;changed.genesis[0]=member;
  assert.throws(()=>validateMainnetInput(changed),/Council wallets cannot occupy genesis positions/);
 }
});
