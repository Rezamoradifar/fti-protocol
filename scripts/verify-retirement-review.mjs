import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
// LOCAL preparation only. No network, credentials, signing or transactions.
const sources=Object.fromEntries(fs.readdirSync('contracts').filter(f=>f.endsWith('.sol')).map(f=>[f,{content:fs.readFileSync('contracts/'+f,'utf8')}]));
const settings={optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}};
function check(result){const errors=(result.errors??[]).filter(e=>e.severity==='error');if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));}
const discovery=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{outputSelection:{'*':{'*':['abi']}}}}),{import:name=>{try{const content=fs.readFileSync(path.join('node_modules',name),'utf8');sources[name]={content};return{contents:content};}catch{return{error:'Missing import '+name};}}}));check(discovery);
const input={language:'Solidity',sources,settings};
const output=JSON.parse(solc.compile(JSON.stringify(input)));check(output);
const names=['MockUSD','Council','FTITimelock','FTIRetirementReviewToken','BinaryPlan'];
for(const name of names){const artifact=JSON.parse(fs.readFileSync(`artifacts/${name}.json`,'utf8'));if(artifact.compiler!==solc.version()||artifact.bytecode!=='0x'+output.contracts[artifact.source][name].evm.bytecode.object)throw Error(`Source/artifact mismatch: ${name}`);}
const dir='artifacts/retirement-verification';fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/standard-input.json',JSON.stringify(input));
console.log('Local retirement verification: all five exact creation bytecodes match; no deployment or explorer submission.');
