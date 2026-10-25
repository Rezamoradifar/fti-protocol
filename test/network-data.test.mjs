import test from 'node:test';
import assert from 'node:assert/strict';
import {memberMetrics,networkPopulation,readTreeMember} from '../frontend/network-data.mjs';
test('genealogy keeps historical volume, remaining matches and personal purchase units distinct',()=>{
 const m=memberMetrics({units:7n,carryL:30n,carryR:12n,lifetimeL:200n,lifetimeR:100n,rank:1n});
 assert.equal(m.contribution,700n);assert.equal(m.matchedCarry,12n);assert.equal(m.balancedLifetime,100n);assert.equal(m.lifetimeL,200n);assert.equal(m.rank,1);
});
test('settled historical matches remain distinct from current carried balances',()=>{
 // This is the reported member shape: completed matching consumes carry while
 // keeping the historical volume and the member's own paid unit unchanged.
 const m=memberMetrics({units:'1',carryL:'0',carryR:'0',lifetimeL:'4',lifetimeR:'4',rank:'0'});
 assert.equal(m.contribution,100n);assert.equal(m.units,1n);assert.equal(m.matchedCarry,0n);
 assert.equal(m.carryL,0n);assert.equal(m.carryR,0n);assert.equal(m.balancedLifetime,4n);
});
test('unknown, negative, unsafe and malformed tree values never become zero balances',()=>{
 const valid={units:1n,carryL:0n,carryR:0n,lifetimeL:4n,lifetimeR:4n,rank:0n};
 for(const key of Object.keys(valid))for(const value of [undefined,null,'',false,-1n,'1.5',Number.MAX_SAFE_INTEGER+1,1n<<256n]){
  assert.throws(()=>memberMetrics({...valid,[key]:value}),new RegExp('Invalid membership field: '+key));
 }
 for(const rank of [5,255n])assert.throws(()=>memberMetrics({...valid,rank}),/rank/);
 const large=memberMetrics({...valid,units:'900719925474099312345'});assert.equal(large.contribution,90071992547409931234500n);
});
test('registered wallet count includes genesis and is independent of purchased units',()=>{
 const genesis=Array.from({length:31},(_,i)=>'0x'+(i+1).toString(16).padStart(40,'0'));
 const state={count:'34',block:129736252,timestamp:1792945037},cfg={genesis};
 assert.deepEqual(networkPopulation(state,cfg),{registeredWallets:'34',genesisWallets:'31',postGenesisWallets:'3',block:129736252,timestamp:1792945037});
 // Repeated unit purchases cannot manufacture extra registered positions.
 assert.deepEqual(networkPopulation({...state,wallet:{units:'1000000'}},cfg),networkPopulation(state,cfg));
 assert.equal(networkPopulation({...state,count:'35'},cfg).postGenesisWallets,'4');
 assert.equal(networkPopulation({...state,count:'900719925474099312345'},cfg).registeredWallets,'900719925474099312345');
});
test('population counts require a valid read anchor and never assume an unknown genesis size',()=>{
 const state={count:'34',block:123,timestamp:456};
 for(const count of [undefined,null,'',false,-1,'3.4',Number.MAX_SAFE_INTEGER+1])assert.equal(networkPopulation({...state,count}).registeredWallets,null);
 for(const change of [{block:undefined},{block:-1},{block:Number.MAX_SAFE_INTEGER+1},{timestamp:0},{timestamp:null}])assert.equal(networkPopulation({...state,...change}).registeredWallets,null);
 assert.deepEqual(networkPopulation({...state,count:'0'}),{registeredWallets:'0',genesisWallets:null,postGenesisWallets:null,block:123,timestamp:456});
 const genesis=Array.from({length:31},(_,i)=>'0x'+(i+1).toString(16).padStart(40,'0'));
 for(const changed of [[],genesis.slice(1),[...genesis.slice(0,30),genesis[0]],[...genesis.slice(0,30),'0x'+'0'.repeat(40)]])assert.equal(networkPopulation(state,{genesis:changed}).genesisWallets,null);
 assert.equal(networkPopulation({...state,count:'30'},{genesis}).postGenesisWallets,null);
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
