// Operational migration code. No auto-voting, mainnet, service switching or owner sweep.
import fs from 'node:fs';
import path from 'node:path';
import {AbiCoder,Contract,ContractFactory,Interface,ZeroHash,keccak256,id} from 'ethers';
import {collectInventory} from './migration-inventory.mjs';
import {completeExport} from './migration-complete-export.mjs';
import {checkedLayout,layoutDigest,bindingField,buildAddressMigrationManifest,migrationDomain,buildPages,IMPLEMENTATION_SLOT} from './address-migration-manifest.mjs';
import {verifyStagedMigration,verifyAddressMigration} from './verify-address-migration.mjs';
import {requireSourceConfig,requireAddress,requireHash,requireSendConsent,pageIndex,uint} from './address-migration-policy.mjs';

const components=['binary','token'];
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const json=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x);
const check=(condition,message)=>{if(!condition)throw Error(message);};
const implementation=raw=>{check(/^0x[\da-f]{64}$/i.test(raw),'Missing implementation');return '0x'+raw.slice(-40);};
const CABI=['function sources(uint256) view returns(address)','function targets(uint256) view returns(address)',
 'function originalLogic(uint256) view returns(address)','function sourceAdapters(uint256) view returns(address)',
 'function targetAdapters(uint256) view returns(address)','function phase() view returns(uint256)',
 'function governance() view returns(address)','function council() view returns(address)','function collateral() view returns(address)',
 'function reviewedManifest() view returns(bytes32)','function minimumCollateral(uint256) view returns(uint256)',
 'function configure(bytes32[2],uint256[2],bytes32,uint256,bytes32)','function commit(bytes32)','function abort()'];
const TABI=['function progress() view returns(uint256 copied,uint256 slots,uint256 indexedHolders,uint256 holders)',
 'function importPage(bytes32[],bytes32[])','function indexHolderPage(address[],bytes32[])'];
const SABI=['function arm()','function migrationPhase() view returns(uint256)','function migrationCoordinator() view returns(address)'];
const TLABI=['function getMinDelay() view returns(uint256)','function PROPOSER_ROLE() view returns(bytes32)',
 'function hasRole(bytes32,address) view returns(bool)','function hashOperationBatch(address[],uint256[],bytes[],bytes32,bytes32) view returns(bytes32)',
 'function isOperationReady(bytes32) view returns(bool)','function scheduleBatch(address[],uint256[],bytes[],bytes32,bytes32,uint256)',
 'function executeBatch(address[],uint256[],bytes[],bytes32,bytes32)'];
const COUNCIL=['function THRESHOLD() view returns(uint256)','function guardians(uint256) view returns(address)','function propose(address,bytes)'];
const UABI=['function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)'];
const APP=['function recoveryFrozen() view returns(bool)','function setRecoveryFrozen(bool)','function upgradeToAndCall(address,bytes)',
 'function governance() view returns(address)','function usd() view returns(address)','function token() view returns(address)',
 'function binary() view returns(address)','function guardian() view returns(address)','function guardianCouncil() view returns(address)',
 'function phase() view returns(uint256)','function monthPhase() view returns(uint256)','function jobCursor() view returns(uint256)',
 'function jobCount() view returns(uint256)','function emergencyUnwind() view returns(bool)','function accounting() view returns(uint256,uint256)'];

