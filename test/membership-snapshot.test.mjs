import test from 'node:test';
import assert from 'node:assert/strict';
import {readMembershipSnapshot} from '../frontend/membership-snapshot.js';
import {membershipBlock} from '../frontend/membership-availability.js';
const address='0x'+'1'.repeat(40),zero='0x'+'0'.repeat(40),hash='0x'+'a'.repeat(64),UNIT=10n**18n;
function fixture(changes={}){
 const calls=[],state={paused:false,recoveryFrozen:false,phase:0n,monthPhase:0n,epochEnd:7200n,balance:100n*UNIT,...changes};
 const member={parent:zero,left:zero,right:zero,units:0n,carryL:2n,carryR:3n,lifetimeL:2n,lifetimeR:3n,rank:0n,exists:true,autoEnabled:false,maxAutoPrice:0n};
 const head={number:123,timestamp:4000,hash};
 const binary=Object.fromEntries(['paused','recoveryFrozen','phase','monthPhase','epochEnd'].map(name=>[name,async options=>{calls.push([name,options]);return state[name];}]));
 binary.members=async(wallet,options)=>{assert.equal(wallet,address);calls.push(['members',options]);return member;};
 const rpc={getNetwork:async()=>({chainId:56n}),getBlock:async tag=>{calls.push(['block',tag]);return {...head};}};
 const usd={balanceOf:async(wallet,options)=>{assert.equal(wallet,address);calls.push(['balanceOf',options]);return state.balance;}};
 return {calls,state,member,head,options:{rpc,binary,usd,address,chainId:56}};
}
test('fresh public membership gates and balances are read at one block without the dashboard',async()=>{
 const f=fixture(),snapshot=await readMembershipSnapshot({...f.options,dashboard:{paused:true,wallet:{usdBalance:0n}}});
 assert.equal(snapshot.block,123);assert.equal(snapshot.timestamp,4000);assert.equal(snapshot.epochEnd,7200);assert.equal(snapshot.wallet.usdBalance,100n*UNIT);assert.equal(snapshot.wallet.exists,true);assert.equal(snapshot.wallet.units,0n);assert.equal(membershipBlock(snapshot),'');
 assert.equal(f.calls.filter(([name])=>name!=='block').length,7);
 for(const [name,options] of f.calls)if(name!=='block')assert.deepEqual(options,{blockTag:123});
 assert.deepEqual(f.calls.filter(([name])=>name==='block'),[['block','latest'],['block',123]]);
});
test('pause, recovery, hourly and monthly settlement and overdue time stay blocked',async()=>{
 for(const changes of [{paused:true},{recoveryFrozen:true},{phase:1n},{phase:2n},{monthPhase:1n},{monthPhase:2n},{epochEnd:4000n},{epochEnd:3999n}]){
  const f=fixture(changes);assert.notEqual(membershipBlock(await readMembershipSnapshot(f.options)),'');
 }
});
test('legacy deployments explicitly skip the unavailable recovery getter',async()=>{
 const f=fixture();f.options.binary.recoveryFrozen=()=>assert.fail('Legacy getter must not be requested');
 const snapshot=await readMembershipSnapshot({...f.options,recoveryFrozen:false});assert.equal(snapshot.binaryRecoveryFrozen,false);assert.equal(membershipBlock(snapshot),'');
});
test('wrong chain, wallet and configuration stop before contract reads',async()=>{
 const f=fixture();f.options.rpc.getNetwork=async()=>({chainId:97n});
 await assert.rejects(readMembershipSnapshot(f.options),/network/);assert.equal(f.calls.length,0);
 for(const change of [{address:'not an address'},{chainId:0},{chainId:56.5},{recoveryFrozen:'false'}]){
  const g=fixture();await assert.rejects(readMembershipSnapshot({...g.options,...change}));assert.equal(g.calls.length,0);
 }
});
test('unreadable balances and malformed contract results never become usable zero state',async()=>{
 for(const mutate of [
  f=>f.options.usd.balanceOf=async()=>{throw Error('RPC offline');},
  f=>f.state.paused='false',f=>f.state.recoveryFrozen=0,f=>f.state.phase=-1n,f=>f.state.phase=3n,
  f=>f.state.monthPhase=256n,f=>f.state.epochEnd=0n,f=>f.state.balance=-1n,
  f=>f.state.balance=undefined,f=>f.member.units='invalid',f=>f.member.rank=5n,
  f=>f.member.exists='true',f=>f.member.autoEnabled=0,f=>f.member.parent='invalid',
 ]){
  const f=fixture();mutate(f);await assert.rejects(readMembershipSnapshot(f.options));
 }
});
test('missing blocks, reorgs and network changes reject the complete membership snapshot',async()=>{
 for(const change of ['missing','hash','number','timestamp','network']){
  const f=fixture();let blocks=0,networks=0;
  f.options.rpc.getBlock=async()=>{blocks++;if(change==='missing')return null;const override=change==='hash'?{hash:'0x'+'b'.repeat(64)}:change==='number'?{number:124}:change==='timestamp'?{timestamp:4001}:{};return {...f.head,...(blocks>1?override:{})};};
  if(change==='network')f.options.rpc.getNetwork=async()=>({chainId:++networks===1?56n:97n});
  await assert.rejects(readMembershipSnapshot(f.options),/block|network/);
 }
});
