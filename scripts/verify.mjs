import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import {AbiCoder,JsonRpcProvider,Contract,isAddress} from 'ethers';
// Source verification only. Never signs or deploys transactions.
const deploymentPath=process.env.DEPLOYMENT_FILE||'deployments/testnet.json';
const d=fs.existsSync(deploymentPath)?JSON.parse(fs.readFileSync(deploymentPath,'utf8')):null;
const tokenContract=(process.argv.includes('--reserve-token')||process.argv.includes('--funded-plan'))?'FTIReserveToken':(d?.tokenContract||'FTIToken');
if(!['FTIToken','FTIReserveToken'].includes(tokenContract))throw Error('Unknown token model');
const binaryContract=process.argv.includes('--funded-plan')?'FundedBinaryPlan':(d?.binaryContract||'BinaryPlan');
if(!['BinaryPlan','FundedBinaryPlan'].includes(binaryContract))throw Error('Unknown reward model');
const names=['MockUSD','Council','FTITimelock',tokenContract,binaryContract];
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
console.log('All five creation bytecodes match saved artifacts.');
if(process.argv.includes('--prepare'))process.exit(0);
if(!process.env.ETHERSCAN_API_KEY)throw Error('Set ETHERSCAN_API_KEY locally. No wallet private key is needed.');
if(!d)throw Error('Deployment file is required for explorer verification');
if(d.chainId!==97)throw Error('Only BNB Testnet chain 97 is supported');
for(const key of ['usd','council','timelock','token','binary'])if(!isAddress(d[key]))throw Error('Invalid address: '+key);
const provider=new JsonRpcProvider(process.env.RPC_URL||'https://bsc-testnet.bnbchain.org');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function api(action,params={},post=false){
 const url=new URL('https://api.etherscan.io/v2/api');url.search=new URLSearchParams({chainid:'97',module:'contract',action,apikey:process.env.ETHERSCAN_API_KEY,...(post?{}:params)}).toString();
 let response;try{response=await fetch(url,{...(post?{method:'POST',body:new URLSearchParams(params)}:{}),signal:AbortSignal.timeout(45000)});}catch{throw Error('Explorer request failed or timed out. No wallet transaction was sent.');}
 if(!response.ok)throw Error('Explorer HTTP '+response.status);return response.json();
}
try{
 if((await provider.getNetwork()).chainId!==97n)throw Error('RPC is not chain 97');
 for(const key of ['usd','council','timelock','token','binary'])if(await provider.getCode(d[key])==='0x')throw Error('No deployed code: '+key);
 const binary=new Contract(d.binary,['function development() view returns(address)','function memberList(uint256) view returns(address)'],provider);
 const council=new Contract(d.council,['function owners(uint256) view returns(address)'],provider);
 const owners=[];for(let i=0;i<7;i++)owners.push(await council.owners(i));
 const genesis=[];for(let i=0;i<31;i++)genesis.push(await binary.memberList(i));
 const dev=await binary.development(),coder=AbiCoder.defaultAbiCoder();
 let tokenTypes=['address','address','address'],tokenArgs=[d.usd,d.timelock,d.council];
 if(tokenContract==='FTIReserveToken'){
  const token=new Contract(d.token,['function animalSupportA() view returns(address)','function animalSupportB() view returns(address)'],provider);
  const animal=Array.isArray(d.animalSupport)&&d.animalSupport.length===2?d.animalSupport:[await token.animalSupportA(),await token.animalSupportB()];
  tokenTypes=['address','address','address','address','address'];tokenArgs=[d.usd,d.timelock,d.council,animal[0],animal[1]];
 }
 const jobs=[['MockUSD','usd',[],[]],['Council','council',['address[7]'],[owners]],['FTITimelock','timelock',['address'],[d.council]],[tokenContract,'token',tokenTypes,tokenArgs],[binaryContract,'binary',['address','address','address','address','address','address[31]'],[d.usd,d.token,d.timelock,d.council,dev,genesis]]];
 let failed=false;
 for(const[name,key,types,args]of jobs){
  const encoded=coder.encode(types,args).slice(2);fs.writeFileSync(`${dir}/${name}-constructor.txt`,encoded);
  await wait(1200);const existing=await api('getsourcecode',{address:d[key]});
  if(existing.status==='1'&&existing.result?.[0]?.SourceCode){console.log('ALREADY VERIFIED',name,d[key]);continue;}
  const r=await api('verifysourcecode',{contractaddress:d[key],sourceCode:JSON.stringify(input),codeformat:'solidity-standard-json-input',contractname:`${artifacts[name].source}:${name}`,compilerversion:'v'+solc.version().split('.Emscripten')[0],optimizationUsed:'1',runs:'200',evmVersion:'shanghai',constructorArguments:encoded,licenseType:'3'},true);
  if(r.status!=='1'){if(/already verified/i.test(String(r.result))){console.log('ALREADY VERIFIED',name);continue;}console.error(name,'SUBMISSION FAILED:',r.result);failed=true;continue;}
  console.log('Submitted',name,'GUID:',r.result);fs.writeFileSync(`${dir}/${name}-submission.json`,JSON.stringify({address:d[key],guid:r.result,chainId:97},null,2));
  let done=false;
  for(let attempt=0;attempt<24;attempt++){
   await wait(5000);const status=await api('checkverifystatus',{guid:r.result});
   if(status.status==='1'){console.log('VERIFIED',name,`https://testnet.bscscan.com/address/${d[key]}#code`);done=true;break;}
   if(!/pending|queue/i.test(String(status.result))){console.error(name,'VERIFICATION FAILED:',status.result);failed=true;done=true;break;}
  }
  if(!done){console.error(name,'Still pending. GUID saved; check later.');failed=true;}
 }
 if(failed)process.exitCode=1;
}finally{provider.destroy();}
