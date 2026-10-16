#!/usr/bin/env node
// Create public deployment input only. No RPC, signer, broadcast or services.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {assertSelectedMainnetCollateral,selectedMainnetCollateral} from './mainnet-collateral.mjs';
import {loadWallets} from './v3-wallets.mjs';
import {APPROVED_MAINNET_PROFILE,assertApprovedMainnetProfile} from './approved-mainnet-profile.mjs';
import {validateMainnetInput} from './prepare-mainnet.mjs';
export function createApprovedMainnetInput({deployer,usd,usdCodeHash,council}){
 const selected=selectedMainnetCollateral();usd=usd||selected.address;usdCodeHash=usdCodeHash||selected.usdCodeHash;
 if(council?.threshold!==5)throw Error('Reviewed council must retain threshold 5');
 const wallets=loadWallets('config/v3-wallets.json');
 return validateMainnetInput(assertSelectedMainnetCollateral(assertApprovedMainnetProfile({schema:'FTI_MAINNET_INPUT_V1',chainId:56,deploymentKind:'new-contracts',daoThreshold:5,
  walletProfile:APPROVED_MAINNET_PROFILE,...wallets,deployer,usd,usdCodeHash,partners:council.partners})));
}
export function main(args=process.argv.slice(2)){
 const {values:v,positionals}=parseArgs({args,strict:true,allowPositionals:true,options:Object.fromEntries([
  ...['deployer','collateral','collateral-code-hash','council-config','out'].map(k=>[k,{type:'string'}]),['help',{type:'boolean'}]])});
 if(v.help){console.log('PUBLIC INPUT ONLY: node scripts/create-mainnet-input.mjs --deployer ADDRESS [--collateral SELECTED_USDT_ADDRESS --collateral-code-hash SELECTED_HASH] --council-config REVIEWED_7_GUARDIANS.json --out NEW_INPUT.json\nSelected BNB USDT defaults are pinned; owner/development and ordered 31 positions are loaded from the pinned release, never generated. No RPC or transactions.');return;}
 if(positionals.length||!['deployer','council-config','out'].every(k=>v[k]))throw Error('Complete public inputs required; see --help');
 const input=createApprovedMainnetInput({deployer:v.deployer,usd:v.collateral,usdCodeHash:v['collateral-code-hash'],council:JSON.parse(fs.readFileSync(v['council-config'],'utf8'))});
 const out=path.resolve(v.out),root=fs.realpathSync(process.cwd()),parent=fs.realpathSync(path.dirname(out));
 if(parent===root||parent.startsWith(root+path.sep))throw Error('Write reviewed inputs outside source checkout');
 const fd=fs.openSync(out,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(input,null,2)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
 console.log(JSON.stringify({result:'FTI_PUBLIC_MAINNET_INPUT_CREATED',chainId:56,genesis:31,initialUnits:0,imports:0,submitted:false,out}));
}
if(process.argv[1]===fileURLToPath(import.meta.url))try{main()}catch{console.error('FTI_PUBLIC_INPUT_FAILED: provide reviewed public inputs and a new output outside the checkout. No transactions submitted.');process.exitCode=1}
