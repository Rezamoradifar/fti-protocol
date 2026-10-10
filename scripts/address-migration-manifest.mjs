// Exact source storage -> bounded, proof-authenticated destination pages.
// No signer, importer transaction or live state mutation in this module.
import fs from 'node:fs';
import {AbiCoder,keccak256,id,toBeHex,getAddress,ZeroAddress,Contract} from 'ethers';
const abi=AbiCoder.defaultAbiCoder();
export const PAGE=64;
export const IMPLEMENTATION_SLOT=toBeHex(BigInt(id('eip1967.proxy.implementation'))-1n,32);
export const INITIALIZABLE_SLOT=toBeHex(BigInt(keccak256(abi.encode(['uint256'],[BigInt(id('openzeppelin.storage.Initializable'))-1n]))) & ~255n,32);
const UINT=(1n<<256n)-1n;
const word=n=>toBeHex(BigInt(n)&UINT,32);
const doubleHash=encoded=>keccak256(keccak256(encoded));
export function migrationDomain({chainId,coordinator,source,target,kind,codeHash,layoutHash}) {
 return keccak256(abi.encode(['bytes32','uint256','address','address','address','uint8','bytes32','bytes32'],
  [id('FTI_ADDRESS_MIGRATION_V1'),chainId,coordinator,source,target,kind,codeHash,layoutHash]));
}
export function pageLeaf(domain,kind,index,keys,values) {
 return doubleHash(abi.encode(['bytes32','uint8','uint256',kind===0?'bytes32[]':'address[]',kind===0?'bytes32[]':'uint256[]'],[domain,kind,index,keys,values]));
}
const hashPair=(a,b)=>keccak256('0x'+[a,b].sort().map(x=>x.slice(2)).join(''));
export function merklePages(leaves) {
 if(!leaves.length)throw Error('Empty manifest');
 const layers=[leaves];
 while(layers.at(-1).length>1) {
  const old=layers.at(-1),next=[];
  for(let i=0;i<old.length;i+=2)next.push(hashPair(old[i],old[i+1]??old[i]));
  layers.push(next);
 }
 return {root:layers.at(-1)[0],proofs:leaves.map((_,position)=>{
  const proof=[];for(let l=0;l<layers.length-1;l++){
   const rows=layers[l];proof.push(rows[position^1]??rows[position]);position=Math.floor(position/2);
  }return proof;
 })};
}
// Canonical layout identity ignores compiler AST numbering but includes every
// field, packing offset, mapping key/value and nested array/struct definition.
export function canonicalLayout(layout) {
 const type=t=>{
  const x=layout.types[t];if(!x)throw Error('Missing layout type '+t);
  const out={encoding:x.encoding,label:x.label,bytes:x.numberOfBytes};
  for(const k of ['key','value','base'])if(x[k])out[k]=type(x[k]);
  if(x.members)out.members=x.members.map(m=>({label:m.label,slot:m.slot,offset:m.offset,type:type(m.type)}));
  return out;
 };
 return layout.storage.map(s=>({label:s.label,slot:s.slot,offset:s.offset,type:type(s.type)}));
}
export function layoutDigest(layout) {return keccak256(Buffer.from(JSON.stringify(canonicalLayout(layout))));}
export function checkedLayout(name,compiled,reviewed) {
 if(layoutDigest(compiled)!==layoutDigest(reviewed))throw Error('Unreviewed storage layout: '+name);
 return compiled;
}
export function bindingField(layout,kind) {
 const field=layout.storage.find(s=>s.label===(kind===0?'token':'binary'));
 if(!field||Number(layout.types[field.type].numberOfBytes)!==20)throw Error('Missing/malformed binding slot');
 return {slot:field.slot,offset:field.offset};
}
function keysFor(label,path,inventory,kind) {
 const users=inventory.users.map(u=>u.wallet),
  wallets=[...new Set([...users,inventory.development.wallet,...inventory.queues.rewards,...inventory.queues.auto,...inventory.ledger.holders.map(h=>h.wallet)].map(w=>w.toLowerCase()))];
 if(kind===1){
  if(label==='_allowances')throw Error('ERC20 allowances MUST NOT be copied to a new token');
  if(['_balances','purchaseCycle','cyclePurchases','lifetimeManualBuys'].includes(label))return wallets;
  throw Error('Unknown token mapping: '+label);
 }
 const byWallet=new Set(['members','rankReachedAt','depth','activatedAtSerial','creditL','creditR','dirty','pendingReward','pendingAuto','rewardIndex','builderClaimed','autoIndex']);
 if(byWallet.has(label))return wallets;
 if(label==='dirtyMembers') {
  const n=Math.max(inventory.users.length,Number(inventory.global.binary.dirtyCount),Number(inventory.global.binary.frozenMembers));
  if(!Number.isSafeInteger(n)||n>1000000)throw Error('Dirty map inventory too large');
  return Array.from({length:n},(_,i)=>i);
 }
 if(['paidPoints','autoSnapshot','settled'].includes(label))return path.length?users:inventory.ledger.epochs.map(e=>e.epoch);
 if(['monthFunding','builderAccounts','builderCredit','builderSeen'].includes(label))return path.length?users:inventory.ledger.months.map(m=>m.month);
 throw Error('Unknown binary mapping: '+label);
}
function validateInventory(r) {
 if(r?.schema!=='FTI_COMPLETE_EXPORT_V1'||r.approximate)throw Error('Complete fixed-block inventory required');
 if(![97,31337].includes(Number(r.chainId)))throw Error('Testnet/local only');
 if(!r.global?.binary?.recoveryFrozen||!r.global?.token?.recoveryFrozen)throw Error('Freeze both sources first');
 const b=r.global.binary;
 if(BigInt(b.phase)!==0n||BigInt(b.monthPhase)!==0n||BigInt(b.jobCursor)!==BigInt(b.jobCount))throw Error('Finish all settlement/volume first');
 for(const key of ['holders','allowances','epochs','months','logs'])if(!Array.isArray(r.ledger?.[key]))throw Error('Missing ledger '+key);
 if(new Set(r.ledger.holders.map(h=>h.wallet.toLowerCase())).size!==r.ledger.holders.length)throw Error('Duplicate holder');
 if(r.ledger.holders.reduce((n,h)=>n+BigInt(h.balance),0n)!==BigInt(r.global.token.totalSupply))throw Error('Holder supply mismatch');
 const sums=r.users.reduce((s,u)=>[s[0]+BigInt(u.creditL)+BigInt(u.creditR),s[1]+BigInt(u.pendingAuto)],[0n,0n]);
 if(sums[0]!==BigInt(b.assignedPointCredit)||sums[1]!==BigInt(b.totalAuto))throw Error('Ownership reconciliation failed');
 const cash=r.ledger.cashQueue.reduce((s,u)=>s+BigInt(u.amount),0n);
 if(cash!==BigInt(b.totalPending))throw Error('Cash ownership mismatch');
 for(const component of ['binary','token']){
  const [actual,book]=r.accounting[component].map(BigInt);
  if(actual<book)throw Error('Unfunded '+component);
 }
 const sourceAddresses=[r.contracts.binary,r.contracts.token].map(a=>a.toLowerCase());
 if(r.ledger.holders.some(h=>sourceAddresses.includes(h.wallet.toLowerCase())&&BigInt(h.balance)!==0n))throw Error('Protocol source holds FTI; explicit custody handling required');
}

