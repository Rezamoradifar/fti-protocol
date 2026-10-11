import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pageIndex,uint,requireSendConsent,createBudget,requireSourceConfig,readPrivateKey} from '../scripts/address-migration-policy.mjs';
const addr=i=>'0x'+i.toString(16).padStart(40,'0');
const config=()=>({chainId:97,binaryContract:'FundedBinaryPlanUpgradeable',tokenContract:'FTIReserveTokenUpgradeable',
 binary:addr(1),token:addr(2),usd:addr(3),council:addr(4),timelock:addr(5),binaryImplementation:addr(6),tokenImplementation:addr(7),
 codeHashes:Object.fromEntries(['binary','token','usd','council','timelock'].map(k=>[k,'0x'+'1'.repeat(64)])),implementationCodeHashes:{binary:'0x'+'1'.repeat(64),token:'0x'+'2'.repeat(64)},deployedBlock:1,daoPartners:Array.from({length:7},(_,i)=>addr(i+20))});
test('resume counters include partial final pages and reject impossible cursors',()=>{
 assert.equal(pageIndex(0,130),0);assert.equal(pageIndex('64','130'),1);assert.equal(pageIndex(128n,130n),2);assert.equal(pageIndex(130,130),null);
 for(const p of [[1,130],[131,130],[-1,130],[Number.MAX_SAFE_INTEGER+1,130]])assert.throws(()=>pageIndex(...p));
});
test('uint256 never silently rounds JSON numbers or accepts signed/hex inputs',()=>{
 assert.equal(uint('9007199254740993','amount'),9007199254740993n);
 for(const v of [9007199254740992,-1,1.2,'1.2','0xff','-1','01','1e18',(1n<<256n).toString(),undefined])assert.throws(()=>uint(v,'amount'));
});
test('write consent requires exact network and exact coordinator',()=>{
 requireSendConsent({chainId:97,expectedChain:'97',coordinator:addr(1),expectedCoordinator:addr(1)});
 for(const change of [{chainId:56,expectedChain:56},{expectedChain:undefined},{expectedChain:31337},{expectedCoordinator:addr(2)}])assert.throws(()=>requireSendConsent({chainId:97,expectedChain:97,coordinator:addr(1),expectedCoordinator:addr(1),...change}));
});
test('gas budget reserves full maximum cost; failure never becomes free retry',()=>{
 const b=createBudget({maxFeeWei:1000,maxGasPriceWei:5,maxGas:100,maxTransactions:2});
 assert.deepEqual(b.reserve(100,5),{gasLimit:100n,gasPrice:5n});assert.equal(b.reserved,500n);
 assert.throws(()=>b.reserve(101,1));assert.throws(()=>b.reserve(1,6));
 b.reserve(100,5);assert.equal(b.reserved,1000n);assert.throws(()=>b.reserve(1,1));assert.equal(b.transactions,2);
});
test('budget configuration rejects unlimited, missing and negative limits',()=>{
 for(const opts of [{maxFeeWei:0},{maxFeeWei:undefined},{maxGasPriceWei:0},{maxGas:28000001},{maxTransactions:0},{maxTransactions:1001}])assert.throws(()=>createBudget({maxFeeWei:100,maxGasPriceWei:5,maxGas:100,maxTransactions:1,...opts}));
});
test('source configuration is the original five-contract deployment with seven distinct guardians',()=>{assert.equal(requireSourceConfig(config()).chainId,97);});
for(const [name,mutate] of [
 ['mainnet',c=>{c.chainId=56;}],['legacy source',c=>{c.binaryContract='FundedBinaryPlan';}],['missing code hash',c=>{delete c.codeHashes.token;}],
 ['duplicate guardian',c=>{c.daoPartners[1]=c.daoPartners[0];}],['no deployment block',c=>{c.deployedBlock=0;}],['same source addresses',c=>{c.token=c.binary;}]
])test('rejects '+name,()=>{const c=config();mutate(c);assert.throws(()=>requireSourceConfig(c));});
test('key-file reader accepts private regular files and rejects symlinks, public files and malformed data',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fti-key-policy-'));
 try {
  const file=path.join(dir,'key');fs.writeFileSync(file,'1'.repeat(64)+'\n',{mode:0o600});assert.equal(readPrivateKey(file),'0x'+'1'.repeat(64));
  fs.chmodSync(file,0o644);assert.throws(()=>readPrivateKey(file));fs.chmodSync(file,0o600);
  fs.symlinkSync(file,path.join(dir,'link'));assert.throws(()=>readPrivateKey(path.join(dir,'link')));
  fs.writeFileSync(file,'not a key');assert.throws(()=>readPrivateKey(file));assert.throws(()=>readPrivateKey(dir));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
