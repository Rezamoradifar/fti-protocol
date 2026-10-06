import fs from 'node:fs';
import path from 'node:path';

const names=['MockUSD','SevenGuardianCouncil','FTIReserveTokenV3','FundedBinaryPlan'];
fs.mkdirSync('launcher/artifacts',{recursive:true});

for(const name of names){
  const src=path.join('artifacts',name+'.json');
  if(!fs.existsSync(src))throw Error('Missing compiled artifact '+src+'. Run npm run compile first.');
  const artifact=JSON.parse(fs.readFileSync(src,'utf8'));
  fs.writeFileSync(path.join('launcher','artifacts',name+'.json'),JSON.stringify(artifact,null,2)+'\n');
}

console.log('FTI V3 launcher artifacts refreshed:',names.join(', '));
