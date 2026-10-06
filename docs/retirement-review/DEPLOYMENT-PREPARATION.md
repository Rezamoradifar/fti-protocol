# Offline, unsigned retirement preparation

This copy's `npm run deploy` now runs **only** `scripts/prepare-retirement-deployment.mjs`. The default validates pinned local source/artifact files and describes unresolved constructor references. It creates no output, reads no public configuration by default, and never claims to be ready to deploy.

This entrypoint has no signer, wallet, credential loading, RPC, network access, execution, or broadcast path. It does not compile or silently refresh the reviewed artifacts. `--broadcast`, `--execute`, `--sign`, network/credential options, historical model switches, and every other unrecognized argument fail closed before any config file is read. A separately authorized deployment process would still be required in the future.

## Owner-confirmed target and scope (2026-10-06)

The owner confirmed BNB Smart Chain Testnet, chain 97, with TEST ONLY MockUSD. This confirms the target only: live network/runtime verification, public addresses/nonce, deployment readiness/approval, signing and broadcast remain unresolved or false. Use the [blank-input checklist](../owner-support-decision/CHAIN97-UNSIGNED-CHECKLIST.md) and `docs/owner-support-decision/retirement-input.blank.json`; no addresses are invented. The [owner support decision](../OWNER-SUPPORT-DECISION-2026-10-06.md) retains current R/H routing and keeps H inactive with retirement-only disposition.

## Read-only description

```sh
npm run deploy
npm run deploy -- --describe
npm run prepare:retirement -- --describe
```

Each description reports five contracts and **six planned transactions**. There are no predicted addresses or encoded unsigned requests until all required public inputs are supplied.

## Explicit public inputs

Create a new public JSON file containing only these fields:

- `chainId`: the number `97`, explicitly supplied; no other chain is accepted
- `deployer`: the provided nonzero address that would create the contracts and perform the bind
- `nonce`: the explicitly provided starting account nonce, as a nonnegative safe integer or canonical decimal string; it is never fetched or guessed
- `development`: the explicitly provided nonzero immutable development recipient
- `owners`: exactly seven distinct, valid, nonzero Council owner addresses
- `genesis`: exactly 31 distinct, valid, nonzero genesis addresses, in the intended tree order
- `testOnly`: optional boolean; set `true` for all fixture/example identities

Addresses are checksum-normalized. Distinctness is required within the Council owner set and within the genesis set. The script does not invent an additional cross-role separation policy. Development cannot equal the predicted MockUSD, retirement token, or BinaryPlan address because the token's constructor or bind would reject that destination.

This intentionally incomplete template is **not** a valid deployment configuration. Replace its missing fields only with reviewed public inputs; no actual addresses were supplied or guessed in this work:

```json
{
  "chainId": 97,
  "deployer": null,
  "nonce": null,
  "development": null,
  "owners": [],
  "genesis": []
}
```

Never put a private key, mnemonic, password, RPC credential, or other secret in this file. Unknown fields, including requested governance overrides, are rejected with a sanitized error. Raw config objects, invalid JSON contents, unknown field names, and rejected values are not printed or copied into output. Only the listed validated public fields enter the manifest. The script never reads `.env`, `process.env`, or any implicit configuration filename.

For an entirely fictional local test fixture, `testOnly: true` causes the output to be labelled `TEST_ONLY_FIXTURES`. It grants no deployment authority. Without that flag, supplied public addresses remain explicitly unverified. MockUSD itself is always TEST ONLY faucet collateral.

## Prepare a new unsigned manifest

The output parent directory must already exist. For example, after creating and reviewing `deployments/retirement-input.json`:

```sh
npm run deploy -- --config deployments/retirement-input.json --output deployments/retirement-review.unsigned.json --dry-run
```

`--dry-run` is optional because preparation is always offline and unsigned. Both `--config` and `--output` are required for preparation. `--describe` cannot be combined with them. The output name must end in `.unsigned.json`.

The script uses exclusive creation with mode `0600`. It refuses to replace the output, a dangling output symlink, related `.progress.json` or `.journal.json` records, or the matching non-unsigned deployment JSON. Existing records must be inspected, never deleted just to make this command succeed. There is no resume operation and no progress journal is produced. Generated unsigned manifests and the conventional input/local-state filenames are ignored by Git.

## Exact sequence and linking

For an explicit starting nonce `N`, five CREATE address predictions use the provided deployer and `N` through `N+4`. The sixth request uses `N+5` and is an ordinary call, **not a sixth contract**:

1. `MockUSD()`
2. `Council(owners[7])`
3. `FTITimelock(Council)`
4. `FTIRetirementReviewToken(MockUSD, FTITimelock, Council, development)`
5. `BinaryPlan(MockUSD, FTIRetirementReviewToken, FTITimelock, Council, development, genesis[31])`
6. The same deployer calls `FTIRetirementReviewToken.bind(BinaryPlan)`

The same development address is encoded in both relevant constructors. The old `FTIReserveToken` and `FundedBinaryPlan` are never selected. The retained `scripts/deploy-reserve.mjs` and `scripts/deploy.mjs` files are historical direct-deployment scripts and remain unchanged; no npm script invokes them. Do not use them for this lifecycle variant.

