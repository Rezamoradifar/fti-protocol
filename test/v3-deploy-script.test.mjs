import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import ganache from 'ganache';
import {JsonRpcProvider,Contract,ZeroHash,hexlify,randomBytes} from 'ethers';
import {artifact} from '../scripts/lib.mjs';
import {RELEASE,verifyV3Deployment} from '../scripts/v3-release.mjs';
import {startWeb} from '../scripts/server.mjs';

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
  const partners=Object.keys(accounts).slice(1,8);
  assert(first?.secretKey);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fti-v3-deploy-'));
  const deploymentFile = path.join(dir, 'v3-testnet.json');
  const secretsFile = path.join(dir, 'v3-testnet-secrets.json');

  const daoFile=path.join(dir,'dao.json');fs.writeFileSync(daoFile,JSON.stringify({threshold:5,partners}));
  try {
    const {stdout} = await runNode(
      ['scripts/deploy-v3-testnet.mjs'],
      {
        DAO_CONFIG:daoFile,
        RPC_URL: `http://127.0.0.1:${port}`,
        DEPLOYER_PRIVATE_KEY: first.secretKey,
        V3_DEPLOYMENT_FILE: deploymentFile,
        V3_TESTNET_SECRETS: secretsFile
      }
    );

    assert.match(stdout, /FTI_V3_OWNER_DECISIONS_20261008/);
    assert(fs.existsSync(deploymentFile));
    assert(fs.existsSync(secretsFile));

    const d = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
    assert.equal(d.release, RELEASE);
    assert.equal(d.mode, 'local');
    assert.equal(d.chainId, 31337);
    assert.equal(d.daoThreshold, 5);
    assert.equal(d.daoPartners.length, 7);
    assert.equal(d.genesis.length, 31);
    assert.equal(d.initialState.totalSupply, '0');
    assert.equal(d.initialState.reserve, '0');
    assert.equal(d.initialState.supportReserve, '0');
    assert.equal(d.initialState.price, '0');

    for (const key of ['usd','council','timelock','token','binary']) {
      assert.match(d[key], /^0x[0-9a-fA-F]{40}$/);
    }

    const s = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
    assert.equal(s.genesisHelpers.length, 30);
    assert.equal(d.tradeFeeBps,300);
    assert.equal(d.reserveFeeBps,300);
    assert.equal(d.transferFeeBps,300);
    assert.equal(d.transferFeeMode,'burn');
    assert.equal(d.charityEnabled,false);
    assert.equal('charityWalletA' in d,false);
    assert.equal('charityWalletB' in d,false);
    assert.equal('charityWalletA' in s,false);
    assert.equal('charityWalletB' in s,false);

    const provider=new JsonRpcProvider(`http://127.0.0.1:${port}`,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
    try{
      const stack=await verifyV3Deployment(d,provider);
      assert.equal(await stack.token.TRANSFER_FEE_BPS(),300n);
      await assert.rejects(()=>verifyV3Deployment({...d,transferFeeBps:0},provider),/Fee configuration mismatch/);
      await assert.rejects(()=>verifyV3Deployment({...d,transferFeeMode:'reserve'},provider),/Fee configuration mismatch/);
      assert.equal(d.governance,d.timelock);assert.equal(d.governanceDelay,259200);
      assert.equal(await stack.timelock.getMinDelay(),259200n);
      await assert.rejects(()=>verifyV3Deployment({...d,chainId:97},provider),/Wrong deployment network/);
      await assert.rejects(()=>verifyV3Deployment({...d,sourceFingerprint:'bad'},provider),/release mismatch/);
      await assert.rejects(()=>verifyV3Deployment({...d,codeHashes:{...d.codeHashes,token:ZeroHash}},provider),/code mismatch/);
      const voters=await Promise.all(partners.map(a=>provider.getSigner(a)));
      const council=stack.council;
      const pause=stack.token.interface.encodeFunctionData('pause');
      await(await council.connect(voters[0]).propose(d.token,pause)).wait();
      for(let i=1;i<4;i++)await(await council.connect(voters[i]).approve(0)).wait();
      await assert.rejects(()=>council.execute.staticCall(0));
      await(await council.connect(voters[4]).approve(0)).wait();
      await(await council.connect(voters[0]).execute(0)).wait();assert(await stack.token.paused());
      const root=await provider.getSigner(0);
      await assert.rejects(()=>stack.token.connect(root).unpause.staticCall());
      const data=stack.token.interface.encodeFunctionData('unpause'),salt=hexlify(randomBytes(32));
      const schedule=stack.timelock.interface.encodeFunctionData('schedule',[d.token,0,data,ZeroHash,salt,259200]);
      await(await council.connect(voters[0]).propose(d.timelock,schedule)).wait();
      for(let i=1;i<5;i++)await(await council.connect(voters[i]).approve(1)).wait();
      await(await council.connect(voters[0]).execute(1)).wait();
      await assert.rejects(()=>stack.timelock.execute.staticCall(d.token,0,data,ZeroHash,salt));
      await provider.send('evm_increaseTime',[259201]);await provider.send('evm_mine',[]);
      await(await stack.timelock.connect(root).execute(d.token,0,data,ZeroHash,salt)).wait();
      assert.equal(await stack.token.paused(),false);
      await assert.rejects(()=>stack.timelock.execute.staticCall(d.token,0,data,ZeroHash,salt));
      const saved={PORT:process.env.PORT,HOST:process.env.HOST,RPC_URL:process.env.RPC_URL};let web;
      try{
        process.env.PORT='0';process.env.HOST='127.0.0.1';process.env.RPC_URL=`http://127.0.0.1:${port}`;
        web=await startWeb(deploymentFile);const origin='http://127.0.0.1:'+web.address().port;
        const cfg=await(await fetch(origin+'/api/config')).json();assert.equal(cfg.sourceFingerprint,d.sourceFingerprint);assert.equal(cfg.timelock,d.timelock);assert.equal('rpcUrl' in cfg,false);
        const state=await fetch(origin+'/api/state');assert.equal(state.status,200);assert.equal((await state.json()).rewardQueue,'0');
      }finally{
        if(web)await new Promise(r=>web.close(r));
        for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
      }
    }finally{provider.destroy();}

  } finally {
    await server.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
