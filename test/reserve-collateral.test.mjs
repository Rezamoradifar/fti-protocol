import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256} from 'ethers';
import {deployOne} from '../scripts/lib.mjs';
let engine,p,signers,usd,token,binary,addresses,snapshot;
before(async()=>{
 const input={language:'Solidity',sources:{'HostileUSD.sol':{content:fs.readFileSync('test/fixtures/HostileUSD.sol','utf8')}},settings:{evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
 const output=JSON.parse(solc.compile(JSON.stringify(input),{import:path=>({contents:fs.readFileSync('node_modules/'+path,'utf8')})}));assert(!output.errors?.some(e=>e.severity==='error'),JSON.stringify(output.errors));const a=output.contracts['HostileUSD.sol'].HostileUSD;
 engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:36},chain:{chainId:31337}});p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;
 signers=await Promise.all(Array.from({length:36},(_,i)=>p.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));usd=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy();await usd.waitForDeployment();
 token=await deployOne('FTIReserveToken',[usd.target,addresses[0],addresses[0]],signers[0]);binary=await deployOne('BinaryPlan',[usd.target,token.target,addresses[0],addresses[0],addresses[35],addresses.slice(0,31)],signers[0]);await(await token.bind(binary.target)).wait();
 for(const i of [0,15]){await(await usd.mint(addresses[i],E('1000'))).wait();await(await usd.connect(signers[i]).approve(binary.target,MaxUint256)).wait();await(await usd.connect(signers[i]).approve(token.target,MaxUint256)).wait();await(await binary.connect(signers[i]).addUnits(1)).wait();}
 await(await token.buy(E('100'),0,MaxUint256)).wait();await p.send('evm_increaseTime',[91*86400]);await p.send('evm_mine',[]);snapshot=await p.send('evm_snapshot',[]);
});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{await engine.disconnect();});
async function fails(fn){await assert.rejects(async()=>{const tx=await fn();await tx.wait();});}
async function unchanged(fn){const r=await token.reserve(),s=await token.totalSupply(),b=await token.balanceOf(addresses[0]);await fails(fn);assert.equal(await token.reserve(),r);assert.equal(await token.totalSupply(),s);assert.equal(await token.balanceOf(addresses[0]),b);}
test('fees taken from either collateral sender or recipient are rejected on buys and sells',async()=>{
 for(const mode of [1,2]){await(await usd.setFeeMode(mode)).wait();await unchanged(()=>token.buy(E('10'),0,MaxUint256));await unchanged(async()=>token.sell(await token.balanceOf(addresses[0]),0,MaxUint256));}
});
test('a collateral callback cannot burn/transfer approved FTI during a priced purchase',async()=>{
 await(await token.approve(usd.target,E('1'))).wait();await(await usd.setCallback(token.target,token.interface.encodeFunctionData('transferFrom',[addresses[0],addresses[15],E('1')]))).wait();
 const q=await token.quoteBuy(E('10')),supply=await token.totalSupply();await(await token.buy(E('10'),q,MaxUint256)).wait();assert(await usd.attempted());assert.equal(await usd.succeeded(),false);assert.equal(await token.balanceOf(addresses[15]),0n);assert.equal(await token.totalSupply(),supply+q);assert.equal(await token.allowance(addresses[0],usd.target),E('1'));
});
test('a collateral deficit blocks trades instead of minting or paying against missing assets',async()=>{
 await(await usd.burn(token.target,E('1'))).wait();await unchanged(()=>token.buy(E('10'),0,MaxUint256));await unchanged(async()=>token.sell(await token.balanceOf(addresses[0]),0,MaxUint256));await unchanged(()=>token.transfer(addresses[15],E('1')));
});
test('pause blocks trades, and rescue cannot remove collateral or locked anchor shares',async()=>{
 await(await token.pause()).wait();await unchanged(()=>token.buy(E('10'),0,MaxUint256));await unchanged(async()=>token.sell(await token.balanceOf(addresses[0]),0,MaxUint256));await unchanged(()=>token.transfer(addresses[15],E('1')));
 await fails(()=>token.rescue(usd.target,addresses[0],1));await fails(()=>token.rescue(token.target,addresses[0],1));await(await token.unpause()).wait();await(await token.buy(E('10'),0,MaxUint256)).wait();
});
