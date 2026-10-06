import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import {AbiCoder,JsonRpcProvider,Contract,isAddress} from 'ethers';

/**
 * FTI V3 BNB Testnet source verification.
 *
 * - Never signs a transaction.
 * - Requires only the public deployment JSON and an explorer API key.
 * - Recompiles the exact Standard JSON input with the same compiler settings.
 * - Checks deployment metadata and selected constructor/state values on-chain.
 * - Submits MockUSD, SevenGuardianCouncil, FTIReserveTokenV3 and
 *   FundedBinaryPlan to the Etherscan V2 verification API for chain 97.
 */

const deploymentPath=process.env.DEPLOYMENT_FILE||'deployments/v3-testnet.json';
if(!fs.existsSync(deploymentPath))throw Error('Missing V3 deployment file: '+deploymentPath);

const d=JSON.parse(fs.readFileSync(deploymentPath,'utf8'));

if(d.release!=='FTI_V3_ZERO_START')throw Error('FTI V3 deployment required');
if(Number(d.chainId)!==97)throw Error('Only BNB Testnet chain 97 is supported');
if(d.tokenContract!=='FTIReserveTokenV3')throw Error('FTIReserveTokenV3 deployment required');
if(d.binaryContract!=='FundedBinaryPlan')throw Error('FundedBinaryPlan deployment required');
if(d.councilContract!=='SevenGuardianCouncil')throw Error('SevenGuardianCouncil deployment required');
if(Number(d.daoThreshold)!==5)throw Error('Expected 5-of-7 Partner DAO');

for(const key of ['usd','council','token','binary','governance','development','charityWalletA','charityWalletB']){
  if(!isAddress(d[key]))throw Error('Invalid deployment address: '+key);
}
if(!Array.isArray(d.daoPartners)||d.daoPartners.length!==7)throw Error('Expected seven Partner DAO addresses');
if(!Array.isArray(d.genesis)||d.genesis.length!==31)throw Error('Expected 31 Genesis addresses');

const contractFiles=fs.readdirSync('contracts').filter(file=>file.endsWith('.sol'));
const sources=Object.fromEntries(
  contractFiles.map(file=>[file,{content:fs.readFileSync(path.join('contracts',file),'utf8')}])
);

function importCallback(importPath){
  try{
    const full=path.join('node_modules',importPath);
    const content=fs.readFileSync(full,'utf8');
    // Preserve imported sources in Standard JSON for explorer submission.
    if(!sources[importPath])sources[importPath]={content};
    return {contents:content};
  }catch{
    return {error:'Missing import '+importPath};
  }
}

function checkCompile(result){
  const errors=(result.errors||[]).filter(e=>e.severity==='error');
  if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
}

// Discovery pass recursively collects imported OpenZeppelin sources.
const discoverInput={
  language:'Solidity',
  sources,
  settings:{outputSelection:{'*':{'*':['abi']}}}
};
checkCompile(JSON.parse(solc.compile(JSON.stringify(discoverInput),{import:importCallback})));

const settings={
  optimizer:{enabled:true,runs:200},
  viaIR:true,
  evmVersion:'shanghai',
  outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}
};

const input={language:'Solidity',sources,settings};
console.log('Recompiling exact V3 verification input with',solc.version());

const compiled=JSON.parse(solc.compile(JSON.stringify(input)));
checkCompile(compiled);

const targets=[
  {name:'MockUSD',key:'usd'},
  {name:'SevenGuardianCouncil',key:'council'},
  {name:'FTIReserveTokenV3',key:'token'},
  {name:'FundedBinaryPlan',key:'binary'}
];

const artifacts={};
for(const {name} of targets){
  const filename=path.join('artifacts',name+'.json');
  if(!fs.existsSync(filename))throw Error('Missing artifact '+filename+'. Run npm run compile first.');
  const artifact=JSON.parse(fs.readFileSync(filename,'utf8'));
  artifacts[name]=artifact;

  const exact=compiled.contracts?.[artifact.source]?.[name];
  if(!exact)throw Error('Compiled target missing: '+artifact.source+':'+name);

  const bytecode='0x'+exact.evm.bytecode.object;
  if(artifact.compiler!==solc.version())throw Error('Compiler mismatch for '+name);
  if(bytecode!==artifact.bytecode)throw Error('Creation bytecode mismatch for '+name);
}

const outDir='artifacts/verification-v3';
fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'standard-input.json'),JSON.stringify(input,null,2));

const coder=AbiCoder.defaultAbiCoder();

const constructorJobs=[
  {
    name:'MockUSD',
    key:'usd',
    types:[],
    args:[]
  },
  {
    name:'SevenGuardianCouncil',
    key:'council',
    types:['address[7]'],
    args:[d.daoPartners]
  },
  {
    name:'FTIReserveTokenV3',
    key:'token',
    types:['address','address','address','address','address'],
    args:[d.usd,d.governance,d.council,d.charityWalletA,d.charityWalletB]
  },
  {
    name:'FundedBinaryPlan',
    key:'binary',
    types:['address','address','address','address','address','address[31]'],
    args:[d.usd,d.token,d.governance,d.council,d.development,d.genesis]
  }
];

for(const job of constructorJobs){
  const encoded=coder.encode(job.types,job.args).slice(2);
  job.encoded=encoded;
  fs.writeFileSync(
    path.join(outDir,job.name+'-constructor.txt'),
    encoded+'\n'
  );
}

const compilerVersion='v'+solc.version().split('.Emscripten')[0];
fs.writeFileSync(
  path.join(outDir,'manifest.json'),
  JSON.stringify({
    release:d.release,
    chainId:97,
    compilerVersion,
    optimizer:{enabled:true,runs:200},
    viaIR:true,
    evmVersion:'shanghai',
    contracts:constructorJobs.map(j=>({
      name:j.name,
      source:artifacts[j.name].source,
      address:d[j.key],
      constructorArgumentsFile:j.name+'-constructor.txt'
    }))
  },null,2)+'\n'
);

