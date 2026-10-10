// Read-only gates for an actual NEW-ADDRESS migration, not a proxy-only upgrade.
import {Contract,keccak256,toBeHex,MaxUint256} from 'ethers';
import {IMPLEMENTATION_SLOT,bindingField} from './address-migration-manifest.mjs';
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const canon=x=>typeof x==='bigint'?String(x):typeof x==='string'&&/^0x[\da-f]+$/i.test(x)?x.toLowerCase():Array.isArray(x)?x.map(canon):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
const equal=(a,b,label)=>{if(JSON.stringify(canon(a))!==JSON.stringify(canon(b)))throw Error('Migration mismatch: '+label);};
const abi=['function phase() view returns(uint256)','function sources(uint256) view returns(address)','function targets(uint256) view returns(address)',
 'function originalLogic(uint256) view returns(address)','function sourceAdapters(uint256) view returns(address)',
 'function reviewedManifest() view returns(bytes32)','function collateral() view returns(address)','function governance() view returns(address)'];
function checkManifest(m) {
 if(m?.schema!=='FTI_ADDRESS_MIGRATION_MANIFEST_V1'||!['97','31337'].includes(String(m.chainId)))throw Error('Wrong manifest/network');
 const {digest,...body}=m;
 if(digest!==keccak256(Buffer.from(JSON.stringify(body,(_,v)=>typeof v==='bigint'?String(v):v))))throw Error('Manifest digest mismatch');
 if(m.components?.length!==2)throw Error('Incomplete component pair');
}
export async function verifyStagedMigration({provider,manifest}) {
 checkManifest(manifest);
 const c=new Contract(manifest.coordinator,abi,provider);
 if((await provider.getNetwork()).chainId!==BigInt(manifest.chainId)||await c.phase()!==1n||await c.reviewedManifest()!==manifest.digest)throw Error('Wrong migration state');
 for(const [kind,part]of manifest.components.entries()){
  if(!same(await c.sources(kind),part.source)||!same(await c.targets(kind),part.target))throw Error('Wrong endpoint');
  const target=new Contract(part.target,['function ready() view returns(bool)'],provider);
  if(!await target.ready())throw Error('Incomplete pages or holder indexing');
  for(const page of part.storage.pages)for(let j=0;j<page.keys.length;j++){
   const raw=await provider.getStorage(part.target,page.keys[j]);equal(BigInt(raw==='0x'?0:raw),BigInt(page.values[j]),'staged '+kind+' '+page.keys[j]);
  }
 }
 const token=new Contract(manifest.components[1].target,['function allowance(address,address) view returns(uint256)'],provider);
 for(const a of manifest.sourceInventory.ledger.allowances)if(await token.allowance(a.owner,a.spender)!==0n)throw Error('Old allowance recreated as new consent');
 return {result:'STAGED_NEW_ADDRESS_STATE_PASS',manifest:manifest.digest,newAddressMigration:true,fundsMoved:false};
}
export async function verifyAddressMigration({provider,manifest,after,layouts}) {
 checkManifest(manifest);
 const c=new Contract(manifest.coordinator,abi,provider),before=manifest.sourceInventory;
 if((await provider.getNetwork()).chainId!==BigInt(manifest.chainId)||await c.phase()!==2n||await c.reviewedManifest()!==manifest.digest)throw Error('Not committed');
 if(after.schema!=='FTI_COMPLETE_EXPORT_V1'||after.approximate||after.block.number<=before.block.number)throw Error('Complete later export required');
 equal(after.chainId,before.chainId,'chain');equal(after.contracts.usd,before.contracts.usd,'collateral');
 for(const [kind,key]of ['binary','token'].entries()) {
  const p=manifest.components[kind],source=new Contract(p.source,['function migrationPhase() view returns(uint256)','function migrationCoordinator() view returns(address)'],provider);
  equal(await c.sources(kind),p.source,'source');equal(await c.targets(kind),after.contracts[key],'destination');
  if(same(p.source,after.contracts[key]))throw Error('New address required');
  if(await source.migrationPhase()!==2n||!same(await source.migrationCoordinator(),c.target))throw Error('Source is not terminally retired');
  const srcSlot=await provider.getStorage(p.source,IMPLEMENTATION_SLOT),dstSlot=await provider.getStorage(p.target,IMPLEMENTATION_SLOT);
  if(!same('0x'+srcSlot.slice(-40),await c.sourceAdapters(kind))||!same('0x'+dstSlot.slice(-40),await c.originalLogic(kind)))throw Error('Wrong source/target implementation');
  if(keccak256(await provider.getCode(await c.originalLogic(kind)))!==p.codeHash)throw Error('Logic hash changed');
  if(after.global[key].recoveryFrozen!==true)throw Error('Verify before reopening');
  const field=bindingField(layouts[kind],kind),shift=BigInt(field.offset)*8n,mask=((1n<<160n)-1n)<<shift;
  for(const page of p.storage.pages)for(let j=0;j<page.keys.length;j++){
   let expected=BigInt(page.values[j]);
   if(BigInt(page.keys[j])===BigInt(field.slot))expected=(expected&~mask)|(BigInt(manifest.components[1-kind].target)<<shift);
   const raw=await provider.getStorage(p.target,page.keys[j],after.block.number);
   equal(BigInt(raw==='0x'?0:raw),expected,'slot '+key+' '+page.keys[j]);
  }
 }
 const userProjection=rows=>rows.map(({walletUSD,...u})=>u);
 equal(userProjection(before.users),userProjection(after.users),'every user, topology, ranks, credits and claims');
 equal(before.global,after.global,'global accounting state');equal(before.queues,after.queues,'queue ordering');
 equal(before.authorities,after.authorities,'authorities');
 equal({wallet:before.development.wallet,pending:before.development.pending},{wallet:after.development.wallet,pending:after.development.pending},'development rights');
 for(const key of ['holders','epochs','monthlyGlobal','cashQueue','autoQueue'])equal(before.ledger[key],after.ledger[key],'ledger '+key);
 const nonempty=months=>months.filter(m=>m.members.length||m.funding.some(n=>BigInt(n)!==0n)||m.credits.some(c=>c.amounts.some(n=>BigInt(n)!==0n)));
 equal(nonempty(before.ledger.months),nonempty(after.ledger.months),'builder history');
 equal(before.accounting.funding,after.accounting.funding,'funding books');
 const usd=new Contract(after.contracts.usd,['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'],provider);
 const token=new Contract(after.contracts.token,['function allowance(address,address) view returns(uint256)'],provider);
 for(const a of before.ledger.allowances)if(await token.allowance(a.owner,a.spender,{blockTag:after.block.number})!==0n)throw Error('New token allowance requires new consent');
 for(let i=0;i<2;i++) {
  const key=i===0?'binary':'token';
  equal(before.accounting[key][1],after.accounting[key][1],'liability '+key);
  if(await usd.balanceOf(manifest.components[i].source,{blockTag:after.block.number})!==0n)throw Error('Collateral left at source');
  if(BigInt(after.accounting[key][0])<BigInt(before.accounting[key][0]))throw Error('Collateral lost at '+key);
 }
 if(await usd.allowance(before.contracts.binary,before.contracts.token,{blockTag:after.block.number})!==0n)throw Error('Source collateral approval not revoked');
 if(await usd.allowance(after.contracts.binary,after.contracts.token,{blockTag:after.block.number})!==MaxUint256)throw Error('Destination internal collateral binding not approved');
 // Historical transaction hashes stay in the source archive. New indexed
 // Transfer events are actual replacement-ledger entries, not historical trades.
 return {result:'FUNDED_NEW_ADDRESS_MIGRATION_PASS',newAddressMigration:true,manifest:manifest.digest,
  members:after.users.length,holders:after.ledger.holders.length,sourceRetired:true,recoveryFrozen:true,
  oldTokenAllowancesReset:true,oldHistoryArchived:true,externalWalletUSDNotFrozen:true};
}
