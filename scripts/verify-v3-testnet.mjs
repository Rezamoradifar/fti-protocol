import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import {JsonRpcProvider} from 'ethers';

const deploymentFile =
  process.env.V3_DEPLOYMENT_FILE || 'deployments/v3-testnet.json';

if (!fs.existsSync(deploymentFile)) {
  throw new Error(
    `Missing ${deploymentFile}. Deploy V3 first with npm run deploy:v3:testnet.`
  );
}

const deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));

if (Number(deployment.chainId) !== 97) {
  throw new Error(
    `Explorer verification is restricted to BNB Testnet chain 97; got ${deployment.chainId}.`
  );
}

if (!process.env.RPC_URL) {
  throw new Error('Set RPC_URL for BNB Testnet.');
}

const provider = new JsonRpcProvider(process.env.RPC_URL);
const network = await provider.getNetwork();

if (Number(network.chainId) !== 97) {
  throw new Error(
    `RPC_URL is not BNB Testnet chain 97; got ${network.chainId}.`
  );
}

function normalizeSourceKey(fromKey, specifier) {
  if (specifier.startsWith('@')) return path.posix.normalize(specifier);
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(fromKey), specifier)
  );
}

function sourceDiskPath(key) {
  if (key.startsWith('@')) return path.join('node_modules', key);
  return path.join('contracts', key);
}

const sources = {};
const queue = fs
  .readdirSync('contracts')
  .filter(f => f.endsWith('.sol'))
  .map(f => path.posix.normalize(f));

while (queue.length) {
  const key = queue.shift();
  if (sources[key]) continue;

  const disk = sourceDiskPath(key);
  if (!fs.existsSync(disk)) {
    throw new Error(`Missing source dependency: ${key} (${disk})`);
  }

  const content = fs.readFileSync(disk, 'utf8');
  sources[key] = {content};

  const importRe =
    /import\s+(?:(?:[^"'\n;]*?from\s*)?["']([^"']+)["'])\s*;/g;

  for (const match of content.matchAll(importRe)) {
    const dependency = normalizeSourceKey(key, match[1]);
    if (!sources[dependency]) queue.push(dependency);
  }
}

const stdJsonInput = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: {enabled: true, runs: 200},
    viaIR: true,
    evmVersion: 'shanghai',
    outputSelection: {
      '*': {
        '*': [
          'abi',
          'evm.bytecode.object',
          'evm.deployedBytecode.object'
        ]
      }
    }
  }
};

const compiled = JSON.parse(solc.compile(JSON.stringify(stdJsonInput)));

for (const e of compiled.errors ?? []) {
  if (e.severity === 'error') console.error(e.formattedMessage);
}

if (compiled.errors?.some(e => e.severity === 'error')) {
  throw new Error('Verification compilation failed.');
}

const compilerLong = solc.version();
const compilerBase = compilerLong.split('.Emscripten')[0];
const etherscanCompiler = `v${compilerBase}`;

const contracts = [
  {
    name: 'MockUSD',
    source: 'MockUSD.sol',
    address: deployment.usd,
    txHash: deployment.transactions?.usd
  },
  {
    name: 'SevenGuardianCouncil',
    source: 'SevenGuardianCouncil.sol',
    address: deployment.council,
    txHash: deployment.transactions?.council
  },
  {
    name: 'FTIReserveTokenV3',
    source: 'FTIReserveTokenV3.sol',
    address: deployment.token,
    txHash: deployment.transactions?.token
  },
  {
    name: 'FundedBinaryPlan',
    source: 'FundedBinaryPlan.sol',
    address: deployment.binary,
    txHash: deployment.transactions?.binary
  }
];

for (const item of contracts) {
  if (!item.address || !item.txHash) {
    throw new Error(
      `Deployment file is missing address/creation tx for ${item.name}.`
    );
  }
}

async function constructorArguments(item) {
  const tx = await provider.getTransaction(item.txHash);
  if (!tx) throw new Error(`Creation transaction not found: ${item.txHash}`);

  const contract = compiled.contracts?.[item.source]?.[item.name];
  if (!contract) {
    throw new Error(
      `Compiled contract not found: ${item.source}:${item.name}`
    );
  }

  const bytecode = contract.evm.bytecode.object.toLowerCase();
  const input = tx.data.replace(/^0x/, '').toLowerCase();

  if (!input.startsWith(bytecode)) {
    throw new Error(
      `Creation bytecode mismatch for ${item.name}; refusing to submit verification.`
    );
  }

  return input.slice(bytecode.length);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function verifySourcify(item) {
  const endpoint =
    `https://sourcify.dev/server/v2/verify/97/${item.address}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent':
        'fti-protocol-v3-verifier/0.2 (+https://github.com/Rezamoradifar/fti-protocol)'
    },
    body: JSON.stringify({
      stdJsonInput,
      compilerVersion: compilerBase,
      contractIdentifier: `${item.source}:${item.name}`,
      creationTransactionHash: item.txHash
    })
  });

  const submitted = await response.json();

  if (!response.ok) {
    const msg = JSON.stringify(submitted);
    if (/already|verified/i.test(msg)) {
      return {provider: 'Sourcify', status: 'already verified', details: submitted};
    }
    throw new Error(
      `Sourcify submission failed for ${item.name}: ${msg}`
    );
  }

  if (!submitted.verificationId) {
    const msg = JSON.stringify(submitted);
    if (/already|verified/i.test(msg)) {
      return {provider: 'Sourcify', status: 'already verified', details: submitted};
    }
    throw new Error(
      `Sourcify did not return verificationId for ${item.name}: ${msg}`
    );
  }

  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const statusRes = await fetch(
      `https://sourcify.dev/server/v2/verify/${submitted.verificationId}`,
      {
        headers: {
          'user-agent':
            'fti-protocol-v3-verifier/0.2 (+https://github.com/Rezamoradifar/fti-protocol)'
        }
      }
    );
    const status = await statusRes.json();
    const raw = JSON.stringify(status);

    if (/exact_match|verified|success/i.test(raw)) {
      return {provider: 'Sourcify', status: 'verified', details: status};
    }

    if (/failed|error/i.test(raw)) {
      throw new Error(
        `Sourcify verification failed for ${item.name}: ${raw}`
      );
    }
  }

  throw new Error(
    `Sourcify verification timed out for ${item.name}.`
  );
}

