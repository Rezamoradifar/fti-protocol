import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Interface, ZeroAddress, concat, getAddress, getCreateAddress, keccak256} from 'ethers';

// Offline, unsigned LOCAL REVIEW ONLY. There is deliberately no execution path.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const COMPILER = '0.8.30+commit.73712a01.Emscripten.clang';
const CHAIN_ID = 97;
const MAX_START_NONCE = (1n << 64n) - 7n; // All six nonce values must remain below 2^64 - 1.
const CONTRACTS = Object.freeze([
  {name:'MockUSD', source:'MockUSD.sol', sourceSHA256:'660b95edc8684c476f7c50c0da618c16b71ef5c82d948042d20dcd963a229157', artifactSHA256:'ec1f602838cc94fe7cf974c6f063c2936a10bb4435a34f1e392da60c9c0e9d22', types:[], references:[]},
  {name:'Council', source:'Governance.sol', sourceSHA256:'ca1e638e4c4f9184c03dabdd23e6fc444c1b1fb4c5c3822898dda1f6263c7540', artifactSHA256:'d32c0d79be8f09daa734597a9c9def3ced264de9b7c8f226b9be44b6e1d3241c', types:['address[7]'], references:['$owners']},
  {name:'FTITimelock', source:'Governance.sol', sourceSHA256:'ca1e638e4c4f9184c03dabdd23e6fc444c1b1fb4c5c3822898dda1f6263c7540', artifactSHA256:'ba6672cc9864c4c1eefebf2d391c13b3f548e6f132ae50bb92a99410cd9cfcb1', types:['address'], references:['$Council']},
  {name:'FTIRetirementReviewToken', source:'FTIRetirementReviewToken.sol', sourceSHA256:'89de8c1e8babbb0b5cf8ad20b92d96f176f2d3f89e9319e7328c7c52f0676ccb', artifactSHA256:'f7821bc76f101bc010d5c61a34408f821f2867e13f53007308335036e0d8d0dd', types:['address','address','address','address'], references:['$MockUSD','$FTITimelock','$Council','$development']},
  {name:'BinaryPlan', source:'BinaryPlan.sol', sourceSHA256:'9844e9b6b14553e0eb14352d43ab65e0cefda18d7c07a87101d074959c198271', artifactSHA256:'74c55aff04054d58d9f7ea9c9720032a0d6fe7572b248fa881dca0b9ee1cd4cb', types:['address','address','address','address','address','address[31]'], references:['$MockUSD','$FTIRetirementReviewToken','$FTITimelock','$Council','$development','$genesis']},
].map(entry => Object.freeze(entry)));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };

export function validateArtifacts(root = ROOT) {
  const artifacts = {};
  const evidence = {};
  for (const pin of CONTRACTS) {
    let sourceBytes, artifactBytes, artifact;
    try {
      sourceBytes = fs.readFileSync(path.join(root, 'contracts', pin.source));
      artifactBytes = fs.readFileSync(path.join(root, 'artifacts', `${pin.name}.json`));
    } catch { fail(`Missing or unreadable pinned source/artifact: ${pin.name}`); }
    if (sha256(sourceBytes) !== pin.sourceSHA256) fail(`Source SHA256 mismatch: ${pin.name}`);
    if (sha256(artifactBytes) !== pin.artifactSHA256) fail(`Artifact SHA256 mismatch: ${pin.name}`);
    try { artifact = JSON.parse(artifactBytes.toString('utf8')); }
    catch { fail(`Invalid pinned artifact JSON: ${pin.name}`); }
    if (artifact.contractName !== pin.name || artifact.source !== pin.source || artifact.compiler !== COMPILER) fail(`Artifact identity/compiler mismatch: ${pin.name}`);
    if (typeof artifact.bytecode !== 'string' || !/^0x(?:[a-fA-F0-9]{2})+$/.test(artifact.bytecode)) fail(`Invalid creation bytecode: ${pin.name}`);
    const constructors = artifact.abi.filter(item => item.type === 'constructor');
    if (constructors.length !== 1 || JSON.stringify(constructors[0].inputs.map(input => input.type)) !== JSON.stringify(pin.types)) fail(`Constructor mismatch: ${pin.name}`);
    artifacts[pin.name] = artifact;
    evidence[pin.name] = {
      contractName:pin.name, source:`contracts/${pin.source}`, sourceSHA256:pin.sourceSHA256,
      artifact:`artifacts/${pin.name}.json`, artifactSHA256:pin.artifactSHA256, compiler:COMPILER,
      creationBytecodeSHA256:sha256(Buffer.from(artifact.bytecode.slice(2), 'hex')),
      creationBytecodeKeccak256:keccak256(artifact.bytecode), constructorTypes:pin.types,
    };
  }
  // These metadata assertions are tied to the exact, frozen source hashes above.
  const governance = fs.readFileSync(path.join(root, 'contracts/Governance.sol'), 'utf8');
  const token = fs.readFileSync(path.join(root, 'contracts/FTIRetirementReviewToken.sol'), 'utf8');
  if (!/OWNER_COUNT\s*=\s*7\s*;/.test(governance) || !/THRESHOLD\s*=\s*5\s*;/.test(governance) || !/FIXED_MIN_DELAY\s*=\s*72 hours\s*;/.test(governance) || !/RETIREMENT_DELAY\s*=\s*72 hours\s*;/.test(token)) fail('Fixed five-of-seven / 72-hour source metadata mismatch');
  const tokenInterface = new Interface(artifacts.FTIRetirementReviewToken.abi);
  if (!tokenInterface.hasFunction('bind(address)') || !tokenInterface.hasFunction('permanentlyRetired()') || !tokenInterface.hasFunction('developmentFund()')) fail('Retirement token lifecycle ABI mismatch');
  for (const signature of ['lifecycleNonce()', 'approveRetirementAction(bytes4,uint256)', 'buysPermanentlyClosed()', 'closeBuysPermanently()', 'retirePermanently()', 'autoBuy(address,uint256,uint256,uint256)']) {
    if (!tokenInterface.hasFunction(signature)) fail('Retirement token lifecycle ABI mismatch');
  }
  if (tokenInterface.hasFunction('approveRetirementAction(bytes4)')) fail('Stale retirement approval ABI');
  const binaryInterface = new Interface(artifacts.BinaryPlan.abi);
  for (const signature of ['setAutoBuy(bool)', 'effectiveAutoEnabled(address)', 'executeAuto(address,uint256)', 'executeImmediateAuto(address,uint256)', 'releaseClosedTokenAutoToCash(uint256,uint256)', 'pendingAutoAccountCount()']) {
    if (!binaryInterface.hasFunction(signature)) fail('Binary immediate-auto ABI mismatch');
  }
  return {artifacts, evidence};
}

