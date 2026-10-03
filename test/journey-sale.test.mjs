import {test} from 'node:test';import assert from 'node:assert/strict';
import ganache from 'ganache';import {BrowserProvider,parseEther as E} from 'ethers';
import {deploySuite,checkAccounting} from '../scripts/lib.mjs';import {sellUnlocked} from '../scripts/journey-sale.mjs';
test('registered user buys, locked sale waits, unlocked sale pays USD, second sale waits',async()=>{
 const engine=ganache.provider({logging:{quiet:true},chain:{chainId:97},wallet:{totalAccounts:45},miner:{blockGasLimit:30000000}});
 const p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 try{const signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));const s=await deploySuite(signers);const wallet=signers[36];
 for(const [c,m,args]of [[s.usd,'faucet',[]],[s.usd,'approve',[s.binary.target,E('100')]],[s.binary,'register',[s.addresses[15],1]],[s.usd,'approve',[s.token.target,E('10')]],[s.token,'buy',[E('10'),0,2n**64n-1n]]])await(await c.connect(wallet)[m](...args)).wait();
 const submit=async(m,args)=>{await(await s.token.connect(wallet)[m](...args)).wait();};const run=()=>sellUnlocked({wallet,token:s.token,usd:s.usd,submit,now:async()=>(await p.getBlock('latest')).timestamp});
 assert.equal((await run()).status,'PENDING');
 await p.send('evm_increaseTime',[31*86400]);await p.send('evm_mine',[]);
 const result=await run();assert.equal(result.status,'PASS');assert(BigInt(result.receivedUSD)>0n);assert.equal(await s.token.balanceOf(await wallet.getAddress()),0n);await checkAccounting(s);
 assert.equal((await run()).status,'PENDING');console.log('SALE_FLOW_PASS',result);
 }finally{p.destroy();await engine.disconnect();}
});
