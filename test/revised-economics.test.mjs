import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,parseEther as E,MaxUint256,ZeroAddress} from 'ethers';
import {deploySuite,checkAccounting,artifact} from '../scripts/lib.mjs';
import {ReserveModel,INITIAL_PRICE,W,baseFee,buyQuote,sellQuote} from '../core/reserve-reference.mjs';

let engine,p,signers,s,snapshot;
before(async()=>{
 engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:42},chain:{chainId:31337,time:new Date('2026-10-04T00:00:00Z')},miner:{blockGasLimit:30000000}});
 p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 signers=await Promise.all(Array.from({length:42},(_,i)=>p.getSigner(i)));
 s=await deploySuite(signers,{tokenContract:'FTIReserveToken',binaryContract:'FundedBinaryPlan'});
 await(await s.usd.faucet()).wait();
 await(await s.usd.approve(s.binary.target,MaxUint256)).wait();
 await(await s.usd.approve(s.token.target,MaxUint256)).wait();
 snapshot=await p.send('evm_snapshot',[]);
});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{await engine.disconnect();});
const fee=amount=>(amount*300n+9999n)/10000n;
async function seed(){await(await s.binary.addUnits(1)).wait();return(await s.token.buy(E('100'),0,MaxUint256)).wait();}
async function state(){return Promise.all([s.token.reserve(),s.token.totalSupply(),s.token.price(),s.token.balanceOf(s.addresses[0]),s.token.balanceOf(s.addresses[1]),s.usd.balanceOf(s.token.target),s.usd.balanceOf(s.addresses[0]),s.token.remainingAllowance(s.addresses[0]),s.token.pressureWad(),s.token.lastPartialSellAt()]);}
function events(receipt,name){return receipt.logs.filter(x=>x.address.toLowerCase()===s.token.target.toLowerCase()).map(x=>{try{return s.token.interface.parseLog(x);}catch{return null;}}).filter(x=>x?.name===name);}
async function growth(oldR,oldS,oldP){const newR=await s.token.reserve(),newS=await s.token.totalSupply();assert(newR*oldS>oldR*newS);assert((await s.token.price())>oldP);await checkAccounting(s);}
async function emergency(){const id=await s.council.count();await(await s.council.connect(signers[31]).propose(s.token.target,s.token.interface.encodeFunctionData('activateEmergencyExit'))).wait();for(const i of [32,33,34,35])await(await s.council.connect(signers[i]).approve(id)).wait();await(await s.council.connect(signers[31]).execute(id)).wait();}

test('revised initial reference is $0.10 with zero tokens/reserve and no charity ABI or constructor arguments',async()=>{
 assert.equal(await s.token.price(),E('0.1'));assert.equal(await s.token.INITIAL_PRICE(),E('0.1'));
 assert.equal(await s.token.referencePrice(),E('0.1'));assert.equal(await s.token.lifecycleClosed(),false);
 assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.totalSupply(),0n);
 const abi=artifact('FTIReserveToken').abi;
 assert.equal(abi.find(x=>x.type==='constructor').inputs.length,3);
 assert(!abi.some(x=>/animal|charity/i.test(x.name??'')));
 await checkAccounting(s);
});

test('membership grants 5x cumulative same-wallet permission and injects support without minting',async()=>{
 await(await s.binary.addUnits(1)).wait();
 assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.unallocatedReserve(),E('5'));assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.token.price(),E('0.1'));
 assert.equal(await s.token.buyLimit(s.addresses[0]),E('500'));assert.equal(await s.token.buyLimit(s.addresses[1]),0n);
 assert.equal(await s.token.quoteBuy(E('100')),E('970'));
 const receipt=await(await s.token.buy(E('100'),E('970'),MaxUint256)).wait();
 assert.equal(await s.token.balanceOf(s.addresses[0]),E('970'));assert.equal(await s.token.totalSupply(),E('970'));
 assert.equal(await s.token.reserve(),E('100'));assert.equal(await s.token.unallocatedReserve(),E('5'));assert.equal(await s.token.remainingAllowance(s.addresses[0]),E('400'));
 const minted=events(receipt,'Transfer').filter(x=>x.args.from===ZeroAddress);
 assert.equal(minted.length,1);assert.equal(minted[0].args.value,E('970'));
 assert((await s.token.price())>E('0.1'));await checkAccounting(s);
});

