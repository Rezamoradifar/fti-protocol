import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import ganache from 'ganache';
import solc from 'solc';
import {BrowserProvider,Contract,ContractFactory,keccak256,AbiCoder} from 'ethers';
import {artifact,checkAccounting} from '../scripts/lib.mjs';
import {validateMainnetInput,prepareMainnet} from '../scripts/prepare-mainnet.mjs';
import {freshDigest} from '../scripts/fresh-testnet.mjs';

const address=n=>'0x'+n.toString(16).padStart(40,'0');
const valid=()=>({schema:'FTI_MAINNET_INPUT_V1',chainId:56,deploymentKind:'new-contracts',daoThreshold:5,
 deployer:address(101),development:address(102),usd:address(103),usdCodeHash:'0x'+'a'.repeat(64),
 partners:Array.from({length:7},(_,i)=>address(200+i)),genesis:Array.from({length:31},(_,i)=>address(300+i))});
test('mainnet planning requires explicit public inputs; cannot reuse testnet defaults or import users',()=>{
 assert.equal(validateMainnetInput(valid()).chainId,56);
 for(const change of [
  x=>{x.chainId=97;},x=>{x.chainId='56';},x=>{x.deploymentKind='migration';},x=>{x.daoThreshold=7;},
  x=>{x.partners.pop();},x=>{x.partners[0]=x.partners[1];},x=>{x.genesis.pop();},x=>{x.genesis[0]=x.genesis[1];},
  x=>{x.deployer=address(0);},x=>{x.development='';},x=>{x.usd=x.genesis[0];},x=>{delete x.usdCodeHash;}
 ]){const input=valid();change(input);assert.throws(()=>validateMainnetInput(input));}
 const help=spawnSync(process.execPath,['scripts/prepare-mainnet.mjs','--help'],{encoding:'utf8'});
 assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/READ ONLY/);
 for(const args of [['deploy'],['--send'],['--key-file','must-not-be-read.key']]){
  assert.notEqual(spawnSync(process.execPath,['scripts/prepare-mainnet.mjs',...args],{encoding:'utf8'}).status,0);
 }
});
test('unsigned chain-56 plan makes no writes and its exact payloads deploy the approved contract model on a local EVM',{timeout:180000},async()=>{
 // Chain ID 56 is simulated locally; this test never connects to BNB mainnet.
 const engine=ganache.provider({chain:{chainId:56},logging:{quiet:true},wallet:{totalAccounts:40},miner:{blockGasLimit:30000000}});
 const provider=new BrowserProvider(engine,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 try{
  const w=await Promise.all(Array.from({length:40},(_,i)=>provider.getSigner(i))),a=await Promise.all(w.map(x=>x.getAddress()));
  // MockUSD intentionally refuses chain 56. Keep that guard intact and compile
  // a local-only fixture here; this artifact never enters production artifacts.
  const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'LocalCollateral.sol':{content:
   'pragma solidity 0.8.30; import "@openzeppelin/contracts/token/ERC20/ERC20.sol"; contract LocalCollateral is ERC20 { constructor() ERC20("Local test collateral", "LOCAL") {} }'}},
   settings:{evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),
   {import:file=>({contents:fs.readFileSync('node_modules/'+file,'utf8')})}));
  assert(!compiled.errors?.some(e=>e.severity==='error'));
  const usdArtifact=compiled.contracts['LocalCollateral.sol'].LocalCollateral;
  const usd=await new ContractFactory(usdArtifact.abi,'0x'+usdArtifact.evm.bytecode.object,w[39]).deploy();await usd.waitForDeployment();
  const input={...valid(),deployer:a[38],development:a[39],usd:usd.target,usdCodeHash:keccak256(await provider.getCode(usd.target)),partners:a.slice(31,38),genesis:a.slice(0,31)};
  const nonce=await provider.getTransactionCount(a[38]),balance=await provider.getBalance(a[38]);
  const plan=await prepareMainnet({provider,input});
  assert.equal(plan.transactions.length,7);assert.equal(plan.readyToBroadcast,false);
  assert.equal(plan.initialState.importedFunds,'0');assert.equal(plan.initialState.importedUsers,0);
  assert.deepEqual(plan.input.genesis,input.genesis);assert(!JSON.stringify(plan).includes('privateKey'));
  assert(!plan.transactions.some(x=>x.name==='usd'));assert.equal(await provider.getTransactionCount(a[38]),nonce);
  assert.equal(await provider.getBalance(a[38]),balance);
  const {digest,...body}=plan;assert.equal(digest,freshDigest(body));
  for(const address of Object.values(plan.addresses))assert.equal(await provider.getCode(address),'0x');
  await assert.rejects(()=>prepareMainnet({provider,input:{...input,usdCodeHash:'0x'+'f'.repeat(64)}}),/Collateral runtime hash mismatch/);
  await assert.rejects(()=>prepareMainnet({provider:{getNetwork:async()=>({chainId:97n})},input}),/not BNB mainnet/);
  const overrides={call:async()=>AbiCoder.defaultAbiCoder().encode(['uint8'],[6])};
  const wrongDecimals=new Proxy(provider,{get:(target,key)=>key in overrides?overrides[key]:typeof target[key]==='function'?target[key].bind(target):target[key]});
  await assert.rejects(()=>prepareMainnet({provider:wrongDecimals,input}),/18 decimals/);
  const pending=new Proxy(provider,{get:(target,key)=>key==='getTransactionCount'?async(address,tag)=>tag==='pending'?nonce+1:nonce:typeof target[key]==='function'?target[key].bind(target):target[key]});
  await assert.rejects(()=>prepareMainnet({provider:pending,input}),/pending deployer/);
  // ONLY this local test explicitly submits the generated payloads, with local signers.
  for(const step of plan.transactions){
   assert.equal(step.dataHash,keccak256(step.data));
   const tx={chainId:step.chainId,nonce:step.nonce,value:0n,data:step.data,...(step.to?{to:step.to}:{})};
   const receipt=await(await w[38].sendTransaction(tx)).wait();assert.equal(receipt.status,1);
   if(!step.to)assert.equal(receipt.contractAddress,plan.addresses[step.name]);
  }
  const contract=(key,name)=>new Contract(plan.addresses[key],artifact(name).abi,provider);
  const binary=contract('binary','FundedBinaryPlanUpgradeable'),token=contract('token','FTIReserveTokenUpgradeable');
  const council=contract('council','SevenGuardianCouncil'),timelock=contract('timelock','FTITimelock');
  assert.equal(await binary.usd(),usd.target);assert.equal(await token.usd(),usd.target);
  assert.equal(await binary.token(),token.target);assert.equal(await token.binary(),binary.target);
  assert.equal(await binary.development(),a[39]);assert.equal(await token.development(),a[39]);
  assert.equal(await binary.governance(),timelock.target);assert.equal(await token.governance(),timelock.target);
  assert.equal(await council.THRESHOLD(),5n);assert.equal(await timelock.getMinDelay(),259200n);
  for(let i=0;i<7;i++)assert.equal(await council.guardians(i),input.partners[i]);
  assert.equal(await binary.memberCount(),31n);assert.equal(await binary.hourlyCapFlushVersion(),1n);
  for(const wallet of input.genesis)assert.equal((await binary.members(wallet)).units,0n);
  assert.equal(await token.totalSupply(),0n);assert.equal(await token.reserve(),0n);assert.equal(await token.supportReserve(),0n);
  await checkAccounting({binary,token});
  console.log('FTI_MAINNET_PAYLOAD_LOCAL_TEST_PASS',JSON.stringify({scope:'LOCAL_EVM_WITH_CHAIN_ID_56_NOT_MAINNET',transactions:7,existingCollateral:true,generatedKeys:0,importedUsers:0}));
 }finally{await engine.disconnect();}
});
