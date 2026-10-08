import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,formatEther as F,MaxUint256} from 'ethers';
import {deploySuite,settle,checkAccounting} from '../scripts/lib.mjs';
import {buyQuote,sellQuote} from '../core/reserve-reference.mjs';
let engine,p,signers,s,snapshot;
before(async()=>{
 engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:45},chain:{chainId:31337,time:new Date('2026-09-15T12:00:00Z')},miner:{blockGasLimit:30000000}});
 p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));s=await deploySuite(signers,{tokenContract:'FTIReserveToken'});
 for(const i of [0,1,2,15,16,36]){await(await s.usd.connect(signers[i]).faucet()).wait();await(await s.usd.connect(signers[i]).approve(s.binary.target,MaxUint256)).wait();await(await s.usd.connect(signers[i]).approve(s.token.target,MaxUint256)).wait();}
 snapshot=await p.send('evm_snapshot',[]);
});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{await engine.disconnect();});
async function fails(fn){await assert.rejects(async()=>{const tx=await fn();await tx.wait();});}
async function seed(){await(await s.binary.addUnits(1)).wait();}
async function mature(){await p.send('evm_increaseTime',[91*86400]);await p.send('evm_mine',[]);}
async function growth(fn){const r=await s.token.reserve(),supply=await s.token.totalSupply(),price=await s.token.price();await(await fn()).wait();const r2=await s.token.reserve(),s2=await s.token.totalSupply();assert(r2*supply>r*s2,'exact reserve/share value must strictly increase');assert((await s.token.price())>=price,'rounded price must not decrease');assert((await s.usd.balanceOf(s.token.target))>=r2);const[,,gross]=await s.token.quoteSell(await s.token.circulatingSupply());assert(gross<=r2);}
async function unchanged(fn){const r=await s.token.reserve(),supply=await s.token.totalSupply(),balance=await s.token.balanceOf(s.addresses[0]);await fails(fn);assert.equal(await s.token.reserve(),r);assert.equal(await s.token.totalSupply(),supply);assert.equal(await s.token.balanceOf(s.addresses[0]),balance);await checkAccounting(s);}

