import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createApprovedMainnetInput} from '../scripts/create-mainnet-input.mjs';
import {loadWallets} from '../scripts/v3-wallets.mjs';
import {assertApprovedMainnetProfile,APPROVED_MAINNET_PROFILE} from '../scripts/approved-mainnet-profile.mjs';
import {validateMainnetInput} from '../scripts/prepare-mainnet.mjs';
const approved=loadWallets();
const sample=()=>({...JSON.parse(fs.readFileSync('config/mainnet-approved-input.REQUIRED.json')),deployer:'0x'+'1'.repeat(40),usd:'0x'+'2'.repeat(40),usdCodeHash:'0x'+'a'.repeat(64),partners:Array.from({length:7},(_,i)=>'0x'+(100+i).toString(16).padStart(40,'0'))});
test('release profile pins exact 31-wallet order and external roles without any testnet migration',()=>{
 const input=validateMainnetInput(assertApprovedMainnetProfile(sample()));
 assert.equal(input.walletProfile,APPROVED_MAINNET_PROFILE);
 assert.equal(input.owner,approved.owner);assert.equal(input.development,approved.development);
 assert.deepEqual(input.genesis,approved.genesis);
 for(const change of [x=>x.genesis.reverse(),x=>x.genesis.pop(),x=>{x.genesis[1]=x.genesis[0]},x=>{x.owner=x.deployer},x=>{x.development=x.deployer},x=>{delete x.walletProfile},x=>{x.chainId=97},x=>{x.deploymentKind='migration'}]){
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
test('shipped profile is deliberately incomplete instead of inventing collateral, deployer or council',()=>{
 const input=JSON.parse(fs.readFileSync('config/mainnet-approved-input.REQUIRED.json'));
 assert.equal(assertApprovedMainnetProfile(input),input);
 assert.throws(()=>validateMainnetInput(input),/Invalid public address/);
 assert.equal(input.partners.length,0);
 assert.match(input.usd,/REQUIRED_REVIEWED/);
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
  const args=['scripts/create-mainnet-input.mjs','--deployer',fixture.deployer,'--collateral',fixture.usd,'--collateral-code-hash',fixture.usdCodeHash,'--council-config',dao,'--out',out];
  const run=()=>spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(run().status,0);assert.equal(fs.statSync(out).mode&0o777,0o600);
  const contents=fs.readFileSync(out,'utf8');assert.equal(JSON.parse(contents).genesis.length,31);
  assert.notEqual(run().status,0);assert.equal(fs.readFileSync(out,'utf8'),contents);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