test('subsequent buy mints net 97% at pre-operation displayed quote and retains all collateral',async()=>{
 await seed();const oldR=await s.token.reserve(),oldS=await s.token.totalSupply(),oldP=await s.token.price(),amount=E('100');
 const expected=(amount-fee(amount))*W/oldP;
 assert.equal(await s.token.quoteBuy(amount),expected);
 await(await s.token.buy(amount,expected,MaxUint256)).wait();
 assert.equal(await s.token.reserve(),oldR+amount);assert.equal(await s.token.totalSupply(),oldS+expected);
 await growth(oldR,oldS,oldP);
});

test('sub-$500 partial sells apply only the 3% base and burn exactly sold tokens once',async()=>{
 await seed();const oldR=await s.token.reserve(),oldS=await s.token.totalSupply(),oldP=await s.token.price(),tokens=oldS*4n/100n;
 const q=sellQuote(tokens,oldR,oldS),gross=q.gross,expected=q.payout,beforeUSD=await s.usd.balanceOf(s.addresses[0]);
 assert.equal(q.impactBps,0n);assert.equal(await s.token.sellImpactBps(tokens),q.impactBps);
 assert.deepEqual(Array.from(await s.token.quoteSell(tokens)),[expected,q.feeBps,gross]);
 const receipt=await(await s.token.sell(tokens,expected,MaxUint256)).wait();
 assert.equal(await s.token.reserve(),oldR-expected);assert.equal(await s.token.totalSupply(),oldS-tokens);
 assert.equal((await s.usd.balanceOf(s.addresses[0]))-beforeUSD,expected);
 const transfers=events(receipt,'Transfer');assert.equal(transfers.length,1);assert.equal(transfers[0].args.to,ZeroAddress);assert.equal(transfers[0].args.value,tokens);
 await growth(oldR,oldS,oldP);
});

test('positive transfer debits 100%, burns 3%, credits 97%, grows real/displayed price and moves no USD',async()=>{
 await seed();const old=await state(),amount=E('100'),burn=E('3');
 const receipt=await(await s.token.transfer(s.addresses[1],amount)).wait();
 const next=await state();
 assert.equal(next[0],old[0]);assert.equal(next[1],old[1]-burn);assert.equal(next[3],old[3]-amount);assert.equal(next[4],E('97'));
 assert.equal(next[5],old[5]);assert.equal(next[6],old[6]);assert.equal(next[7],old[7]);
 const transfers=events(receipt,'Transfer');assert.equal(transfers.length,2);assert.equal(transfers[0].args.to,ZeroAddress);assert.equal(transfers[0].args.value,burn);assert.equal(transfers[1].args.value,E('97'));
 await growth(old[0],old[1],old[2]);
});

test('transferFrom spends gross allowance and has the same single burn and net receipt',async()=>{
 await seed();await(await s.token.approve(s.addresses[2],E('150'))).wait();
 const old=await state();
 await(await s.token.connect(signers[2]).transferFrom(s.addresses[0],s.addresses[1],E('100'))).wait();
 assert.equal(await s.token.allowance(s.addresses[0],s.addresses[2]),E('50'));
 assert.equal(await s.token.balanceOf(s.addresses[1]),E('97'));assert.equal(await s.token.balanceOf(s.addresses[0]),old[3]-E('100'));
 assert.equal(await s.token.totalSupply(),old[1]-E('3'));await growth(old[0],old[1],old[2]);
 await assert.rejects(s.token.connect(signers[2]).transferFrom.staticCall(s.addresses[0],s.addresses[1],E('51')));
});

test('self-transfer requires gross balance and burns once; zero transfer is the explicit no-op exception',async()=>{
 await seed();const old=await state();
 await(await s.token.transfer(s.addresses[0],E('100'))).wait();
 assert.equal(await s.token.balanceOf(s.addresses[0]),old[3]-E('3'));assert.equal(await s.token.totalSupply(),old[1]-E('3'));
 await assert.rejects(s.token.transfer.staticCall(s.addresses[0],old[3]));
 const unchanged=await state();const receipt=await(await s.token.transfer(s.addresses[1],0)).wait();
 assert.deepEqual(await state(),unchanged);assert.equal(events(receipt,'Transfer').length,1);assert.equal(events(receipt,'Transfer')[0].args.value,0n);
});

