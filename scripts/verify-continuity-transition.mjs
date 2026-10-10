// Compare complete, fixed-block exports around a frozen proxy upgrade.
// This is a verification gate, never an importer or authority to move funds.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {keccak256,toUtf8Bytes,isAddress} from 'ethers';
import {validateGenealogy} from './migration-inventory.mjs';

function canonical(value) {
 if(typeof value==='bigint')return value.toString();
 if(typeof value==='string'&&isAddress(value))return value.toLowerCase();
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
 return value;
}
function requireExport(r) {
 if(r?.schema!=='FTI_COMPLETE_EXPORT_V1'||r.approximate)throw Error('Complete fixed-block export required');
 if(!['97','31337'].includes(String(r.chainId)))throw Error('Testnet/local verification only');
 if(!Number.isSafeInteger(r.block?.number)||!/^0x[0-9a-f]{64}$/i.test(r.block?.hash||''))throw Error('Invalid snapshot block');
 for(const key of ['binary','token','usd'])if(!isAddress(r.contracts?.[key]))throw Error('Invalid contract identity');
 for(const key of ['binary','token']){
  if(r.global?.[key]?.recoveryFrozen!==true)throw Error('Both components must be frozen for the comparison');
  if(!isAddress(r.implementations?.[key]?.address)||!/^0x[0-9a-f]{64}$/i.test(r.implementations?.[key]?.codeHash||''))throw Error('Implementation identity required');
 }
 if(String(r.global.binary.phase)!=='0'||String(r.global.binary.monthPhase)!=='0'||String(r.global.binary.jobCursor)!==String(r.global.binary.jobCount))throw Error('Finish hourly/monthly settlement and volume work first');
 if(!Array.isArray(r.users)||!r.queues||!r.accounting||!r.development||!r.codeHashes||!r.authorities||!r.collateral)throw Error('Incomplete inventory');
 const required=(obj,keys,label)=>{for(const k of keys)if(obj?.[k]===undefined||obj[k]===null)throw Error('Missing '+label+'.'+k);};
 required(r.global.binary,['epoch','epochEnd','lastClosedAt','epochUnits','unitsSinceSettlement','fundingSerial','pointPool','queuedPointCredit','assignedPointCredit','retainedPointReserve','queuedBuilderCredit','assignedBuilderCredit','retainedBuilderReserve','builderAccounted','totalPending','totalAuto','phase','monthPhase','nextBuilderMonth','protectionLevel','frozenLevel','cursor','frozenMembers','totalPaidPoints','allocated','pointValue','dirtyCount','jobCursor','jobCount','candidatePoints','candidateFunding','calculatedPointValue','pointValueIsTarget','recoveryCheckpointSerial','recoverySnapshotRoot'],'binary');
 required(r.global.token,['reserve','supportReserve','launchPrice','ath','pendingSupportTarget','cycle','cycleStartPrice','sellWindowStart','sellWindowOpeningReserve','sellWindowOutflow','emergencyUnwind','emergencyRemainingPool','emergencyRemainingSupply','totalSupply','price'],'token');
 required(r.authorities.binary,['governance','guardian','development'],'binary authorities');
 required(r.authorities.token,['governance','guardianCouncil','development','deployer'],'token authorities');
 required(r.collateral,['binaryBalance','tokenBalance','binaryToTokenAllowance'],'collateral');
 required(r.development,['wallet','pending','walletUSD'],'development');
 for(const u of r.users){
  required(u,['index','wallet','member','depth','activatedAtSerial','creditL','creditR','pendingReward','pendingAuto','walletUSD','rankReachedAt','builderClaimed','token'],'member');
  required(u.member,['parent','left','right','units','carryL','carryR','lifetimeL','lifetimeR','rank','exists','autoEnabled','maxAutoPrice'],'genealogy');
  required(u.token,['balanceOf','purchaseCycle','cyclePurchases','lifetimeManualBuys'],'member token');
 }
 for(const k of ['rewards','auto','dirty','jobs'])if(!Array.isArray(r.queues[k]))throw Error('Missing queue '+k);
 for(const key of ['binary','token','usd'])if(!/^0x[0-9a-f]{64}$/i.test(r.codeHashes[key]||''))throw Error('Missing code hash '+key);
 for(const key of ['holders','allowances','logs','epochs','months','cashQueue','autoQueue'])if(!Array.isArray(r.ledger?.[key]))throw Error('Missing ledger section: '+key);
 for(const h of r.ledger.holders)required(h,['wallet','balance','purchaseCycle','cyclePurchases','lifetimeManualBuys'],'holder');
 for(const a of r.ledger.allowances)required(a,['owner','spender','amount'],'allowance');
 if(!r.ledger.monthlyGlobal)throw Error('Missing monthly books');
 const wallets=r.users.map(u=>u.wallet?.toLowerCase());
 if(wallets.some(w=>!isAddress(w))||new Set(wallets).size!==wallets.length)throw Error('Duplicate or invalid member');
 validateGenealogy(r.users);
 const holders=r.ledger.holders.map(u=>u.wallet?.toLowerCase());
 if(holders.some(w=>!isAddress(w))||new Set(holders).size!==holders.length)throw Error('Duplicate or invalid holder');
 if(r.ledger.holders.reduce((s,h)=>s+BigInt(h.balance),0n)!==BigInt(r.global.token.totalSupply))throw Error('Holder supply mismatch');
 for(const key of ['binary','token']){
  const book=r.accounting[key];
  if(!Array.isArray(book)||book.length<2||BigInt(book[0])!==BigInt(book[1]))throw Error('Collateral accounting mismatch: '+key);
  if(BigInt(book[0])!==BigInt(r.collateral[key+'Balance']))throw Error('Collateral balance mismatch: '+key);
 }
 const f=r.accounting.funding;
 if(!Array.isArray(f)||f.length<4||BigInt(f[0])!==BigInt(f[1])||BigInt(f[2])!==BigInt(f[3]))throw Error('Funding accounting mismatch');
 const b=r.global.binary,sum=(rows,fn)=>rows.reduce((s,v)=>s+BigInt(fn(v)),0n);
 if(BigInt(b.pointPool)+BigInt(b.builderAccounted)+BigInt(b.totalPending)+BigInt(b.totalAuto)!==BigInt(r.collateral.binaryBalance))throw Error('Binary liabilities mismatch');
 if(sum(r.ledger.cashQueue,x=>x.amount)!==BigInt(b.totalPending)||sum(r.users,x=>x.pendingAuto)!==BigInt(b.totalAuto))throw Error('Reward ownership mismatch');
 if(sum(r.users,x=>BigInt(x.creditL)+BigInt(x.creditR))!==BigInt(b.assignedPointCredit))throw Error('Point credit ownership mismatch');
 const assignedBuilder=r.ledger.months.reduce((s,m)=>s+m.credits.reduce((v,c)=>v+c.amounts.reduce((n,a)=>n+BigInt(a),0n),0n),0n);
 if(assignedBuilder!==BigInt(b.assignedBuilderCredit))throw Error('Builder credit ownership mismatch');
}
function conserved(r) {
 const ledger={...r.ledger};
 // Crossing a calendar boundary may add an entirely empty month, not state.
 ledger.months=ledger.months.filter(m=>m.members.length||m.funding.some(v=>BigInt(v)!==0n)||m.credits.some(c=>c.amounts.some(v=>BigInt(v)!==0n)));
 return canonical({chainId:String(r.chainId),contracts:r.contracts,codeHashes:r.codeHashes,users:r.users,global:r.global,queues:r.queues,authorities:r.authorities,collateral:r.collateral,development:r.development,accounting:r.accounting,ledger});
}
function firstDifference(a,b,path='state') {
 if(typeof a!==typeof b)return path;
 if(a===b)return null;
 if(!a||!b||typeof a!=='object')return path;
 const keys=[...new Set([...Object.keys(a),...Object.keys(b)])].sort();
 for(const k of keys){if(!(k in a)||!(k in b))return path+'.'+k;const difference=firstDifference(a[k],b[k],path+'.'+k);if(difference)return difference;}
 return null;
}
export function verifyTransition(before,after) {
 requireExport(before);requireExport(after);
 if(before.block.number>=after.block.number)throw Error('After snapshot must follow before snapshot');
 for(const key of ['binary','token','usd'])if(before.contracts[key].toLowerCase()!==after.contracts[key].toLowerCase())throw Error('New-address migration needs a separate funded importer; proxy gate refuses it');
 const a=conserved(before),b=conserved(after),difference=firstDifference(a,b);
 if(difference)throw Error('Continuity mismatch: '+difference);
 for(const key of ['binary','token'])if(before.implementations[key].address.toLowerCase()===after.implementations[key].address.toLowerCase())throw Error('Implementation did not change: '+key);
 return {result:'FROZEN_PROXY_CONTINUITY_PASS',chainId:String(before.chainId),beforeBlock:before.block.number,afterBlock:after.block.number,members:before.users.length,holders:before.ledger.holders.length,stateHash:keccak256(toUtf8Bytes(JSON.stringify(a))),implementations:{before:before.implementations,after:after.implementations},newAddressMigration:false,limits:'Export comparison only; reopening and post-upgrade payout/trade tests are separate.'};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.length!==4)throw Error('Usage: node scripts/verify-continuity-transition.mjs before.json after.json');
 console.log(JSON.stringify(verifyTransition(JSON.parse(fs.readFileSync(process.argv[2])),JSON.parse(fs.readFileSync(process.argv[3]))),null,2));
}
