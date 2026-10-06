import test from 'node:test';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {AbiCoder, Interface, ZeroAddress, getAddress, getCreateAddress} from 'ethers';
import {describePreparation, prepareDeployment, validateArtifacts, validatePublicConfig, writeUnsignedManifest} from '../scripts/prepare-retirement-deployment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'scripts/prepare-retirement-deployment.mjs');
const names = ['MockUSD','Council','FTITimelock','FTIRetirementReviewToken','BinaryPlan'];
// TEST_ONLY public fixture identities. They are never signer credentials or deployment inputs.
const TEST_ONLY_address = number => getAddress(`0x${number.toString(16).padStart(40, '0')}`);
function TEST_ONLY_config() {
  return {chainId:97, deployer:TEST_ONLY_address(1001), nonce:37, development:TEST_ONLY_address(1002), owners:Array.from({length:7}, (_, index) => TEST_ONLY_address(index + 2001)), genesis:Array.from({length:31}, (_, index) => TEST_ONLY_address(index + 3001)), testOnly:true};
}
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fti-unsigned-TEST_ONLY-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  return dir;
}
function command(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {encoding:'utf8', timeout:10000, ...options});
}
function configFile(dir, config = TEST_ONLY_config()) {
  const filename = path.join(dir, 'public.TEST_ONLY.json');
  fs.writeFileSync(filename, JSON.stringify(config));
  return filename;
}
function copyFrozenFiles(dir) {
  fs.mkdirSync(path.join(dir, 'contracts'));
  fs.mkdirSync(path.join(dir, 'artifacts'));
  for (const filename of ['MockUSD.sol','Governance.sol','FTIRetirementReviewToken.sol','BinaryPlan.sol']) fs.copyFileSync(path.join(root, 'contracts', filename), path.join(dir, 'contracts', filename));
  for (const name of names) fs.copyFileSync(path.join(root, 'artifacts', `${name}.json`), path.join(dir, 'artifacts', `${name}.json`));
}

test('description validates five exact artifacts and fixed 5/7 + 72h metadata without claiming readiness', () => {
  const result = describePreparation();
  assert.equal(result.preparationComplete, false);
  assert.equal(result.deploymentReady, false);
  assert.equal(result.networkVerified, false);
  assert.equal(result.chainId, 97);
  assert.deepEqual(Object.keys(result.artifacts), names);
  assert.deepEqual(result.governance, {ownerCount:7, threshold:5, timelockDelaySeconds:259200, retirementDelaySeconds:259200, verifiedAgainstPinnedSources:true});
  assert.equal(result.steps.length, 6);
  assert.equal(result.steps[5].kind, 'contract-call');
  assert.equal(result.steps[5].method, 'bind(address)');
  assert.deepEqual(result.unsignedTransactions, []);
  assert.equal(Object.hasOwn(result, 'predictedAddresses'), false);
});

test('public config is normalized, fixture-labelled, and copied only through an explicit allowlist', () => {
  const config = TEST_ONLY_config();
  const validated = validatePublicConfig(config);
  assert.equal(validated.nonce, '37');
  assert.notEqual(validated.owners, config.owners);
  assert.equal(prepareDeployment(config).addressScope, 'TEST_ONLY_FIXTURES');
  delete config.testOnly;
  assert.equal(prepareDeployment(config).addressScope, 'USER_SUPPLIED_PUBLIC_ADDRESSES_UNVERIFIED');
});

