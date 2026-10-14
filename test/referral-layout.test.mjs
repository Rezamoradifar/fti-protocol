import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import {assertStorageCompatible} from '../scripts/check-upgrade-layout.mjs';

test('referral V2 changes storage layout by appending referral mappings and explicit pool activation state; legacy member and balances remain intact',()=>{
 const oldBinary=fs.readFileSync('test/fixtures/legacy/FundedBinaryPlanUpgradeable.v1.sol.txt','utf8');
 const actual=fs.readFileSync('contracts/FundedBinaryPlanUpgradeable.sol','utf8');
 assert.notEqual(actual,oldBinary,'Fixture must remain the unmodified previous implementation');
 const src={};for(const f of fs.readdirSync('contracts').filter(f=>f.endsWith('.sol'))){
  src['contracts/'+f]={content:f==='FundedBinaryPlanUpgradeable.sol'?oldBinary:fs.readFileSync('contracts/'+f,'utf8')};
 }
 const input={language:'Solidity',sources:src,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['storageLayout']}}}};
 const output=JSON.parse(solc.compile(JSON.stringify(input),{import:p=>{try{return {contents:fs.readFileSync(path.join('node_modules',p),'utf8')}}catch{return {error:'Missing '+p};}}}));
 assert(!output.errors?.some(e=>e.severity==='error'),(output.errors||[]).filter(e=>e.severity==='error').map(e=>e.formattedMessage).join('\n'));
 const oldLayout=output.contracts['contracts/FundedBinaryPlanUpgradeable.sol'].FundedBinaryPlanUpgradeable.storageLayout;
 const newLayout=JSON.parse(fs.readFileSync('artifacts/storage-layout/FundedBinaryPlanUpgradeable.json','utf8'));
 assertStorageCompatible(oldLayout,newLayout);
 assert.equal(newLayout.storage.length,oldLayout.storage.length+6);
 assert.deepEqual(newLayout.storage.slice(-6).map(s=>s.label),['directReferrer','directReferralCount','poolDistributionState','poolMigrationCursor','poolMigrationMonth','poolMigrationLastMonth']);
 assert.match(actual,/FTI_BINARY_CONTINUITY_V1/);
 assert.match(actual,/require\(msg.sender==governance,'governance'\)/);
 console.log('FTI_REFERRAL_STORAGE_COMPATIBLE',JSON.stringify({originalStorageFields:oldLayout.storage.length,addedStorageFields:6,result:'PASS'}));
});