console.log('Prepared exact V3 verification bundle in',outDir);

if(process.argv.includes('--prepare')){
  console.log('PREPARE ONLY: no explorer request sent.');
  process.exit(0);
}

const apiKey=process.env.ETHERSCAN_API_KEY||process.env.BSCSCAN_API_KEY;
if(!apiKey)throw Error('Set ETHERSCAN_API_KEY or BSCSCAN_API_KEY locally. No wallet private key is needed.');

const rpcUrl=process.env.RPC_URL||'https://bsc-testnet.bnbchain.org';
const provider=new JsonRpcProvider(rpcUrl,undefined,{cacheTimeout:-1});

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function explorer(action,params={},post=false){
  const url=new URL('https://api.etherscan.io/v2/api');
  url.search=new URLSearchParams({
    chainid:'97',
    module:'contract',
    action,
    apikey:apiKey,
    ...(post?{}:params)
  }).toString();

  const options={
    signal:AbortSignal.timeout(45000)
  };
  if(post){
    options.method='POST';
    options.body=new URLSearchParams(params);
  }

  let response;
  try{
    response=await fetch(url,options);
  }catch{
    throw Error('Explorer request failed or timed out. No wallet transaction was sent.');
  }

  if(!response.ok)throw Error('Explorer HTTP '+response.status);
  return response.json();
}

function same(a,b){return String(a).toLowerCase()===String(b).toLowerCase();}

try{
  if((await provider.getNetwork()).chainId!==97n)throw Error('RPC is not BNB Testnet chain 97');

  for(const {key} of targets){
    if(await provider.getCode(d[key])==='0x')throw Error('No deployed bytecode at '+key+' address '+d[key]);
  }

  // Cross-check constructor/state assumptions against the actual deployment.
  const council=new Contract(d.council,artifacts.SevenGuardianCouncil.abi,provider);
  if(await council.THRESHOLD()!==5n)throw Error('On-chain DAO threshold is not 5');
  for(let i=0;i<7;i++){
    if(!same(await council.guardians(i),d.daoPartners[i]))throw Error('On-chain DAO guardian mismatch at index '+i);
  }

  const token=new Contract(d.token,artifacts.FTIReserveTokenV3.abi,provider);
  if(!same(await token.usd(),d.usd))throw Error('Token stablecoin mismatch');
  if(!same(await token.governance(),d.governance))throw Error('Token governance mismatch');
  if(!same(await token.guardianCouncil(),d.council))throw Error('Token council mismatch');
  if(!same(await token.animalWalletA(),d.charityWalletA))throw Error('Animal wallet A mismatch');
  if(!same(await token.animalWalletB(),d.charityWalletB))throw Error('Animal wallet B mismatch');
  if(!same(await token.binary(),d.binary))throw Error('Token/binary binding mismatch');

  const binary=new Contract(d.binary,artifacts.FundedBinaryPlan.abi,provider);
  if(!same(await binary.usd(),d.usd))throw Error('Binary stablecoin mismatch');
  if(!same(await binary.token(),d.token))throw Error('Binary token mismatch');
  if(!same(await binary.governance(),d.governance))throw Error('Binary governance mismatch');
  if(!same(await binary.guardian(),d.council))throw Error('Binary guardian mismatch');
  if(!same(await binary.development(),d.development))throw Error('Binary development mismatch');
  for(let i=0;i<31;i++){
    if(!same(await binary.memberList(i),d.genesis[i]))throw Error('Genesis mismatch at index '+i);
  }

  console.log('On-chain V3 constructor/state checks passed.');

  let failed=false;

  for(const job of constructorJobs){
    const address=d[job.key];

    await wait(1000);
    const existing=await explorer('getsourcecode',{address});
    if(existing.status==='1'&&existing.result?.[0]?.SourceCode){
      console.log('ALREADY VERIFIED',job.name,address);
      continue;
    }

    const artifact=artifacts[job.name];
    const response=await explorer('verifysourcecode',{
      contractaddress:address,
      sourceCode:JSON.stringify(input),
      codeformat:'solidity-standard-json-input',
      contractname:artifact.source+':'+job.name,
      compilerversion:compilerVersion,
      optimizationUsed:'1',
      runs:'200',
      evmVersion:'shanghai',
      constructorArguments:job.encoded,
      licenseType:'3'
    },true);

    if(response.status!=='1'){
      if(/already verified/i.test(String(response.result))){
        console.log('ALREADY VERIFIED',job.name,address);
        continue;
      }
      console.error(job.name,'SUBMISSION FAILED:',response.result);
      failed=true;
      continue;
    }

    const guid=response.result;
    console.log('Submitted',job.name,'GUID:',guid);
    fs.writeFileSync(
      path.join(outDir,job.name+'-submission.json'),
      JSON.stringify({address,guid,chainId:97},null,2)+'\n'
    );

    let finished=false;
    for(let attempt=0;attempt<30;attempt++){
      await wait(5000);
      const check=await explorer('checkverifystatus',{guid});

      if(check.status==='1'){
        console.log('VERIFIED',job.name,'https://testnet.bscscan.com/address/'+address+'#code');
        finished=true;
        break;
      }

      if(!/pending|queue/i.test(String(check.result))){
        console.error(job.name,'VERIFICATION FAILED:',check.result);
        failed=true;
        finished=true;
        break;
      }
    }

    if(!finished){
      console.error(job.name,'still pending. GUID saved in',outDir);
      failed=true;
    }
  }

  if(failed)process.exitCode=1;
}finally{
  provider.destroy();
}