async function verifyEtherscan(item, apiKey) {
  const args = await constructorArguments(item);

  const params = new URLSearchParams({
    chainid: '97',
    module: 'contract',
    action: 'verifysourcecode',
    contractaddress: item.address,
    sourceCode: JSON.stringify(stdJsonInput),
    contractname: `${item.source}:${item.name}`,
    compilerversion: etherscanCompiler,
    codeformat: 'solidity-standard-json-input',
    runs: '200',
    constructorArguments: args,
    evmVersion: 'shanghai',
    licenseType: '3'
  });

  const submitUrl =
    `https://api.etherscan.io/v2/api?apikey=${encodeURIComponent(apiKey)}&chainid=97&module=contract&action=verifysourcecode`;

  const response = await fetch(submitUrl, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: params
  });

  const submitted = await response.json();
  const submittedText = JSON.stringify(submitted);

  if (/already verified/i.test(submittedText)) {
    return {
      provider: 'Etherscan/BscScan',
      status: 'already verified',
      details: submitted
    };
  }

  if (submitted.status !== '1' || !submitted.result) {
    throw new Error(
      `Explorer submission failed for ${item.name}: ${submittedText}`
    );
  }

  const guid = submitted.result;

  for (let i = 0; i < 60; i++) {
    await sleep(3000);

    const statusUrl = new URL('https://api.etherscan.io/v2/api');
    statusUrl.searchParams.set('apikey', apiKey);
    statusUrl.searchParams.set('chainid', '97');
    statusUrl.searchParams.set('module', 'contract');
    statusUrl.searchParams.set('action', 'checkverifystatus');
    statusUrl.searchParams.set('guid', guid);

    const statusRes = await fetch(statusUrl);
    const status = await statusRes.json();
    const result = String(status.result ?? '');

    if (/pass|verified/i.test(result)) {
      return {
        provider: 'Etherscan/BscScan',
        status: 'verified',
        details: status
      };
    }

    if (/fail|unable|error/i.test(result)) {
      throw new Error(
        `Explorer verification failed for ${item.name}: ${JSON.stringify(status)}`
      );
    }
  }

  throw new Error(
    `Explorer verification timed out for ${item.name}.`
  );
}

const report = {
  chainId: 97,
  compiler: compilerLong,
  settings: {
    optimizer: {enabled: true, runs: 200},
    viaIR: true,
    evmVersion: 'shanghai'
  },
  verifiedAt: new Date().toISOString(),
  contracts: []
};

for (const item of contracts) {
  console.log(`Verifying ${item.name} at ${item.address}...`);

  const row = {
    name: item.name,
    address: item.address,
    creationTransactionHash: item.txHash
  };

  try {
    row.sourcify = await verifySourcify(item);
    console.log(`  Sourcify: ${row.sourcify.status}`);
  } catch (error) {
    row.sourcify = {status: 'failed', error: error.message};
    console.error(`  Sourcify: ${error.message}`);
  }

  if (process.env.ETHERSCAN_API_KEY) {
    try {
      row.explorer = await verifyEtherscan(
        item,
        process.env.ETHERSCAN_API_KEY
      );
      console.log(`  BscScan/Etherscan: ${row.explorer.status}`);
    } catch (error) {
      row.explorer = {status: 'failed', error: error.message};
      console.error(`  BscScan/Etherscan: ${error.message}`);
    }
  } else {
    row.explorer = {
      status: 'skipped',
      reason:
        'Set ETHERSCAN_API_KEY to submit source verification through Etherscan API V2 for BNB Testnet.'
    };
  }

  report.contracts.push(row);
}

fs.mkdirSync('deployments', {recursive: true});
const reportFile =
  process.env.V3_VERIFICATION_FILE ||
  'deployments/v3-testnet-verification.json';

fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

const failures = report.contracts.filter(
  x =>
    x.sourcify?.status === 'failed' &&
    x.explorer?.status !== 'verified' &&
    x.explorer?.status !== 'already verified'
);

console.log(`Verification report saved to ${reportFile}`);

if (failures.length) {
  throw new Error(
    `Verification did not succeed for: ${failures.map(x => x.name).join(', ')}`
  );
}
