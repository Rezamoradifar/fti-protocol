import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
function typeShape(layout,key,trail=new Set()){
 const t=layout.types[key];if(!t)throw Error('Missing storage type');
 if(trail.has(key))return {recursive:t.label};
 const next=new Set(trail).add(key),shape={label:t.label,encoding:t.encoding,bytes:t.numberOfBytes};
 for(const k of ['key','value','base'])if(t[k])shape[k]=typeShape(layout,t[k],next);
 if(t.members)shape.members=t.members.map(m=>({label:m.label,slot:m.slot,offset:m.offset,type:typeShape(layout,m.type,next)}));
 return shape;
}
export function assertStorageCompatible(previous,next){
 if(!Array.isArray(previous.storage)||!Array.isArray(next.storage))throw Error('Storage layout required');
 if(next.storage.length<previous.storage.length)throw Error('Storage fields removed');
 for(let i=0;i<previous.storage.length;i++){
  const shape=(l,s)=>({label:s.label,slot:s.slot,offset:s.offset,type:typeShape(l,s.type)});
  if(JSON.stringify(shape(previous,previous.storage[i]))!==JSON.stringify(shape(next,next.storage[i])))throw Error('Incompatible storage field: '+previous.storage[i].label);
 }
 return true;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.length!==4)throw Error('Usage: node scripts/check-upgrade-layout.mjs old-layout.json new-layout.json');
 assertStorageCompatible(JSON.parse(fs.readFileSync(process.argv[2])),JSON.parse(fs.readFileSync(process.argv[3])));console.log('STORAGE_LAYOUT_PASS');
}