export function loadMigrationBuild(root=process.cwd()) {
  const artifact=n=>JSON.parse(fs.readFileSync(path.join(root,'artifacts',n+'.json'),'utf8'));
  const models=['FundedBinaryPlanUpgradeable','FTIReserveTokenUpgradeable'];
  const layouts=models.map(n=>checkedLayout(n,
    JSON.parse(fs.readFileSync(path.join(root,'artifacts/storage-layout',n+'.json'),'utf8')),
    JSON.parse(fs.readFileSync(path.join(root,'docs/storage-layout',n+'.json'),'utf8'))));
  return {layouts,apps:models.map(artifact),migration:artifact('FTIAddressMigration')};
}
// Use the ORIGINAL saved deployment configuration, never manufacture missing hashes.
export async function inspectSources({provider,cfg,build}) {
  requireSourceConfig(cfg);
  check((await provider.getNetwork()).chainId===BigInt(cfg.chainId),'Source network mismatch');
  for(const key of ['binary','token','usd','council','timelock']) {
    const code=await provider.getCode(cfg[key]);check(code!=='0x'&&same(keccak256(code),cfg.codeHashes[key]),'Source code mismatch: '+key);
  }
  for(const key of components) {
    const code=await provider.getCode(cfg[key+'Implementation']);
    check(code!=='0x'&&same(keccak256(code),cfg.implementationCodeHashes[key]),'Original logic mismatch: '+key);
    const u=new Contract(cfg[key+'Implementation'],['function COMPONENT_ID() view returns(bytes32)','function proxiableUUID() view returns(bytes32)'],provider);
    check(await u.COMPONENT_ID()===id(key==='binary'?'FTI_BINARY_CONTINUITY_V1':'FTI_TOKEN_CONTINUITY_V1')&&await u.proxiableUUID()===IMPLEMENTATION_SLOT,'Wrong UUPS component');
  }
  check(build.layouts.length===2&&build.apps.length===2,'Reviewed build required');
  const timelock=new Contract(cfg.timelock,TLABI,provider),council=new Contract(cfg.council,COUNCIL,provider),usd=new Contract(cfg.usd,UABI,provider);
  check(await timelock.getMinDelay()===259200n&&await council.THRESHOLD()===5n,'Governance must remain 5-of-7 / 72 hours');
  check(await timelock.hasRole(await timelock.PROPOSER_ROLE(),cfg.council),'Council proposer missing');
  for(let i=0;i<7;i++)check(same(await council.guardians(i),cfg.daoPartners[i]),'Guardian changed');
  check(await usd.decimals()===18n,'Collateral decimals mismatch');
  return {provider,cfg,build,timelock,council,usd};
}
export async function prepareMigrationDeployment(options) {
  const ctx=await inspectSources(options),{provider,cfg,build}=ctx;
  for(const [kind,key] of components.entries()) {
    check(same(implementation(await provider.getStorage(cfg[key],IMPLEMENTATION_SLOT)),cfg[key+'Implementation']),'Source is not original logic');
    const app=new Contract(cfg[key],APP,provider);
    check(same(await app.governance(),cfg.timelock)&&same(await app.usd(),cfg.usd),'Source roles/assets changed');
    check(same(await app[kind===0?'token':'binary'](),cfg[components[1-kind]]),'Source binding changed');
    check(same(await app[kind===0?'guardian':'guardianCouncil'](),cfg.council),'Source council changed');
    check(await provider.getBalance(cfg[key])===0n,'Native source assets need separate custody');
  }
  const token=new Contract(cfg.token,UABI,provider);
  for(const key of components)check(await token.balanceOf(cfg[key])===0n,'Source-owned FTI needs explicit custody');
  const fields=build.layouts.map((l,i)=>bindingField(l,i));
  const args=[components.map(k=>cfg[k]),components.map(k=>cfg[k+'Implementation']),build.layouts.map(layoutDigest),fields.map(f=>f.slot),fields.map(f=>f.offset)];
  const creation=await new ContractFactory(build.migration.abi,build.migration.bytecode).getDeployTransaction(...args);
  return {...ctx,args,transaction:{data:creation.data,value:0n}};
}
export async function inspectMigration({provider,cfg,build,record}) {
  const ctx=await inspectSources({provider,cfg,build});
  requireAddress(record?.address,'coordinator');requireHash(record?.transactionHash,'creation transaction');
  const tx=await provider.getTransaction(record.transactionHash),receipt=await provider.getTransactionReceipt(record.transactionHash);
  check(receipt?.status===1&&same(receipt.contractAddress,record.address)&&tx?.to===null,'Unverified coordinator creation');
  check(tx.chainId===BigInt(cfg.chainId),'Coordinator creation network mismatch');
  const fields=build.layouts.map((l,i)=>bindingField(l,i));
  const args=[components.map(k=>cfg[k]),components.map(k=>cfg[k+'Implementation']),build.layouts.map(layoutDigest),fields.map(f=>f.slot),fields.map(f=>f.offset)];
  const expected=await new ContractFactory(build.migration.abi,build.migration.bytecode).getDeployTransaction(...args);
  check(same(tx.data,expected.data),'Coordinator creation code/arguments mismatch');
  const block=await provider.getBlock(receipt.blockNumber);check(block&&same(block.hash,receipt.blockHash),'Coordinator creation reorganized');
  const c=new Contract(record.address,CABI,provider),phase=await c.phase();
  check(same(await c.governance(),cfg.timelock)&&same(await c.council(),cfg.council)&&same(await c.collateral(),cfg.usd),'Coordinator authority mismatch');
  const targets=[],sourceAdapters=[];
  for(const [i,key] of components.entries()) {
    check(same(await c.sources(i),cfg[key])&&same(await c.originalLogic(i),cfg[key+'Implementation']),'Coordinator source/logic mismatch');
    const target=await c.targets(i),sourceAdapter=await c.sourceAdapters(i),targetAdapter=await c.targetAdapters(i);
    targets.push(target);sourceAdapters.push(sourceAdapter);
    const srcImpl=implementation(await provider.getStorage(cfg[key],IMPLEMENTATION_SLOT));
    const dstImpl=implementation(await provider.getStorage(target,IMPLEMENTATION_SLOT));
    check(same(srcImpl,sourceAdapter)||(phase===0n||phase===3n)&&same(srcImpl,cfg[key+'Implementation']),'Unexpected source implementation');
    check(same(dstImpl,phase===2n?cfg[key+'Implementation']:targetAdapter),'Unexpected target implementation');
  }
  return {...ctx,record,c,phase,targets,sourceAdapters};
}
export function validateOperatorManifest(manifest,cfg,record,build) {
  check(manifest?.schema==='FTI_ADDRESS_MIGRATION_MANIFEST_V1','Wrong manifest schema');
  const {digest,...body}=manifest;
  check(requireHash(digest)===keccak256(Buffer.from(json(body))),'Manifest digest mismatch');
  check(String(manifest.chainId)===String(cfg.chainId)&&same(manifest.coordinator,record.address),'Manifest network/coordinator mismatch');
  check(manifest.components?.length===2&&manifest.sourceInventory?.schema==='FTI_COMPLETE_EXPORT_V1'&&!manifest.sourceInventory.approximate,'Incomplete inventory');
  check(Number.isSafeInteger(manifest.snapshot?.number)&&manifest.snapshot.number>=cfg.deployedBlock,'Invalid snapshot block');
  requireHash(manifest.snapshot.hash,'snapshot hash');
  check(json(manifest.snapshot)===json(manifest.sourceInventory.block),'Snapshot inventory mismatch');
  check(String(manifest.sourceInventory.chainId)===String(cfg.chainId),'Inventory chain mismatch');
  for(const key of ['binary','token','usd'])check(same(manifest.sourceInventory.contracts?.[key],cfg[key]),'Inventory source mismatch');
  for(const [i,part]of manifest.components.entries()) {
    check(part.kind===i&&String(part.chainId)===String(cfg.chainId)&&same(part.coordinator,record.address)&&same(part.source,cfg[components[i]]),'Component identity mismatch');
    requireAddress(part.target,'target');
    check(same(part.codeHash,cfg.implementationCodeHashes[components[i]])&&part.layoutHash===layoutDigest(build.layouts[i]),'Manifest code/layout mismatch');
    const domain=migrationDomain(part);check(domain===part.domain,'Manifest domain mismatch');
    for(const kind of i===1?[0,1]:[0]) {
      const tree=kind===0?part.storage:part.holders;
      const count=uint(tree?.count,'page count');check(count>0n&&count<=2000000n&&Array.isArray(tree.pages),'Invalid page inventory');
      const rows=[];let last=-1n;
      for(const [index,page]of tree.pages.entries()) {
        check(page.index===index&&page.keys?.length===page.values?.length&&page.keys.length===Number(count-BigInt(rows.length)>64n?64n:count-BigInt(rows.length)),'Bad page length/order');
        for(let j=0;j<page.keys.length;j++) {
          const key=page.keys[j];if(kind===1)requireAddress(key,'holder');else check(/^0x[\da-f]{64}$/i.test(key),'Invalid storage key');
          check(BigInt(key)>last,'Duplicate/unsorted page key');last=BigInt(key);
          if(kind===0){check(/^0x[\da-f]{64}$/i.test(page.values[j])&&BigInt(page.values[j])>0n,'Invalid storage value');rows.push({key,value:page.values[j]});}
          else rows.push({wallet:key,balance:uint(page.values[j],'holder balance')});
        }
      }
      check(BigInt(rows.length)===count,'Incomplete page inventory');
      const rebuilt=buildPages(rows,domain,kind);check(json(tree)===json(rebuilt),'Merkle root/proof/page mismatch');
    }
  }
  return manifest;
}
export async function exportMigrationInventory(ctx,destination=false) {
  const {provider,cfg,build}=ctx;
  const blockTag=await provider.getBlockNumber(),addresses=destination?ctx.targets:components.map(k=>cfg[k]);
  const [binary,token]=addresses.map((a,i)=>new Contract(a,build.apps[i].abi,provider));
  // Destination proxy bytecode is checked through coordinator provenance, not old addresses.
  const exportCfg={binaryContract:cfg.binaryContract,tokenContract:cfg.tokenContract,deployedBlock:cfg.deployedBlock,binaryStorageLayout:build.layouts[0]};
  const report=await collectInventory({provider,binary,token,usd:ctx.usd,cfg:exportCfg,blockTag});
  return completeExport(report,{provider,binary,token,cfg:exportCfg});
}
export async function exportOperatorManifest(ctx) {
  check(await ctx.c.phase()===0n,'Export before configure only');
  const inventory=await exportMigrationInventory(ctx);
  return buildAddressMigrationManifest({provider:ctx.provider,coordinator:ctx.record.address,inventory,layouts:ctx.build.layouts});
}
async function checkCurrentManifest(ctx,manifest,phase) {
  validateOperatorManifest(manifest,ctx.cfg,ctx.record,ctx.build);
  const block=await ctx.provider.getBlock(manifest.snapshot.number);check(block&&same(block.hash,manifest.snapshot.hash),'Source snapshot reorganized');
  check(await ctx.c.phase()===BigInt(phase),'Unexpected migration phase');
  for(let i=0;i<2;i++)check(same(manifest.components[i].target,ctx.targets[i]),'Wrong manifest target');
  if(phase>0)check(await ctx.c.reviewedManifest()===manifest.digest,'Manifest not council-approved');
}
export async function prepareGovernanceAction(ctx,action,manifest,salt) {
  const {cfg,c,provider,timelock}=ctx;
  const app=new Interface(APP);let targets,payloads;
  if(action==='freeze') {
    check(await c.phase()===0n,'Cannot freeze at this stage');
    const b=new Contract(cfg.binary,APP,provider);
    check(await b.phase()===0n&&await b.monthPhase()===0n&&await b.jobCursor()===await b.jobCount(),'Drain settlement/volume before freeze');
    targets=components.map(k=>cfg[k]);payloads=targets.map(()=>app.encodeFunctionData('setRecoveryFrozen',[true]));
  } else if(action==='arm') {
    check(await c.phase()===0n,'Already configured');
    for(const [i,key]of components.entries()) {
      check(same(implementation(await provider.getStorage(cfg[key],IMPLEMENTATION_SLOT)),cfg[key+'Implementation']),'Source already armed');
      const a=new Contract(cfg[key],APP,provider);check(await a.recoveryFrozen(),'Freeze both sources first');
      const [actual,book]=await a.accounting();check(actual>=book,'Unbacked source');
      if(i===0)check(await a.phase()===0n&&await a.monthPhase()===0n&&await a.jobCursor()===await a.jobCount(),'Drain settlement/volume before arming');
      else check(!await a.emergencyUnwind(),'Emergency source unsupported');
    }
    targets=components.map(k=>cfg[k]);const arm=new Interface(SABI).encodeFunctionData('arm');
    payloads=ctx.sourceAdapters.map(a=>app.encodeFunctionData('upgradeToAndCall',[a,arm]));
  } else if(action==='configure') {
    await checkCurrentManifest(ctx,manifest,0);
    for(const key of components)check(await new Contract(cfg[key],SABI,provider).migrationPhase()===1n,'Both sources must be armed');
    targets=[c.target];payloads=[c.interface.encodeFunctionData('configure',[manifest.components.map(p=>p.storage.root),manifest.components.map(p=>p.storage.count),manifest.components[1].holders.root,manifest.components[1].holders.count,manifest.digest])];
  } else if(action==='commit') {
    await checkCurrentManifest(ctx,manifest,1);await verifyStagedMigration({provider,manifest});
    targets=[c.target];payloads=[c.interface.encodeFunctionData('commit',[manifest.digest])];
  } else if(action==='abort') {
    check((await c.phase())<2n,'Cannot abort a committed/aborted migration');
    targets=[c.target];payloads=[c.interface.encodeFunctionData('abort')];
  } else if(action==='reopen') {
    await checkCurrentManifest(ctx,manifest,2);
    const after=await exportMigrationInventory(ctx,true);
    await verifyAddressMigration({provider,manifest,after,layouts:ctx.build.layouts});
    targets=[ctx.targets[1],ctx.targets[0]];payloads=targets.map(()=>app.encodeFunctionData('setRecoveryFrozen',[false]));
  } else throw Error('Unsupported governance action');
  const values=targets.map(()=>0),predecessor=ZeroHash;
  salt=salt??id('FTI_OPERATOR_V1:'+ctx.record.address.toLowerCase()+':'+action+':'+(manifest?.digest??''));requireHash(salt,'operation salt');
  const delay=await timelock.getMinDelay();check(delay===259200n,'Unexpected governance delay');
  const operation=await timelock.hashOperationBatch(targets,values,payloads,predecessor,salt);
  const schedule=timelock.interface.encodeFunctionData('scheduleBatch',[targets,values,payloads,predecessor,salt,delay]);
  return {schema:'FTI_MIGRATION_OPERATION_V1',chainId:String(cfg.chainId),coordinator:ctx.record.address,action,operation,salt,targets,values,payloads,predecessor,delay:String(delay),
    councilProposal:{to:cfg.council,value:'0',data:new Interface(COUNCIL).encodeFunctionData('propose',[cfg.timelock,schedule])},
    execution:{to:cfg.timelock,value:'0',data:timelock.interface.encodeFunctionData('executeBatch',[targets,values,payloads,predecessor,salt])},
    fundsMoved:false,warning:'Unsigned. Five council approvals and timelock scheduling/execution remain required. Reopen is separate from commit.'};
}
// A single explicit invocation has a conservative fee budget. No automatic resubmission.
export async function sendBudgeted({ctx,signer,budget,transaction,onEvent=async()=>{},confirmations=1}) {
  check(['97','31337'].includes(String(ctx.cfg.chainId)),'Testnet/local writes only');
  check(Number.isSafeInteger(confirmations)&&confirmations>=1&&confirmations<=64,'Invalid confirmations');
  check(signer.provider&&(await signer.provider.getNetwork()).chainId===BigInt(ctx.cfg.chainId),'Signer network mismatch');
  check((await ctx.provider.getNetwork()).chainId===BigInt(ctx.cfg.chainId),'RPC network changed');
  const from=await signer.getAddress();
  check(await ctx.provider.getTransactionCount(from,'pending')===await ctx.provider.getTransactionCount(from,'latest'),'Signer has pending transactions; resolve before resume');
  const fee=await ctx.provider.getFeeData();check(fee.gasPrice!==null,'Gas price unavailable');
  const estimate=await ctx.provider.estimateGas({...transaction,from});
  const limits=budget.reserve((estimate*120n+99n)/100n+10000n,fee.gasPrice);
  await onEvent({event:'RESERVED',to:transaction.to??null,reservedWei:String(budget.reserved)});
  const tx=await signer.sendTransaction({...transaction,...limits,chainId:BigInt(ctx.cfg.chainId)});
  await onEvent({event:'SUBMITTED',hash:tx.hash});
  const receipt=await tx.wait(confirmations);check(receipt?.status===1,'Transaction not confirmed successfully');
  await onEvent({event:'CONFIRMED',hash:receipt.hash,block:receipt.blockNumber,gasUsed:String(receipt.gasUsed)});
  return receipt;
}
export async function copyMigrationPages({ctx,manifest,signer,budget,expectedChain,expectedCoordinator,maxPages=100,onEvent,confirmations=1}) {
  requireSendConsent({chainId:ctx.cfg.chainId,expectedChain,coordinator:ctx.record.address,expectedCoordinator});
  check(Number.isSafeInteger(maxPages)&&maxPages>=1&&maxPages<=1000,'Invalid max pages');
  await checkCurrentManifest(ctx,manifest,1);
  let sent=0;
  for(let i=0;i<2;i++) {
    const target=new Contract(ctx.targets[i],TABI,ctx.provider);
    for(const holder of i===1?[false,true]:[false])while(true) {
      check(await ctx.c.phase()===1n&&await ctx.c.reviewedManifest()===manifest.digest,'Migration changed during copy');
      const p=await target.progress(),tree=holder?manifest.components[i].holders:manifest.components[i].storage;
      const copied=holder?p.indexedHolders:p.copied,count=holder?p.holders:p.slots;
      check(count===BigInt(tree.count),'Approved count mismatch');
      const index=pageIndex(copied,count);if(index===null)break;
      if(sent>=maxPages)return {result:'COPY_PAUSED',sent,manifest:manifest.digest,fundsMoved:false};
      const page=tree.pages[index];check(page,'Missing resume page');
      await sendBudgeted({ctx,signer,budget,onEvent,confirmations,transaction:{to:target.target,value:0n,
        data:target.interface.encodeFunctionData(holder?'indexHolderPage':'importPage',[page.keys,page.proof])}});
      sent++;
      const next=await target.progress();check((holder?next.indexedHolders:next.copied)>=copied+BigInt(page.keys.length),'Import did not advance');
    }
  }
  const verification=await verifyStagedMigration({provider:ctx.provider,manifest});
  return {result:'COPY_COMPLETE',sent,manifest:manifest.digest,fundsMoved:false,verification};
}
export async function executeMigrationAction({ctx,action,manifest,salt,operation,signer,budget,expectedChain,expectedCoordinator,onEvent,confirmations=1}) {
  requireSendConsent({chainId:ctx.cfg.chainId,expectedChain,coordinator:ctx.record.address,expectedCoordinator});requireHash(operation,'reviewed operation');
  // Rebuild from the current verified state; never execute arbitrary file calldata.
  const plan=await prepareGovernanceAction(ctx,action,manifest,salt);
  check(same(operation,plan.operation),'Reviewed operation mismatch');
  check(await ctx.timelock.isOperationReady(plan.operation),'Timelock not ready; council approval/delay required');
  await ctx.timelock.executeBatch.staticCall(plan.targets,plan.values,plan.payloads,plan.predecessor,plan.salt);
  return sendBudgeted({ctx,signer,budget,onEvent,confirmations,transaction:{...plan.execution,value:0n}});
}
