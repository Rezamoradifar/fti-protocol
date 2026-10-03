import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,formatEther as F,MaxUint256} from 'ethers';
import {deploySuite,checkAccounting} from '../scripts/lib.mjs';

let engine,p,signers,s,snapshot;
before(async()=>{
 engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:60},chain:{chainId:31337,time:new Date('2026-10-04T00:00:00Z')},miner:{blockGasLimit:30000000}});
 p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 signers=await Promise.all(Array.from({length:60},(_,i)=>p.getSigner(i)));
 s=await deploySuite(signers,{tokenContract:'FTIReserveToken',binaryContract:'FundedBinaryPlan'});
 for(let i=0;i<60;i++){
   await(await s.usd.connect(signers[i]).faucet()).wait();
   await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();
   await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();
 }
 snapshot=await p.send('evm_snapshot',[]);
});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{await engine.disconnect();});

async function activateEmergency(){
 const id=await s.council.count();
 const data=s.token.interface.encodeFunctionData('activateEmergencyExit');
 await(await s.council.connect(signers[31]).propose(s.token.target,data)).wait();
 for(const i of [32,33,34,35])await(await s.council.connect(signers[i]).approve(id)).wait();
 await(await s.council.connect(signers[31]).execute(id)).wait();
 assert.equal(await s.token.emergencyExit(),true);
}
async function seedAndBuy(amount='100'){
 await(await s.binary.addUnits(1)).wait(); // 5 USD support, zero FTI mint
 assert.equal(await s.token.totalSupply(),0n);
 await(await s.token.buy(E(amount),0,MaxUint256)).wait();
}

test('starts with zero reserve, zero supply and zero price',async()=>{
 assert.equal(await s.token.reserve(),0n);
 assert.equal(await s.token.totalSupply(),0n);
 assert.equal(await s.token.circulatingSupply(),0n);
 assert.equal(await s.token.anchorSupply(),0n);
 assert.equal(await s.token.price(),0n);
 await checkAccounting(s);
});

test('binary registration/funding supports reserve but never mints the first FTI',async()=>{
 await(await s.binary.addUnits(1)).wait();
 assert.equal(await s.token.reserve(),E('5'));
 assert.equal(await s.token.totalSupply(),0n);
 assert.equal(await s.token.price(),0n);
 assert.equal(await s.token.walletClock(),0n);
 await(await s.binary.connect(signers[41]).register(s.addresses[15],1)).wait();
 assert.equal(await s.token.reserve(),E('10'));
 assert.equal(await s.token.totalSupply(),0n);
 assert.equal(await s.token.walletClock(),1n);
 await checkAccounting(s);
});

test('first actual buy creates user supply and splits one percentage point to two animal wallets',async()=>{
 await(await s.binary.addUnits(1)).wait();
 const q=await s.token.quoteBuy(E('100'));
 assert.equal(q,E('97'));
 await(await s.token.buy(E('100'),q,MaxUint256)).wait();
 assert.equal(await s.token.balanceOf(s.addresses[0]),E('97'));
 assert.equal(await s.token.balanceOf(s.addresses[38]),E('0.5'));
 assert.equal(await s.token.balanceOf(s.addresses[39]),E('0.5'));
 assert.equal(await s.token.totalSupply(),E('98'));
 assert.equal(await s.token.reserve(),E('105'));
 assert((await s.token.price())>E('1'));
 await checkAccounting(s);
});

test('tokens are immediately unlocked; transfer is standard and has no transfer tax',async()=>{
 await seedAndBuy();
 assert.equal(await s.token.locked(s.addresses[0]),0n);
 assert.equal(await s.token.unlocked(s.addresses[0]),E('97'));
 assert.equal(await s.token.lockCount(s.addresses[0]),0n);
 const supply=await s.token.totalSupply();
 await(await s.token.transfer(s.addresses[1],E('1'))).wait();
 assert.equal(await s.token.balanceOf(s.addresses[1]),E('1'));
 assert.equal(await s.token.totalSupply(),supply);
 // A small immediate sale works without a 30/90-day or wallet-count unlock.
 const before=await s.usd.balanceOf(s.addresses[0]);
 await(await s.token.sell(E('4'),0,MaxUint256)).wait();
 assert((await s.usd.balanceOf(s.addresses[0]))>before);
 await checkAccounting(s);
});

test('normal mode rejects a sudden whale exit and quotes additional impact above 1% size',async()=>{
 await seedAndBuy();
 assert((await s.token.sellImpactBps(E('2')))>0n);
 await assert.rejects(async()=>{const tx=await s.token.sell(E('6'),0,MaxUint256);await tx.wait();});
});

test('5-of-7 council vote activates redemption-only emergency mode without an admin liquidity transfer',async()=>{
 await seedAndBuy();
 await activateEmergency();
 assert.equal(await s.token.paused(),true);
 await assert.rejects(async()=>{const tx=await s.token.buy(E('1'),0,MaxUint256);await tx.wait();});
 const before=await s.usd.balanceOf(s.addresses[0]);
 const bal=await s.token.balanceOf(s.addresses[0]);
 await(await s.token.sell(bal,0,MaxUint256)).wait(); // whale/hour caps bypassed only for emergency redemption
 assert((await s.usd.balanceOf(s.addresses[0]))>before);
 assert.equal(await s.token.emergencyExit(),true);
 await checkAccounting(s);
});

test('a 10x internal price milestone doubles the builder multiplier automatically',async()=>{
 await seedAndBuy();
 const launch=await s.token.launchPrice();
 assert(launch>0n);
 assert.equal(await s.token.priceMultiplier(),1n);
 // 200 membership units inject 1,000 support USD without minting FTI.
 await(await s.binary.addUnits(200)).wait();
 assert((await s.token.price())>=launch*10n);
 assert.equal(await s.token.priceMultiplier(),2n);
});

test('animal-support shares are fully backed and sell fees still raise reserve/share value',async()=>{
 await seedAndBuy();
 const oldR=await s.token.reserve(),oldS=await s.token.totalSupply(),oldAnimal=(await s.token.balanceOf(s.addresses[38]))+(await s.token.balanceOf(s.addresses[39]));
 await(await s.token.sell(E('4'),0,MaxUint256)).wait();
 const newR=await s.token.reserve(),newS=await s.token.totalSupply(),newAnimal=(await s.token.balanceOf(s.addresses[38]))+(await s.token.balanceOf(s.addresses[39]));
 assert(newAnimal>oldAnimal);
 assert(newR*oldS>oldR*newS);
 await checkAccounting(s);
 console.log('FTI_V2_FEE_CHECK',JSON.stringify({price:F(await s.token.price()),animalTokens:F(newAnimal)}));
});
