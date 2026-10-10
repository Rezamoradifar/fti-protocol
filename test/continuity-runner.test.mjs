import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const runner=fileURLToPath(new URL('../tools/test-continuity-transfer.sh',import.meta.url));
const revision='b254a379b08929a261dccfeae18bcf17d3781b90';
// Only shell orchestration is tested here. All git/npm/node commands are fakes;
// these tests neither contact GitHub/RPC nor compile or deploy any contracts.
function fixture({sha=revision,major='22',fail='',mismatch=false,missingNode=false}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fti-runner-test-'));
  const bin=path.join(root,'bin'); fs.mkdirSync(bin);
  const trace=path.join(root,'trace');
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  const pre=`#!/bin/bash\nset -eu\nprintf '%s %s\\n' "$(basename "$0")" "$*" >> ${quote(trace)}\n`;
  const clean=`for name in PRIVATE_KEY RPC_URL DEPLOYMENT_FILE FORK_RPC_URL NODE_OPTIONS NODE_PATH NPM_TOKEN GITHUB_TOKEN; do
    [[ -z "\${!name-}" ]] || { echo "Environment leaked: $name"; exit 91; }
  done
  [[ "$HOME" == */fti-transition-check.*/home ]] || exit 92
  [[ "$NPM_CONFIG_USERCONFIG" == "$HOME/.npmrc" ]] || exit 93
  [[ "$GIT_CONFIG_GLOBAL" == /dev/null ]] || exit 94
`;
  const write=(name,body)=>fs.writeFileSync(path.join(bin,name),pre+clean+body,{mode:0o700});
  write('node',`if [[ "$1" == -p ]]; then echo ${quote(major)}; exit 0; fi
if [[ "$1" == --version ]]; then echo v${major}.0.0; exit 0; fi
[[ "$1" == --test ]] || exit 95
${fail==='tests'?'exit 17':'exit 0'}\n`);
  write('git',`case "$*" in
  'init -q') mkdir -p test; : > test/stub.test.mjs ;;
  'rev-parse HEAD') echo ${quote(mismatch?'0'.repeat(40):revision)} ;;
  *'fetch --depth=1'*) ${fail==='checkout'?'exit 17':':'} ;;
esac\n`);
  write('npm',`case "$*" in
  ci) ${fail==='install'?'exit 17':':'} ;;
  'run compile') ${fail==='compile'?'exit 17':':'} ;;
  'run build:web') ${fail==='build'?'exit 17':':'} ;;
  *) exit 96 ;;
esac\n`);
  const env={...process.env,TMPDIR:root,FTI_NODE_BINARY:missingNode?path.join(root,'missing-node'):path.join(bin,'node'),
    PRIVATE_KEY:'test-secret-never-use',RPC_URL:'https://invalid.example/not-a-real-rpc',
    FORK_RPC_URL:'https://invalid.example/not-a-real-fork',DEPLOYMENT_FILE:'/not/a/live/config',
    NODE_OPTIONS:'--this-option-must-not-be-inherited',NODE_PATH:'/not/a/module/path',NPM_TOKEN:'test-token',GITHUB_TOKEN:'test-github-token'};
  // The outer shell necessarily starts before the runner can sanitize its child.
  delete env.BASH_ENV; delete env.ENV;
  const output=spawnSync('/bin/bash',[runner,sha],{env,encoding:'utf8',timeout:15000});
  const dirs=fs.readdirSync(root).filter(n=>n.startsWith('fti-transition-check.'));
  const dir=dirs.length?path.join(root,dirs[0]):null;
  const result=dir&&fs.existsSync(path.join(dir,'result.json'))?JSON.parse(fs.readFileSync(path.join(dir,'result.json'),'utf8')):null;
  const log=dir?fs.readFileSync(path.join(dir,'verification.log'),'utf8'):'';
  const calls=fs.existsSync(trace)?fs.readFileSync(trace,'utf8'):'';
  return {root,dir,result,log,calls,output,dispose:()=>fs.rmSync(root,{recursive:true,force:true})};
}

test('isolated runner strips signer/RPC/preload secrets and records the pinned successful local run',()=>{
  const f=fixture();try {
    assert.equal(f.output.status,0,f.output.stderr+f.output.stdout);
    assert.deepEqual(f.result,{schema:'FTI_LOCAL_RUN_V1',scope:'LOCAL_EVM_NOT_LIVE_NETWORK',commit:revision,stage:'complete',result:'PASS',exitCode:0});
    assert.match(f.calls,new RegExp('git -c credential.helper= fetch --depth=1 origin '+revision));
    assert.doesNotMatch(f.calls,/single-branch|systemctl|deploy-|upgradeTo/);
    assert.match(f.log,/TRANSFER_VERIFICATION_PASS/);
    assert.doesNotMatch(f.log,/test-secret-never-use|test-token|invalid.example/);
    assert.equal(fs.statSync(f.dir).mode&0o777,0o700);
    assert.equal(fs.statSync(path.join(f.dir,'result.json')).mode&0o777,0o600);
  } finally {f.dispose();}
});
for(const [name,options,stage] of [
  ['dependency failure',{fail:'install'},'install'],
  ['compiler failure',{fail:'compile'},'compile'],
  ['test failure',{fail:'tests'},'tests'],
  ['web build failure',{fail:'build'},'build'],
  ['checkout failure',{fail:'checkout'},'checkout'],
  ['mismatched checkout',{mismatch:true},'checkout'],
  ['unsupported Node major',{major:'20'},'node'],
  ['malformed Node major',{major:'invalid'},'node']
])test('isolated runner fails closed on '+name,()=>{
  const f=fixture(options);try {
    assert.notEqual(f.output.status,0);
    assert.equal(f.result.result,'FAILED');assert.equal(f.result.stage,stage);
    assert.notEqual(f.result.exitCode,0);
    assert.doesNotMatch(f.log,/TRANSFER_VERIFICATION_PASS/);
    if(stage!=='build')assert.doesNotMatch(f.calls,/npm run build:web/);
  }finally{f.dispose();}
});
for(const sha of ['main','--help','a'.repeat(39),'A'.repeat(40)])test('runner rejects non-pinned revision '+sha,()=>{
  const f=fixture({sha});try {assert.notEqual(f.output.status,0);assert.equal(f.result,null);assert.equal(f.calls,'');}
  finally{f.dispose();}
});
test('runner fails clearly when no usable Node executable was selected',()=>{
  const f=fixture({missingNode:true});try {assert.notEqual(f.output.status,0);assert.equal(f.result,null);assert.match(f.output.stderr,/Node >=22/);}
  finally{f.dispose();}
});
