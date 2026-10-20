import test from 'node:test';
import assert from 'node:assert/strict';
import {readTokenSnapshot} from '../frontend/token-snapshot.js';

const address='0x'+'1'.repeat(40),tokenAddress='0x'+'2'.repeat(40),zero='0x'+'0'.repeat(40),hash='0x'+'a'.repeat(64),UNIT=10n**18n;
function fixture(changes={}){
 const calls=[],state={paused:false,recoveryFrozen:false,emergencyUnwind:false,usdBalance:41n*UNIT,ftiBalance:0n,remaining:500n*UNIT,allowance:5n*UNIT,...changes};
 const member={parent:zero,left:zero,right:zero,units:1n,carryL:2n,carryR:3n,lifetimeL:4n,lifetimeR:5n,rank:0n,exists:true,autoEnabled:false,maxAutoPrice:0n};
 const head={number:123,timestamp:4000,hash};
 const token={target:tokenAddress};
 for(const name of ['paused','recoveryFrozen','emergencyUnwind'])token[name]=async options=>{calls.push([name,options]);return state[name];};
 for(const name of ['balanceOf','remainingAllowance'])token[name]=async(wallet,options)=>{assert.equal(wallet,address);calls.push(['token.'+name,options]);return name==='balanceOf'?state.ftiBalance:state.remaining;};
 const binary={members:async(wallet,options)=>{assert.equal(wallet,address);calls.push(['members',options]);return member;}};
 const usd={balanceOf:async(wallet,options)=>{assert.equal(wallet,address);calls.push(['usd.balanceOf',options]);return state.usdBalance;},allowance:async(wallet,spender,options)=>{assert.equal(wallet,address);assert.equal(spender,tokenAddress);calls.push(['usd.allowance',options]);return state.allowance;}};
 const rpc={getNetwork:async()=>({chainId:56n}),getBlock:async tag=>{calls.push(['block',tag]);return {...head};},request(){assert.fail('The snapshot must not call a wallet');}};
 return {calls,state,member,head,options:{rpc,binary,usd,token,address,chainId:56}};
}

test('reads complete V3 trading gates, membership and balances at one verified public block',async()=>{
 const f=fixture(),snapshot=await readTokenSnapshot(f.options);
 assert.equal(snapshot.block,123);assert.equal(snapshot.timestamp,4000);assert.equal(snapshot.tokenStateVerified,true);
 assert.equal(snapshot.tokenPaused,false);assert.equal(snapshot.tokenRecoveryFrozen,false);assert.equal(snapshot.emergencyUnwind,false);
 assert.equal(snapshot.wallet.address,address);assert.equal(snapshot.wallet.units,1n);assert.equal(snapshot.wallet.exists,true);
 assert.equal(snapshot.wallet.usdBalance,41n*UNIT);assert.equal(snapshot.wallet.ftiBalance,0n);assert.equal(snapshot.wallet.unlocked,0n);
 assert.equal(snapshot.wallet.remaining,500n*UNIT);assert.equal(snapshot.wallet.collateralAllowance,5n*UNIT);
 assert.equal(snapshot.wallet.carryL,2n);assert.equal(snapshot.wallet.lifetimeR,5n);
 assert.equal('claimable' in snapshot.wallet,false);assert.equal('autoPending' in snapshot.wallet,false);assert.equal('phase' in snapshot,false);
 assert.equal(f.calls.filter(([name])=>name!=='block').length,8);
 for(const [name,options]of f.calls)if(name!=='block')assert.deepEqual(options,{blockTag:123});
 assert.deepEqual(f.calls.filter(([name])=>name==='block'),[['block','latest'],['block',123]]);
});

test('pause and recovery each keep trading paused; emergency remains independently visible',async()=>{
 for(const change of [{paused:true},{recoveryFrozen:true}]){
  const f=fixture(change),snapshot=await readTokenSnapshot(f.options);assert.equal(snapshot.tokenPaused,true);
  assert.equal(snapshot.tokenRecoveryFrozen,!!change.recoveryFrozen);
 }
 const f=fixture({emergencyUnwind:true}),snapshot=await readTokenSnapshot(f.options);
 assert.equal(snapshot.emergencyUnwind,true);assert.equal(snapshot.tokenPaused,false);
});