test('five unsigned creations and sixth bind have correct constructor encodings, linking, sender, nonce, and chain', () => {
  const config = TEST_ONLY_config();
  const manifest = prepareDeployment(config);
  const a = manifest.predictedAddresses;
  const expectedArguments = [[], [config.owners], [a.Council], [a.MockUSD,a.FTITimelock,a.Council,config.development], [a.MockUSD,a.FTIRetirementReviewToken,a.FTITimelock,a.Council,config.development,config.genesis]];
  assert.equal(manifest.contractCount, 5);
  assert.equal(manifest.plannedTransactionCount, 6);
  assert.equal(manifest.unsignedTransactions.length, 6);
  assert.equal(manifest.unsignedTransactions.filter(entry => entry.kind === 'contract-creation').length, 5);
  for (let index = 0; index < 5; index++) {
    const transaction = manifest.unsignedTransactions[index];
    const artifact = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', `${names[index]}.json`)));
    const abi = new Interface(artifact.abi);
    assert.equal(transaction.contract, names[index]);
    assert.equal(transaction.predictedAddress, getCreateAddress({from:config.deployer, nonce:config.nonce + index}));
    assert.deepEqual(transaction.constructorArgs, expectedArguments[index]);
    assert.equal(transaction.request.data, artifact.bytecode + abi.encodeDeploy(expectedArguments[index]).slice(2));
    const decoded = AbiCoder.defaultAbiCoder().decode(abi.deploy.inputs, `0x${transaction.request.data.slice(artifact.bytecode.length)}`);
    assert.deepEqual(decoded.toArray(true), expectedArguments[index]);
    assert.equal(transaction.request.to, null);
  }
  const bind = manifest.unsignedTransactions[5];
  assert.equal(bind.kind, 'contract-call');
  assert.equal(bind.request.to, a.FTIRetirementReviewToken);
  assert.deepEqual(bind.arguments, [a.BinaryPlan]);
  const tokenArtifact = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/FTIRetirementReviewToken.json')));
  assert.equal(new Interface(tokenArtifact.abi).decodeFunctionData('bind', bind.request.data)[0], a.BinaryPlan);
  for (const [index, transaction] of manifest.unsignedTransactions.entries()) {
    assert.equal(transaction.request.from, config.deployer);
    assert.equal(transaction.request.chainId, 97);
    assert.equal(transaction.request.nonce, String(config.nonce + index));
    assert.equal(transaction.request.value, '0');
    assert.equal(Object.hasOwn(transaction.request, 'signature'), false);
    assert.equal(Object.hasOwn(transaction.request, 'gasPrice'), false);
  }
});

test('new retirement token pins are frozen and no old token is a deployment target', () => {
  const manifest = prepareDeployment(TEST_ONLY_config());
  assert.equal(manifest.tokenContract, 'FTIRetirementReviewToken');
  assert.equal(manifest.artifacts.FTIRetirementReviewToken.sourceSHA256, '89de8c1e8babbb0b5cf8ad20b92d96f176f2d3f89e9319e7328c7c52f0676ccb');
  assert.equal(manifest.artifacts.FTIRetirementReviewToken.artifactSHA256, 'f7821bc76f101bc010d5c61a34408f821f2867e13f53007308335036e0d8d0dd');
  assert(!JSON.stringify(manifest).includes('FTIReserveToken'));
  assert(!JSON.stringify(manifest).includes('FundedBinaryPlan'));
  assert.equal(manifest.deploymentReady, false);
  assert.equal(manifest.deploymentApproved, false);
  assert.equal(manifest.preparationComplete, true);
  assert.match(manifest.boundaries.join(' '), /Pending-auto conversion is implemented for the same beneficiary/);
});

test('unsigned preparation is deterministic for the same explicit public inputs', () => {
  assert.deepEqual(prepareDeployment(TEST_ONLY_config()), prepareDeployment(TEST_ONLY_config()));
});

