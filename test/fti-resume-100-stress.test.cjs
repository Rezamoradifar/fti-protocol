'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const cp=require('node:child_process');
const path=require('node:path');
const f=path.resolve(__dirname,'../tools/fti-resume-100-stress.sh');
const s=fs.readFileSync(f,'utf8');
test('runner bash syntax',()=>{
  const r=cp.spawnSync('bash',['-n',f],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
});
test('guarded resume',()=>{
  assert.match(s,/vps-titan-5320/);
  assert.match(s,/--confirm-plan/);
  assert.match(s,/operation.lock/);
  assert.match(s,/PREVIOUS_TEST_LOCK_EXISTS_DO_NOT_REMOVE/);
  assert.match(s,/any\(v>3 for v in nums.values\(\)\)/);
  assert.match(s,/all\(v>=3 for v in nums.values\(\)\)/);
});