test('non-upgradeable V3 explicitly skips the absent recovery getter',async()=>{
 const f=fixture();f.options.token.recoveryFrozen=()=>assert.fail('Unavailable V3 recovery getter must not be read');
 const snapshot=await readTokenSnapshot({...f.options,recoveryFrozen:false});assert.equal(snapshot.tokenRecoveryFrozen,false);
 assert.equal(f.calls.filter(([name])=>name!=='block').length,7);
});

test('nonzero V3 balances are fully unlocked and an unregistered wallet is reported without inventing membership',async()=>{
 const f=fixture({ftiBalance:123n*UNIT,remaining:0n,allowance:0n});f.member.exists=false;f.member.units=0n;
 const snapshot=await readTokenSnapshot({...f.options,tokenAddress});assert.equal(snapshot.wallet.unlocked,123n*UNIT);
 assert.equal(snapshot.wallet.exists,false);assert.equal(snapshot.wallet.units,0n);assert.equal(snapshot.wallet.remaining,0n);
});

test('wrong network and malformed configuration reject before any contract reads',async()=>{
 const f=fixture();f.options.rpc.getNetwork=async()=>({chainId:97n});
 await assert.rejects(readTokenSnapshot(f.options),/network/);assert.equal(f.calls.length,0);
 for(const change of [{address:'invalid'},{chainId:0},{chainId:56.5},{recoveryFrozen:'false'},{tokenAddress:'invalid'}]){
  const g=fixture();await assert.rejects(readTokenSnapshot({...g.options,...change}));assert.equal(g.calls.length,0);
 }
 const g=fixture();delete g.options.token.target;await assert.rejects(readTokenSnapshot(g.options),/contract address/);assert.equal(g.calls.length,0);
});

test('unreadable RPC or missing ABI getter never becomes a verified snapshot',async()=>{
 for(const mutate of [
  f=>f.options.token.balanceOf=async()=>{throw Error('RPC offline');},
  f=>delete f.options.token.recoveryFrozen,
  f=>delete f.options.token.emergencyUnwind,
  f=>delete f.options.usd.allowance,
  f=>f.options.binary.members=async()=>null,
 ]){const f=fixture();mutate(f);await assert.rejects(readTokenSnapshot(f.options));}
});

test('malformed flags, membership records and numeric responses fail closed',async()=>{
 const mutations=[
  f=>f.state.paused='false',f=>f.state.recoveryFrozen=0,f=>f.state.emergencyUnwind='true',
  f=>f.member.parent='invalid',f=>f.member.left=undefined,f=>f.member.exists=1,f=>f.member.autoEnabled='false',
  f=>f.member.units='invalid',f=>f.member.carryL=-1n,f=>f.member.rank=5n,f=>f.member.rank=2n**256n,
 ];
 for(const name of ['usdBalance','ftiBalance','remaining','allowance'])for(const value of [undefined,-1n,2n**256n,Number.MAX_SAFE_INTEGER+1,'01'])mutations.push(f=>{f.state[name]=value;});
 for(const mutate of mutations){const f=fixture();mutate(f);await assert.rejects(readTokenSnapshot(f.options));}
});

test('missing or malformed latest block rejects before reading balances and approvals',async()=>{
 for(const head of [null,{number:123,timestamp:4000},{number:-1,timestamp:4000,hash},{number:123,timestamp:0,hash}]){
  const f=fixture();f.options.rpc.getBlock=async()=>head;
  await assert.rejects(readTokenSnapshot(f.options),/block/);assert.equal(f.calls.length,0);
 }
});

test('reorg, changed timestamp or network changes reject the entire snapshot',async()=>{
 for(const change of ['missing','hash','number','timestamp','network']){
  const f=fixture();let blocks=0,networks=0;
  f.options.rpc.getBlock=async()=>{blocks++;if(blocks>1&&change==='missing')return null;const override=change==='hash'?{hash:'0x'+'b'.repeat(64)}:change==='number'?{number:124}:change==='timestamp'?{timestamp:4001}:{};return {...f.head,...(blocks>1?override:{})};};
  if(change==='network')f.options.rpc.getNetwork=async()=>({chainId:++networks===1?56n:97n});
  await assert.rejects(readTokenSnapshot(f.options),/block|network/);
 }
});
