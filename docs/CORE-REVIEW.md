# Contract core review and auto-buy protection candidate

**Historical report:** this document records the earlier auto-buy candidate and legacy economic findings. The separate `FundedBinaryPlan` candidate addresses specific findings through a materially changed compensation policy; see [FUNDED-PLAN](FUNDED-PLAN.md). The results below are not a validation report for that newer implementation.

Date: 2026-10-01 UTC. Baseline main commit: `2e1507f6405544815a0f3534426f684c5654b1de`.

This branch implements three focused protections in `BinaryPlan.executeAuto` and adds local EVM evidence. It is a review candidate, not a deployment or an independent security audit. The economic findings below remain open. No production-safety score or guarantee follows from passing tests.

## What changed

| Confirmed legacy behavior | Candidate behavior | Evidence |
| --- | --- | --- |
| A stranger split a user's 45 USD pending auto reward into 64 purchases of 0.000001 USD, spent 0.000064 USD, and filled all live lock slots. The user's next manual purchase reverted. | A third party must execute the whole pending amount. Only the beneficiary can intentionally execute a partial amount. | Legacy diagnostic and regression for rejected fragmentation, preserved liabilities, and an available manual purchase. |
| A maximum of 0.101 USD/FTI accepted a 45 USD purchase with an effective cost of approximately 0.103182744262965534 USD/FTI. Only pre-trade spot was checked. | The maximum additionally bounds gross USD paid divided by tokens received, including fees and curve impact. | Integer boundary test: one wei below the necessary ceiling rejects, the ceiling accepts. |
| Disabling auto-buy left previously pending funds executable by a stranger. | Execution requires auto-buy still enabled. Pending funds can still be released into the user's cash claim. | Disable, release, repeated-release and stale-execution tests. |

The keeper remains permissionless and can execute the full eligible pending amount. It cannot redirect purchased tokens or receive the beneficiary's USD. Owner-initiated partial purchases remain subject to the same enabled flag and price bound. The existing settings freeze during hourly settlement remains in place; disabling takes effect when that settings transaction is accepted.

The new effective-price condition, for WAD-scaled amounts, is:

```
grossUSD * 1e18 <= tokensReceived * maxUSDPerFTI
minimumRequired = ceil(grossUSD * 1e18 / maxUSDPerFTI)
```

The implementation uses OpenZeppelin `Math.mulDiv` with upward rounding and passes the checked token quote as `minTokens` to `autoBuy`. Failed execution reverts the liability deductions and token changes atomically. This interpretation of maximum price is stricter than the legacy spot-only behavior; previously accepted purchases can now reject and remain owed to the user.

Only BinaryPlan contract source changes. Token economics, locks, compensation formula, governance, stablecoin and external ABIs are unchanged. FTIToken creation bytecode is checked against the baseline; the changed BinaryPlan cannot replace an already deployed immutable contract.

## Reserve mathematics and its limits

Let `R` be accounted spendable reserve, `V` the virtual reserve, and `S = S0 + circulatingSupply`. `S0` is virtual supply, not a wallet balance. With exponent five, the coverage condition is:

```
(R + V) * S0^5 >= V * S^5
```

For redemption of all real tokens, the continuous gross curve amount is:

```
I_all = (R + V) * (1 - (S0 / S)^5)
I_all <= R  exactly when the coverage condition holds
```

Under exact-transfer, non-rebasing collateral assumptions, buys priced with upward-rounded cost cannot mint more than that funded cost supports. Sell quotes round the gross redemption down; retained base fees and reserve top-ups preserve or improve coverage. Transfer burns reduce supply without paying out reserve. The test checks the inequality directly using arbitrary-precision integers against EVM state, rather than merely comparing two copies of a quote function.

`test/core-solvency.test.mjs` seeds eight funded holders, performs 32 purchases and 24 mixed sale/transfer operations, then exits every remaining holder after advancing the LOCAL EVM clock. It requires 72 post-operation accounting/coverage checks, exercises both sales and burns, and finishes with zero circulating supply. Real testnet time was not advanced. This is a reproducible sample of state transitions, not a formal proof for every reachable state or a 200,000-user load test.

Reserve coverage does not guarantee the purchase price, marginal displayed price, original principal, uninterrupted trading, stablecoin value, or availability during a pause/lock. Virtual reserve cannot be withdrawn. A support fund can be depleted; a floor target is not an external guarantee.

## Open issues and required next decisions

