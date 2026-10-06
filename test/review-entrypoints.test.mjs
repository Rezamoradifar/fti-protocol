import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));

test('canonical demo selects retirement review and preserves explicit historical local demos', () => {
  assert.match(pkg.scripts.demo,/scripts\/local\.mjs --retirement-review$/);
  assert.match(pkg.scripts['demo:retirement'],/scripts\/local\.mjs --retirement-review$/);
  assert.match(pkg.scripts['demo:reserve'],/scripts\/local\.mjs --reserve-token$/);
  assert(!Object.hasOwn(pkg.scripts,'demo:funded'));
  assert.match(pkg.scripts['demo:historical-funded'],/--funded-plan$/);
  const local = fs.readFileSync('scripts/local.mjs','utf8');
  assert.match(local,/process\.argv\.includes\('--retirement-review'\)/);
  assert.match(local,/retirementModel\?'FTIRetirementReviewToken'/);
  assert.match(local,/deployments\/local-retirement\.json/);
  assert.match(local,/global-pool-paid-points-v2/);
});

test('canonical deploy and prepare entrypoints have no compilation, credential, live-network, or historical deployment hooks', () => {
  assert.equal(pkg.scripts.deploy,'node scripts/prepare-retirement-deployment.mjs');
  assert.equal(pkg.scripts['prepare:retirement'],'node scripts/prepare-retirement-deployment.mjs');
  for (const hook of ['predeploy','postdeploy','preprepare:retirement','postprepare:retirement']) assert(!Object.hasOwn(pkg.scripts,hook));
  for (const command of Object.values(pkg.scripts)) assert.doesNotMatch(command,/scripts\/deploy(?:-reserve)?\.mjs/);
});

test('canonical deployment default only describes the current token with unresolved public inputs', () => {
  const result = spawnSync(process.execPath,['scripts/prepare-retirement-deployment.mjs'],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  const description = JSON.parse(result.stdout);
  assert.equal(description.tokenContract,'FTIRetirementReviewToken');
  assert.equal(description.preparationComplete,false);
  assert.equal(description.deploymentReady,false);
  assert.equal(description.signed,false);
  assert.equal(description.broadcast,false);
  assert.deepEqual(description.unsignedTransactions,[]);
});

test('default historical browser launcher fails closed before opening a server', () => {
  const result = spawnSync(process.execPath,['scripts/launch-server.mjs'],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);
  assert.match(result.stderr,/historical browser launcher.*disabled/i);
  assert(!result.stdout.includes('http://'));
});

test('canonical deployment rejects historical models and execution requests before public config reads', () => {
  for (const flag of ['--funded-plan','--reserve-token','--broadcast','--execute']) {
    const result = spawnSync(process.execPath,['scripts/prepare-retirement-deployment.mjs',flag],{encoding:'utf8',timeout:10000});
    assert.equal(result.status,1);
    assert.match(result.stderr,/Unsupported option.*forbidden/);
    assert(!result.stdout.includes('SENT'));
  }
});

test('historical direct deployment scripts are retained unchanged but never invoked by npm scripts', () => {
  for (const [filename, expected] of [
    ['scripts/deploy-reserve.mjs','a6b2aa19eeb02f78ee77325a4ee0253eabecceff7fa0dc0e42e4624a8b828eca'],
    ['scripts/deploy.mjs','61d66ce58761e5295d82bf588d06cab24d2981a9874dcefe53dc9db787b04728'],
  ]) assert.equal(createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),expected);
});

test('local retirement configuration and generated unsigned manifests are excluded from source publication', () => {
  const ignore = fs.readFileSync('.gitignore','utf8');
  assert.match(ignore,/^deployments\/local-retirement\.json$/m);
  assert.match(ignore,/^\*\.unsigned\.json$/m);
  assert.match(ignore,/^deployments\/retirement-input\.json$/m);
});
