# Independent review of the complete FTI test-suite migration

Review date: 2026-10-06 UTC

## Decision

Approve integration of the exact ten test files in `TEST-MIGRATION-MANIFEST.json`, using patch SHA-256 `aeef2081311307daa993238e36bb2f4508a24b0c2bb3d36efc303b57048e3e06`. No production contract, helper, runtime script, UI, package command or dependency-lock change is part of this approval.

The complete migrated `npm test` run passed **447/447 tests across 49 files**, with zero failures, skips, cancellations or todo cases and exit code 0. This replaces the earlier focused 173-case checkpoint as the complete repository result; do not add the counts together. The 447 include historical, mixed-model and repeated behavioral scenarios, not 447 independent security properties or 447 tests solely of the latest token.

## What was independently verified

- Read every change across all ten migrated test files and compared it with the approved current policy
- Verified all ten baseline hashes against both the untouched baseline and original delivery candidate, and all ten migrated hashes against the final-run snapshot
- Replayed the complete patch into a separate temporary baseline copy and reproduced every expected migrated hash exactly
- Compared 74 production/configuration/UI inputs with the baseline; all were unchanged, including contract source, helper/runtime scripts, frontend, core models, deployment configuration, package commands and dependency lock
- Independently checked all 99 pre-recorded full-run input hashes after execution; all matched
- Confirmed identical top-level test-file sets, unchanged test-definition counts in each migrated file, and no newly introduced skip, only, todo or early-return bypass
- Checked the terminal full log, exit-code file, runtime, inventory and preserved failing baseline. The command remains `npm run compile && node --test --test-concurrency=1 test/*.test.mjs`, without a name filter
- Verified final token/Binary artifact and source hashes remain those reviewed at the 173-case checkpoint

The complete 70-minute suite was not independently executed a second time. This is an independent review of the test changes, their inputs, complete execution evidence and reproducible patch application.

## Assertion review

The changed assertions implement the approved differences instead of masking failing behavior:

1. The current Binary uses `setAutoBuy(bool)` and immediate purchase attempts. Tests needing a pending liability now cause an actual blocked collateral transfer, assert preserved cash/token/quota state, then check the successful retry. Historical FundedBinaryPlan keeps its original two-argument setting and maximum-price rules.
2. Removed maximum-price boundary cases are replaced by explicit absence-of-cap ABI checks, current-price repricing after an intervening trade, exact beneficiary mint and unchanged manual quota. Owner-partial/keeper-full restrictions, disablement, collateral rollback and cash ownership remain tested.
3. Funded rank cases retain organic qualification and clearly identified synthetic prior history. They now assert old-rank snapshots plus exact same-transaction token, reserve and Binary-cash changes, rather than incorrectly requiring a successful purchase to remain pending.
4. Governance cases supply the expected lifecycle nonce and complete separate Council/timelock permanent-buy closure before retirement. Threshold, delay, revocation, quiescence, fixed recipient, callback rejection and atomic rollback assertions remain. State snapshots add lifecycle nonce, exact retained ratio and permanent-closure state.
5. Ordinary zero-supply cases now prove manual and automatic restart at the exact retained ratio, isolation of old support/development claims and the correct manual-spend difference.
6. Displayed-price strict-increase assertions are replaced with a strict reserve/supply cross-product plus a nondecreasing displayed price. Equality is permitted only in the truncated display, never in the required real ratio.
7. The historical FTIToken curve/lock path can exceed the new bounded immediate frame. Its tests explicitly assert the exact deferred liability, emitted deferral and a successful full retry; the current-token immediate-execution tests remain in the suite. This does not change production gas policy.

No unexplained assertion weakening was identified. A mechanical assertion-call count rises from 1,050 to 1,119 across the ten files; that count supports the change inventory but is not itself proof of correctness.

## Result provenance

- Runtime: Node v24.19.0; the project requires >=22. Node 22 itself was not tested
- Solidity: 0.8.30, optimizer 200, viaIR, Shanghai
- Started: 2026-10-06 00:46:08 UTC; finished: 01:57:45 UTC
- Test-runner duration: 4,247,994.557 ms, about 70 minutes 48 seconds; total recorded wall window also includes compilation
- Final log SHA-256: `614a02a91a43c2c739f62a49f2077906785f6949cce160decdc9eacf43dac89d`
- Preserved baseline: 395 passed, 52 failed out of the same 447, no skips. Failures map to obsolete auto/lifecycle approval encodings and the superseded no-restart expectation
- Baseline log SHA-256: `7787b7b4f89d63e2176e8db3d8837291efa41b5f76608014199bdb7230790cf8`

The current-token 100-user EVM load also completed in the full run: 100 registrations, 104 buys, four live-support top-ups, 20 transfers, 100 normal exits and 334 checks. Separate closure and retirement left token supply/cash at zero while preserving 9,880 USD of Binary cash and its claimability. This is useful bounded load evidence, not a full-network throughput guarantee.

## Still open

- The original protected H funding allocation and automatic active release are still unimplemented. A green test suite does not close that economic requirement
- The 7% large-trade coefficient and true zero-output/dust boundaries remain policy limitations
- No rendered-browser, live-wallet or deployment verification was added
- No production readiness, signing, broadcast, external publication or guarantee against future findings is implied

The 39-requirement matrix now closes the obsolete-suite validation gap only. Its H row remains explicitly unfulfilled, and browser/deployment limits remain.
