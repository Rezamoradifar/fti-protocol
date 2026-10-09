import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
const sources=Object.fromEntries(fs.readdirSync('contracts').filter(f=>f.endsWith('.sol')).map(f=>[f,{content:fs.readFileSync('contracts/'+f,'utf8')}]));
const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{outputSelection:{'*':{'*':['storageLayout']}}}}),{import:p=>{try{return{contents:fs.readFileSync(path.join('node_modules',p),'utf8')}}catch{return{error:'Missing '+p}}}}));
const errors=(output.errors||[]).filter(e=>e.severity==='error');if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
fs.mkdirSync('artifacts/storage-layout',{recursive:true});
for(const name of ['FundedBinaryPlan','FundedBinaryPlanFloor','FundedBinaryPlanUpgradeable','FTIReserveTokenV3','FTIReserveTokenRecovery','FTIReserveTokenUpgradeable'])fs.writeFileSync(`artifacts/storage-layout/${name}.json`,JSON.stringify(output.contracts[name+'.sol'][name].storageLayout,null,2)+'\n');
console.log('CONTINUITY_LAYOUTS_WRITTEN');
