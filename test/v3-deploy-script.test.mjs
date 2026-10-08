import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import ganache from 'ganache';

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: {...process.env, ...env},
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({stdout, stderr});
      else reject(new Error(
        `deploy script failed with code ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
      ));
    });
  });
}

test('dedicated V3 deployment script deploys only the new stack and verifies zero-start state', async () => {
  const server = ganache.server({
    logging: {quiet: true},
    wallet: {totalAccounts: 10},
    chain: {chainId: 31337},
    miner: {blockGasLimit: 30000000}
  });

  await server.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  assert(port > 0);

  const accounts = server.provider.getInitialAccounts();
  const first = Object.values(accounts)[0];
  assert(first?.secretKey);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fti-v3-deploy-'));
  const deploymentFile = path.join(dir, 'v3-testnet.json');
  const secretsFile = path.join(dir, 'v3-testnet-secrets.json');

  try {
    const {stdout} = await runNode(
      ['scripts/deploy-v3-testnet.mjs'],
      {
        RPC_URL: `http://127.0.0.1:${port}`,
        DEPLOYER_PRIVATE_KEY: first.secretKey,
        V3_DEPLOYMENT_FILE: deploymentFile,
        V3_TESTNET_SECRETS: secretsFile
      }
    );

    assert.match(stdout, /FTI_V3_NO_CHARITY/);
    assert(fs.existsSync(deploymentFile));
    assert(fs.existsSync(secretsFile));

    const d = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
    assert.equal(d.release, 'FTI_V3_NO_CHARITY');
    assert.equal(d.mode, 'local');
    assert.equal(d.chainId, 31337);
    assert.equal(d.daoThreshold, 5);
    assert.equal(d.daoPartners.length, 7);
    assert.equal(d.genesis.length, 31);
    assert.equal(d.initialState.totalSupply, '0');
    assert.equal(d.initialState.reserve, '0');
    assert.equal(d.initialState.supportReserve, '0');
    assert.equal(d.initialState.price, '0');

    for (const key of ['usd','council','token','binary']) {
      assert.match(d[key], /^0x[0-9a-fA-F]{40}$/);
    }

    const s = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
    assert.equal(s.genesisHelpers.length, 30);
    assert.equal(d.tradeFeeBps,300);
    assert.equal(d.reserveFeeBps,300);
    assert.equal(d.charityEnabled,false);
    assert.equal('charityWalletA' in d,false);
    assert.equal('charityWalletB' in d,false);
    assert.equal('charityWalletA' in s,false);
    assert.equal('charityWalletB' in s,false);
  } finally {
    await server.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
