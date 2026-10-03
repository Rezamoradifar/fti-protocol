import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,parseEther as E,MaxUint256} from 'ethers';
import {deployOne,settle} from '../scripts/lib.mjs';
let engine,p,signers,usd,token,binary,addresses,snapshot;
before(async()=>{
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'HostileUSD.sol':{content:fs.readFileSync('test/fixtures/HostileUSD.sol','utf8')}},settings:{evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:path=>({contents:fs.readFileSync('node_modules/'+path,'utf8')})}));assert(!output.errors?.some(e=>e.severity==='error'));const a=output.contracts['HostileUSD.sol'].HostileUSD;
 engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:45},chain:{chainId:31337},miner:{blockGasLimit:30000000}});p=new BrowserProvider(engine,undefined,{cacheTimeout:-1});p.pollingInterval=10;signers=await Promise.all(Array.from({length:45},(_,i)=>p.getSigner(i)));addresses=await Promise.all(signers.map(s=>s.getAddress()));
 usd=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signers[0]).deploy();await usd.waitForDeployment();token=await deployOne('FTIReserveToken',[usd.target,addresses[0],addresses[0],addresses[38],addresses[39]],signers[0]);binary=await deployOne('FundedBinaryPlan',[usd.target,token.target,addresses[0],addresses[0],addresses[40],addresses.slice(0,31)],signers[0]);await(await token.bind(binary.target)).wait();
 for(const i of [0,1,2]){await(await usd.mint(addresses[i],E('100000'))).wait();await(await usd.connect(signers[i]).approve(binary.target,MaxUint256)).wait();await(await binary.connect(signers[i]).addUnits(i===0?1:2)).wait();}snapshot=await p.send('evm_snapshot',[]);
});
beforeEach(async()=>{await p.send('evm_revert',[snapshot]);snapshot=await p.send('evm_snapshot',[]);});
after(async()=>{await engine.disconnect();});
async function fails(fn){await assert.rejects(async()=>{const tx=await fn();await tx.wait();});}
async function check(){const[a,b]=await binary.accounting();assert(a>=b);const[c,d,e,f]=await binary.fundingAccounting();assert.equal(c,d);assert.equal(e,f);}
test('membership rejects collateral tax on either sender or recipient without changing balances or credits',async()=>{
 const before=await binary.unitsOf(addresses[0]),pool=await binary.pointPool(),serial=await binary.fundingSerial();for(const mode of [1,2]){await(await usd.setFeeMode(mode)).wait();await fails(()=>binary.addUnits(1));assert.equal(await binary.unitsOf(addresses[0]),before);assert.equal(await binary.pointPool(),pool);assert.equal(await binary.fundingSerial(),serial);}await check();
});
test('a collateral callback cannot process volume inside a membership funding transaction',async()=>{
 assert.equal(await binary.jobCursor(),0n);await(await usd.setCallback(binary.target,binary.interface.encodeFunctionData('processVolume',[1]))).wait();await(await binary.addUnits(1)).wait();assert(await usd.attempted());assert.equal(await usd.succeeded(),false);assert.equal(await binary.jobCursor(),0n);await check();
});
test('a taxed claim reverts without reducing the beneficiary entitlement',async()=>{
 await settle({binary,token,usd},p);const reward=await binary.pendingReward(addresses[0]);assert(reward>0n);for(const mode of [1,2]){await(await usd.setFeeMode(mode)).wait();await fails(()=>binary.claim());assert.equal(await binary.pendingReward(addresses[0]),reward);}await(await usd.setFeeMode(0)).wait();await(await binary.claim()).wait();await check();
});
test('missing collateral blocks claims and funding; direct donations cannot create payout credits or be rescued',async()=>{
 await settle({binary,token,usd},p);const pool=await binary.pointPool();await(await usd.burn(binary.target,E('1'))).wait();await fails(()=>binary.claim());await fails(()=>binary.addUnits(1));await(await usd.mint(binary.target,E('11'))).wait();assert.equal(await binary.pointPool(),pool);await fails(()=>binary.rescue(usd.target,addresses[0],E('10')));await check();
});