function address(value, label) {
  if (typeof value !== 'string') fail(`Provide an explicit nonzero ${label} address`);
  let normalized;
  try { normalized = getAddress(value); } catch { fail(`Provide a valid nonzero ${label} address`); }
  if (normalized === ZeroAddress) fail(`Provide a nonzero ${label} address`);
  return normalized;
}
function addresses(value, count, label) {
  if (!Array.isArray(value) || value.length !== count) fail(`Provide ${count} distinct nonzero ${label} addresses`);
  const normalized = value.map(entry => address(entry, label));
  if (new Set(normalized).size !== count) fail(`Provide ${count} distinct nonzero ${label} addresses`);
  return normalized;
}
export function validatePublicConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('Provide a public configuration object');
  const allowed = new Set(['chainId','deployer','nonce','development','owners','genesis','testOnly']);
  // Never repeat arbitrary field names, values, parser errors, or the raw configuration.
  if (Object.keys(config).some(key => !allowed.has(key))) fail('Unsupported public configuration fields; include only chainId, deployer, nonce, development, owners, genesis, and optional testOnly');
  if (config.chainId !== CHAIN_ID) fail('Explicit chainId 97 is required; other chains are forbidden');
  const deployer = address(config.deployer, 'deployer');
  const development = address(config.development, 'development');
  const owners = addresses(config.owners, 7, 'Council owner');
  const genesis = addresses(config.genesis, 31, 'genesis');
  const validNumber = typeof config.nonce === 'number' && Number.isSafeInteger(config.nonce) && config.nonce >= 0;
  const validString = typeof config.nonce === 'string' && /^(0|[1-9][0-9]*)$/.test(config.nonce) && config.nonce.length <= 20;
  if (!validNumber && !validString) fail('Provide an explicit nonnegative nonce as a safe integer or canonical decimal string');
  const nonce = BigInt(config.nonce);
  if (nonce > MAX_START_NONCE) fail('Starting nonce leaves insufficient account nonce range for all six unsigned transactions');
  if (Object.hasOwn(config, 'testOnly') && typeof config.testOnly !== 'boolean') fail('Optional testOnly must be a boolean');
  return {chainId:CHAIN_ID, deployer, nonce:nonce.toString(), development, owners, genesis, testOnly:config.testOnly === true};
}

