// Shell orchestration tests use fake git/npm/node; they are NOT EVM execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const runner=fileURLToPath(new URL('../tools/prepare-builder-controls.sh',import.meta.url));
const revision='4e720d7b11c4b2b2c3f51b775b485a5f4c0e9856';
function fixture({fail='',rev=revision,nodeMajor='22',mismatch=false}={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fti-builder-install-'));
 const bin=path.join(root,'bin');fs.mkdirSync(bin);
 const trace=path.join(root,'trace');
 const pre=`#!/bin/bash\nset -eu\nprintf '%s %s\\n' "$(basename "$0")" "$*" >> '${trace}'\n`+
  `for n in PRIVATE_KEY KEEPER_PRIVATE_KEY RPC_URL DEPLOYMENT_FILE NODE_OPTIONS NPM_TOKEN; do [[ -z "\${!n-}" ]] || exit 91; done\n`;
 const put=(name,body)=>fs.writeFileSync(path.join(bin,name),pre+body,{mode:0o700});
 put('node',`if [[ "$1" == -p ]]; then echo '${nodeMajor}'; exit 0; fi\nif [[ "$1" == --version ]]; then echo v${nodeMajor}.0.0; exit 0; fi\n`+
  `if [[ "$1" == scripts/check-upgrade-layout.mjs && '${fail}' == storage ]]; then exit 19; fi\n`+
  `if [[ "$1" == --test && '${fail}' == tests ]]; then exit 19; fi\n`);
 put('git',`if [[ "$*" == 'rev-parse HEAD' ]]; then echo '${mismatch?'0'.repeat(40):revision}'; fi\n`+
  `if [[ "$*" == *'fetch --depth=1'* && '${fail}' == checkout ]]; then exit 19; fi\n`);
 put('npm',`case "$*" in ci) stage=dependencies;; 'run compile') stage=compile;; 'run build:web') stage=web;; *) exit 97;; esac\n[[ "$stage" != '${fail}' ]] || exit 19\n`);
 const env={...process.env,FTI_CANDIDATE_ROOT:path.join(root,'candidates'),FTI_NODE_BINARY:path.join(bin,'node'),
  PRIVATE_KEY:'fake-private-key',KEEPER_PRIVATE_KEY:'fake-keeper-key',RPC_URL:'https://invalid.example',DEPLOYMENT_FILE:'/invalid',NODE_OPTIONS:'--invalid-option',NPM_TOKEN:'fake-token'};
 delete env.BASH_ENV;delete env.ENV;
 const output=spawnSync('/bin/bash',[runner,rev],{env,encoding:'utf8',timeout:15000});
 const base=path.join(root,'candidates'),dirs=fs.existsSync(base)?fs.readdirSync(base):[];
 const dir=dirs.length?path.join(base,dirs[0]):null;
 const result=dir&&fs.existsSync(path.join(dir,'result.json'))?JSON.parse(fs.readFileSync(path.join(dir,'result.json'))):null;
 const calls=fs.existsSync(trace)?fs.readFileSync(trace,'utf8'):'';
 return {root,dir,result,calls,output,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('candidate installer isolates credentials, pins code and does not activate services',()=>{
 const f=fixture();try{
  assert.equal(f.output.status,0,f.output.stderr+f.output.stdout);
  assert.deepEqual(f.result,{schema:'FTI_BUILDER_CANDIDATE_V1',commit:revision,stage:'complete',result:'CANDIDATE_PREPARED',exitCode:0,liveActivated:false,fundsMoved:false});
  assert.match(f.calls,new RegExp('fetch --depth=1 origin '+revision));
  assert.doesNotMatch(f.calls,/systemctl|nginx|scripts\/deploy|scripts\/migrate-addresses/);
  assert.doesNotMatch(fs.readFileSync(path.join(f.dir,'install.log'),'utf8'),/fake-private-key|fake-keeper-key|fake-token/);
  assert.equal(fs.statSync(f.dir).mode&0o777,0o700);
  assert.equal(fs.statSync(path.join(f.dir,'result.json')).mode&0o777,0o600);
 }finally{f.close();}
});
for(const stage of ['checkout','dependencies','compile','storage','tests','web'])test('candidate installer stops on '+stage+' failure',()=>{
 const f=fixture({fail:stage});try{
  assert.notEqual(f.output.status,0);assert.equal(f.result.stage,stage);assert.equal(f.result.result,'FAILED');
  assert.notEqual(f.result.exitCode,0);assert.equal(f.result.liveActivated,false);
  assert.doesNotMatch(f.output.stdout,/FTI_BUILDER_CANDIDATE_PREPARED/);
 }finally{f.close();}
});
test('candidate installer rejects changed checkout identity',()=>{
 const f=fixture({mismatch:true});try{assert.notEqual(f.output.status,0);assert.equal(f.result.stage,'checkout');assert.doesNotMatch(f.calls,/npm ci/);}finally{f.close();}
});
test('candidate installer rejects unsupported Node before checkout',()=>{
 const f=fixture({nodeMajor:'20'});try{assert.notEqual(f.output.status,0);assert.equal(f.result.stage,'node');assert.doesNotMatch(f.calls,/git /);}finally{f.close();}
});
test('candidate installer rejects a mutable branch as the revision',()=>{
 const f=fixture({rev:'main'});try{assert.notEqual(f.output.status,0);assert.equal(f.result,null);assert.equal(f.calls,'');}finally{f.close();}
});
