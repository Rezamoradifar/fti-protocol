import test from 'node:test';
import assert from 'node:assert/strict';
import {membershipBlock,walletError} from '../frontend/membership-availability.js';
const open={phase:'0',monthPhase:'0',timestamp:100,epochEnd:'101',paused:false,binaryRecoveryFrozen:false};
test('deposit window closes exactly at epoch end even with phase zero',()=>{
 assert.equal(membershipBlock(open),'');
 for(const timestamp of [101,102,1792420715])assert.match(membershipBlock({...open,timestamp}),/settlement is overdue/);
});
test('unknown data and governance or settlement gates fail closed',()=>{
 assert.match(membershipBlock(null),/unavailable/);
 assert.match(membershipBlock({...open,epochEnd:undefined}),/timing/);
 assert.match(membershipBlock({...open,paused:true}),/paused/);
 assert.match(membershipBlock({...open,binaryRecoveryFrozen:true}),/frozen/);
 for(const phase of [1,2])assert.match(membershipBlock({...open,phase}),/progress/);
 assert.match(membershipBlock({...open,monthPhase:1}),/progress/);
});
test('nested wallet errors retain the useful cause and redact URLs',()=>{
 assert.equal(walletError({shortMessage:'could not coalesce error',error:{message:'insufficient funds for gas'}}),'insufficient funds for gas');
 assert.equal(walletError({info:{error:{code:4001}}}),'Request cancelled in your wallet.');
 assert.equal(walletError({error:{message:'RPC unavailable https://rpc.example/private-token'}}),'RPC unavailable [RPC]');
 const circular={};circular.error=circular;assert.match(walletError(circular),/Check the wallet activity/);
});