function common(evidence) {
  return {
    schema:'fti-retirement-unsigned-preparation-v1', status:'UNSIGNED_LOCAL_REVIEW_ONLY',
    chainId:CHAIN_ID, network:'BNB Smart Chain Testnet', tokenContract:'FTIRetirementReviewToken', binaryContract:'BinaryPlan',
    deploymentReady:false, deploymentApproved:false, signed:false, broadcast:false, networkVerified:false,
    governance:{ownerCount:7, threshold:5, timelockDelaySeconds:259200, retirementDelaySeconds:259200, verifiedAgainstPinnedSources:true},
    lifecycle:{ordinaryZeroSupply:'RESTARTABLE', referencePrice:'EXACT_RESERVE_SUPPLY_RATIO', approvalABI:'approveRetirementAction(bytes4,uint256)', approvalScope:'EXPECTED_LIFECYCLE_NONCE', permanentBuyClosureMarker:'buysPermanentlyClosed', immediateAutoBuy:'NO_USER_PRICE_CAP_ATOMIC_QUOTE', failedAutoBuy:'PENDING_RETRY_OR_BENEFICIARY_CASH_RELEASE', closedAutoConversion:'PERMISSIONLESS_SAME_BENEFICIARY_ONLY_WHEN_PERMANENTLY_BUY_CLOSED_AND_BINARY_PAUSED_IDLE', automaticSupportFundUse:'NOT_IMPLEMENTED'},
    collateral:'TEST ONLY MockUSD public faucet; never real collateral',
    contractCount:5, plannedTransactionCount:6, artifacts:evidence,
    boundaries:[
      'This manifest contains unsigned requests only and cannot execute them.',
      'No network, live nonce, address ownership, chain state, balance, gas estimate, or fee data was checked.',
      'Predictions require this deployer and exactly these six consecutive nonce values; intervening transactions invalidate the sequence.',
      'No signing or broadcast authorization is granted. Separate review and authorization are required.',
      'Pending-auto conversion is implemented for the same beneficiary after permanent buy closure and while Binary is paused and idle; ordinary zero supply remains restartable and does not authorize conversion.',
      'Final retirement requires zero supply/reserve, cleared token development claims and pending auto, and a quiescent Binary; ordinary Binary cash claims remain with their beneficiaries.',
      'Post-retirement membership and terminal precision dust remain open integration decisions; the 7% size-curve coefficient is provisional.',
    ],
  };
}
export function describePreparation({root = ROOT} = {}) {
  const {evidence} = validateArtifacts(root);
  return {
    ...common(evidence), preparationComplete:false, status:'DESCRIPTION_ONLY_MISSING_PUBLIC_CONFIGURATION',
    requiredPublicInputs:['chainId (97)','deployer','nonce','development','owners (7 distinct nonzero addresses)','genesis (31 distinct nonzero addresses)'],
    optionalPublicInputs:['testOnly (true for all fixture/example addresses)'],
    steps:[...CONTRACTS.map((entry, index) => ({index:index + 1, kind:'contract-creation', contract:entry.name, constructorReferences:entry.references})),
      {index:6, kind:'contract-call', target:'$FTIRetirementReviewToken', method:'bind(address)', argumentReferences:['$BinaryPlan'], sender:'$deployer'}],
    unsignedTransactions:[],
  };
}
export function prepareDeployment(config, {root = ROOT} = {}) {
  const publicInputs = validatePublicConfig(config);
  const {artifacts, evidence} = validateArtifacts(root);
  const initialNonce = BigInt(publicInputs.nonce);
  const predictedAddresses = Object.fromEntries(CONTRACTS.map((entry, index) => [entry.name, getCreateAddress({from:publicInputs.deployer, nonce:initialNonce + BigInt(index)})]));
  // Mirror constructor and bind restrictions, without inventing a treasury identity.
  if (['MockUSD','FTIRetirementReviewToken','BinaryPlan'].some(name => predictedAddresses[name] === publicInputs.development)) fail('Development address conflicts with the predicted stablecoin, token, or BinaryPlan destination');
  const references = {...predictedAddresses, owners:publicInputs.owners, genesis:publicInputs.genesis, development:publicInputs.development};
  const unsignedTransactions = CONTRACTS.map((entry, index) => {
    const constructorArgs = entry.references.map(reference => references[reference.slice(1)]);
    const abi = new Interface(artifacts[entry.name].abi);
    return {
      index:index + 1, kind:'contract-creation', contract:entry.name,
      predictedAddress:predictedAddresses[entry.name], constructorArgs,
      request:{chainId:CHAIN_ID, from:publicInputs.deployer, nonce:(initialNonce + BigInt(index)).toString(), to:null, value:'0', data:concat([artifacts[entry.name].bytecode, abi.encodeDeploy(constructorArgs)])},
    };
  });
  unsignedTransactions.push({
    index:6, kind:'contract-call', contract:'FTIRetirementReviewToken', method:'bind(address)', arguments:[predictedAddresses.BinaryPlan],
    request:{chainId:CHAIN_ID, from:publicInputs.deployer, nonce:(initialNonce + 5n).toString(), to:predictedAddresses.FTIRetirementReviewToken, value:'0', data:new Interface(artifacts.FTIRetirementReviewToken.abi).encodeFunctionData('bind', [predictedAddresses.BinaryPlan])},
  });
  return {
    ...common(evidence), preparationComplete:true,
    addressScope:publicInputs.testOnly ? 'TEST_ONLY_FIXTURES' : 'USER_SUPPLIED_PUBLIC_ADDRESSES_UNVERIFIED',
    publicInputs, predictedAddresses, unsignedTransactions,
    omittedTransactionFields:['gasLimit','gasPrice','maxFeePerGas','maxPriorityFeePerGas','type','signature'],
  };
}

