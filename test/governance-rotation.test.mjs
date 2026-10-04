import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory} from 'ethers';

let engine,provider,signers,addresses,council,snapshot;
before(async()=>{
 const input={language:'Solidity',sources:{'Governance.sol':{content:fs.readFileSync('contracts/Governance.sol','utf8')}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
 const output=JSON.parse(solc.compile(JSON.stringify(input),{import:path=>({contents:fs.readFileSync('node_modules/'+path,'utf8')})}));
 assert(!output.errors?.some(e=>e.severity==='error'),JSON.stringify(output.errors));
 const artifact=output.contracts['Governance.sol'].Council;
 engine=ganache.provider({logging:{quiet:true},wallet:{totalAccounts:10},chain:{chainId:31337}});
 provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 signers=await Promise.all(Array.from({length:10},(_,i)=>provider.getSigner(i)));
 addresses=await Promise.all(signers.map(s=>s.getAddress()));
 council=await new ContractFactory(artifact.abi,'0x'+artifact.evm.bytecode.object,signers[0]).deploy(addresses.slice(0,7));
 await council.waitForDeployment();
 snapshot=await provider.send('evm_snapshot',[]);
});
beforeEach(async()=>{await provider.send('evm_revert',[snapshot]);snapshot=await provider.send('evm_snapshot',[]);});
after(async()=>{await engine?.disconnect();});

async function propose(approvers,data=council.interface.encodeFunctionData('count')){
 const id=await council.count();
 await(await council.connect(signers[approvers[0]]).propose(council.target,data)).wait();
 for(const i of approvers.slice(1))await(await council.connect(signers[i]).approve(id)).wait();
 return id;
}
async function rotate(oldIndex,newIndex,approvers){
 const data=council.interface.encodeFunctionData('replaceOwner',[addresses[oldIndex],addresses[newIndex]]);
 const id=await propose(approvers,data);
 await(await council.execute(id)).wait();
 assert.equal(await council.isOwner(addresses[oldIndex]),false);
 assert.equal(await council.isOwner(addresses[newIndex]),true);
}
async function approvals(id){return(await council.proposal(id))[2];}
async function rejectsThreshold(id){
 await assert.rejects(()=>council.execute.staticCall(id),/threshold/);
 await assert.rejects(async()=>{await(await council.execute(id,{gasLimit:300000})).wait();});
 assert.equal((await council.proposal(id))[3],false);
}

test('rotating an approving key cannot turn four current approvals into five',async()=>{
 const id=await propose([0,1,2,3]);
 await rotate(0,7,[0,1,2,3,4]);
 await(await council.connect(signers[7]).approve(id)).wait();
 // The removed owner's vote and replacement's vote must not count together.
 await rejectsThreshold(id);
 assert.equal(await approvals(id),4n);
 assert.equal(await council.approved(id,addresses[0]),false);
 for(const i of [1,2,3,7])assert.equal(await council.approved(id,addresses[i]),true);
 await(await council.connect(signers[4]).approve(id)).wait();
 assert.equal(await approvals(id),5n);
 await(await council.execute(id)).wait();
 assert.equal((await council.proposal(id))[3],true);
});

test('removing and later restoring an owner never revives their old consent',async()=>{
 const id=await propose([0,1,2,3,4]);
 await rotate(0,7,[0,1,2,3,4]);
 await rotate(7,0,[1,2,3,4,5]);
 await rejectsThreshold(id);
 assert.equal(await approvals(id),4n);
 assert.equal(await council.approved(id,addresses[0]),false);
 await(await council.connect(signers[0]).approve(id)).wait();
 assert.equal(await approvals(id),5n);
 await(await council.execute(id)).wait();
 assert.equal((await council.proposal(id))[3],true);
});

test('repeated rotations preserve one current approval per owner slot',async()=>{
 const id=await propose([0,1,2]);
 for(const[oldIndex,newIndex]of [[0,7],[7,8],[8,0]]){
  await rotate(oldIndex,newIndex,[1,2,3,4,5]);
  assert.equal(await approvals(id),2n);
  assert.equal(await council.approved(id,addresses[oldIndex]),false);
  await assert.rejects(()=>council.connect(signers[oldIndex]).approve.staticCall(id),/approval/);
  await(await council.connect(signers[newIndex]).approve(id)).wait();
  assert.equal(await approvals(id),3n);
  await assert.rejects(()=>council.connect(signers[newIndex]).approve.staticCall(id),/approval/);
  await rejectsThreshold(id);
 }
 await(await council.connect(signers[3]).approve(id)).wait();
 await rejectsThreshold(id);
 await(await council.connect(signers[4]).approve(id)).wait();
 await(await council.execute(id)).wait();
 assert.equal((await council.proposal(id))[3],true);
});

test('five unchanged current owners keep their approvals across an unrelated rotation',async()=>{
 const id=await propose([0,1,2,3,4]);
 await rotate(6,7,[0,1,2,3,4]);
 assert.equal(await approvals(id),5n);
 for(const i of [0,1,2,3,4])assert.equal(await council.approved(id,addresses[i]),true);
 await(await council.execute(id)).wait();
 assert.equal((await council.proposal(id))[3],true);
 await assert.rejects(()=>council.execute.staticCall(id),/threshold/);
 await assert.rejects(()=>council.connect(signers[5]).approve.staticCall(id),/approval/);
 await assert.rejects(()=>council.replaceOwner.staticCall(addresses[5],addresses[8]),/self only/);
});
