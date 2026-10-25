// Local EVM only. Proves the immutable runtime overlay boots with the existing
// source/creation/role checks, while adding files outside the frozen manifest.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import ganache from 'ganache';
import {Wallet} from 'ethers';

const root=process.cwd();
function child(command,args,options={}){
 return new Promise((resolve,reject)=>{
  const proc=spawn(command,args,{cwd:root,...options});let output='';
  proc.stdout.on('data',data=>{output+=data;});proc.stderr.on('data',data=>{output+=data;});
  proc.once('error',reject);proc.once('exit',code=>code===0?resolve(output):reject(Error(output.slice(-10000))));
 });
}
test('frozen canonical source boots completion overlay and rejects changed source or contract identity',{timeout:240000},async()=>{
 const engine=ganache.server({chain:{chainId:31337,time:new Date('2026-10-25T12:10:00Z')},
  logging:{quiet:true},wallet:{totalAccounts:10},miner:{blockGasLimit:30000000,timestampIncrement:0}});
 await engine.listen(0,'127.0.0.1');
 const rpc='http://127.0.0.1:'+engine.address().port;
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fti-completion-boot-'));
 const keys=Object.values(engine.provider.getInitialAccounts()).map(a=>a.secretKey);
 const dao=path.join(directory,'dao.json'),config=path.join(directory,'deployment.json');
 fs.writeFileSync(dao,JSON.stringify({threshold:5,partners:keys.slice(1,8).map(key=>new Wallet(key).address)}));
 const baseline=path.join(directory,'frozen'),overlayData=path.join(directory,'overlay.json');
 try{
  // Canonical source comes from the exact approved revision. The two generated
  // public bundles are fixture inputs; their actual frozen fingerprint is bound
  // into this local deployment, never represented as the production fingerprint.
  const python=String.raw`
import importlib.util,json,os,pathlib,shutil,subprocess,sys
root=pathlib.Path(sys.argv[1]);dest=pathlib.Path(sys.argv[2]);out=pathlib.Path(sys.argv[3]);dest.mkdir()
spec=importlib.util.spec_from_file_location('completion',root/'tools/install-panel-completion.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
spec=importlib.util.spec_from_file_location('recovery',root/'tools/recover-mainnet-source.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
canonical=m.canonical_sources(root)
for name,expected in r.BASELINE.items():
 data=canonical[name];assert m.sha(data)==expected
 file=dest/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(data)
for name in ['web','artifacts']:
 shutil.copytree(root/name,dest/name)
(dest/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
runtime={name:(root/name).read_bytes() for name in m.RUNTIME_FILES}
name,files=m.overlay_files(runtime)
out.write_text(json.dumps({'folder':name,'files':{key:value.decode() for key,value in files.items()}}))
`;
  await child('python3',['-c',python,root,baseline,overlayData]);
  await child(process.execPath,['scripts/deploy-continuity-testnet.mjs'],{cwd:baseline,env:{...process.env,RPC_URL:rpc,FTI_SOURCE_REVISION:'ba82373a83d63fba0643332371cfb6d62903c849',
   DEPLOYER_PRIVATE_KEY:keys[0],DAO_CONFIG:dao,V3_TESTNET_SECRETS:path.join(directory,'genesis.json'),V3_DEPLOYMENT_FILE:config}});
  const proof=String.raw`
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const config=process.argv[1],data=JSON.parse(fs.readFileSync(process.argv[2]));
const {releaseManifest}=await import('./scripts/continuity-release.mjs');
const before=releaseManifest();
const folder=path.resolve(data.folder);fs.mkdirSync(folder);
for(const[name,code]of Object.entries(data.files))fs.writeFileSync(path.join(folder,name),code);
assert.deepEqual(releaseManifest(),before,'overlay must not alter the frozen source manifest');
const cfg=JSON.parse(fs.readFileSync(config));assert.equal(cfg.sourceFingerprint,before.sourceFingerprint,'deployment must bind the frozen manifest');
const {startWeb}=await import('./'+data.folder+'/server.mjs');
let web;
try{
 web=await startWeb(config);const base='http://127.0.0.1:'+web.address().port;
 assert.equal((await fetch(base+'/health')).status,200);
 const publicCfg=await(await fetch(base+'/api/config')).json();
 assert.equal(publicCfg.sourceFingerprint,before.sourceFingerprint);assert.equal(publicCfg.supportTicketVersion,1);assert.equal(publicCfg.memberHistoryVersion,1);
 const state=await fetch(base+'/api/state?wallet='+cfg.genesis[0]);assert.equal(state.status,200);assert.equal((await state.json()).wallet.exists,true);
 assert.equal((await fetch(base+'/api/support/tickets')).status,401);
 assert.equal((await fetch(base+'/api/support/challenge',{method:'POST',headers:{Origin:'https://invalid.example','Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/api/member-history?wallet=invalid')).status,400);
 const history=await fetch(base+'/api/member-history?wallet='+cfg.genesis[0]);assert.equal(history.status,200,await history.text());
 const blocked=await fetch(base+'/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:['0x']})});assert.equal(blocked.status,400);
 assert.deepEqual(releaseManifest(),before,'serving the new APIs must not change frozen source identity');
}finally{if(web)await new Promise(resolve=>web.close(resolve));}
const wrong=structuredClone(cfg);wrong.tokenImplementation=cfg.binaryImplementation;const bad=path.resolve('../bad-deployment.json');fs.writeFileSync(bad,JSON.stringify(wrong));
await assert.rejects(()=>startWeb(bad),/Implementation mismatch/);
fs.appendFileSync('./scripts/site-routing.mjs','\n// invalid source fixture\n');
await assert.rejects(()=>startWeb(config),/Deployment\/build release mismatch/);
console.log('FTI_COMPLETION_FROZEN_RUNTIME_BOOT_PASS');
`;
  const result=await child(process.execPath,['--input-type=module','--eval',proof,config,overlayData],
   {cwd:baseline,env:{...process.env,RPC_URL:rpc,PORT:'0',HOST:'127.0.0.1',FTI_SOURCE_REVISION:'ba82373a83d63fba0643332371cfb6d62903c849',WALLETCONNECT_PROJECT_ID:''}});
  assert.match(result,/FTI_COMPLETION_FROZEN_RUNTIME_BOOT_PASS/);
 }finally{
  await engine.close();fs.rmSync(directory,{recursive:true,force:true});
 }
});
