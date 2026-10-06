# Hourly registration-unit gate validation

Date: 2026-10-05 UTC. Local prototype only; no push, merge or deployment was performed for this check.

## Rule and implementation

The threshold is **five paid registration units in the hour being closed**, not five distinct wallets and not five units accumulated over multiple hours. Each unit costs 100 USD; one wallet registering or topping up by 500 USD contributes five units.

- Fewer than five current-hour units: no point distribution; the entire point pool carries forward, as does unmatched branch volume.
- At least five current-hour units and positive eligible capped paid points: distribute the available pool, including carried cash, proportionally.
- Zero eligible paid points: retain the entire point pool. It is not rounding and cannot become a development allocation.
- Only the exact sum-of-floors allocation residual goes to development, in addition to the existing 1 USD per membership unit.
- The five-unit condition does not guarantee point value of at least 20 USD. The existing 20 USD protection target is not a payout gate, floor or ceiling.

`BinaryPlan.beginEpochClose` now checks `epochUnits < 5`. The public `unitsSinceSettlement` counter is retained for compatibility, but no longer controls eligibility. It is not substituted for the current-hour counter. Cash carry does not carry registration units toward a later hour's threshold. No other payout, rank, quota, monthly-pool or token formula was changed in this patch.

Historical `FundedBinaryPlan` and the historical `core/reference.mjs` model are intentionally outside this policy change.

## Regression evidence

The previous guard checked `unitsSinceSettlement`. Before the correction, the new 4-then-1 cross-hour test failed: the second hour distributed all 450 USD although only one unit was purchased in that hour. A separate one-wallet, five-unit registration test passed, showing that wallet counting was already correct.

Existing tests were extended rather than duplicating the binary suite:

- `test/paid-points-binary.test.mjs`: four units with eligible branch matches retain 360 USD; one unit in the next hour retains all 450 USD; an empty hour retains it; a single-wallet five-unit top-up in a later hour distributes the full 900 USD. Development, builder and token-support buckets are checked separately. A new-wallet five-unit registration reaches matching but retains all 450 USD when no eligible point exists.
- `test/protocol.test.mjs`: three units in hour 1 and two in hour 2 retain the full 450 USD. Five units in hour 3 distribute all 900 USD, with 10 USD development allocation and 40 USD builder funds kept separate.
- Existing paid-point tests cover exact rounding residuals, zero-eligible carry concentration, unchanged cap rows, protection changes below 20 USD, real 20-hour paid-rank progression and funded allocation safety.

## Validation status

The targeted BinaryPlan compilation passed with solc 0.8.30, optimizer 200 runs, viaIR and Shanghai EVM. Runtime remains 19,384 bytes, below EIP-170.

Focused hourly cases passed 3/3. A clean final-source rerun of the complete paid-point file passed **13/13, exit 0**, including the real 20-hour rank path, below-20-USD settlement and hostile collateral cases. This rerun used the current compiled fee-floor token and BinaryPlan artifacts. Before/after SHA-256 checks confirmed no drift in either contract source, either compiled artifact, or the paid-point test file.

The first combined affected-file run reported 21/39 passing and 18 protocol failures. Protocol's real-time Ganache setup crossed the next hour boundary at 10:00 UTC, causing funding to revert with `settlement required`. Its test clock is now pinned to 2026-10-04 00:00 UTC with zero automatic timestamp increment, matching the deterministic paid-point suite; all advances remain explicit. No production timing rule changed. The complete protocol rerun passed **26/26, exit 0**, with no failures, skips or cancellations. Together with the clean final-source 13-case paid-point rerun, all **39 distinct affected cases** have passing execution evidence; the focused 3-case run overlaps these and is not an additional count.

Preserved logs:
- [Pre-change baseline, 3/3](validation/hourly-unit-gate-baseline.log)
- [Intentional regression before the guard fix, 1 pass / 1 fail](validation/hourly-unit-gate-regression-before-fix.log)
- [Focused hourly regressions, 3/3](validation/hourly-unit-gate-focused-final.log)
- [Initial combined run, including the full 13-case paid-point pass and protocol clock failures](validation/hourly-unit-gate-initial-affected-files.log)
- [Clean deterministic protocol rerun, 26/26](validation/hourly-unit-gate-protocol-final.log)
- [Clean final-source paid-point rerun, 13/13](validation/hourly-unit-gate-paid-points-final.log)

The initial combined attempt used a preexisting reserve-token artifact in its first suite; it is preserved as historical diagnostic evidence and is superseded for final coverage by the clean 13-case rerun. Final coverage uses the compiled current fee-floor token, with source/artifact equivalence independently verified by the canonical `--reserve-token --prepare` check. Fee-formula behavior has its own separate tests; this report covers binary interactions and the hourly gate. These checks are not a full repository aggregate pass, independent audit, production-performance claim or investment guarantee. Node 24.19.0 and Ganache's JavaScript fallback were used.


## Reproduction and exact scope

Commands executed:

```sh
node --check test/paid-points-binary.test.mjs
node --check test/protocol.test.mjs
node --test --test-concurrency=1 --test-name-pattern='hourly registration-unit gate|one new wallet registering five units|hourly unit minimum' test/paid-points-binary.test.mjs test/protocol.test.mjs
node --test --test-concurrency=1 test/paid-points-binary.test.mjs test/protocol.test.mjs
node --test --test-concurrency=1 test/protocol.test.mjs
node --test --test-concurrency=1 test/paid-points-binary.test.mjs
```

The binary-only compiler invocation used the repository's compiler settings and selected only `BinaryPlan` output, leaving the concurrent token build untouched. JavaScript syntax and whitespace checks passed. Replacing just the new guard/comment with the old guard exactly recovers the task-start BinaryPlan SHA-256 `8c13f87612621e608d12f147aa7a956a18ca32659100590dc7cf3f2866cd1a8c`, confirming the narrow production-code change.

Final SHA-256:

- `contracts/BinaryPlan.sol`: `92a39d6f728b492b46ae54f53d36e15d8d20a1c1a082acca81bcdc6babe81789`
- `test/paid-points-binary.test.mjs`: `7051a5aac13607d9e59ba73a289875b4d68dce621593724fc0ef6627534868f8`
- `test/protocol.test.mjs`: `6db5c0aa6ed63ce9bc4aef1dcb49c0972c44ffcdb41ec14c3055f99a4536b793`
- `artifacts/BinaryPlan.json`: `066818fc06217e09abfe76f9b2189947cbef1b6f328739023c1d9f93c362fe1d`
- Current `contracts/FTIReserveToken.sol`: `c92a91a9cd21335c5eeef805faba5185204bd39c5d239bb339eb19a4a825b3be`
- Current `artifacts/FTIReserveToken.json`: `5ad6d442770b37a48f991a7ce2238817db509e000a986a741cc50e1c95801c2b`

The accompanying [checksum manifest](validation/hourly-unit-gate-sha256.txt) includes this report and preserved logs. Earlier prototype results must not be presented as certification of this source change.
