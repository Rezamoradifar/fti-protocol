import test from 'node:test';
import assert from 'node:assert/strict';
import {memberMetrics,readTreeMember} from '../frontend/network-data.mjs';
test('genealogy keeps historical volume, remaining matches and personal purchase units distinct',()=>{
 const m=memberMetrics({units:7n,carryL:30n,carryR:12n,lifetimeL:200n,lifetimeR:100n,rank:1n});
 assert.equal(m.contribution,700n);assert.equal(m.matchedCarry,12n);assert.equal(m.balancedLifetime,100n);assert.equal(m.lifetimeL,200n);assert.equal(m.rank,1);
});
test('missing trie switches to explicitly marked current-state reads',async()=>{
 const calls=[],context={blockTag:100,approximate:false};
 const binary={members:async(a,o)=>{calls.push(o.blockTag);if(o.blockTag===100)throw {info:{error:{message:'missing trie node'}}};return {units:1n}}};
 await readTreeMember(binary,'a',context);await readTreeMember(binary,'b',context);
 assert.deepEqual(calls,[100,'latest','latest']);assert.equal(context.approximate,true);
});
test('contract errors are not replaced with empty or zero nodes',async()=>{
 const context={blockTag:100,approximate:false};
 await assert.rejects(()=>readTreeMember({members:async()=>{throw Error('execution reverted')}},'a',context),/execution reverted/);assert.equal(context.approximate,false);
});
