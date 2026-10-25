import test from 'node:test';
import assert from 'node:assert/strict';
import {memberAccountView} from '../frontend/member-account-view.js';

const address='0x'+'a'.repeat(40),other='0x'+'b'.repeat(40),now=1_800_000_000_000;
const networkProfile={chainId:56,label:'BNB Mainnet · 56',explorer:'https://bscscan.com',testAssets:false};
const cfg={chainId:56,referralPlacementEnabled:true};
const fixture=()=>({address,networkProfile,cfg,selectableAuto:true,now,updatedAt:now,
 state:{block:1234,timestamp:now/1000-3,level:0,wallet:{address,exists:true,rank:2,
  units:'3',lifetimeL:'205',lifetimeR:'220',carryL:'12',carryR:'30',directReferrals:'7',
  autoEnabled:true,autoBuyPercent:35,autoPending:'1250000000000000000',claimable:'3000000000000000000',
  usdBalance:'456000000000000000000',ftiBalance:'9876543210000000000',unlocked:'9876543210000000000',remaining:'800000000000000000000'}}});

test('projects verified account values without converting base units or losing integer precision',()=>{
 const input=fixture();input.state.wallet.ftiBalance='123456789012345678901234567890';
 const value=memberAccountView(input);
 assert.equal(value.status,'verified');assert.equal(value.verified,true);assert.equal(value.membershipStatus,'registered');
 assert.equal(value.units,'3');assert.equal(value.lifetimeL,'205');assert.equal(value.carryR,'30');
 assert.equal(value.hourlyCap,15);assert.equal(value.directReferrals,'7');assert.equal(value.autoBuyPercent,35);
 assert.equal(value.claimable,'3000000000000000000');assert.equal(value.ftiBalance,'123456789012345678901234567890');
 assert.deepEqual(value.network,{chainId:56,label:'BNB Mainnet · 56',explorer:'https://bscscan.com',testAssets:false});
 assert.deepEqual(value.snapshot,{block:1234,timestamp:now/1000-3,updatedAt:now,ageSeconds:3});
});

test('account switch never exposes balances or referral data from the previous wallet',()=>{
 const input=fixture();input.address=other;
 const value=memberAccountView(input);
 assert.equal(value.connected,true);assert.equal(value.address,other);assert.equal(value.status,'unavailable');
 for(const key of ['units','lifetimeL','carryR','rank','hourlyCap','directReferrals','autoPending','claimable','usdBalance','ftiBalance','unlocked','remaining'])assert.equal(value[key],null,key);
 assert.equal(value.membershipStatus,'unknown');assert.equal(value.verified,false);
 input.address=address.toUpperCase().replace('0X','0x');
 assert.equal(memberAccountView(input).status,'verified');
});

test('disconnection clears account values while preserving only the known deployment network',()=>{
 const input=fixture();input.address=null;
 const value=memberAccountView(input);
 assert.equal(value.status,'disconnected');assert.equal(value.connected,false);assert.equal(value.address,null);
 assert.equal(value.claimable,null);assert.equal(value.rank,null);assert.equal(value.network.chainId,56);
 assert.equal(memberAccountView({...fixture(),address:'not-an-address'}).connected,false);
});

test('stale same-wallet data remains labeled stale and never claims to be current',()=>{
 const input=fixture();input.state.timestamp=now/1000-121;
 const value=memberAccountView(input);
 assert.equal(value.status,'stale');assert.equal(value.stale,true);assert.equal(value.verified,false);
 assert.equal(value.claimable,'3000000000000000000');assert.equal(value.snapshot.ageSeconds,121);
 const refreshStale=fixture();refreshStale.updatedAt=now-121_000;
 assert.equal(memberAccountView(refreshStale).status,'stale');
 const future=fixture();future.state.timestamp=now/1000+16;
 assert.equal(memberAccountView(future).status,'stale');
});

test('missing, malformed and unsafe numbers stay unavailable instead of becoming zero or a cap',()=>{
 const input=fixture();delete input.state.wallet.claimable;delete input.state.wallet.units;
 input.state.wallet.carryL=-1;input.state.wallet.autoPending='1.2';input.state.wallet.remaining=Number.MAX_SAFE_INTEGER+1;
 input.state.wallet.ftiBalance=1n<<256n;input.state.level=99;input.state.wallet.rank='4.5';
 const value=memberAccountView(input);
 assert.equal(value.status,'unavailable');
 for(const key of ['claimable','units','carryL','autoPending','remaining','ftiBalance','rank','hourlyCap'])assert.equal(value[key],null,key);
 input.state.timestamp='not-a-time';
 assert.equal(memberAccountView(input).snapshot.timestamp,null);
 assert.equal(memberAccountView(input).stale,false);
});

test('actual zeroes are preserved, unregistered status is explicit and capabilities gate referral/auto data',()=>{
 const input=fixture();Object.assign(input.state.wallet,{exists:false,rank:0,units:0n,lifetimeL:0,lifetimeR:'0',carryL:0n,carryR:0n,claimable:'0',autoPending:0n});
 input.cfg={chainId:56,referralPlacementEnabled:false};input.selectableAuto=false;
 const value=memberAccountView(input);
 assert.equal(value.status,'verified');assert.equal(value.membershipStatus,'not-registered');assert.equal(value.units,'0');
 assert.equal(value.claimable,'0');assert.equal(value.hourlyCap,null);assert.equal(value.directReferrals,null);assert.equal(value.autoBuyPercent,null);
 input.selectableAuto=true;input.state.wallet.autoBuyPercent=101;
 assert.equal(memberAccountView(input).autoBuyPercent,null);
});

test('an unknown network, invalid anchor or mismatched configuration is never presented as verified',()=>{
 for(const mutate of [i=>{i.networkProfile=undefined;},i=>{i.networkProfile={...networkProfile,chainId:97};},i=>{i.state.block=NaN;},i=>{i.state.timestamp=0;},i=>{i.networkProfile={...networkProfile,explorer:'javascript:alert(1)'};}]){
  const input=fixture();mutate(input);assert.equal(memberAccountView(input).verified,false);
 }
 assert.equal(memberAccountView({address,networkProfile,now}).status,'loading');
 assert.equal(memberAccountView({address,networkProfile,now,state:{}}).status,'unavailable');
});

test('a failed refresh immediately marks retained same-account data stale even with a recent block',()=>{
 const input=fixture();input.readError=true;
 const value=memberAccountView(input);
 assert.equal(value.status,'stale');assert.equal(value.readError,true);assert.equal(value.verified,false);
 assert.equal(value.claimable,'3000000000000000000');assert.equal(value.hourlyCap,null);
 assert.equal(memberAccountView({address,networkProfile,now,readError:true}).status,'unavailable');
 assert.equal(memberAccountView({address,networkProfile,now,readError:true,state:{wallet:{address}}}).status,'unavailable');
 const otherAccount=fixture();otherAccount.address=other;otherAccount.readError=true;
 assert.equal(memberAccountView(otherAccount).status,'unavailable');assert.equal(memberAccountView(otherAccount).claimable,null);
});
