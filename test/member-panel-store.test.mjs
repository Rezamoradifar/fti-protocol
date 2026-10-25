import test from 'node:test';
import assert from 'node:assert/strict';
import {expireMemberView,publishMemberView,readMemberView,subscribeMemberView} from '../frontend/member-panel-store.js';

const now=1_800_000_000_000;
const fixture=()=>({connected:true,address:'0x'+'a'.repeat(40),verified:true,stale:false,status:'verified',
 membershipStatus:'registered',hourlyCap:15,units:'25',claimable:'123456789012345678901',
 network:{chainId:56,label:'BNB Mainnet · 56'},snapshot:{block:123,timestamp:now/1000,updatedAt:now,ageSeconds:0}});

test('observed account is fresh through 120 seconds and expires immediately beyond the boundary',()=>{
 const view=fixture();
 assert.strictEqual(expireMemberView(view,now+120_000),view);
 const expired=expireMemberView(view,now+120_001);
 assert.equal(expired.verified,false);assert.equal(expired.stale,true);assert.equal(expired.status,'stale');
 assert.equal(expired.hourlyCap,null);assert.equal(expired.snapshot.ageSeconds,120);
});

test('block age and last-read age each independently expire a view',()=>{
 const oldBlock=fixture();oldBlock.snapshot.timestamp-=121;
 assert.equal(expireMemberView(oldBlock,now).status,'stale');
 const oldRead=fixture();oldRead.snapshot.updatedAt-=120_001;
 assert.equal(expireMemberView(oldRead,now).status,'stale');
 const future=fixture();future.snapshot.timestamp+=16;
 assert.equal(expireMemberView(future,now).status,'stale');
});

test('expiry is immutable and preserves account identity and exact retained quantities',()=>{
 const original=fixture();Object.freeze(original.snapshot);Object.freeze(original.network);Object.freeze(original);
 const result=expireMemberView(original,now+130_000);
 assert.notStrictEqual(result,original);assert.notStrictEqual(result.snapshot,original.snapshot);
 assert.equal(original.status,'verified');assert.equal(original.hourlyCap,15);assert.equal(original.snapshot.ageSeconds,0);
 assert.equal(result.address,original.address);assert.equal(result.units,'25');assert.equal(result.claimable,'123456789012345678901');
 assert.strictEqual(result.network,original.network);
 assert.strictEqual(expireMemberView(result,now+140_000),result);
});

test('disconnected, unavailable and unobserved values never acquire fabricated stale account data',()=>{
 for(const view of [{connected:false,verified:false,status:'disconnected'},
  {connected:true,verified:false,status:'unavailable'},
  {connected:true,verified:true,status:'verified',snapshot:{timestamp:null,updatedAt:null}}]){
  assert.strictEqual(expireMemberView(view,now+999_000),view);
 }
 assert.strictEqual(expireMemberView(null,now),null);
 const view=fixture();assert.strictEqual(expireMemberView(view,NaN),view);
});

test('subscribed store expires at its deadline without a network request or user interaction',t=>{
 let clock=now;const timers=[];
 t.mock.method(Date,'now',()=>clock);
 t.mock.method(globalThis,'setTimeout',(callback,delay)=>{const timer={callback,delay,cancelled:false,unref(){}};timers.push(timer);return timer;});
 t.mock.method(globalThis,'clearTimeout',timer=>{if(timer)timer.cancelled=true;});
 publishMemberView(fixture());let notifications=0;
 const unsubscribe=subscribeMemberView(()=>notifications++);t.after(unsubscribe);
 const timer=timers.at(-1);assert.equal(timer.delay,120_001);
 clock=now+120_001;timer.callback();
 assert.equal(readMemberView().status,'stale');assert.equal(readMemberView().hourlyCap,null);assert.equal(notifications,1);
});

test('visibility restoration expires a backgrounded view and unsubscribe removes the observer',t=>{
 let clock=now;const handlers=new Map();let removed=0;
 const original=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{
  addEventListener:(name,listener)=>handlers.set(name,listener),
  removeEventListener:(name,listener)=>{assert.strictEqual(handlers.get(name),listener);handlers.delete(name);removed++;}
 }});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;});
 t.mock.method(Date,'now',()=>clock);
 t.mock.method(globalThis,'setTimeout',()=>({unref(){}}));t.mock.method(globalThis,'clearTimeout',()=>{});
 publishMemberView(fixture());let notifications=0;
 const unsubscribe=subscribeMemberView(()=>notifications++);
 assert.equal(handlers.has('visibilitychange'),true);
 clock=now+300_000;handlers.get('visibilitychange')();
 assert.equal(readMemberView().status,'stale');assert.equal(readMemberView().address,fixture().address);assert.equal(notifications,1);
 unsubscribe();assert.equal(removed,1);assert.equal(handlers.size,0);
});
