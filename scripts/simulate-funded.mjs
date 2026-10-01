import fs from 'node:fs';
import {FundedLedger,WAD} from '../core/funded-reference.mjs';
const n=Number(process.argv[2]||300000),out=process.argv[3];
if(!Number.isSafeInteger(n)||n<100||n>1000000)throw Error('Use 100..1000000 new wallets');
const ledger=new FundedLedger(),started=performance.now();
const money=x=>`${x/WAD}.${(x%WAD).toString().padStart(18,'0')}`;
for(let i=0;i<31;i++)ledger.fund(i,1);
let oldFullScanVisits=0;
for(let i=0;i<n;i++){
 const id=ledger.place(Math.floor((i+30)/2));ledger.fund(id,1+(i*17)%5);
 // Every 5k additions is an accounting epoch; every 50k additions is a simulated month.
 // This does not model wall-clock hour capacity, RPC, keeper fees or transactions.
 if((i+1)%5000===0||i+1===n){oldFullScanVisits+=2*ledger.users.length;ledger.closeEpoch();ledger.check();}
 if((i+1)%50000===0||i+1===n){ledger.closeMonth();ledger.check();}
}
ledger.check(true);
const result={model:'attributed-credit-v1',kind:'BigInt accounting simulation; NOT EVM or public-testnet load',
 newWallets:n,genesis:31,paidGenesis:31,epochs:ledger.epochs,months:ledger.months,
 maxDepth:Math.max(...ledger.users.slice(-1000).map(u=>u.depth)),ancestorVisits:ledger.ancestorVisits,
 sparseEpochVisits:ledger.epochVisits,legacyTwoPassScanVisits:oldFullScanVisits,monthlyAccountVisits:ledger.monthVisits,
 membershipInflow:money(ledger.inflow),pointRewardsAllocated:money(ledger.pointPaid),builderRewardsAllocated:money(ledger.builderPaid),
 retainedPointReserve:money(ledger.pointRetained),retainedBuilderReserve:money(ledger.builderRetained),
 unmatchedPointCredits:money(ledger.pointAssigned),unclosedBuilderCredits:money(ledger.builderAssigned),
 developmentAllocation:money(ledger.development),tokenReserveSupport:money(ledger.tokenSupport),
 assertions:{nonnegative:true,pointPartition:true,builderPartition:true,globalCashConservation:true,perWalletLedgerReconciliation:true},
 durationSeconds:Number(((performance.now()-started)/1000).toFixed(2)),
 exclusions:['On-chain gas throughput','300k concurrent users','Adversarial public RPC','Token trading (separate reserve simulation)','Calendar automation','Individual identity / Sybil prevention']};
if(out)fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
