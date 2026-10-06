# Test-only migration for frozen combined FTI candidate

Status: the fresh complete migrated suite passed 447/447, with zero failures, cancellations or skips. The test-only patch awaits integration review.

## Scope and reproducibility

The production contracts, scripts, UI, package scripts and dependency lock are unchanged. Ten test files are migrated; their before/after SHA-256 hashes and unified patch are in `TEST-MIGRATION-MANIFEST.json` and `TEST-MIGRATION.patch`. There are 49 top-level test files. The full command remains `npm test`, which compiles and runs every `test/*.test.mjs` with concurrency 1. No tests were skipped or removed to obtain a passing result, and no helper was changed to suppress failures.

Runtime: Node v24.19.0, satisfying the repository's >=22 engine constraint. No installed Node 22 binary was found. Ganache reports its native µWS binary is unavailable for this Node ABI and falls back to its JavaScript implementation. This warning is recorded; it is not a failed test, nor evidence of Node 22 validation.

- Untouched baseline: `/workspace/shared/fti-full-suite-baseline`
- Editable test-only migration: `/workspace/shared/fti-full-suite-migration`
- Frozen migrated full-run snapshot: `/workspace/shared/fti-full-suite-final-run`

The final-run snapshot records start/end time, exit status, runtime and SHA-256 hashes of contracts/tests/scripts/frontend. Neither test edits nor fixes are applied to a running snapshot. The initial compile-only attempt was interrupted deliberately to separate baseline execution from edits; its log is retained and explicitly excluded from results.

## Policy-aware changes

1. `binary-buy-allowance`, `integrated-binary-funding`: preserve historical FTIReserveToken economics and historical FundedBinaryPlan's queued, two-argument setting/max-price behavior. Only the current BinaryPlan branch changes to the one-argument setting, immediate attempt and no user price cap. Tests requiring pending funds use an actual blocked collateral transfer, then verify retry and every original cash/quota partition.
2. `paid-points-binary`, `independent-rank-boundaries`: retain real funded rank qualification and synthetic boundary provenance. Updated current Binary auto assertions cover next-hour activation, immediate exact mint, old-rank allocation timing and unchanged manual quota. Independent boundary fixtures stay clearly labelled.
3. `size-fee-proposal`: update the real BinaryPlan setting ABI only. Historical reserve-token fee, quarantine and no-restart assertions remain historical and unchanged.
4. `core-autobuy`, `protocol`: preserve historical FTIToken locks, curve and governance. Current Binary auto tests cover the one-argument ABI, no-cap current quotes, partial-owner/full-keeper restrictions, collateral rollback and release. Expensive historical FTIToken curve/lock purchases exceed the bounded immediate-attempt frame; tests explicitly prove exact deferred liabilities and successful full retry rather than altering the contract gas policy or claiming every historical token mints immediately. Enabling during old matching schedules a future boundary and cannot rewrite old allocation.
5. `retirement-review`, `retirement-integrations`, `retirement-load`: update to expected-lifecycle-nonce approvals, separate governed permanent-buy closure and final retirement, and restartable ordinary zero supply. Preserve approval thresholds, delays/revocation, claim ownership, reentrancy/hostile collateral, quiescence, segregated cash, rollback, and the real 100-user load. Strict price growth uses exact cross-products; displayed price remains nondecreasing. Conversion is tested only behind the permanent buy-closure marker and preserves each beneficiary.

## Interpretation

A full repository pass, if obtained, will include historical and mixed-model regressions as well as current candidate tests. It must not be represented as an independent security audit or proof that all desired economics exist. H automatic support use remains unimplemented; no production economics or governance authorization is changed by this migration. Deployment approval/readiness, network verification, signing and broadcasting remain false. No real accounts, chain-97 RPC, external publication or sample activation are involved.

## Completed focused lifecycle checks

- `retirement-review.test.mjs`: 43/43 passed, 348.44 seconds
- `retirement-integrations.test.mjs`: 20/20 passed, 157.90 seconds
- `retirement-load.test.mjs`: 1/1 passed, 415.49 seconds
- Total: 64 passed, zero failures/cancellations/skips

The unmodified-contract 100-user load executed 100 real registrations, 104 buys, four live-support top-ups, 20 transfers, 100 normal exits and 334 checks. Separate governed closure and retirement preserved $9,880 Binary beneficiary cash; its existing $104 development cash claim remained claimable. Token supply and collateral ended at zero. These focused results do not replace the pending full run. Logs are `migration-retirement-{review,integrations,load}.log`.

## Terminal untouched baseline

The complete untouched `npm test` run finished with exit 1: 447 tests, 395 passed, 52 failed, zero cancelled/skipped/todo, 18 suites, 3,745,807.401 ms. The complete failure log is retained as `full-suite-baseline-failed.log`; machine-readable totals and file breakdown are in `FULL-SUITE-BASELINE.json`.

All 52 failures map to the ten migrated files: 26 obsolete one-argument lifecycle approval encodings, 25 obsolete two-argument Binary auto-setting calls, and one obsolete assertion that ordinary zero supply cannot restart. Migration did not stop at removing these first errors: subsequent economic, lifecycle, ownership and rollback assertions were updated and exercised in the focused runs. The 98-case mixed-model focused run also passed with no failures/cancellations/skips; see `migration-mixed-binary.log`.

## Terminal fresh migrated full run

`npm test` completed with exit 0: **447 tests passed out of 447**, 18 suites, zero failures/cancellations/skips/todo, duration 4,247,994.557 ms. It started at 2026-10-06T00:46:08Z and finished at 2026-10-06T01:57:45Z. The full command compiled first and executed all 49 test files. `full-suite-final.log` is the complete output; `FULL-SUITE-FINAL.json` provides machine-readable provenance.

Every pre-recorded contract/test/script/frontend hash still matched after execution. Final token and Binary full source/artifact pins are unchanged. All ten migrated test hashes equal the frozen full-run inputs, and all ten pre-migration hashes still match the original candidate, so the patch has not been integrated silently.

The test count remains 447 before and after migration. This complete pass is not added to the 64- or 98-case focused results because those are overlapping checks. The previously failed focused core/protocol attempt and its targeted diagnostic are retained, followed by passing focused retry coverage and this fresh full pass.
