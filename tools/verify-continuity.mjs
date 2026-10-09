import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import {AbiCoder,JsonRpcProvider,Contract,isAddress,keccak256} from 'ethers';
// Source verification only. Never signs or deploys transactions.
const deploymentPath=process.env.DEPLOYMENT_FILE||'deployments/testnet.json';
const d=fs.existsSync(deploymentPath)?JSON.parse(fs.readFileSync(deploymentPath,'utf8')):null;
if(d && d.release!=='FTI_CONTINUITY_TESTNET_20261009')throw Error('Expected continuity deployment record');
const tokenContract=d?.tokenContract||'FTIReserveTokenUpgradeable';
if(tokenContract!=='FTIReserveTokenUpgradeable')throw Error('Unknown token model');
const binaryContract=d?.binaryContract||'FundedBinaryPlanUpgradeable';
if(binaryContract!=='FundedBinaryPlanUpgradeable')throw Error('Unknown reward model');
const names=['MockUSD','SevenGuardianCouncil','FTITimelock',tokenContract,binaryContract,'FTIProxy'];
const sources=Object.fromEntries(fs.readdirSync('contracts').filter(f=>f.endsWith('.sol')).map(f=>[f,{content:fs.readFileSync('contracts/'+f,'utf8')}]));
const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}};
function check(r){const e=(r.errors||[]).filter(e=>e.severity==='error');if(e.length)throw Error(e.map(e=>e.formattedMessage).join('\n'));}
const discovered=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{outputSelection:{'*':{'*':['abi']}}}}),{import:p=>{try{const content=fs.readFileSync(path.join('node_modules',p),'utf8');sources[p]={content};return{contents:content};}catch{return{error:'Missing import '+p};}}}));check(discovered);
const input={language:'Solidity',sources,settings};
console.log('Recompiling verification input...');
const compiled=JSON.parse(solc.compile(JSON.stringify(input)));check(compiled);
const artifacts=Object.fromEntries(names.map(n=>[n,JSON.parse(fs.readFileSync(`artifacts/${n}.json`,'utf8'))]));
for(const name of names){const a=artifacts[name];if(a.compiler!==solc.version()||'0x'+compiled.contracts[a.source][name].evm.bytecode.object!==a.bytecode)throw Error('Build mismatch: '+name+'. Preserve deployment sources and artifacts.');}
const dir='artifacts/verification';fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/standard-input.json',JSON.stringify(input));
console.log('All six contract creation bytecodes match saved artifacts.');
if(process.argv.includes('--prepare'))process.exit(0);
if(!process.env.ETHERSCAN_API_KEY)throw Error('Set ETHERSCAN_API_KEY locally. No wallet private key is needed.');
if(!d)throw Error('Deployment file is required for explorer verification');
if(d.chainId!==97)throw Error('Only BNB Testnet chain 97 is supported');
for(const key of ['usd','council','timelock','token','binary','tokenImplementation','binaryImplementation'])if(!isAddress(d[key]))throw Error('Invalid address: '+key);
const provider=new JsonRpcProvider(process.env.RPC_URL||'https://bsc-testnet.bnbchain.org');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function api(action,params={},post=false){
 const url=new URL('https://api.etherscan.io/v2/api');url.search=new URLSearchParams({chainid:'97',module:'contract',action,apikey:process.env.ETHERSCAN_API_KEY,...(post?{}:params)}).toString();
 let response;try{response=await fetch(url,{...(post?{method:'POST',body:new URLSearchParams(params)}:{}),signal:AbortSignal.timeout(45000)});}catch{throw Error('Explorer request failed or timed out. No wallet transaction was sent.');}
 if(!response.ok)throw Error('Explorer HTTP '+response.status);return response.json();
}
try{
 if((await provider.getNetwork()).chainId!==97n)throw Error('RPC is not chain 97');
 for(const key of ['usd','council','timelock','token','binary','tokenImplementation','binaryImplementation']){const code=await provider.getCode(d[key]);if(code==='0x'||keccak256(code)!==d.codeHashes?.[key])throw Error('Deployed code mismatch: '+key);}
 const coder=AbiCoder.defaultAbiCoder();
 const jobs=[['MockUSD','usd'],['SevenGuardianCouncil','council'],['FTITimelock','timelock'],[tokenContract,'tokenImplementation'],[binaryContract,'binaryImplementation'],['FTIProxy','token'],['FTIProxy','binary']].map(([name,key])=>{
  const constructor=artifacts[name].abi.find(x=>x.type==='constructor');
  const types=(constructor?.inputs||[]).map(x=>x.type);
  const args=d.constructorArgs?.[key];
  if(!Array.isArray(args))throw Error('Missing saved constructor arguments: '+key);
  return [name,key,types,args];
 });
 const slot='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
 for(const key of ['token','binary']){
  const value=await provider.getStorage(d[key],slot);
  if(('0x'+value.slice(-40)).toLowerCase()!==d[key+'Implementation'].toLowerCase())throw Error('Proxy implementation mismatch: '+key);
 }
 // Check all seven creation transactions before making any explorer submission.
 for(const[name,key,types,args]of jobs){
  const tx=await provider.getTransaction(d.transactions?.[key]);
  const receipt=tx&&await provider.getTransactionReceipt(tx.hash);
  if(!tx||tx.to!==null||!receipt||receipt.status!==1||receipt.contractAddress?.toLowerCase()!==d[key].toLowerCase()||tx.data.toLowerCase()!==(artifacts[name].bytecode+coder.encode(types,args).slice(2)).toLowerCase())throw Error('Creation transaction mismatch: '+name);
 }
 console.log('All seven on-chain creation transactions match the compiled source and constructor arguments.');
 let failed=false;
 for(const[name,key,types,args]of jobs){
  const encoded=coder.encode(types,args).slice(2);fs.writeFileSync(`${dir}/${key}-constructor.txt`,encoded);
  await wait(1200);const existing=await api('getsourcecode',{address:d[key]});
  if(existing.status==='1'&&existing.result?.[0]?.SourceCode){console.log('ALREADY VERIFIED',name,d[key]);continue;}
  const r=await api('verifysourcecode',{contractaddress:d[key],sourceCode:JSON.stringify(input),codeformat:'solidity-standard-json-input',contractname:`${artifacts[name].source}:${name}`,compilerversion:'v'+solc.version().split('.Emscripten')[0],optimizationUsed:'1',runs:'200',evmVersion:'shanghai',constructorArguments:encoded,licenseType:'3'},true);
  if(r.status!=='1'){if(/already verified/i.test(String(r.result))){console.log('ALREADY VERIFIED',name);continue;}console.error(name,'SUBMISSION FAILED:',r.result);failed=true;continue;}
  console.log('Submitted',name,'GUID:',r.result);fs.writeFileSync(`${dir}/${key}-submission.json`,JSON.stringify({address:d[key],guid:r.result,chainId:97},null,2));
  let done=false;
  for(let attempt=0;attempt<24;attempt++){
   await wait(5000);const status=await api('checkverifystatus',{guid:r.result});
   if(status.status==='1'){console.log('VERIFIED',name,`https://testnet.bscscan.com/address/${d[key]}#code`);done=true;break;}
   if(!/pending|queue/i.test(String(status.result))){console.error(name,'VERIFICATION FAILED:',status.result);failed=true;done=true;break;}
  }
  if(!done){console.error(name,'Still pending. GUID saved; check later.');failed=true;}
 }
 if(!failed){
  for(const key of ['token','binary']){
   await wait(1200);
   const r=await api('verifyproxycontract',{address:d[key],expectedimplementation:d[key+'Implementation']},true);
   if(r.status!=='1'){
    const current=await api('getsourcecode',{address:d[key]});
    if(current.status==='1'&&current.result?.[0]?.Implementation?.toLowerCase()===d[key+'Implementation'].toLowerCase()){console.log('PROXY LINKED',key);continue;}
    console.error('PROXY LINK FAILED',key,r.result);failed=true;continue;
   }
   fs.writeFileSync(`${dir}/${key}-proxy-submission.json`,JSON.stringify({guid:r.result,address:d[key]}));
   let done=false;
   for(let attempt=0;attempt<24;attempt++){
    await wait(5000);const status=await api('checkproxyverification',{guid:r.result});
    if(status.status==='1'){console.log('PROXY VERIFIED',key,d[key]);done=true;break;}
    if(!/pending|queue/i.test(String(status.result))){console.error('PROXY LINK FAILED',key,status.result);failed=true;done=true;break;}
   }
   if(!done){console.error('Proxy link pending:',key);failed=true;}
  }
 }
 if(failed)process.exitCode=1;
}finally{provider.destroy();}
