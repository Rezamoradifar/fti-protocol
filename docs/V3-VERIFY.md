# FTI V3 — BNB Testnet source verification

This verification flow is for the **FTI V3 Testnet release only**.

Contracts:
- `MockUSD`
- `SevenGuardianCouncil`
- `FTIReserveTokenV3`
- `FundedBinaryPlan`

The verifier:
1. Reads `deployments/v3-testnet.json`.
2. Recompiles all Solidity sources with Solidity 0.8.30, optimizer 200 runs, viaIR, Shanghai EVM.
3. Confirms saved creation bytecode matches the newly compiled bytecode.
4. Encodes and saves exact constructor arguments.
5. Reads deployed V3 state from BNB Testnet and validates DAO guardians, token roles, charity wallets, token/binary binding and 31 Genesis addresses.
6. Submits each contract to the Etherscan V2 verification API for BNB Testnet chain ID 97.
7. Polls verification status and prints BscScan code links.

## Prepare locally without an explorer request

```bash
npm ci
npm run verify:v3:prepare
```

This writes:
- `artifacts/verification-v3/standard-input.json`
- one constructor-argument file per contract
- `artifacts/verification-v3/manifest.json`

## Verify after the public Testnet deployment

Keep API keys and RPC credentials outside Git.

```bash
export DEPLOYMENT_FILE=deployments/v3-testnet.json
export RPC_URL=https://bsc-testnet.bnbchain.org
export ETHERSCAN_API_KEY='YOUR_EXPLORER_API_KEY'

npm run verify:v3:testnet
```

`BSCSCAN_API_KEY` can be used instead of `ETHERSCAN_API_KEY`.

No deployer private key is required for source verification. The verifier never signs or sends a blockchain transaction.
