# Chain 97 unsigned preparation checklist

## Present status

The owner confirmed BNB Smart Chain Testnet, chain 97. Only TEST ONLY MockUSD faucet collateral is in scope. Economic scope is the [owner support decision](../OWNER-SUPPORT-DECISION-2026-10-06.md). Selecting a target does not authorize any transaction.

[CHAIN97-PREPARATION-STATUS.json](CHAIN97-PREPARATION-STATUS.json) records the boundary: `preparationComplete`, `deploymentReady`, `deploymentApproved`, `networkVerified`, `runtimeVerified`, `addressesVerified`, `nonceVerified`, `signed`, `broadcast` and `deployed` are all false. `targetOwnerConfirmed` alone is true. No predicted addresses or unsigned transaction payloads exist because required public inputs are blank.

## Blank public inputs

Use [retirement-input.blank.json](retirement-input.blank.json) as a deliberately invalid, incomplete template. It contains chain ID 97, blank deployer/development addresses, null nonce, and empty owner/genesis arrays. The existing preparer must reject it; this is intentional. The status record is not a preparer configuration.

Before preparing an actual unsigned transaction sequence, obtain and review:

- [ ] Explicit deployer public address and verified starting/pending nonce
- [ ] Immutable development-recipient public address, identical in token and Binary constructors
- [ ] Exactly seven distinct nonzero Council public addresses; preserve the fixed five-of-seven threshold
- [ ] Exactly 31 distinct nonzero genesis public addresses in the intended tree order
- [ ] Confirmation that all identities and wallet roles belong to the intended test setup; no placeholder/sample identity becomes a real account by assumption
- [ ] Live chain-ID, account ownership, balances, nonce and gas/fee verification through a separately authorized workflow
- [ ] Source/artifact hashes match the frozen candidate; do not silently replace pins

Never enter private keys, mnemonics, passwords or credentials in these files. Provide only the supported public input fields. Do not add status flags to the public input file; the preparer rejects unknown fields.

## Permitted offline reference check

From the repository root, with the reviewed local Node 24.19.0 runtime:

```sh
node scripts/prepare-retirement-deployment.mjs --describe
```

This validates the pinned five artifact files and describes six planned transactions without RPC, signing, broadcasting, address prediction or transaction encoding. It neither deploys contracts nor authorizes later execution. The preserved `docs/retirement-review/UNSIGNED-DEPLOYMENT-PLAN.json` is a description-only artifact.

After all inputs are explicitly supplied and reviewed, the existing unsigned-only preparer can create five contract-creation requests (MockUSD, Council, FTITimelock, FTIRetirementReviewToken, BinaryPlan) and the same deployer’s token `bind(BinaryPlan)` call. Do not use retained historical direct-deploy scripts. Never overwrite an existing manifest, journal or deployment record. Creation predictions depend on exactly six consecutive nonces.

## Gate before any later execution

- [ ] Re-review exact transaction sequence, constructor links, immutable recipient, chain 97, gas/fees, nonce and TEST ONLY collateral
- [ ] Obtain the required transaction authorization; current selection of chain 97 is not that authorization
- [ ] Use the supported signing handoff; do not collect secrets in chat or templates
- [ ] After any separately authorized execution, verify each receipt, deployed code/runtime, constructor bindings, roles/delays, final bind and application configuration

None of those live steps was performed here. All readiness/approval/verification/execution flags stay false. No network, SSH, GitHub, public deployment, real collateral or real-fund movement occurred.
