import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const script=path.resolve('scripts');
function python(args){return spawnSync('python3',args,{encoding:'utf8'});}
test('private migration retains journals and secrets, excludes dependencies, rejects traversal',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fti-migration-test-'));
 try{
  const project=path.join(tmp,'project'),home=path.join(tmp,'home'),archive=path.join(tmp,'backup.tar.gz'),dest=path.join(tmp,'restored');
  fs.mkdirSync(path.join(project,'deployments'),{recursive:true});fs.mkdirSync(path.join(project,'node_modules'));
  fs.mkdirSync(path.join(home,'.fti-testnet-100'),{recursive:true});
  fs.writeFileSync(path.join(project,'deployments/testnet.json'),'{"chainId":97}');
  fs.writeFileSync(path.join(project,'.env'),'TEST_SECRET=fixture');
  fs.writeFileSync(path.join(home,'.fti-testnet-100/journal.json'),'{"pending":{"hash":"fixture"}}');
  fs.writeFileSync(path.join(project,'node_modules/exclude'),'skip');
  let r=python([path.join(script,'migration-backup.py'),'--project',project,'--home',home,'--output',archive]);assert.equal(r.status,0,r.stderr);
  assert.equal(fs.statSync(archive).mode&0o777,0o600);
  r=python([path.join(script,'migration-restore.py'),archive,dest]);assert.equal(r.status,0,r.stderr);
  assert.equal(fs.readFileSync(path.join(dest,'project/.env'),'utf8'),'TEST_SECRET=fixture');
  assert(fs.existsSync(path.join(dest,'private/home/.fti-testnet-100/journal.json')));assert(!fs.existsSync(path.join(dest,'project/node_modules')));
  assert.notEqual(python([path.join(script,'migration-restore.py'),archive,dest]).status,0);
  const bad=path.join(tmp,'bad.tar.gz');r=python(['-c','import tarfile,io,sys\nwith tarfile.open(sys.argv[1],"w:gz") as t:\n m=tarfile.TarInfo("../escape");m.size=1;t.addfile(m,io.BytesIO(b"x"))',bad]);assert.equal(r.status,0,r.stderr);
  assert.notEqual(python([path.join(script,'migration-restore.py'),bad,path.join(tmp,'bad-output')]).status,0);
  assert(!fs.existsSync(path.join(tmp,'escape')));assert(!fs.existsSync(path.join(tmp,'bad-output')));
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