test('dust transfer and sub-displayed-price-step transfer revert atomically including gross allowance',async()=>{
 await seed();await(await s.token.approve(s.addresses[2],100n)).wait();const old=await state();
 await assert.rejects(s.token.transfer.staticCall(s.addresses[1],1n),{reason:'transfer dust'});
 await assert.rejects(s.token.transfer.staticCall(s.addresses[1],2n),{reason:'price step too small'});
 await assert.rejects(async()=>{await(await s.token.connect(signers[2]).transferFrom(s.addresses[0],s.addresses[1],2n,{gasLimit:1000000})).wait();});
 assert.deepEqual(await state(),old);assert.equal(await s.token.allowance(s.addresses[0],s.addresses[2]),100n);await checkAccounting(s);
});

test('final normal redemption pays 100% of live reserve, freezes reference and blocks restart',async()=>{
 await seed();const old=await state();
 assert((await s.token.sell.staticCall(old[1]/2n,0,MaxUint256))>0n);
 assert.deepEqual(Array.from(await s.token.quoteSell(old[1])),[old[0],0n,old[0]]);
 const expected=old[0],spent=await s.binary.tokenBuySpent(s.addresses[0]),window=await s.token.sellWindowGross();
 await(await s.token.sell(old[1],expected,MaxUint256)).wait();
 assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.token.balanceOf(s.addresses[0]),0n);
 assert.equal(await s.token.price(),old[2]);assert.equal(await s.token.referencePrice(),old[2]);assert.equal(await s.token.lifecycleClosed(),true);
 assert.equal((await s.usd.balanceOf(s.addresses[0]))-old[6],expected);assert.equal(await s.token.sellWindowGross(),window);
 await assert.rejects(s.token.quoteBuy(E('0.1')),{reason:'restart policy pending'});
 await assert.rejects(s.token.buy.staticCall(E('0.1'),0,MaxUint256),{reason:'restart policy pending'});
 assert.equal(await s.binary.tokenBuySpent(s.addresses[0]),spent);await checkAccounting(s);
});

test('retained emergency exception is fee-free, closes final lifecycle and preserves historical reference',async()=>{
 await seed();await emergency();const old=await state();
 assert.deepEqual(Array.from(await s.token.quoteSell(old[1])),[old[0],0n,old[0]]);
 await(await s.token.sell(old[1],old[0],MaxUint256)).wait();
 assert.equal(await s.token.reserve(),0n);assert.equal(await s.token.totalSupply(),0n);assert.equal(await s.token.price(),old[2]);assert.equal(await s.token.lifecycleClosed(),true);
 await checkAccounting(s);
});

test('independent revised model matches buys, transfer burn, trade-size sale fees and terminal restart guard',()=>{
 const m=new ReserveModel();assert.equal(m.price(),INITIAL_PRICE);m.register('a');m.register('b');
 assert.deepEqual(m.buy('a',100n*W),{userMint:970n*W});
 assert.equal(m.reserve,100n*W);assert.equal(m.unallocatedReserve,10n*W);assert.equal(m.supply,970n*W);
 const p=m.price();assert.deepEqual(m.transfer('a','b',100n*W),{burned:3n*W,received:97n*W});assert(m.price()>p);
 const expected=sellQuote(100n*W,m.reserve,m.supply),q=m.sell('a',100n*W);
 assert.equal(q.impactBps,0n);assert.deepEqual(q,expected);assert.equal(q.baseFee,baseFee(q.gross));
 m.sell('b',m.wallets.get('b').balance,{emergency:true});
 const last=m.price();m.sell('a',m.wallets.get('a').balance);assert.equal(m.supply,0n);assert.equal(m.price(),last);assert.equal(m.lifecycleClosed,true);
 assert.throws(()=>m.buy('a',W),/restart policy pending/);
 assert.equal(m.reserve+m.unallocatedReserve,m.cashIn-m.cashOut);
});

test('arithmetic keeps post-close support protected and prevents capture without approving restart',()=>{
 const m=new ReserveModel();m.register('a');m.buy('a',100n*W);m.sell('a',m.supply);
 assert.equal(m.reserve,0n);assert.equal(m.unallocatedReserve,5n*W);m.register('b');assert.equal(m.reserve,0n);assert.equal(m.unallocatedReserve,10n*W);
 assert.throws(()=>m.buy('b',W),/restart policy pending/);
 const buyAmount=W/10n,minted=buyQuote(buyAmount,m.reserve,0n,m.referencePrice);
 const hypothetical=sellQuote(minted,m.reserve+buyAmount,minted);
 assert.equal(hypothetical.payout,E('0.1'));assert.equal(hypothetical.payout-buyAmount,0n);assert.equal(m.cashIn-m.cashOut,m.unallocatedReserve);
});
