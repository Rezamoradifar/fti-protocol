import fs from 'node:fs';
import path from 'node:path';
import {
  JsonRpcProvider,
  Wallet,
  formatEther,
  isAddress
} from 'ethers';
import {deployOne} from './lib.mjs';

const rpc = process.env.RPC_URL;
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

if (!rpc || !privateKey) {
  throw new Error('Set RPC_URL and DEPLOYER_PRIVATE_KEY in a protected server environment.');
}

const provider = new JsonRpcProvider(rpc);
const network = await provider.getNetwork();
const chainId = Number(network.chainId);

if (chainId !== 97 && chainId !== 31337) {
  throw new Error(
    `FTI V3 deployment is TESTNET/LOCAL ONLY. Expected chain 97 or 31337, got ${chainId}.`
  );
}

const signer = new Wallet(privateKey, provider);
const deployer = await signer.getAddress();
const nativeBalance = await provider.getBalance(deployer);

if (chainId === 97 && nativeBalance === 0n) {
  throw new Error('Deployer has no test BNB for gas.');
}

const daoConfig = JSON.parse(
  fs.readFileSync(
    process.env.DAO_CONFIG || 'config/v3-partner-dao.json',
    'utf8'
  )
);

if (daoConfig.threshold !== 5) {
  throw new Error('V3 requires a 5-of-7 Partner DAO threshold.');
}

if (
  !Array.isArray(daoConfig.partners) ||
  daoConfig.partners.length !== 7 ||
  new Set(daoConfig.partners.map(x => x.toLowerCase())).size !== 7 ||
  daoConfig.partners.some(
    x => !isAddress(x) || /^0x0{40}$/i.test(x)
  )
) {
  throw new Error('Provide exactly 7 unique nonzero Partner DAO addresses.');
}

// Testnet helpers are intentionally generated at deployment time.
// The deployer is genesis root so the deployment owner can test immediately.
// Private keys are written only to a local gitignored file with mode 0600.
const generated = Array.from({length: 32}, () => Wallet.createRandom());
const genesisHelpers = generated.slice(0, 30);
const charityWalletA = generated[30];
const charityWalletB = generated[31];

const genesis = [
  deployer,
  ...genesisHelpers.map(w => w.address)
];

if (new Set(genesis.map(x => x.toLowerCase())).size !== 31) {
  throw new Error('Genesis addresses must be unique.');
}

fs.mkdirSync('deployments', {recursive: true});

const secretsPath =
  process.env.V3_TESTNET_SECRETS ||
  'deployments/v3-testnet-secrets.json';

const secretPayload = {
  warning: 'TESTNET ONLY. Never fund these wallets on mainnet.',
  chainId,
  generatedAt: new Date().toISOString(),
  genesisHelpers: genesisHelpers.map((w, index) => ({
    index: index + 1,
    address: w.address,
    privateKey: w.privateKey
  })),
  charityWalletA: {
    address: charityWalletA.address,
    privateKey: charityWalletA.privateKey
  },
  charityWalletB: {
    address: charityWalletB.address,
    privateKey: charityWalletB.privateKey
  }
};

fs.writeFileSync(
  secretsPath,
  JSON.stringify(secretPayload, null, 2),
  {mode: 0o600}
);
try {
  fs.chmodSync(secretsPath, 0o600);
} catch {}

console.log(
  `FTI V3 test deployment: chain=${chainId}, deployer=${deployer}, gas=${formatEther(nativeBalance)}`
);

const usd = await deployOne('MockUSD', [], signer);

const council = await deployOne(
  'SevenGuardianCouncil',
  [daoConfig.partners],
  signer
);

const token = await deployOne(
  'FTIReserveTokenV3',
  [
    usd.target,
    deployer,             // testnet governance
    council.target,
    charityWalletA.address,
    charityWalletB.address
  ],
  signer
);

const binary = await deployOne(
  'FundedBinaryPlan',
  [
    usd.target,
    token.target,
    deployer,             // testnet governance
    council.target,       // 5/7 emergency guardian
    deployer,             // testnet development wallet
    genesis
  ],
  signer
);

const bindTx = await token.bind(binary.target);
const bindReceipt = await bindTx.wait();

if ((await token.binary()).toLowerCase() !== binary.target.toLowerCase()) {
  throw new Error('Token/binary binding verification failed.');
}

if ((await council.THRESHOLD()) !== 5n) {
  throw new Error('Council threshold verification failed.');
}

for (let i = 0; i < 7; i++) {
  const onchain = await council.guardians(i);
  if (onchain.toLowerCase() !== daoConfig.partners[i].toLowerCase()) {
    throw new Error(`DAO guardian mismatch at index ${i}`);
  }
}

if ((await token.totalSupply()) !== 0n) {
  throw new Error('V3 must have zero supply immediately after deployment.');
}

if ((await token.reserve()) !== 0n || (await token.supportReserve()) !== 0n) {
  throw new Error('V3 must have zero reserve immediately after deployment.');
}

const deploymentTxs = {
  usd: usd.deploymentTransaction()?.hash ?? null,
  council: council.deploymentTransaction()?.hash ?? null,
  token: token.deploymentTransaction()?.hash ?? null,
  binary: binary.deploymentTransaction()?.hash ?? null,
  bind: bindTx.hash
};

const result = {
  release: 'FTI_V3_ZERO_START',
  mode: chainId === 97 ? 'bnb-testnet' : 'local',
  chainId,
  deployedAt: new Date().toISOString(),
  deployedBlock: bindReceipt.blockNumber,
  deployer,
  governance: deployer,
  development: deployer,
  usd: usd.target,
  council: council.target,
  token: token.target,
  binary: binary.target,
  daoThreshold: 5,
  daoPartners: daoConfig.partners,
  charityWalletA: charityWalletA.address,
  charityWalletB: charityWalletB.address,
  genesis,
  initialState: {
    totalSupply: '0',
    reserve: '0',
    supportReserve: '0',
    price: '0'
  },
  transactions: deploymentTxs,
  secretsFile: path.basename(secretsPath),
  note: 'TESTNET ONLY. MockUSD has no monetary value. Mainnet deployment is not approved.'
};

const output =
  process.env.V3_DEPLOYMENT_FILE ||
  'deployments/v3-testnet.json';

fs.writeFileSync(output, JSON.stringify(result, null, 2));

console.log(JSON.stringify({
  ok: true,
  release: result.release,
  mode: result.mode,
  chainId,
  deployedBlock: result.deployedBlock,
  usd: result.usd,
  council: result.council,
  token: result.token,
  binary: result.binary,
  daoThreshold: result.daoThreshold,
  charityWalletA: result.charityWalletA,
  charityWalletB: result.charityWalletB,
  initialState: result.initialState,
  deploymentFile: output
}, null, 2));
