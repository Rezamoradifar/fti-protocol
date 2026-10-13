import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ZeroAddress} from 'ethers';
import {reviewMainnetMigration} from '../scripts/review-mainnet-migration.mjs';
const address=i=>'0x'+i.toString(16).padStart(40,'0');
function snapshot(){
 const users=Array.from({length:31},(_,i)=>({index:i,wallet:address(i+1),depth:String(Math.floor(Math.log2(i+1))),pendingAuto:'0',creditL:'0',creditR:'0',member:{exists:true,parent:i?address(Math.floor((i-1)/2)+1):ZeroAddress,left:i*2+1<31?address(i*2+2):ZeroAddress,right:i*2+2<31?address(i*2+3):ZeroAddress}}));
 return {schema:'FTI_COMPLETE_EXPORT_V1',chainId:'97',block:{number:123,hash:'0x'+'a'.repeat(64)},contracts:{binary:address(100),token:address(101),usd:address(102)},users,
  global:{binary:{phase:'0',monthPhase:'0',jobCursor:'0',jobCount:'0',totalPending:'5',totalAuto:'0',assignedPointCredit:'0',assignedBuilderCredit:'0'},token:{totalSupply:'21'}},
  collateral:{binaryBalance:'5',tokenBalance:'7'},accounting:{binary:['5','5'],token:['7','7'],funding:['0','0','0','0']},
  ledger:{holders:[{wallet:address(1),balance:'21'}],cashQueue:[{wallet:address(1),amount:'5'}],autoQueue:[],months:[]}};
}
const run=s=>{const raw=JSON.stringify(s);return reviewMainnetMigration(raw,createHash('sha256').update(raw).digest('hex'));};
test('migration review preserves genealogy and measures funding without creating mainnet claims',()=>{
 const s=snapshot(),r=run(s);assert.equal(r.members,31);assert.equal(r.financialInventory.totalReplacementCollateralWei,'12');
 assert.equal(r.policy,'UNDECIDED');assert.equal(r.readyToImport,false);assert.equal(r.submitted,false);assert.equal(r.sourceVerifiedOnChain,false);
 assert.equal(r.preservationCandidate.genealogy[1].parent,s.users[0].wallet);assert.equal(r.financialInventory.externalWalletBalancesExcluded,true);
});
test('mismatched source, broken ownership, unsettled state and bad genealogy fail closed',()=>{
 assert.throws(()=>reviewMainnetMigration(JSON.stringify(snapshot()),'0'.repeat(64)),/SHA-256/);
 for(const change of [s=>s.chainId='56',s=>s.users[1].member.parent=ZeroAddress,s=>s.users[0].index=3,s=>s.accounting.binary[0]='4',s=>s.global.binary.phase='1',s=>s.ledger.holders[0].balance='20',s=>s.ledger.cashQueue[0].amount='4',s=>s.users[0].creditL='1',s=>s.users[0].pendingAuto='1',s=>s.ledger.holders.push(s.ledger.holders[0]),s=>s.global.binary.totalAuto='-1']){
  const s=snapshot();change(s);assert.throws(()=>run(s));
 }
});
