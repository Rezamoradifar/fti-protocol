// TEST ONLY: synthetic paid-rank fixtures for isolated quota/auto/monthly feature tests.
// This is not economic qualification evidence. paid-points-binary.test.mjs exercises
// canonical unmodified BinaryPlan through 20 real, funded Member epochs.
// Nothing in this module is included in production compilation or deployments.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import solc from 'solc';
import {ContractFactory} from 'ethers';
import {deployOne} from '../../scripts/lib.mjs';

const source=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {BinaryPlan} from './BinaryPlan.sol';
contract TEST_ONLY_PaidRankFeatureBinary is BinaryPlan {
 address private immutable TEST_ONLY_controller;
 constructor(address stable,address token,address gov,address emergency,address dev,address[31] memory genesis)
  BinaryPlan(stable,token,gov,emergency,dev,genesis) {TEST_ONLY_controller=msg.sender;}
 function TEST_ONLY_setPaidRank(address who,uint8 rank) external {
  require(msg.sender==TEST_ONLY_controller&&members[who].exists&&rank>0&&rank<=4,'test rank fixture');
  require(rank>=members[who].rank,'monotone fixture');
  uint256[4] memory thresholds=[uint256(100),200,500,1000];
  if(cumulativePaidRankPoints[who]<thresholds[rank-1])cumulativePaidRankPoints[who]=thresholds[rank-1];
  for(uint256 r=members[who].rank;r<rank;r++)rankReachedAt[who][r]=uint64(block.timestamp);
  members[who].rank=rank;
 }
}`;
let cached;
function fixtureArtifact(){
 if(cached)return cached;
 const sources=Object.fromEntries(fs.readdirSync('contracts').filter(n=>n.endsWith('.sol')).map(n=>[n,{content:fs.readFileSync(path.join('contracts',n),'utf8')}]));
 sources['TEST_ONLY_PaidRankFeatureBinary.sol']={content:source};
 const key=createHash('sha256').update(solc.version()+JSON.stringify(sources)).digest('hex');
 const cache=path.join(os.tmpdir(),`fti-TEST-ONLY-paid-rank-feature-${key}.json`);
 if(fs.existsSync(cache))return cached=JSON.parse(fs.readFileSync(cache,'utf8'));
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'TEST_ONLY_PaidRankFeatureBinary.sol':{'TEST_ONLY_PaidRankFeatureBinary':['abi','evm.bytecode.object']}}}}),{import:name=>({contents:fs.readFileSync(path.join('node_modules',name),'utf8')})}));
 const errors=output.errors?.filter(e=>e.severity==='error');
 if(errors?.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
 cached=output.contracts['TEST_ONLY_PaidRankFeatureBinary.sol'].TEST_ONLY_PaidRankFeatureBinary;
 fs.writeFileSync(cache,JSON.stringify(cached));return cached;
}
export async function deployFeatureBinary(binaryContract,args,signer){
 if(binaryContract!=='BinaryPlan')return deployOne(binaryContract,args,signer);
 const a=fixtureArtifact();const c=await new ContractFactory(a.abi,'0x'+a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;
}
export async function deployPaidRankFeatureSuite(signers,{tokenContract='FTIToken',binaryContract='BinaryPlan'}={}){
 const addresses=await Promise.all(signers.map(s=>s.getAddress()));
 const usd=await deployOne('MockUSD',[],signers[0]);const council=await deployOne('Council',[addresses.slice(31,38)],signers[0]);
 const timelock=await deployOne('FTITimelock',[council.target],signers[0]);
 const token=await deployOne(tokenContract,[usd.target,timelock.target,council.target],signers[0]);
 const binary=await deployFeatureBinary(binaryContract,[usd.target,token.target,timelock.target,council.target,addresses[35],addresses.slice(0,31)],signers[0]);
 await(await token.bind(binary.target)).wait();return{usd,council,timelock,token,binary,addresses};
}
export async function seedPaidRank(binary,who,rank=1){
 if(binary.interface.hasFunction('TEST_ONLY_setPaidRank'))await(await binary.TEST_ONLY_setPaidRank(who,rank)).wait();
}