Each request records `chainId`, `from`, exact decimal `nonce`, zero `value`, `data`, and `to` (`null` for creation). Creation data includes the pinned creation bytecode and ABI-encoded constructor arguments. The manifest also records predicted addresses, argument lists, source/artifact hashes, creation-bytecode hashes, contract class, compiler, and fixed five-of-seven / 259,200-second governance metadata.

The file deliberately omits gas limits, gas prices, fee parameters, transaction type, and signatures. It is a collection of unsigned transaction requests, not a signed/raw broadcast payload. Before writing, the complete manifest is re-derived from its public inputs and the frozen pins. Altered bytecode, incomplete transaction sequences, changed dependencies, bind destination, evidence, or raised readiness flags are rejected before output creation. These six transactions are ordered and dependency-bound, not an on-chain atomic batch. Its `deploymentReady`, `deploymentApproved`, `signed`, `broadcast`, and `networkVerified` flags remain `false`, including when unsigned preparation is complete.

## Pinned candidate and checks

The preparer pins all five full artifact files and their four source files, validates exact contract/source/compiler identity and constructor types, and checks the new lifecycle ABI. It checks the fixed seven-owner/five-approval Council and 72-hour timelock/retirement metadata against those same frozen sources. Any mismatch stops preparation; it is not repaired silently.

- Retirement token source SHA-256: `89de8c1e8babbb0b5cf8ad20b92d96f176f2d3f89e9319e7328c7c52f0676ccb`
- Retirement token artifact-file SHA-256: `f7821bc76f101bc010d5c61a34408f821f2867e13f53007308335036e0d8d0dd`
- Binary source SHA-256: `9844e9b6b14553e0eb14352d43ab65e0cefda18d7c07a87101d074959c198271`
- Binary artifact-file SHA-256: `74c55aff04054d58d9f7ea9c9720032a0d6fe7572b248fa881dca0b9ee1cd4cb`
- Compiler: `0.8.30+commit.73712a01.Emscripten.clang`
- Threshold: five of seven; fixed timelock and retirement delay: 259,200 seconds each

To build artifacts intentionally from the frozen candidate and independently verify source-to-bytecode reproducibility:

```sh
npm run compile
node scripts/verify-retirement-review.mjs
```

To run the offline preparation and entrypoint guard tests:

```sh
npm run test:retirement-deployment
```

The dedicated tests cover complete constructor decoding and linking, exactly six unsigned requests, wrong chains, missing configuration, duplicate/invalid addresses, invalid/conflicting development destinations, precise nonce handling, source/artifact tampering, actual pre-combined token/Binary fixture substitution, old-token substitution, fixed governance, output/journal preservation, default-description safety, forbidden execution flags, sanitized errors, and successful preparation while network operations and credential/environment-file reads are actively blocked. No live deployment or RPC endpoint is used by these tests.

## Remaining boundaries

No real development treasury, Council owner list, genesis list, deployer address, or nonce is configured here. No chain state, address ownership, deployed code, current/pending nonce, balance, or gas requirement has been verified. Predictions depend on these exact consecutive nonce values and are invalidated by intervening transactions. Later execution would need separately reviewed authorization, live chain/nonce checks, transaction and gas review, and verification after each creation and bind.

The checked-in `UNSIGNED-DEPLOYMENT-PLAN.json` is the exact current `--describe` output: public addresses are unresolved, no unsigned requests are generated, and all readiness and authorization flags remain false. It is not a public input configuration and cannot authorize execution.

This entrypoint refresh changes no contracts or permissions. The pinned combined candidate supports restart after ordinary zero supply and preserves exact reserve/supply reference pricing. Retirement approval uses `approveRetirementAction(bytes4,uint256)` with the expected `lifecycleNonce`; old one-argument approval calldata is not compatible.

Immediate auto-buy has no user price cap: quote and execution use an atomic transaction, with failures remaining pending for retry or beneficiary cash release. Permissionless `releaseClosedTokenAutoToCash(start,limit)` keeps each beneficiary unchanged and requires the permanent `buysPermanentlyClosed` marker plus paused/idle Binary. Ordinary empty supply does not authorize this conversion. Final retirement additionally requires cleared token development claims and pending auto, zero supply/reserve, and quiescent Binary. Automatic use of the H support fund is intentionally outside the owner-selected scope; H remains protected and inactive, with disposition only at permanent governed retirement after liability checks. The former automatic-support policy is superseded, not implemented. Post-retirement membership and terminal precision dust remain open integration decisions; the 7% size-curve coefficient remains provisional.

The local review demo is separate from this chain-97-only preparation:

- `npm run demo` or `npm run demo:retirement`: fresh local retirement-review fixture chain, default RPC port 8548 and web port 3084, `deployments/local-retirement.json`
- `npm run demo:reserve`: preserved earlier reserve-token local fixture demo
- `npm run demo:historical-funded`: historical funded-plan local fixture demo

Those demo commands create local test fixtures; they are not deployment commands for a live chain. The preparer does not launch them or connect to their servers.