export async function exportStorageRecords({provider,address,blockTag,layout,inventory,kind,maxSlots=2000000}) {
 validateInventory(inventory);
 if(blockTag!==inventory.block.number)throw Error('Snapshot block mismatch');
 const cache=new Map();
 const get=async slot=>{
  const k=word(slot);
  if(!cache.has(k)){
   if(cache.size>=maxSlots)throw Error('Slot export budget exceeded; do not truncate');
   const raw=await provider.getStorage(address,k,blockTag);
   cache.set(k,word(raw==='0x'?0n:BigInt(raw)));
  }return cache.get(k);
 };
 const walkArray=async (type,base,length,label,path)=>{
  if(!Number.isSafeInteger(length)||length<0||length>maxSlots)throw Error('Invalid array length: '+label);
  const t=layout.types[type],size=Number(t.numberOfBytes);
  const pack=t.encoding==='inplace'&&!t.members&&!t.base&&size<=32;
  if(pack){const per=Math.floor(32/size);for(let i=0;i<Math.ceil(length/per);i++)await get(base+BigInt(i));}
  else for(let i=0;i<length;i++)await walk(type,base+BigInt(i)*BigInt(Math.ceil(size/32)),label,[...path,i]);
 };
 const walk=async (type,slot,label,path=[])=>{
  const t=layout.types[type];if(!t)throw Error('Unknown type '+type);
  if(t.encoding==='mapping'){
   const keyType=layout.types[t.key].label;
   if(!['address','uint256'].includes(keyType))throw Error('Unsupported mapping key '+keyType);
   for(const k of keysFor(label,path,inventory,kind)) {
    const child=BigInt(keccak256(abi.encode([keyType,'uint256'],[k,slot])));
    await walk(t.value,child,label,[...path,k]);
   }
  }else if(t.encoding==='dynamic_array'){
   const length=Number(BigInt(await get(slot)));
   await walkArray(t.base,BigInt(keccak256(word(slot))),length,label,path);
  }else if(t.encoding==='bytes'){
   const raw=BigInt(await get(slot));
   if(raw&1n){const length=(raw-1n)/2n;if(length>BigInt(maxSlots)*32n)throw Error('Byte array too large');
    const base=BigInt(keccak256(word(slot)));for(let i=0n;i<(length+31n)/32n;i++)await get(base+i);
   }else if((raw&255n)/2n>31n)throw Error('Malformed short bytes');
  }else if(t.encoding==='inplace'){
   if(t.members)for(const m of t.members)await walk(m.type,slot+BigInt(m.slot),label,path);
   else if(t.base){const match=t.label.match(/\[(\d+)\](?: storage)?$/);if(!match)throw Error('Unknown fixed array '+t.label);await walkArray(t.base,slot,Number(match[1]),label,path);}
   else await get(slot);
  }else throw Error('Unsupported storage encoding '+t.encoding);
 };
 for(const s of layout.storage){if(kind===1&&s.label==='_allowances')continue;await walk(s.type,BigInt(s.slot),s.label);}
 await get(BigInt(INITIALIZABLE_SLOT));
 if(BigInt(cache.get(INITIALIZABLE_SLOT))!==1n)throw Error('Unexpected initializer state');
 const current=await provider.getBlock(blockTag);
 if(current.hash.toLowerCase()!==inventory.block.hash.toLowerCase())throw Error('Snapshot reorg');
 const records=[...cache].filter(([,v])=>BigInt(v)!==0n).sort((a,b)=>BigInt(a[0])<BigInt(b[0])?-1:1).map(([key,value])=>({key,value}));
 for(const slot of [IMPLEMENTATION_SLOT,word(BigInt(id('eip1967.proxy.admin'))-1n),word(BigInt(id('eip1967.proxy.beacon'))-1n)])if(records.some(r=>r.key===slot))throw Error('Control slot in source manifest');
 return records;
}
export function buildPages(records,domain,kind=0) {
 const pages=[];
 for(let offset=0;offset<records.length;offset+=PAGE){
  const rows=records.slice(offset,offset+PAGE),keys=rows.map(r=>kind===0?r.key:r.wallet),values=rows.map(r=>kind===0?r.value:String(r.balance));
  pages.push({index:pages.length,keys,values,leaf:pageLeaf(domain,kind,pages.length,keys,values)});
 }
 const {root,proofs}=merklePages(pages.map(p=>p.leaf));
 return {root,count:records.length,pages:pages.map((p,i)=>({...p,proof:proofs[i]}))};
}
export async function buildAddressMigrationManifest({provider,coordinator,inventory,layouts}) {
 validateInventory(inventory);
 const c=new Contract(coordinator,[
  'function sources(uint256) view returns(address)','function targets(uint256) view returns(address)',
  'function originalLogic(uint256) view returns(address)','function sourceAdapters(uint256) view returns(address)',
  'function phase() view returns(uint256)'],provider);
 if(await c.phase()!==0n)throw Error('Manifest must precede configuration');
 const chainId=(await provider.getNetwork()).chainId;
 if(chainId!==BigInt(inventory.chainId))throw Error('Chain mismatch');
 const result={schema:'FTI_ADDRESS_MIGRATION_MANIFEST_V1',chainId:String(chainId),coordinator,
  snapshot:inventory.block,sourceInventory:inventory,components:[],allowancePolicy:'RESET_ALL_NEW_TOKEN_ALLOWANCES_AND_REQUIRE_NEW_USD_APPROVALS'};
 for(let kind=0;kind<2;kind++){
  const key=kind===0?'binary':'token',source=await c.sources(kind),target=await c.targets(kind),logic=await c.originalLogic(kind);
  if(source.toLowerCase()!==inventory.contracts[key].toLowerCase())throw Error('Source identity mismatch');
  const stored=await provider.getStorage(source,IMPLEMENTATION_SLOT,inventory.block.number);
  const adapter=await c.sourceAdapters(kind);
  if(stored.slice(-40).toLowerCase()!==adapter.slice(2).toLowerCase())throw Error('Install/arm source adapters before snapshot');
  const bridge=new Contract(source,['function migrationPhase() view returns(uint256)','function migrationCoordinator() view returns(address)'],provider);
  if(await bridge.migrationPhase({blockTag:inventory.block.number})!==1n || (await bridge.migrationCoordinator()).toLowerCase()!==coordinator.toLowerCase())throw Error('Source not quiescent');
  const layoutHash=layoutDigest(layouts[kind]),codeHash=keccak256(await provider.getCode(logic));
  const context={chainId,coordinator,source,target,kind,codeHash,layoutHash},domain=migrationDomain(context);
  const targetBridge=new Contract(target,['function domain() view returns(bytes32)'],provider);
  if(await targetBridge.domain()!==domain)throw Error('Target layout/code/domain mismatch');
  const records=await exportStorageRecords({provider,address:source,blockTag:inventory.block.number,layout:layouts[kind],inventory,kind});
  const component={...context,chainId:String(chainId),domain,storage:buildPages(records,domain)};
  if(kind===1){const holders=inventory.ledger.holders.slice().sort((a,b)=>a.wallet.toLowerCase().localeCompare(b.wallet.toLowerCase()));component.holders=buildPages(holders,domain,1);}
  result.components.push(component);
 }
 result.digest=keccak256(Buffer.from(JSON.stringify(result,(_,v)=>typeof v==='bigint'?String(v):v)));
 return result;
}
export function writePrivateJSON(file,value) {
 const text=JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n';
 fs.writeFileSync(file,text,{mode:0o600,flag:'wx'});
}
