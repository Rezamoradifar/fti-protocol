# Local integrated experiment validation

Status: aggregate verification in progress; not a final release approval. No GitHub publication or network deployment has occurred.

## Source identity

- Base: PR5 commit `8fa961c5feb679a0d35077ddf2f0ff4b1a360ffd`
- Local branch: `experiment/integrated-redemption-impact`
- Preserved prior baseline: 119 tests passed, with patch SHA-256 `82a1e448480cfa890bb85a015a92250acc4f7c48e7a01428e52311efadaff9ca`
- The prior baseline uses different partial-sale, terminal and quota rules. Its pass count does not certify this revision.
- Aggregate source/test/config hashes were captured before the new serial run. The final report must verify they are unchanged.

## Current checks

- Solidity compilation passed: token runtime 13,884 bytes; BinaryPlan 16,032; FundedBinaryPlan 21,341. All are below the 24,576-byte runtime limit.
- Independent verification input was recompiled; all five selected creation bytecodes match the saved artifacts.
- Token-focused experiment: 15/15 tests passed before the rank-ledger restoration; contract economic behavior is unchanged by that later restoration. The aggregate run retests the final combination.
- Migrated existing token/collateral/lock tests: 29/29 passed before rank restoration.
- Rank-aware integrated binary funding: 22/22 passed against the restored rank capacity, across both binary variants.
- Rank-aware existing allowance/API/gas helper group: 19/19 passed.
- Independent arithmetic model: 6/6 passed. The deterministic 300,000-wallet simulation covers 300,000 buys, 399,966 normal sales, 59,999 transfer burns and 1,059,965 invariant checks. Exact total token cash in equals cash out; reserve and supply finish at zero. This model covers Member capacity, not binary rank/reward settlement or EVM throughput.
- Frontend and landing builds passed. Browser wallet-clickthrough/visual regression was not rerun.
- Additional all-rank/top-up/10×/100×/1,024-cap boundary tests are running separately.
- Full serial `npm test` started 2026-10-04 at approximately 13:00 UTC. It includes normal, non-emergency complete exits for both 100-user EVM load scenarios. No final aggregate result is claimed yet.

## What the tests distinguish

1. Actual USD conservation is independent of the internal quote and fee ledger. Retained fees are not credited a second time.
2. Every membership unit transfers 5 USD actual reserve support without minting; binary reward/development/builder accounts remain separate.
3. Manual gross spending is authorized atomically in the binary. Rank/top-up/milestone capacity growth does not reset spending, and failed collateral transfers roll both contracts back.
4. A full-supply normal sale returns all accounted token backing and reaches R=S=0, including a one-atom reserve. The saved price is historical only.
5. The pressure surcharge removes old size/hourly waiting caps but does not provide split-proof protection. Equal final pressure does not imply equal cash payout.
6. Time-dependent pressure decay can increase gas between estimation and mining. The UI adds measured padding of 25% plus 30,000 gas while preserving min-out and deadline; no formal worst-case gas guarantee is claimed.

## Open release blockers and specification differences

- Zero-supply ownership: pre-mint 500 USD binary support plus a sole 100 USD buyer permits a 600 USD final payout. Tests deliberately demonstrate this unapproved first-minter allocation.
- Automatic restart remains review-gated, yet binary support can still enter after closure. No new treasury, fee quarantine or reserve owner is silently selected.
- Direct USD donations are unaccounted surplus and can remain after all accounted backing is redeemed. Their ownership is unresolved.
- Two ordinary one-atom holders can be unable to sell or consolidate because ceil fees leave zero net output. Tests do not silently destroy those claims; the inherited emergency path can resolve the fixture.
- Experimental pressure fees remain timing/split-sensitive, affect unrelated sellers and favor the final owner under the full-refund rule.
- Rank capacity uses the original builder-only, global latched multiplier anchored to the actual post-first-buy quote, capped at 1,024. Transfer burns can increase that quote and capacity without adding reserve cash. These inherited details are disclosed, not treated as new external income.
- FundedBinaryPlan's attributed-credit hard 20 USD/paid-point ceiling and permanent retained credit differ from the reference's target-only 20 USD threshold. Its monthly builder-credit/retained-reserve policy also differs from legacy equal sharing plus reusable carry. This experiment does not change either binary payout model or pretend they are equivalent.
- The inherited Council owner-rotation stale-approval defect has a separately tested patch; it is not silently included in this token/rank experiment.
- Token and binary addresses are bound/immutable. Deployment or migration requires an agreed compatible pair and separate authorization.
- Independent economic/security review, exact final policy approval, public-testnet gas/keeper validation and production deployment approval remain outstanding.

## Toolchain limits

Node 24.19.0, npm 11.9.0, solc 0.8.30 and pinned project dependencies were used. Ganache's native uWS binary is unavailable for this Node ABI; tests run on its JavaScript fallback. The local API test also reports a MaxListeners warning while passing. The prior unchanged dependency audit found no production advisories and nine development/toolchain advisories, including one critical. This is not an independent audit. GitHub CI was not run because publication remains on hold.
