import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

test('canonical demo and deployment select the reserve token/global-pool route',()=>{
 const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
 assert.match(pkg.scripts.demo,/scripts\/local\.mjs --reserve-token/);
 assert.match(pkg.scripts.deploy,/scripts\/deploy-reserve\.mjs/);
 assert(!Object.hasOwn(pkg.scripts,'demo:funded'));
 assert.match(pkg.scripts['demo:historical-funded'],/--funded-plan/);
 const local=fs.readFileSync('scripts/local.mjs','utf8');
 assert.match(local,/const reserveModel=!process\.argv\.includes\('--legacy-token'\)/);
 assert.match(local,/global-pool-paid-points-v2/);
});

test('default historical browser launcher fails closed before opening a server',()=>{
 const r=spawnSync(process.execPath,['scripts/launch-server.mjs'],{encoding:'utf8',timeout:10000});
 assert.equal(r.status,1);assert.match(r.stderr,/historical browser launcher.*disabled/i);
 assert(!r.stdout.includes('http://'));
});

test('canonical deployment refuses the historical funded variant before reading credentials or sending anything',()=>{
 const r=spawnSync(process.execPath,['scripts/deploy-reserve.mjs','--funded-plan'],{encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,HOME:process.env.HOME}});
 assert.equal(r.status,1);assert.match(r.stderr,/historical.*not a deployment target/i);
 assert(!r.stdout.includes('SENT'));
});
