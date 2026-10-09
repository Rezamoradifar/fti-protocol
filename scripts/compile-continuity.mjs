import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import {contractDigest} from './v3-release.mjs';
const targets=['FundedBinaryPlanUpgradeable','FTIReserveTokenUpgradeable','FTIProxy'];
const sources=Object.fromEntries(fs.readdirSync('contracts').filter(f=>f.endsWith('.sol')).map(f=>[f,{content:fs.readFileSync('contracts/'+f,'utf8')}]));
const selections=Object.fromEntries(targets.map(name=>[name+'.sol',{[name]:['abi','evm.bytecode.object','evm.deployedBytecode.object','storageLayout']}]));
const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:selections}};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:p=>{try{return{contents:fs.readFileSync(path.join('node_modules',p),'utf8')}}catch{return{error:'Missing '+p}}}}));
for(const error of output.errors||[])if(error.severity==='error')throw Error(error.formattedMessage);
fs.mkdirSync('artifacts/storage-layout',{recursive:true});
for(const name of targets){
 const c=output.contracts[name+'.sol'][name],size=c.evm.deployedBytecode.object.length/2;if(size>24576)throw Error(name+' exceeds EIP-170');
 fs.writeFileSync(`artifacts/${name}.json`,JSON.stringify({contractName:name,source:name+'.sol',compiler:solc.version(),sourceDigest:contractDigest(),abi:c.abi,bytecode:'0x'+c.evm.bytecode.object},null,2));
 fs.writeFileSync(`artifacts/storage-layout/${name}.json`,JSON.stringify(c.storageLayout,null,2));console.log(name,size+' runtime bytes');
}