function pathExists(filename) {
  try { fs.lstatSync(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export function writeUnsignedManifest(manifest, output) {
  if (!output || typeof output !== 'string' || !output.endsWith('.unsigned.json')) fail('Output filename must end in .unsigned.json');
  if (manifest.schema !== 'fti-retirement-unsigned-preparation-v1' || manifest.status !== 'UNSIGNED_LOCAL_REVIEW_ONLY' || manifest.preparationComplete !== true || manifest.signed !== false || manifest.broadcast !== false || manifest.deploymentReady !== false || manifest.deploymentApproved !== false || manifest.networkVerified !== false || manifest.chainId !== CHAIN_ID) fail('Only an explicitly unsigned, complete chain-97 preparation may be written');
  // Re-derive the complete sequence before any filesystem write. A caller cannot
  // replace bytecode, omit bind, relink dependencies, or raise readiness flags.
  if (JSON.stringify(manifest) !== JSON.stringify(prepareDeployment(manifest.publicInputs))) fail('Unsigned manifest differs from the complete pinned preparation');
  const filename = path.resolve(output);
  const stem = filename.slice(0, -'.unsigned.json'.length);
  const protectedPaths = [filename, `${filename}.progress.json`, `${filename}.journal.json`, `${stem}.progress.json`, `${stem}.journal.json`, `${stem}.json`];
  if (protectedPaths.some(pathExists)) fail('Output, related deployment record, or journal already exists; inspect it and choose a new output, never overwrite');
  try { fs.writeFileSync(filename, JSON.stringify(manifest, null, 2) + '\n', {flag:'wx', mode:0o600}); }
  catch { fail('Could not create a new unsigned manifest; ensure its parent directory exists and no output already exists'); }
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (['--describe','--dry-run','--help'].includes(argument)) {
      if (options[argument]) fail('Duplicate options are not allowed');
      options[argument] = true;
    } else if (argument === '--config' || argument === '--output') {
      if (Object.hasOwn(options, argument) || !argv[i + 1] || argv[i + 1].startsWith('--')) fail('Provide each config/output option exactly once with a path');
      options[argument] = argv[++i];
    } else {
      fail('Unsupported option. Signing, broadcast, execution, network, and credential options are forbidden; use --help');
    }
  }
  if (options['--help'] && argv.length !== 1) fail('--help cannot be combined with other options');
  if (options['--describe'] && (options['--config'] || options['--output'] || options['--dry-run'])) fail('--describe is reference-only and cannot be combined with config, output, or dry-run');
  return options;
}
export function runCLI(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options['--help']) {
    console.log('OFFLINE UNSIGNED ONLY. No signer, credentials, RPC, or execution support.\nDefault / --describe: validate frozen artifacts and describe unresolved references.\n--config PUBLIC.json --output NEW.unsigned.json [--dry-run]: write six unsigned transaction requests.\nOnly chainId 97 is accepted. Existing output or related journal is never overwritten.');
    return;
  }
  if (!argv.length || options['--describe']) {
    console.log(JSON.stringify(describePreparation(), null, 2));
    return;
  }
  if (!options['--config'] || !options['--output']) fail('Preparation requires both --config PUBLIC.json and --output NEW.unsigned.json; use --describe when public inputs are missing');
  let config;
  try {
    const bytes = fs.readFileSync(options['--config']);
    if (bytes.length > 32768) fail('Too large');
    config = JSON.parse(bytes.toString('utf8'));
  } catch { fail('Public configuration is missing, unreadable, oversized, or invalid JSON; no raw contents are shown'); }
  const manifest = prepareDeployment(config);
  writeUnsignedManifest(manifest, options['--output']);
  console.log('Wrote a new UNSIGNED LOCAL REVIEW manifest: five contract creations plus one bind call. No network access, signing, or broadcasting occurred.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { runCLI(); } catch (error) { console.error(`STOPPED: ${error.message}`); process.exitCode = 1; }
}
