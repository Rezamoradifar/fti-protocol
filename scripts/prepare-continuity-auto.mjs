import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Wallet,NonceManager,JsonRpcProvider,parseEther as E,formatEther} from 'ethers';
const key=raw=>{try{return new Wallet('0x'+raw.trim().replace(/^0x/i,''));}catch{throw Error('Invalid protected test-wallet key');}};
export async function prepareAuto({state,rpc,provider,sourceRevision='',funderKey,allowLocal=false}){
 if(!path.isAbsolute(state))throw Error('Absolute state directory required');
 fs.mkdirSync(state,{recursive:true,mode:0o750});
 const p=provider||new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1,batchMaxCount:1});
 try{
  const chain=(await p.getNetwork()).chainId;
  if(chain!==97n&&!(allowLocal&&chain===31337n))throw Error('Auto setup is BNB TESTNET only');
  const journal=path.join(state,'test-gas-transfers.jsonl');
  if(fs.existsSync(journal))for(const line of fs.readFileSync(journal,'utf8').split(/\r?\n/).filter(Boolean)){const entry=JSON.parse(line);let receipt=await p.getTransactionReceipt(entry.hash);if(!receipt)receipt=await p.waitForTransaction(entry.hash,1,30000);if(!receipt||receipt.status!==1)throw Error('A recorded test-gas transfer is pending or failed; no duplicate funding attempted');}
  const file=path.join(state,'auto-wallets.json');let saved;
  if(fs.existsSync(file)){saved=JSON.parse(fs.readFileSync(file));if(saved.chainId!==Number(chain))throw Error('Saved test wallets belong to another chain');}
  else{const wallets=Array.from({length:9},()=>Wallet.createRandom());saved={chainId:Number(chain),warning:'TESTNET ONLY. All signing keys remain on this server.',deployer:wallets[0].privateKey,keeper:wallets[1].privateKey,council:wallets.slice(2).map(w=>w.privateKey)};fs.writeFileSync(file,JSON.stringify(saved,null,2),{mode:0o600,flag:'wx'});}
  fs.chmodSync(file,0o600);
  const deployer=key(saved.deployer),keeper=key(saved.keeper),guardians=saved.council.map(key),wallets=[deployer,keeper,...guardians];
  if(guardians.length!==7||new Set(wallets.map(w=>w.address)).size!==9)throw Error('Expected nine distinct test wallets');
  const targets=[E('0.12'),E('0.03'),...guardians.map(()=>E('0.002'))];
  const balances=await Promise.all(wallets.map(w=>p.getBalance(w.address,'latest')));
  const missing=targets.map((target,i)=>target>balances[i]?target-balances[i]:0n);
  const remaining=missing.reduce((a,b)=>a+b,0n);let sender;
  const fees=await p.getFeeData(),gasFee=fees.maxFeePerGas??fees.gasPrice;if(!gasFee||gasFee<=0n)throw Error('Test-gas fee unavailable');
  const feeBudget=21000n*gasFee*BigInt(missing.filter(v=>v>0n).length);
  const feeOptions=fees.maxFeePerGas?{gasLimit:21000n,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas??0n}:{gasLimit:21000n,gasPrice:fees.gasPrice};
  // Only the dedicated former load-test gas wallet may be used as a fallback.
  // The CLI disables it while that test service is active; the active keeper is never read.
  if(funderKey&&remaining>0n){const f=key(funderKey).connect(p);if(wallets.some(w=>w.address===f.address))throw Error('Funder must be distinct');const balance=await p.getBalance(f.address);if(remaining+feeBudget<=E('0.2')&&balance>=remaining+E('0.05')+feeBudget)sender=new NonceManager(f);}
  // When the generated deployer was charged directly, it supplies the other gas wallets.
  if(!sender&&remaining>0n){const others=missing.slice(1).reduce((a,b)=>a+b,0n);if(balances[0]>=targets[0]+others+feeBudget)sender=new NonceManager(deployer.connect(p));}
  if(sender){const senderAddress=await sender.getAddress();for(let i=0;i<wallets.length;i++)if(missing[i]>0n&&wallets[i].address!==senderAddress){const tx=await sender.sendTransaction({to:wallets[i].address,value:missing[i],...feeOptions});fs.appendFileSync(journal,JSON.stringify({hash:tx.hash,from:senderAddress,to:wallets[i].address,value:missing[i].toString()})+'\n',{mode:0o640});const receipt=await tx.wait();if(receipt.status!==1)throw Error('Test-gas funding failed');}}
  const final=await Promise.all(wallets.map(w=>p.send('eth_getBalance',[w.address,'latest']).then(BigInt)));
  const ready=final.every((v,i)=>v>=targets[i]);
  const publicResult={ready,deployer:deployer.address,keeper:keeper.address,council:guardians.map(w=>w.address),balances:final.map(formatEther),fundingAddress:deployer.address,recommendedTBNB:'0.2'};
  fs.writeFileSync(path.join(state,'wallet-addresses.json'),JSON.stringify(publicResult,null,2),{mode:0o640});
  if(!ready)return publicResult;
  const dao={threshold:5,partners:guardians.map(w=>w.address)},daoFile=path.join(state,'dao.json');
  if(fs.existsSync(daoFile)&&JSON.stringify(JSON.parse(fs.readFileSync(daoFile)))!==JSON.stringify(dao))throw Error('Existing council configuration differs');
  fs.writeFileSync(daoFile,JSON.stringify(dao),{mode:0o640});
  const line=(k,v)=>k+'='+JSON.stringify(v)+'\n';
  const base=line('RPC_URL',rpc)+line('DEPLOYMENT_FILE',path.join(state,'deployment.json'))+line('FTI_SOURCE_REVISION',sourceRevision);
  fs.writeFileSync(path.join(state,'web.env'),base+line('WALLETCONNECT_PROJECT_ID','04efbb394027fd24f16da8bd2c1e5930')+line('PORT','3110')+line('HOST','127.0.0.1'),{mode:0o640});
  fs.writeFileSync(path.join(state,'keeper.env'),base+line('KEEPER_PRIVATE_KEY',keeper.privateKey),{mode:0o640});
  fs.writeFileSync(path.join(state,'auto-rpc.json'),JSON.stringify({rpc}),{mode:0o600});
  return publicResult;
 }finally{if(!provider)p.destroy();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const state=process.env.FTI_STATE;if(!state)throw Error('FTI_STATE required');
 let rpc=process.env.RPC_URL;
 if(!rpc){const env=fs.readFileSync('/etc/fti-v3/web.env','utf8');const line=env.split(/\r?\n/).find(l=>l.startsWith('RPC_URL='));if(!line)throw Error('RPC_URL absent from existing server configuration');try{rpc=JSON.parse(line.slice(8));}catch{rpc=line.slice(8);}}
 let funderKey;const funderFile='/root/.fti-v3-1000-funder.key';
 if(fs.existsSync(funderFile)){let inactive=false;try{const status=execFileSync('systemctl',['show','fti-v3-load-1000.service','-p','ActiveState','--value'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();inactive=['inactive','failed'].includes(status);}catch{}if(inactive){const raw=fs.readFileSync(funderFile,'utf8').trim();funderKey=raw.startsWith('"')?JSON.parse(raw):raw;}}

 const result=await prepareAuto({state,rpc,sourceRevision:process.env.FTI_SOURCE_REVISION,funderKey});
 console.log(JSON.stringify(result,null,2));
 if(!result.ready){console.log('NEEDS_TEST_GAS: send 0.2 tBNB to '+result.fundingAddress+' and rerun the SAME command. Wallets are saved and will be reused.');process.exitCode=2;}
}