test('reserve bootstrap is paid by the first membership allocation, never virtual collateral',async()=>{
 assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.token.price(),E('0.1'));
 await assert.rejects(s.token.quoteBuy(E('1')));await seed();
 assert.equal(await s.token.reserve(),E('5'));assert.equal(await s.token.anchorSupply(),E('50'));assert.equal(await s.token.balanceOf(s.token.target),E('50'));assert.equal(await s.token.unlocked(s.token.target),0n);assert.equal(await s.token.circulatingSupply(),0n);assert.equal(await s.token.price(),E('0.1'));
 assert.equal(await s.token.buybackFund(),0n);assert.equal(await s.token.floorFund(),0n);await checkAccounting(s);
});
test('buy and full sale both increase actual reserve/share price; payouts are real',async()=>{
 await seed();const first=await s.token.price();const cash=await s.usd.balanceOf(s.addresses[0]);const quote=await s.token.quoteBuy(E('100'));
 assert.equal(quote,E('970'));await growth(()=>s.token.buy(E('100'),quote,MaxUint256));const afterBuy=await s.token.price();assert.equal(await s.token.reserve(),E('105'));assert.equal(await s.token.balanceOf(s.addresses[0]),quote);
 await mature();const[out,fee]=await s.token.quoteSell(quote);assert.equal(fee,300n);const beforeSale=await s.usd.balanceOf(s.addresses[0]);await growth(()=>s.token.sell(quote,out,MaxUint256));
 assert.equal((await s.usd.balanceOf(s.addresses[0]))-beforeSale,out);assert.equal(await s.token.circulatingSupply(),0n);assert.equal(await s.token.totalSupply(),await s.token.anchorSupply());assert((await s.usd.balanceOf(s.addresses[0]))<cash);await checkAccounting(s);
 console.log('RESERVE_ROUND_TRIP',JSON.stringify({initialPrice:F(first),afterBuy:F(afterBuy),afterSale:F(await s.token.price()),usdIn:'100',usdOut:F(out),finalCirculating:'0'}));
});
test('a new purchase after complete circulation exit cannot reset or lower the price',async()=>{
 await seed();await growth(()=>s.token.buy(E('100'),0,MaxUint256));await mature();await growth(async()=>s.token.sell(await s.token.balanceOf(s.addresses[0]),0,MaxUint256));
 const previous=await s.token.price(),anchor=await s.token.anchorSupply();await growth(()=>s.token.buy(E('100'),0,MaxUint256));assert((await s.token.price())>previous);assert.equal(await s.token.anchorSupply(),anchor);await checkAccounting(s);
});
test('subsequent membership allocations increase real backing without issuing anchor or user shares',async()=>{
 await seed();const supply=await s.token.totalSupply();await growth(()=>s.binary.connect(signers[15]).addUnits(1));assert.equal(await s.token.reserve(),E('10'));assert.equal(await s.token.totalSupply(),supply);await growth(()=>s.binary.connect(signers[36]).register(s.addresses[15],1));assert.equal(await s.token.walletClock(),1n);await checkAccounting(s);
});
test('unlocked transfers and transferFrom burn shares and raise the price without reserve withdrawal',async()=>{
 await seed();for(const i of [15,16])await(await s.binary.connect(signers[i]).addUnits(1)).wait();await growth(()=>s.token.buy(E('100'),0,MaxUint256));await mature();
 const r=await s.token.reserve();await growth(()=>s.token.transfer(s.addresses[15],E('10')));assert.equal(await s.token.balanceOf(s.addresses[15]),E('9.7'));
 await(await s.token.approve(s.addresses[15],E('10'))).wait();await growth(()=>s.token.connect(signers[15]).transferFrom(s.addresses[0],s.addresses[16],E('10')));assert.equal(await s.token.reserve(),r);assert.equal(await s.token.allowance(s.addresses[0],s.addresses[15]),0n);await checkAccounting(s);
});
test('zero/dust operations cannot create shares or round fees away',async()=>{
 await seed();await unchanged(()=>s.token.buy(0,0,MaxUint256));await unchanged(()=>s.token.buy(1,0,MaxUint256));assert.equal(await s.token.quoteBuy(1),0n);
 await(await s.binary.connect(signers[15]).addUnits(1)).wait();await growth(()=>s.token.buy(E('10'),0,MaxUint256));await mature();await unchanged(()=>s.token.transfer(s.addresses[15],1));await unchanged(()=>s.token.sell(1,0,MaxUint256));
 const r=await s.token.reserve(),supply=await s.token.totalSupply();await(await s.token.transfer(s.addresses[15],0)).wait();assert.equal(await s.token.reserve(),r);assert.equal(await s.token.totalSupply(),supply);await checkAccounting(s);
});
test('direct collateral donations do not change quotes or dilute a later depositor',async()=>{
 await seed();const price=await s.token.price(),quote=await s.token.quoteBuy(E('100'));
 await(await s.usd.transfer(s.token.target,E('10000'))).wait();assert.equal(await s.token.price(),price);assert.equal(await s.token.quoteBuy(E('100')),quote);
 await growth(()=>s.token.buy(E('100'),quote,MaxUint256));await mature();await growth(()=>s.token.sell(quote,0,MaxUint256));const[actual,accounted]=await s.token.accounting();assert.equal(actual-accounted,E('10000'));assert.equal(await s.token.circulatingSupply(),0n);
});
test('min output, expiry, allowance, registration and maturity still reject atomically',async()=>{
 await seed();const q=await s.token.quoteBuy(E('100'));await unchanged(()=>s.token.buy(E('100'),q+1n,MaxUint256));await unchanged(()=>s.token.buy(E('100'),0,0));await unchanged(()=>s.token.buy(E('501'),0,MaxUint256));
 await growth(()=>s.token.buy(E('100'),q,MaxUint256));await unchanged(()=>s.token.sell(q,0,MaxUint256));await mature();const[out]=await s.token.quoteSell(q);await unchanged(()=>s.token.sell(q,out+1n,MaxUint256));await unchanged(()=>s.token.transfer(s.addresses[36],E('1')));await unchanged(()=>s.token.transfer(s.addresses[0],E('1')));assert.equal(await s.token.remainingAllowance(s.addresses[0]),E('400'));
});
test('a failed collateral payout restores burned tokens and the entire reserve',async()=>{
 await seed();await growth(()=>s.token.buy(E('100'),0,MaxUint256));await mature();await(await s.usd.setBlocked(s.addresses[0],true)).wait();await unchanged(async()=>s.token.sell(await s.token.balanceOf(s.addresses[0]),0,MaxUint256));await(await s.usd.setBlocked(s.addresses[0],false)).wait();await growth(async()=>s.token.sell(await s.token.balanceOf(s.addresses[0]),0,MaxUint256));await checkAccounting(s);
});
test('anchor shares and accounted collateral cannot be withdrawn by administrative rescue',async()=>{
 await seed();for(const asset of [s.usd.target,s.token.target])await assert.rejects(p.call({from:s.timelock.target,to:s.token.target,data:s.token.interface.encodeFunctionData('rescue',[asset,s.addresses[0],1])}));
 await assert.rejects(p.call({from:s.token.target,to:s.token.target,data:s.token.interface.encodeFunctionData('transfer',[s.addresses[0],1])}));await assert.rejects(s.token.quoteSell(E('1')));
 await fails(()=>s.token.inject(1,false));await fails(()=>s.token.bind(s.binary.target));await checkAccounting(s);
});
test('real binary rewards execute through the protected auto-buy flow and raise price',async()=>{
 for(const[i,n]of [[0,1],[1,100],[2,100]])await(await s.binary.connect(signers[i]).addUnits(n)).wait();await settle(s,p);await(await s.binary.setAutoBuy(true,E('1000'))).wait();for(const i of [1,2])await(await s.binary.connect(signers[i]).addUnits(5)).wait();await settle(s,p);
 const amount=await s.binary.pendingAuto(s.addresses[0]);assert.equal(amount,E('45'));const q=await s.token.quoteBuy(amount);await fails(()=>s.binary.connect(signers[44]).executeAuto(s.addresses[0],1));await growth(()=>s.binary.connect(signers[44]).executeAuto(s.addresses[0],amount));assert.equal(await s.token.balanceOf(s.addresses[0]),q);assert.equal(await s.binary.pendingAuto(s.addresses[0]),0n);await checkAccounting(s);
});
test('splitting a full exit preserves growth at every fill and cannot profit from a closed own-funded cycle',async()=>{
 await seed();const cash=await s.usd.balanceOf(s.addresses[0]);await growth(()=>s.token.buy(E('100'),0,MaxUint256));await mature();const balance=await s.token.balanceOf(s.addresses[0]);
 for(let i=0;i<20;i++)await growth(async()=>s.token.sell(i===19?await s.token.balanceOf(s.addresses[0]):balance/20n,0,MaxUint256));assert.equal(await s.token.circulatingSupply(),0n);assert((await s.usd.balanceOf(s.addresses[0]))<cash);await checkAccounting(s);
});
test('a 50,000 USD purchase and full whale exit retain the fixed fee, backed payout and prior peak',async()=>{
 await seed();await growth(()=>s.binary.addUnits(100));const amount=E('50000'),r=await s.token.reserve(),supply=await s.token.totalSupply();
 const q=buyQuote(amount,r,supply);assert.equal(await s.token.quoteBuy(amount),q);await growth(()=>s.token.buy(amount,q,MaxUint256));await mature();
 const expected=sellQuote(q,await s.token.reserve(),await s.token.totalSupply()),[out,fee,gross]=await s.token.quoteSell(q);
 assert.equal(out,expected.payout);assert.equal(gross,expected.gross);assert.equal(fee,300n);const cash=await s.usd.balanceOf(s.addresses[0]);await growth(()=>s.token.sell(q,out,MaxUint256));assert.equal((await s.usd.balanceOf(s.addresses[0]))-cash,out);assert.equal(await s.token.circulatingSupply(),0n);await checkAccounting(s);
 console.log('RESERVE_WHALE',JSON.stringify({usdIn:F(amount),usdOut:F(out),feeBps:String(fee),finalPrice:F(await s.token.price())}));
});