test('default CLI and --describe remain read-only with missing public configuration', t => {
  const dir = temporary(t);
  for (const args of [[], ['--describe']]) {
    const result = command(args, {cwd:dir});
    assert.equal(result.status, 0, result.stderr);
    const description = JSON.parse(result.stdout);
    assert.equal(description.preparationComplete, false);
    assert.equal(description.deploymentReady, false);
    assert.deepEqual(description.unsignedTransactions, []);
  }
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('CLI creates exactly one clearly unsigned fixture manifest with restrictive permissions', t => {
  const dir = temporary(t);
  const input = configFile(dir);
  const output = path.join(dir, 'TEST_ONLY.unsigned.json');
  const result = command(['--config', input, '--output', output, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /UNSIGNED LOCAL REVIEW/);
  const manifest = JSON.parse(fs.readFileSync(output));
  assert.equal(manifest.addressScope, 'TEST_ONLY_FIXTURES');
  assert.equal(manifest.unsignedTransactions.length, 6);
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['TEST_ONLY.unsigned.json','public.TEST_ONLY.json']);
});

test('all chains except explicitly numeric chain 97 fail closed', () => {
  for (const chainId of [undefined,null,0,1,56,31337,'97',98]) assert.throws(() => prepareDeployment({...TEST_ONLY_config(), chainId}), /chainId 97/);
});

test('every required public input must be explicit, with no defaults or inferred addresses/nonces', () => {
  for (const key of ['chainId','deployer','nonce','development','owners','genesis']) {
    const config = TEST_ONLY_config();
    delete config[key];
    assert.throws(() => prepareDeployment(config), undefined, key);
  }
  for (const config of [null,undefined,[],true]) assert.throws(() => prepareDeployment(config), /configuration object/);
});

test('seven Council owners must be distinct after address normalization', () => {
  const config = TEST_ONLY_config();
  config.owners[6] = config.owners[0].toLowerCase();
  assert.throws(() => prepareDeployment(config), /7 distinct nonzero Council owner/);
});

test('seven nonzero valid Council owners are required', () => {
  for (const owners of [[],TEST_ONLY_config().owners.slice(0,6),[...TEST_ONLY_config().owners,TEST_ONLY_address(7777)]]) assert.throws(() => prepareDeployment({...TEST_ONLY_config(), owners}), /7 distinct nonzero Council owner/);
  for (const value of [ZeroAddress,'not-an-address',null]) {
    const config = TEST_ONLY_config(); config.owners[0] = value;
    assert.throws(() => prepareDeployment(config), /nonzero Council owner/);
  }
});

test('31 genesis addresses must be distinct after normalization', () => {
  const config = TEST_ONLY_config(); config.genesis[30] = config.genesis[0].toLowerCase();
  assert.throws(() => prepareDeployment(config), /31 distinct nonzero genesis/);
});

test('31 nonzero valid genesis addresses are required', () => {
  for (const genesis of [[],TEST_ONLY_config().genesis.slice(0,30),[...TEST_ONLY_config().genesis,TEST_ONLY_address(8888)]]) assert.throws(() => prepareDeployment({...TEST_ONLY_config(), genesis}), /31 distinct nonzero genesis/);
  for (const value of [ZeroAddress,'bad-genesis',null]) {
    const config = TEST_ONLY_config(); config.genesis[0] = value;
    assert.throws(() => prepareDeployment(config), /nonzero genesis/);
  }
});

test('development and deployer must be valid explicit nonzero addresses', () => {
  for (const key of ['development','deployer']) for (const value of [undefined,null,ZeroAddress,'',42,'secret-invalid-address']) {
    assert.throws(() => prepareDeployment({...TEST_ONLY_config(), [key]:value}), error => error.message.includes(`nonzero ${key}`) && !error.message.includes('secret-invalid-address'));
  }
});

test('development destination cannot conflict with stablecoin, token, or BinaryPlan predictions', () => {
  const config = TEST_ONLY_config();
  const addresses = prepareDeployment(config).predictedAddresses;
  for (const name of ['MockUSD','FTIRetirementReviewToken','BinaryPlan']) assert.throws(() => prepareDeployment({...config, development:addresses[name]}), /Development address conflicts/);
});

test('nonce rejects absent, fractional, negative, ambiguous, unsafe, or exhausted account values', () => {
  for (const nonce of [undefined,null,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER + 1,'','01','0x1','1e2','-1',' 1','18446744073709551610']) assert.throws(() => prepareDeployment({...TEST_ONLY_config(), nonce}), /nonce/i);
});

test('explicit decimal nonces beyond Number precision are preserved without guessing', () => {
  const nonce = '9007199254740993';
  const manifest = prepareDeployment({...TEST_ONLY_config(), nonce});
  assert.equal(manifest.unsignedTransactions[0].request.nonce, nonce);
  assert.equal(manifest.unsignedTransactions[5].request.nonce, '9007199254740998');
  const zero = prepareDeployment({...TEST_ONLY_config(), nonce:0});
  assert.equal(zero.unsignedTransactions[0].request.nonce, '0');
});

test('unknown configuration fields, secrets, and attempted governance overrides are rejected without echoing them', () => {
  for (const extra of [{privateKey:'TEST_SECRET_DO_NOT_ECHO'},{TEST_SECRET_FIELD:'TEST_SECRET_DO_NOT_ECHO'},{rpcUrl:'https://example.invalid/TEST_SECRET_DO_NOT_ECHO'},{threshold:3},{timelockDelaySeconds:1},{tokenContract:'FTIReserveToken'}]) {
    assert.throws(() => prepareDeployment({...TEST_ONLY_config(), ...extra}), error => /Unsupported public configuration fields/.test(error.message) && !/TEST_SECRET|FTIReserveToken|example/.test(error.message));
  }
  assert.throws(() => prepareDeployment({...TEST_ONLY_config(), testOnly:'true'}), /boolean/);
});

test('CLI does not leak invalid JSON or unsupported secret values', t => {
  const dir = temporary(t);
  const filename = path.join(dir, 'public.json');
  const output = path.join(dir, 'secret-check.unsigned.json');
  for (const content of ['{"TEST_SECRET_DO_NOT_ECHO":', JSON.stringify({...TEST_ONLY_config(), secret:'TEST_SECRET_DO_NOT_ECHO'})]) {
    fs.writeFileSync(filename, content);
    const result = command(['--config', filename, '--output', output]);
    assert.equal(result.status, 1);
    assert(!`${result.stdout}${result.stderr}`.includes('TEST_SECRET_DO_NOT_ECHO'));
    assert.equal(fs.existsSync(output), false);
  }
});

test('source hash mismatch and missing sources stop preparation before output', t => {
  const dir = temporary(t); copyFrozenFiles(dir);
  const filename = path.join(dir, 'contracts/FTIRetirementReviewToken.sol');
  fs.appendFileSync(filename, '\n// TEST_ONLY tampering');
  assert.throws(() => prepareDeployment(TEST_ONLY_config(), {root:dir}), /Source SHA256 mismatch: FTIRetirementReviewToken/);
  fs.unlinkSync(filename);
  assert.throws(() => describePreparation({root:dir}), /Missing or unreadable pinned source/);
});

test('artifact hash mismatch or substitution of the old token is rejected', t => {
  const dir = temporary(t); copyFrozenFiles(dir);
  const filename = path.join(dir, 'artifacts/FTIRetirementReviewToken.json');
  fs.appendFileSync(filename, '\n');
  assert.throws(() => prepareDeployment(TEST_ONLY_config(), {root:dir}), /Artifact SHA256 mismatch: FTIRetirementReviewToken/);
  fs.copyFileSync(path.join(root, 'artifacts/FTIReserveToken.json'), filename);
  assert.throws(() => prepareDeployment(TEST_ONLY_config(), {root:dir}), /Artifact SHA256 mismatch: FTIRetirementReviewToken/);
});

test('governance changes are rejected rather than reported as fixed 5/7 + 72h', t => {
  const dir = temporary(t); copyFrozenFiles(dir);
  const filename = path.join(dir, 'contracts/Governance.sol');
  fs.writeFileSync(filename, fs.readFileSync(filename, 'utf8').replace('THRESHOLD=5;', 'THRESHOLD=3;'));
  assert.throws(() => describePreparation({root:dir}), /Source SHA256 mismatch: Council/);
});

test('output and every supported related journal/deployment record are preserved without overwrite', t => {
  const dir = temporary(t);
  const manifest = prepareDeployment(TEST_ONLY_config());
  const output = path.join(dir, 'new.unsigned.json');
  for (const filename of [output, `${output}.progress.json`, `${output}.journal.json`, path.join(dir,'new.progress.json'), path.join(dir,'new.journal.json'), path.join(dir,'new.json')]) {
    fs.writeFileSync(filename, 'TEST_ONLY keep this record');
    assert.throws(() => writeUnsignedManifest(manifest, output), /already exists/);
    assert.equal(fs.readFileSync(filename, 'utf8'), 'TEST_ONLY keep this record');
    fs.unlinkSync(filename);
  }
});

test('dangling output or journal symlinks are treated as existing records', t => {
  const dir = temporary(t);
  const manifest = prepareDeployment(TEST_ONLY_config());
  const output = path.join(dir, 'new.unsigned.json');
  for (const filename of [output, `${output}.progress.json`]) {
    fs.symlinkSync(path.join(dir, 'missing-target'), filename);
    assert.throws(() => writeUnsignedManifest(manifest, output), /already exists/);
    assert(fs.lstatSync(filename).isSymbolicLink());
    fs.unlinkSync(filename);
  }
});

test('writing requires an explicitly unsigned complete chain-97 manifest and new unsigned filename', t => {
  const dir = temporary(t);
  const manifest = prepareDeployment(TEST_ONLY_config());
  for (const filename of ['testnet.json','new.progress.json','new.json']) assert.throws(() => writeUnsignedManifest(manifest, path.join(dir, filename)), /\.unsigned\.json/);
  for (const change of [{signed:true},{broadcast:true},{deploymentReady:true},{deploymentApproved:true},{networkVerified:true},{chainId:56},{preparationComplete:false},{status:'deployed'}]) assert.throws(() => writeUnsignedManifest({...manifest,...change}, path.join(dir,'new.unsigned.json')), /explicitly unsigned/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('broadcast, execute, signer, RPC, legacy and unknown CLI flags fail before config reads or file writes', t => {
  const dir = temporary(t);
  for (const option of ['--broadcast','--execute','--sign','--send','--rpc-url','--private-key','--funded-plan','--reserve-token','--chain-id','--broadcast=true']) {
    const result = command(['--config', path.join(dir,'missing.json'), '--output', path.join(dir,'new.unsigned.json'), option], {cwd:dir});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported option.*forbidden/);
    assert.equal(result.stdout, '');
  }
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('incomplete and contradictory CLI modes fail closed', t => {
  const dir = temporary(t);
  for (const args of [['--dry-run'],['--config','missing.json'],['--output','new.unsigned.json'],['--describe','--config','missing.json'],['--describe','--dry-run'],['--help','--broadcast'],['--config','a','--config','b','--output','x.unsigned.json']]) {
    const result = command(args, {cwd:dir});
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('unsigned CLI preparation works with all network calls and credential/environment-file reads actively blocked', t => {
  const dir = temporary(t);
  const input = configFile(dir);
  const output = path.join(dir, 'offline.unsigned.json');
  const guard = path.join(dir, 'deny-network-and-secrets.mjs');
  fs.writeFileSync(guard, `
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import {syncBuiltinESMExports} from 'node:module';
const denied = () => { throw Error('TEST_ONLY_FORBIDDEN_NETWORK_OR_SECRET_READ'); };
net.connect = denied; net.createConnection = denied; net.Socket.prototype.connect = denied;
http.request = denied; http.get = denied; https.request = denied; https.get = denied;
dns.lookup = denied; dns.resolve = denied; globalThis.fetch = denied;
const read = fs.readFileSync.bind(fs);
fs.readFileSync = (name, ...args) => { if (/(^|[/\\\\])\\.env(?:$|[.])/.test(String(name))) denied(); return read(name,...args); };
const environment = process.env;
process.env = new Proxy(environment, {get(target,key) { if (/PRIVATE|SECRET|PASSWORD|MNEMONIC|RPC_URL|CONFIG_FILE|DEPLOYMENT_FILE/.test(String(key))) denied(); return Reflect.get(target,key); }});
syncBuiltinESMExports();
`);
  const result = spawnSync(process.execPath, ['--import',guard,cli,'--config',input,'--output',output], {encoding:'utf8',timeout:10000,env:{...process.env,DEPLOYER_PRIVATE_KEY:'TEST_SECRET_NEVER_READ',RPC_URL:'http://example.invalid/TEST_SECRET_NEVER_READ',CONFIG_FILE:'TEST_SECRET_NEVER_READ'}});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(output)).unsignedTransactions.length, 6);
  assert(!`${result.stdout}${result.stderr}${fs.readFileSync(output,'utf8')}`.includes('TEST_SECRET_NEVER_READ'));
  const source = fs.readFileSync(cli,'utf8');
  assert.doesNotMatch(source, /process\.env|dotenv|JsonRpcProvider|BrowserProvider|\bWallet\b|sendTransaction|broadcastTransaction|\.deploy\(/);
  assert.doesNotMatch(source, /from ['"]\.\/lib\.mjs/);
});

test('frozen artifacts retain identity, compiler, ABI and exact creation-bytecode evidence', () => {
  const {artifacts,evidence} = validateArtifacts();
  for (const name of names) {
    assert.equal(artifacts[name].contractName,name);
    assert.equal(evidence[name].compiler,'0.8.30+commit.73712a01.Emscripten.clang');
    assert.match(evidence[name].sourceSHA256,/^[a-f0-9]{64}$/);
    assert.match(evidence[name].artifactSHA256,/^[a-f0-9]{64}$/);
    assert.match(evidence[name].creationBytecodeSHA256,/^[a-f0-9]{64}$/);
    assert.match(evidence[name].creationBytecodeKeccak256,/^0x[a-f0-9]{64}$/);
  }
});


test('combined lifecycle and immediate-auto ABI metadata describe the frozen implementation', () => {
  const result = describePreparation();
  assert.equal(result.artifacts.BinaryPlan.sourceSHA256, '9844e9b6b14553e0eb14352d43ab65e0cefda18d7c07a87101d074959c198271');
  assert.equal(result.artifacts.BinaryPlan.artifactSHA256, '74c55aff04054d58d9f7ea9c9720032a0d6fe7572b248fa881dca0b9ee1cd4cb');
  assert.equal(result.lifecycle.approvalABI, 'approveRetirementAction(bytes4,uint256)');
  assert.equal(result.lifecycle.ordinaryZeroSupply, 'RESTARTABLE');
  assert.equal(result.lifecycle.automaticSupportFundUse, 'NOT_IMPLEMENTED');
  assert.equal(result.lifecycle.permanentBuyClosureMarker, 'buysPermanentlyClosed');
  assert.equal(result.lifecycle.immediateAutoBuy, 'NO_USER_PRICE_CAP_ATOMIC_QUOTE');
  assert.match(result.lifecycle.closedAutoConversion, /SAME_BENEFICIARY.*PERMANENTLY_BUY_CLOSED/);
});

test('actual historical token and Binary source/artifact pins are rejected independently', t => {
  const dir = temporary(t);
  const historical = JSON.parse(gunzipSync(fs.readFileSync(path.join(root, 'test/fixtures/pre-combined-unsigned-pins.json.gz'))));
  const expected = {
    'contracts/FTIRetirementReviewToken.sol':'0ad9664006aadb83ba5141ec0b43982e3dd444356922974a2fb1d6593d34aba3',
    'contracts/BinaryPlan.sol':'92a39d6f728b492b46ae54f53d36e15d8d20a1c1a082acca81bcdc6babe81789',
    'artifacts/FTIRetirementReviewToken.json':'052ca59dd7f550d8656c9f43f7c5d56c0b90479c8bebe4e2dd976f9ecbfe4b3a',
    'artifacts/BinaryPlan.json':'066818fc06217e09abfe76f9b2189947cbef1b6f328739023c1d9f93c362fe1d',
  };
  copyFrozenFiles(dir);
  for (const [filename, hash] of Object.entries(expected)) {
    assert.equal(createHash('sha256').update(historical[filename]).digest('hex'), hash);
    fs.writeFileSync(path.join(dir, filename), historical[filename]);
    const kind = filename.startsWith('contracts/') ? 'Source' : 'Artifact';
    const name = path.basename(filename).replace(/\.(sol|json)$/, '');
    assert.throws(() => prepareDeployment(TEST_ONLY_config(), {root:dir}), new RegExp(`${kind} SHA256 mismatch: ${name}`));
    fs.copyFileSync(path.join(root, filename), path.join(dir, filename));
  }
});

test('writer atomically rejects incomplete sequence, modified bytecode, dependencies, bind, or evidence', t => {
  const dir = temporary(t);
  const output = path.join(dir, 'mutated.unsigned.json');
  const mutations = [
    m => m.unsignedTransactions.pop(),
    m => { m.unsignedTransactions[0].request.data = '0x00'; },
    m => { m.unsignedTransactions[4].constructorArgs[1] = TEST_ONLY_address(9999); },
    m => { m.unsignedTransactions[5].request.to = TEST_ONLY_address(9999); },
    m => { m.unsignedTransactions[5].request.nonce = '999'; },
    m => { m.artifacts.BinaryPlan.creationBytecodeSHA256 = '0'.repeat(64); },
    m => { m.predictedAddresses.BinaryPlan = TEST_ONLY_address(9999); },
  ];
  for (const mutate of mutations) {
    const manifest = prepareDeployment(TEST_ONLY_config()); mutate(manifest);
    assert.throws(() => writeUnsignedManifest(manifest, output), /differs from the complete pinned preparation/);
    assert.deepEqual(fs.readdirSync(dir), []);
  }
});

test('checked-in descriptor equals the current validated public-input-free description', () => {
  const descriptor = JSON.parse(fs.readFileSync(path.join(root, 'docs/retirement-review/UNSIGNED-DEPLOYMENT-PLAN.json')));
  assert.deepEqual(descriptor, describePreparation());
  for (const flag of ['deploymentReady','deploymentApproved','networkVerified','signed','broadcast','preparationComplete']) assert.equal(descriptor[flag], false);
  assert.deepEqual(descriptor.requiredPublicInputs, ['chainId (97)','deployer','nonce','development','owners (7 distinct nonzero addresses)','genesis (31 distinct nonzero addresses)']);
});
