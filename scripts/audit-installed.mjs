// Audit physical packages, including Ganache's shrinkwrapped/bundled tree.
// npm audit's root lockfile report alone does not cover that entire tree.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const semver=require('semver'); // Installed through the pinned solc toolchain.
const out=path.resolve(process.argv[2]||'audit/dependencies/installed');
const inventory=[];
async function modules(dir){
  for(const entry of await fs.readdir(dir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})){
    if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
    const target=path.join(dir,entry.name);
    if(entry.name.startsWith('@')){
      for(const child of await fs.readdir(target,{withFileTypes:true}))if(child.isDirectory())await pkg(path.join(target,child.name));
    }else await pkg(target);
  }
}
async function pkg(dir){
  const manifest=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));
  if(!manifest.name||!semver.valid(manifest.version))throw Error(`Invalid package identity: ${dir}`);
  inventory.push({path:dir,name:manifest.name,version:manifest.version});
  await modules(path.join(dir,'node_modules'));
}
await modules('node_modules');
if(!inventory.length)throw Error('No installed packages to audit');
const payload={};
for(const item of inventory)(payload[item.name]??=new Set()).add(item.version);
const response=await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(Object.fromEntries(Object.entries(payload).map(([k,v])=>[k,[...v].sort()]))),
  signal:AbortSignal.timeout(60000)
});
if(!response.ok)throw Error(`Advisory service returned HTTP ${response.status}`);
const advisories=await response.json();
const findings=[];
for(const item of inventory){
  const matches=(advisories[item.name]||[]).filter(a=>semver.satisfies(item.version,a.vulnerable_versions));
  if(matches.length)findings.push({...item,advisories:matches});
}
const levels=['low','moderate','high','critical'];
const summary={low:0,moderate:0,high:0,critical:0};
for(const name of new Set(findings.map(x=>x.name))){
  const severity=findings.filter(x=>x.name===name).flatMap(x=>x.advisories.map(a=>a.severity)).sort((a,b)=>levels.indexOf(b)-levels.indexOf(a))[0];
  if(!(severity in summary))throw Error(`Unknown advisory severity: ${severity}`);
  summary[severity]++;
}
await fs.mkdir(path.dirname(out),{recursive:true});
await fs.writeFile(out+'.json',JSON.stringify({generatedAt:new Date().toISOString(),node:process.version,inventory,advisories,findings,summary,countUnit:'unique directly affected package names, maximum severity; excludes inherited npm meta-vulnerabilities'},null,2)+'\n');
console.log(JSON.stringify({installedPaths:inventory.length,directlyAffected:summary,report:out+'.json'}));
