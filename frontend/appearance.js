// One preference drives every appearance control and synchronizes browser tabs.
export function createAppearanceStore({root,storage,target}={}){
 let value='glass';const listeners=new Set();
 try{if(storage?.getItem('fti-appearance')==='solid')value='solid';}catch{}
 const apply=()=>{if(root)root.dataset.appearance=value;};
 const notify=()=>{apply();for(const listener of listeners)listener();};
 const stored=event=>{if(event.key!=='fti-appearance'&&event.key!==null)return;let next='glass';try{if(storage?.getItem('fti-appearance')==='solid')next='solid';}catch{}if(next!==value){value=next;notify();}};
 return {
  get:()=>value,
  initialize:apply,
  set(next){if(!['glass','solid'].includes(next))throw Error('Invalid appearance.');value=next;try{storage?.setItem('fti-appearance',value);}catch{}notify();},
  subscribe(listener){if(!listeners.size)target?.addEventListener('storage',stored);listeners.add(listener);return()=>{listeners.delete(listener);if(!listeners.size)target?.removeEventListener('storage',stored);};},
 };
}
let storage;try{storage=globalThis.localStorage;}catch{}
export const appearance=createAppearanceStore({root:globalThis.document?.documentElement,storage,target:globalThis.window});
