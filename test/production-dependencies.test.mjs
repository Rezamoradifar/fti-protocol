import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const manifest=JSON.parse(fs.readFileSync('config/mainnet-ui-release.json'));
test('release ships wallet libraries within its versioned asset manifest',()=>{
 for(const file of ['web/vendor/ethers.js','web/vendor/walletconnect.js'])assert.ok(manifest.files[file]);
 const bundle=fs.readFileSync('web/app.js','utf8');
 assert.match(bundle,/from["']\.\/vendor\/ethers\.js["']/);
 assert.match(bundle,/import\(["']\.\/vendor\/walletconnect\.js["']\)/);
 assert.doesNotMatch(bundle,/(?:from|import\()["']\/vendor\//);
});
test('production install excludes contract test toolchain and retains build/audit tools',()=>{
 const pkg=JSON.parse(fs.readFileSync('package.json'));
 assert.equal(pkg.dependencies.ganache,undefined);assert.equal(pkg.dependencies.solc,undefined);
 assert.ok(pkg.dependencies.esbuild);assert.ok(pkg.dependencies.semver);
 const installer=fs.readFileSync('tools/update-mainnet-ui.sh','utf8');
 assert.match(installer,/npm ci --omit=dev/);assert.match(installer,/audit-installed\.mjs .*--enforce/);
});
