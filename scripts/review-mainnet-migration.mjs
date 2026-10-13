#!/usr/bin/env node
// Offline review of a pinned source export, never an authorization or import.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {isAddress,ZeroAddress} from 'ethers';
import {validateGenealogy} from './migration-inventory.mjs';
const check=(ok,message)=>{if(!ok)throw Error(message);};
const uint=x=>{check(typeof x==='bigint'||typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x),'Integer base-unit amounts required');const n=BigInt(x);check(n>=0n&&n<2n**256n,'Invalid amount');return n;};
const sum=(xs,key)=>xs.reduce((a,x)=>a+uint(x[key]),0n);
export function reviewMainnetMigration(raw,expectedHash){
 const hash=createHash('sha256').update(raw).digest('hex');
 check(/^[a-f0-9]{64}$/.test(expectedHash||'')&&hash===expectedHash,'Reviewed snapshot SHA-256 mismatch');
 const s=JSON.parse(raw);check(s.schema==='FTI_COMPLETE_EXPORT_V1'&&String(s.chainId)==='97','Complete testnet-97 export required');
 check(Number.isSafeInteger(s.block?.number)&&s.block.number>0&&/^0x[0-9a-f]{64}$/i.test(s.block.hash||''),'Fixed source block required');
 for(const key of ['binary','token','usd'])check(isAddress(s.contracts?.[key])&&s.contracts[key]!==ZeroAddress,'Source addresses required');
 check(Array.isArray(s.users)&&s.users.length>=31&&s.users.every(u=>isAddress(u.wallet)&&u.wallet!==ZeroAddress),'Complete user list required');
 check(s.users.every((u,i)=>u.index===i),'Member ordering mismatch');validateGenealogy(s.users);
 const roots=s.users.filter(u=>u.member.parent.toLowerCase()===ZeroAddress);check(roots.length===1,'Exactly one source root required');
 const b=s.global.binary,t=s.global.token;
 check(uint(b.phase)===0n&&uint(b.monthPhase)===0n&&uint(b.jobCursor)===uint(b.jobCount),'Source settlement/volume incomplete');
 const amounts={};
 for(const key of ['binary','token']){
  const book=s.accounting?.[key];check(Array.isArray(book)&&book.length===2&&uint(book[0])===uint(book[1]),'Source accounting mismatch: '+key);
  check(uint(s.collateral[key+'Balance'])===uint(book[0]),'Collateral/book mismatch: '+key);amounts[key]=uint(book[1]);
 }
 const f=s.accounting?.funding;check(Array.isArray(f)&&f.length===4&&uint(f[0])===uint(f[1])&&uint(f[2])===uint(f[3]),'Funding ledger mismatch');
 const ledger=s.ledger;check(Array.isArray(ledger?.holders)&&Array.isArray(ledger.cashQueue)&&Array.isArray(ledger.autoQueue)&&Array.isArray(ledger.months),'Complete holder/reward/month ledgers required');
 const holders=new Set();for(const h of ledger.holders){check(isAddress(h.wallet)&&h.wallet!==ZeroAddress&&!holders.has(h.wallet.toLowerCase()),'Invalid/duplicate token holder');holders.add(h.wallet.toLowerCase());}
 check(sum(ledger.holders,'balance')===uint(t.totalSupply),'Token supply mismatch');
 const cashSet=new Set();for(const entry of ledger.cashQueue){check(isAddress(entry.wallet)&&!cashSet.has(entry.wallet.toLowerCase()),'Invalid/duplicate reward beneficiary');cashSet.add(entry.wallet.toLowerCase());}
 check(sum(ledger.cashQueue,'amount')===uint(b.totalPending),'Cash ownership mismatch');
 check(sum(s.users,'pendingAuto')===uint(b.totalAuto),'Auto-buy ownership mismatch');
 check(s.users.reduce((n,u)=>n+uint(u.creditL)+uint(u.creditR),0n)===uint(b.assignedPointCredit),'Point credit mismatch');
 check(ledger.months.reduce((n,m)=>n+m.credits.reduce((a,c)=>a+c.amounts.reduce((x,v)=>x+uint(v),0n),0n),0n)===uint(b.assignedBuilderCredit),'Builder credit mismatch');
 return {schema:'FTI_MAINNET_MIGRATION_REVIEW_V1',source:{chainId:97,snapshotSHA256:hash,block:s.block,contracts:s.contracts},destinationChainId:56,
  members:s.users.length,tokenHolders:ledger.holders.length,rootWallet:roots[0].wallet,
  preservationCandidate:{wallets:s.users.map(u=>u.wallet),genealogy:s.users.map(u=>({wallet:u.wallet,parent:u.member.parent,left:u.member.left,right:u.member.right,depth:String(u.depth)}))},
  financialInventory:{binaryCollateralWei:String(amounts.binary),tokenCollateralWei:String(amounts.token),
   totalReplacementCollateralWei:String(amounts.binary+amounts.token),pendingCashWei:String(uint(b.totalPending)),pendingAutoWei:String(uint(b.totalAuto)),
   tokenSupplyWei:String(uint(t.totalSupply)),externalWalletBalancesExcluded:true,allowancesMustBeReapproved:true},
  policy:'UNDECIDED',sourceVerifiedOnChain:false,readyToImport:false,submitted:false,
  decisionsRequired:['Preserve genealogy only with explicitly approved financial reset, OR preserve funded entitlements with real destination collateral.',
   'Review units, rank, carry, credits, supply, price history and monthly state together; genealogy alone does not determine these rights.'],
  remaining:['Verify source archive and fixed block against source chain; use a final frozen snapshot before any economic cutover.',
   'Approve a 97-to-56 policy and destination importer; existing same-chain migration cannot bridge state or test collateral.',
   'Prove real destination funding and all per-wallet/aggregate state before opening the destination.'],
  note:'This is an offline reconciliation report. No balances are erased, imported or converted; no wallet keys or approvals are copied.'};
}
export function main(args=process.argv.slice(2)){
 const {values:v,positionals}=parseArgs({args,strict:true,allowPositionals:true,options:{snapshot:{type:'string'},sha256:{type:'string'},out:{type:'string'},help:{type:'boolean'}}});
 if(v.help){console.log('OFFLINE READ ONLY: node scripts/review-mainnet-migration.mjs --snapshot COMPLETE_EXPORT.json --sha256 REVIEWED_SHA256 --out NEW_REVIEW.json');return;}
 check(!positionals.length&&v.snapshot&&v.sha256&&v.out,'Snapshot, reviewed hash and new output required');
 const report=reviewMainnetMigration(fs.readFileSync(v.snapshot),v.sha256);
 const fd=fs.openSync(v.out,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(report,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 console.log(JSON.stringify({result:'MAINNET_MIGRATION_REVIEW_PREPARED',members:report.members,policy:'UNDECIDED',readyToImport:false,submitted:false,out:v.out}));
}
if(process.argv[1]===fileURLToPath(import.meta.url))try{main();}catch(e){console.error('FTI_MIGRATION_REVIEW_FAILED: '+e.message);process.exitCode=1;}
