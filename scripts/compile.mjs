import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import {contractDigest} from './v3-release.mjs';
const sources=Object.fromEntries(fs.readdirSync('contracts').filter(f=>f.endsWith('.sol')).map(f=>[f,{content:fs.readFileSync('contracts/'+f,'utf8')}]));
const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','storageLayout']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:p=>{try{return{contents:fs.readFileSync(path.join('node_modules',p),'utf8')}}catch{return{error:'Missing '+p}}}}));
for(const e of output.errors??[])console[e.severity==='error'?'error':'warn'](e.formattedMessage);
if(output.errors?.some(e=>e.severity==='error'))process.exit(1);
fs.mkdirSync('artifacts',{recursive:true});
fs.mkdirSync('artifacts/storage-layout',{recursive:true});
for(const [file,contracts] of Object.entries(output.contracts))if(sources[file])for(const [name,c]of Object.entries(contracts)){
 fs.writeFileSync(`artifacts/${name}.json`,JSON.stringify({contractName:name,source:file,compiler:solc.version(),sourceDigest:contractDigest(),abi:c.abi,bytecode:'0x'+c.evm.bytecode.object},null,2));
 fs.writeFileSync(`artifacts/storage-layout/${name}.json`,JSON.stringify(c.storageLayout,null,2)+'\n');
 const size=c.evm.deployedBytecode.object.length/2;if(size>24576)throw Error(name+' exceeds EIP-170');console.log(name,size+' runtime bytes');
}
