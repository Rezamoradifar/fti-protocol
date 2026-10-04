# Current paid-points/global-pool validation

Checkpoint: 2026-10-04, 13:55 UTC. Draft publication has been authorized; merge and deployment remain on hold.

## Exact source

- Base PR5 commit: `8fa961c5feb679a0d35077ddf2f0ff4b1a360ffd`
- Local branch: `review/paid-points-global-pool`
- SHA-256 of the 84-file source/test/config manifest: `db16ddef2a882e71e104b84f676332d0c6ea73645c86e765994ae092d578b3cf`
- No source/test change has occurred since this aggregate manifest was captured. Review documentation/logs may be updated with new results.

## Completed checks

- Migrated existing EVM tests: **110/110**
- Updated rank-capacity tests: **7/7**; synthetic rank setup for isolated features is clearly TEST ONLY
- Independent model: **7/7**, including 300,000 wallets and 1,059,965 invariant checks; cash reconciles with live reserve plus protected funds
- Both 100-user normal-exit EVM loads: **2/2**; each executes 100 buys, 20 transfers and 100 normal exits, paying exactly 1,790 USD (1,785 buys + 5 live support), retaining the pre-mint 500/655 USD protected bucket
- Zero-supply quarantine tests: **21/21**, including first manual/auto mint and exact final redemption
- Governance owner rotation: **4/4**
- Canonical entrypoint guards: **3/3**
- New binary policy: **12/12 in the complete final closeout**; the real 20-hour path proves 200 raw matched units -> 100 paid rank points + 100 flushed units -> Builder 1. All 12 then passed together in the 54-case closeout.
- Frontend/landing builds and syntax/whitespace checks passed
- Canonical verification input independently recompiles; all five creation bytecodes match saved artifacts

Targeted groups are not an aggregate result and must not be added to unrelated historical pass counts. Earlier 119-test and raw-rank pressure-candidate results cover different source.

## Complete partitioned coverage

All **30 current top-level test files / 208 distinct cases** now have successful execution evidence. No failures, skips or cancellations occurred in the successful closing runs. The final missing-file selection passed 54/54 with exit0; the exact-byte provenance rerun passed 37/37 with exit0. A per-file command/log/SHA-256 map is included in the review package, and the extended source/artifact hashes stayed unchanged.

The full `npm test` wrapper did not complete as one invocation: two execution sessions became unavailable during its compilation stage following automatic review cancellations. Those logs are preserved and are not reported as code failures or successful aggregate runs. Coverage was closed through explicit independent file selections under the existing local-test authorization, without changing source, permissions or environment. Compilation and runtime-size checks had already passed separately; the saved successful compiler log and canonical bytecode verification establish that stage.

The earlier 110-case run began before final label/reference-model edits. Its affected files (integrated-economics, revised-economics, reserve-token) were conservatively rerun against frozen source and credited only from the final 37-case closeout. The real paid-point binary file also received a clean complete rerun. Historical 119/167 results are excluded from the 208-case count.

Extended manifest SHA-256: `8aefed6e982305c3b24cb59498b1f82ef79b243fcf8f1e4a544890cab4eecfcb`. It records 115 tracked non-document inputs, including Python migration helpers, plus 11 compiled artifact hashes. No source/artifact drift occurred during closeout. Runtime bytes: BinaryPlan19,384; FTIReserveToken13,944; FundedBinaryPlan21,341; Council3,721; FTITimelock5,461; FTIToken13,427; MockUSD1,994.

## Review qualifications

Canonical BinaryPlan now uses global proportional distribution and funded capped settlement-point ranks, while FundedBinaryPlan remains historical. Allocation rather than later withdrawal defines paid rank points provisionally. Protected zero-supply cash ownership, no-eligible-hour carry ownership/concentration, exact pressure-fee parameters, restart, raw surplus, ordinary dust and emergency exceptions remain explicit decisions. Full source rules are in TOKEN-V2.md.

Node 24.19.0 / npm 11.9.0 / solc 0.8.30 were used with pinned dependencies. Ganache runs its JavaScript fallback because its native uWS binary is unavailable for this Node ABI. A local API MaxListeners warning was observed while its test passed. Dependencies are unchanged: previous audit found 0 production advisories and 9 development/toolchain advisories, including 1 critical. No independent audit, public-value deployment, browser-wallet clickthrough or GitHub CI success is claimed.
