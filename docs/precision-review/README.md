> Historical precision-only checkpoint. Superseded by strict-real-growth/README.md after explicit approval of exact-ratio growth without a displayed-price tick.

# Isolated precision-only review

Local candidate, not published or approved for deployment. Baseline: `/workspace/shared/fti-lifecycle-retirement-review` copied fresh on 2026-10-05.

The only contract edit is active-supply `quoteBuy`: `Math.mulDiv(netAssets,totalSupply(),reserve)` replaces division by the truncated display price. Bootstrap still uses `referencePrice`. Manual and automatic buys share the same path. Strict exact-growth and strict displayed-growth guards, fees, fund routing, zero-supply protection, and retirement behavior remain unchanged.

This prevents avoidable overminting from premature price rounding. It does not introduce infinite decimals: collateral and token amounts remain 18-decimal integer atoms. Full-precision multiplication/division rounds token output down once. Unchanged-display dust can still revert because that policy has deliberately not been changed.

## Completed verification

- Production compilation succeeded; token runtime 18,979 bytes, below EIP-170.
- Six focused Ganache EVM tests passed, including the old overmint counterexample, an actual failed dust transaction with rollback, fee and quota behavior, automatic purchases, 20 repeated split buys, partial sale/transfer, bootstrap support routing, solvency, and terminal closure.
- Five selected integration tests passed: three canonical BinaryPlan cases (large buy, registration/top-up quota, failure rollback), plus two TEST_ONLY paid-rank auto-execution/release cases. Rank eligibility was seeded, not organically earned.
- In-memory test-only seeding harness is confined to test compilation. No setter added to production source or artifacts.
- Logs and exact source hashes are alongside this file.

## Reproduction

`node --test --test-concurrency=1 test/support-precision.test.mjs`

`node --test --test-concurrency=1 --test-name-pattern='actual large buys|real registration|roll back real Binary authorization|builder auto:' test/retirement-integrations.test.mjs`

The one edited existing integration assertion now computes expected tokens from the exact reserve/supply ratio. No obsolete quote expectations are silently claimed as passing.

## Limits

No automatic support-release code is activated. Funding split, exact-equality behavior, and fund-shortfall handling require an explicit settled policy. No production deployment, canonical overwrite, publication, full repository regression run, unlimited-precision claim, or security audit occurred. Split-trade checks establish accounting and quota invariants, not resistance to whale-fee avoidance by splitting.
