# FTI Protocol

Complete independent **local / BNB Testnet** development package: binary rewards, FTI curve token, 3-of-5 governance, 72-hour timelock, English web panel, browser-signed deployment launcher, settlement keeper, reference simulator and EVM tests.

**Not independently audited. Mainnet deployment is disabled. Test USD has no dollar value.** Economic interpretations and changes from the supplied specification are recorded in [DECISIONS](docs/DECISIONS.md).

See [GitHub publishing and server installation](docs/GITHUB.md) for uploading this package.

## Requirements

Node.js 22 or newer, npm, and Git. A browser wallet is required for public testnet transactions. Use BNB Smart Chain **testnet, chain ID 97**.

## Run locally

```bash
npm ci
npm test
npm run demo
```

Open http://localhost:3000. A fresh in-memory EVM, 45 test accounts, test USD, contracts, English dashboard and keeper start together. Each restart resets the local chain. Keep this unlocked-account demo private; its default bind address is localhost.

For a remote server, use an SSH tunnel from your computer:

```bash
ssh -L 3000:127.0.0.1:3000 USER@SERVER
```

Then open http://localhost:3000 on your computer. Docker users can run `docker compose up --build`; its published port also binds to localhost.

## Deploy using your wallet, without putting its key on a server

```bash
npm ci
npm run launch
```

Open http://localhost:3000, or serve `launcher/` over HTTPS on your domain. The launcher is configured for the requested primary owner:

`0x63c5B98AEfd69658B652d5F35FFda3C6c06847E3`

1. Connect that wallet and accept switching to BNB Testnet.
2. Generate the 30 helper accounts. They are generated **in your browser**. Download the encrypted backup, keep its password, and confirm that you saved it.
3. Click **Start / resume deployment**. Review and approve six transactions: test USD, council, timelock, FTI, binary plan, then contract binding.
4. Download the deployment JSON. Progress can resume after interruptions. Keep both the deployment JSON and encrypted helper-account backup.
5. Open **Test the protocol**. The primary wallet plus 30 helpers have Genesis positions but initially no units. Request test USD and add units. For a simple binary test, fund helper 1 and 2 with test gas, give each two units, and give the root one unit. After the hour boundary, process volume and settlement.

The test council uses the primary wallet plus four helper accounts controlled through the encrypted backup. This is suitable for single-person testing, **not independent production governance**. Passwords and helper keys are never uploaded. Never enter your primary wallet seed or private key in the launcher. The browser page is not a continuously running keeper.

## Connect the full panel to the browser deployment

Copy the non-secret deployment JSON to the server, then run:

```bash
npm run compile
node scripts/import-browser-deployment.mjs FTI-Testnet-Deployment.json
DEPLOYMENT_FILE=deployments/testnet.json npm start
```

The importer verifies chain ID, transaction sender, deployment bytecode, receipts and token binding. The full panel uses connected wallets for signatures; it does not hold user keys.

For a continuous keeper, configure a **separate gas-only wallet** in the server environment:

```bash
DEPLOYMENT_FILE=deployments/testnet.json node --env-file=.env scripts/keeper.mjs
```

See [.env.example](.env.example). Do not add keys to Git. The keeper has no admin privileges.

## CLI testnet deployment

Alternatively, fill `deployments/testnet-input.json` from its example with 31 distinct Genesis addresses, five distinct council addresses, and a development address. Configure `RPC_URL` and `DEPLOYER_PRIVATE_KEY` locally in a protected environment file, then run:

```bash
npm run compile
node --env-file=.env scripts/deploy.mjs
```

The supplied deploy script accepts only chain 97 or 31337 and deploys an explicitly test-only collateral token.

## Tests and simulation

```bash
npm test
npm run simulate -- 2000 42
```

The checked-in report records **28 successful math/EVM tests** and a 2,000-member integrated cash-flow simulation. The simulation ends new inflows and redeems all real tokens, assuming lock deadlines have elapsed. It checks exact integer accounting and the reserve inequality, not investment returns or million-member gas performance.

## Repository layout

- `contracts/` — binary plan, token, council, timelock and test collateral.
- `web/` — English full dashboard for local or deployed contracts.
- `launcher/` — standalone HTTPS browser deployment and testing page.
- `scripts/` — compiler, deployment, server, keeper and simulation tools.
- `core/` — independent BigInt mathematical reference.
- `test/` — math and EVM integration tests.
- `docs/` — decisions, operations, reports. The original supplied Word specification is excluded from the public repository.

See [operations](docs/OPERATIONS.md), [validation](docs/VALIDATION.md) and the optional [Persian guide](README.fa.md). A public testnet deployment is complete only after wallet transactions are confirmed; downloading or cloning this repository does not deploy contracts.