| Priority | Open issue | Required work |
| --- | --- | --- |
| High | Carried point-pool capture: a self-controlled 500 USD subtree receives 9,450 USD when unrelated carry is available. | Specify eligible funding/volume, carry release and USD-per-point limits, then test group-level extraction over many epochs. The existing 20 USD protection threshold is not a payout cap. |
| High | Per-wallet rewards and limits do not identify a person or coordinated group. | State the intended anti-Sybil model and test colluding addresses, recycling, rank income and builder income together. |
| High at target scale | Every hourly settlement visits the whole member list twice; ancestor work grows with depth. | Redesign or bound active work, measure gas and closure deadlines, and fund keeper capacity before a large launch. |
| Medium | Sixty-four live locks also fill through legitimate frequent purchases. The fragmentation fix does not remove this throughput limit. | Design bounded lock aggregation without earlier unlocks or silently delaying existing claims; test long-running hourly auto-buy. Sixty-four hourly purchases can fill slots well before a 30-day backstop if wallet unlocks have not occurred. |
| Medium | Transaction-local whale fees can be reduced by splitting one sale into ten. | Specify whether split resistance is required and choose/test aggregate-flow rules with their impact on honest users. |
| Release dependency | MockUSD has unrestricted test hooks; council owners are fixed; final real collateral behavior is unspecified. | Establish production collateral and governance assumptions, adversarial callback/transfer testing, independent review, and a migration plan. |

Detailed reproduction and funding analysis: [ECONOMIC-REVIEW.md](ECONOMIC-REVIEW.md). The reserve-support budget and scheduled exits on the separate `fix/liquidity-safety` branch are not part of this candidate and are not claimed as deployed fixes.

The next economic specification must answer who may receive old carry, the maximum USD payable for one point, how unused funding is retained, and what group-level self-funding outcome is acceptable. Those choices change members' payouts; this patch does not invent them.

## Reproduction and evidence

Use an isolated checkout and Node 22 or later:

```bash
npm ci
npm test
```

`npm test` recompiles the candidate and runs all repository tests, including the new regression and reserve tests. `test/economic-adversary.test.mjs` includes **diagnostics that pass when an unresolved weakness is reproduced**. A green full suite must not be read as resolving those findings. Machine-readable run counts and artifact hashes are in [core-validation.json](core-validation.json).

Observed result on Node v24.19.0: **46 passed, 0 failed, 0 skipped**, approximately 534 seconds for the tests. This includes eight new auto-buy regressions, the new reserve scenario (72 checks, 14 mixed sales and 10 transfers), three economic diagnostics, and existing protocol/server/migration/math tests. Full output: [core-validation-output.txt](core-validation-output.txt). BinaryPlan runtime size is 15,106 bytes; FTIToken remains 13,427 bytes with identical creation bytecode to the baseline. The baseline protocol/math/economic subset passed 31 tests before the patch.

`scripts/reproduce-core-autobuy.mjs` intentionally reproduces the old behavior. It rejects artifacts that do not match the legacy creation-bytecode hashes. To reproduce it, compile baseline `2e1507f6405544815a0f3534426f684c5654b1de` in a separate checkout, copy this diagnostic script there, and run it from that checkout. Do not replace artifacts on the live server. The captured local output is [core-autobuy-legacy-findings.json](core-autobuy-legacy-findings.json).

Compiler settings: Solidity 0.8.30, optimizer enabled with 200 runs, viaIR, Shanghai EVM; OpenZeppelin 5.4.0. No claim is made that the compiler or dependencies have no known or unknown issues. Local Ganache fell back to its JavaScript transport on this runtime; test results below concern local EVM behavior, not network throughput.

## Deployment boundary

The website's public configuration observed during this review still points to chain 97 and these existing contracts:

| Contract | Address |
| --- | --- |
| MockUSD | `0x5a8A97a6c2AFEf0FA315f28cF58653AEAD75d6ae` |
| FTIToken | `0x127bEEe5c89fDf42Bb056BBD5D4491982880eE91` |
| BinaryPlan | `0x8838a88b34219119D14092DEC9A9070809F3456e` |
| Council | `0xD26f0Cb7ed939f91DD1fa07eBfc9bd1e803A58BB` |
| Timelock | `0x7e28976e53AF9A66824F08169ac0a17AB3C00685` |

This address listing is a configuration observation, not new explorer source verification or proof that current on-chain bytecode matches the candidate. No transactions were submitted to those contracts in this review. No keys or server configuration were changed.

Because binding is one-time and contracts are not proxies, integration testing the patched BinaryPlan requires a separate deployment with an appropriately bound token. Replacing a file on the server does not upgrade a contract. Preserve old deployment JSON, compiler inputs and artifacts for the existing addresses; use a separate output directory and test collateral for any new deployment. Do not repoint the live website as part of a routine source update.
