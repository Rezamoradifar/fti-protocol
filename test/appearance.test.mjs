import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppearanceStore} from '../frontend/appearance.js';

function fixture(initial){
 const values=new Map(initial?[['fti-appearance',initial]]:[]),root={dataset:{}},target=new EventTarget();
 const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 return {values,root,target,store:createAppearanceStore({root,target,storage})};
}
test('every subscriber sees one glass preference and both settings persist',()=>{
 const {store,root,values}=fixture('solid'),seenA=[],seenB=[];
 const a=store.subscribe(()=>seenA.push(store.get())),b=store.subscribe(()=>seenB.push(store.get()));
 store.initialize();assert.equal(root.dataset.appearance,'solid');
 store.set('glass');store.set('solid');
 assert.deepEqual(seenA,['glass','solid']);assert.deepEqual(seenB,seenA);assert.equal(values.get('fti-appearance'),'solid');
 a();store.set('glass');assert.deepEqual(seenA,['glass','solid']);assert.deepEqual(seenB,['glass','solid','glass']);b();
 assert.throws(()=>store.set('anything'),/Invalid appearance/);
});
test('another browser tab synchronizes controls and actual root appearance',()=>{
 const {values,root,target,store}=fixture();let updates=0;const stop=store.subscribe(()=>updates++);
 values.set('fti-appearance','solid');const event=new Event('storage');event.key='fti-appearance';target.dispatchEvent(event);
 assert.equal(store.get(),'solid');assert.equal(root.dataset.appearance,'solid');assert.equal(updates,1);
 values.delete('fti-appearance');const cleared=new Event('storage');cleared.key=null;target.dispatchEvent(cleared);
 assert.equal(store.get(),'glass');assert.equal(root.dataset.appearance,'glass');stop();
});
test('appearance works when browser storage is unavailable',()=>{
 const root={dataset:{}},store=createAppearanceStore({root,storage:{getItem(){throw Error();},setItem(){throw Error();}}});
 store.initialize();assert.equal(root.dataset.appearance,'glass');store.set('solid');assert.equal(root.dataset.appearance,'solid');
});
