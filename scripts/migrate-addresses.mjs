#!/usr/bin/env node
// Explicit CLI for the governed testnet migration. No default write command.
import fs from 'node:fs';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,Wallet} from 'ethers';
import {loadMigrationBuild,prepareMigrationDeployment,inspectMigration,exportOperatorManifest,exportMigrationInventory,
  prepareGovernanceAction,copyMigrationPages,executeMigrationAction,sendBudgeted,validateOperatorManifest} from './address-migration-operator.mjs';
import {verifyAddressMigration} from './verify-address-migration.mjs';
import {writePrivateJSON} from './address-migration-manifest.mjs';
import {createBudget,readPrivateKey,requireSendConsent} from './address-migration-policy.mjs';

const help=`FTI governed NEW-ADDRESS migration (97/31337 only)
Read/prepare:
  node scripts/migrate-addresses.mjs preflight --config SOURCE.json --out NEW.json
  node scripts/migrate-addresses.mjs deploy --config SOURCE.json --out DEPLOY_PLAN.json
  node scripts/migrate-addresses.mjs status --config SOURCE.json --record COORDINATOR.json --out STATUS.json
  node scripts/migrate-addresses.mjs plan --action freeze|arm|configure|commit|abort|reopen --config SOURCE.json --record COORDINATOR.json [--manifest MANIFEST.json] --out NEW_PLAN.json
  node scripts/migrate-addresses.mjs export --config SOURCE.json --record COORDINATOR.json --out MANIFEST.json
  node scripts/migrate-addresses.mjs verify --config SOURCE.json --record COORDINATOR.json --manifest MANIFEST.json --out REPORT.json
Writes are opt-in:
  deploy --send --expected-chain 97 --confirm SOURCE_BINARY ...
  copy --send --expected-chain 97 --confirm COORDINATOR --manifest MANIFEST.json ...
  execute --send --expected-chain 97 --confirm COORDINATOR --action ACTION --operation REVIEWED_OPERATION ...
Every write also requires --key-file PRIVATE_0600_FILE --max-fee-wei INTEGER --max-gas-price-wei INTEGER --journal NEW_LOG.jsonl --out NEW_RESULT.json.
Optional: --max-pages 100 --max-gas 12000000 --max-transactions 100 --confirmations 2 --salt BYTES32.
RPC is read from FTI_MIGRATION_RPC_URL. The original saved deployment JSON is required.
Plans are UNSIGNED council proposals. No council votes, timelock shortcuts, service changes or mainnet.
The out/journal paths must not exist. Resume COPY using the same manifest and a new log/result path.
`;
export async function main(args=process.argv.slice(2)) {
  const {values:v,positionals}=parseArgs({args,allowPositionals:true,strict:true,options:Object.fromEntries([
    ...['config','record','manifest','out','action','operation','salt','key-file','expected-chain','confirm','max-fee-wei','max-gas-price-wei','max-gas','max-transactions','max-pages','confirmations','journal'].map(n=>[n,{type:'string'}]),
    ['send',{type:'boolean'}],['help',{type:'boolean'}]])});
  if(v.help){console.log(help);return;}
  const command=positionals[0];
  if(positionals.length!==1||!['preflight','deploy','status','plan','export','copy','execute','verify'].includes(command))throw Error('Choose a supported command; use --help');
  if(!v.config||!v.out)throw Error('--config and a new --out file are required');
  const writes=['deploy','copy','execute'].includes(command)&&v.send;
  if(v.send&&!writes)throw Error('This command cannot send transactions');
  if(['copy','execute'].includes(command)&&!writes)throw Error('Write command requires --send');
  // Reserve output before doing any mutation; refuse symlinks/existing reports.
  const output=fs.openSync(v.out,'wx',0o600);
  let provider,journal,lock,lockPath;
  try {
    const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
    const cfg=read(v.config),build=loadMigrationBuild();
    const rpc=process.env.FTI_MIGRATION_RPC_URL;if(!rpc)throw Error('FTI_MIGRATION_RPC_URL required');
    provider=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1});
    const record=v.record?read(v.record):null,manifest=v.manifest?read(v.manifest):undefined;
    const ctx=['preflight','deploy'].includes(command)?await prepareMigrationDeployment({provider,cfg,build}):
      await inspectMigration({provider,cfg,build,record});
    let signer,budget;
    const onEvent=async event=>{if(journal!==undefined){fs.writeSync(journal,JSON.stringify({time:new Date().toISOString(),...event})+'\n');fs.fsyncSync(journal);}};
    const confirmations=v.confirmations===undefined?2:Number(v.confirmations);
    if(writes) {
      const confirmation=command==='deploy'?cfg.binary:record.address;
      requireSendConsent({chainId:cfg.chainId,expectedChain:v['expected-chain'],coordinator:confirmation,expectedCoordinator:v.confirm});
      if(!v['key-file']||!v.journal)throw Error('Private key file and new journal required');
      budget=createBudget({maxFeeWei:v['max-fee-wei'],maxGasPriceWei:v['max-gas-price-wei'],maxGas:v['max-gas']??12000000,maxTransactions:Number(v['max-transactions']??100)});
      // Serialize this coordinator's local operator invocations, even with different journals.
      lockPath=(v.record??v.config)+'.migration.lock';lock=fs.openSync(lockPath,'wx',0o600);
      fs.writeSync(lock,JSON.stringify({pid:process.pid,command})+'\n');
      journal=fs.openSync(v.journal,'wx',0o600);
      signer=new Wallet(readPrivateKey(v['key-file']),provider);
    } else if(v['key-file'])throw Error('Read-only commands must not load a signing key');
    let result;
    if(command==='preflight')result={result:'SOURCE_PREFLIGHT_PASS',chainId:String(cfg.chainId),sources:[cfg.binary,cfg.token],fundsMoved:false};
    if(command==='deploy') {
      if(!writes)result={schema:'FTI_MIGRATION_DEPLOY_PLAN_V1',chainId:String(cfg.chainId),transaction:ctx.transaction,args:ctx.args,fundsMoved:false};
      else {
        const receipt=await sendBudgeted({ctx,signer,budget,transaction:ctx.transaction,onEvent,confirmations});
        result={schema:'FTI_MIGRATION_COORDINATOR_RECORD_V1',address:receipt.contractAddress,transactionHash:receipt.hash,blockNumber:receipt.blockNumber,chainId:String(cfg.chainId),fundsMoved:false};
        await inspectMigration({provider,cfg,build,record:result});
      }
    }
    if(command==='status')result={result:'MIGRATION_STATUS',phase:String(await ctx.c.phase()),source:[cfg.binary,cfg.token],destination:ctx.targets,coordinator:record.address};
    if(command==='plan')result=await prepareGovernanceAction(ctx,v.action,manifest,v.salt);
    if(command==='export')result=await exportOperatorManifest(ctx);
    if(command==='copy')result=await copyMigrationPages({ctx,manifest,signer,budget,expectedChain:v['expected-chain'],expectedCoordinator:v.confirm,maxPages:Number(v['max-pages']??100),onEvent,confirmations});
    if(command==='execute') {
      const receipt=await executeMigrationAction({ctx,action:v.action,manifest,salt:v.salt,operation:v.operation,signer,budget,expectedChain:v['expected-chain'],expectedCoordinator:v.confirm,onEvent,confirmations});
      result={result:'GOVERNED_OPERATION_EXECUTED',action:v.action,transactionHash:receipt.hash,blockNumber:receipt.blockNumber,coordinator:record.address,
        warning:'Execution receipt only. Commit remains frozen; verify separately before proposing reopen.'};
    }
    if(command==='verify') {
      if(!manifest)throw Error('--manifest required');
      validateOperatorManifest(manifest,cfg,record,build);
      const after=await exportMigrationInventory(ctx,true);
      result={...await verifyAddressMigration({provider,manifest,after,layouts:build.layouts}),after};
    }
    const text=JSON.stringify(result,(_,x)=>typeof x==='bigint'?String(x):x,2)+'\n';fs.writeSync(output,text);fs.fsyncSync(output);
    console.log(JSON.stringify({result:result.result??result.schema,output:v.out}));
  } catch(error) {
    // Never serialize provider errors: they may contain credential-bearing RPC URLs.
    fs.writeSync(output,JSON.stringify({result:'FAILED',command,note:'Review the private transaction journal. Do not retry pending transactions blindly.'})+'\n');
    throw error;
  } finally {
    fs.closeSync(output);if(journal!==undefined)fs.closeSync(journal);
    if(lock!==undefined){fs.closeSync(lock);fs.unlinkSync(lockPath);}
    provider?.destroy();
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{
  // Only operator-owned errors are displayed; remote nested objects are omitted.
  const text=error?.code?'RPC, filesystem or signing failure ('+String(error.code)+'). Inspect configuration and private journal.':error?.message??'Migration command failed';
  console.error(String(text).replace(/https?:\/\/[^\s"'<>]+/g,'[RPC URL redacted]').slice(0,500));process.exitCode=1;
});
