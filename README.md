> **Review checkpoint only, not the newly requested final version.** This snapshot preserves the 447-tested baseline plus the later H-scope documentation/UI-copy decision. Its Council is still 5-of-7. The owner subsequently requested 7-of-7 governance and emergency recovery; those changes are unfinished and are not included or certified here. Do not install this expecting that newer functionality, and do not deploy it. See [publication scope](PUBLICATION-CHECKPOINT.md).

# Local immediate-auto, exact-price and restart review

This isolated candidate combines `BinaryPlan` immediate auto-buy with the exact-ratio/restart version of `FTIRetirementReviewToken`. It is not deployed, independently audited, or production-approved. Old validation totals do not certify this source; current unsigned preparation pins have been refreshed and independently rebuilt.

Current support scope is fixed by the [owner decision of 2026-10-06](docs/OWNER-SUPPORT-DECISION-2026-10-06.md): buy fees remain in live reserve R; the Binary 5% goes to R when supply S > 0 and protected H when S = 0. H stays inactive, separate from price, and provides no automatic insurance or loss repair. Only permanent governed retirement after liability checks can dispose of H to the fixed development recipient. Contracts and economics are unchanged.

Current rules: [immediate auto](docs/immediate-auto-review/REVIEW.md), [restart and permanent shutdown](docs/RETIREMENT-REVIEW.md), and [test scope](docs/immediate-auto-review/TEST-SCOPE.md).

- Auto defaults off; an enable applies at the next UTC hourly settlement boundary (12:30 → 13:00). Disable stops purchases immediately, including between allocation batches
- Five percent remains fixed. No user maximum price: the current exact internal quote is used atomically
- Eligible allocations attempt to mint directly to their beneficiary in the same settlement transaction; manual quota is untouched
- Failed attempts preserve beneficiary-owned funds. Bounded keeper retries require an active request and an available service/network
- An ordinary last sale pays net of fee and records a development claim. The same token can restart at the last exact price ratio; protected support, old claims and donations are not captured by the next buyer
- A distinct 5-of-7 Council/72-hour action permanently closes buys. Only that irreversible marker permits bounded permissionless conversion of pending auto to the same beneficiary's cash claim
- Later retirement still requires zero supply/backing/token claims/auto claims and quiescent Binary. It never sweeps Binary rewards, point or builder funds

## Full repository validation

A fresh `npm test` run passed **447/447 tests across 49 files and 18 suites**, with zero failures, skips or cancellations and exit code 0. It ran from 2026-10-06 00:46:08 UTC to 01:57:45 UTC on Node 24.19.0. Ten test files were migrated to the approved interfaces and behavior; production contracts, bytecode, core logic, keeper, configuration and UI were unchanged. An independent replay approved the exact test patch without removed tests or skip/only controls.

```sh
npm ci
npm test
```

The earlier 173-case focused checkpoint is preserved; it overlaps this full run and is not added to 447. The full suite includes historical and mixed-model regression cases, not only the current contract pair. See [full-run evidence](docs/full-suite-review/FULL-SUITE-FINAL.json), [migration review](docs/full-suite-review/INDEPENDENT-MIGRATION-REVIEW.json) and [current scope](docs/immediate-auto-review/TEST-SCOPE.md). Node 22 was not tested. Ganache used its JavaScript fallback.

All 39 requirement rows have been assessed. H01 is resolved by the owner’s explicit scope decision to retain this model; the former automatic H funding/release policy is superseded, not implemented. Passing tests is not independent external security certification, production-throughput proof or deployment clearance. No earlier three-hour soak is relabeled as this run. The 447-case result predates the documentation/UI-copy update; its original records and the 173-case checkpoint remain unchanged. See the [decision-update checks](docs/owner-support-decision/VALIDATION.md).

## Deployment boundary

No signing, broadcast, deployment, real-fund movement, GitHub retry or email occurs in this candidate task. The current offline unsigned preparer pins the final artifacts and passed a separate independent rebuild and focused preparation check; its output still grants no deployment authorization. Historical deployment and verification scripts are not the current preparation path. BNB Smart Chain Testnet (chain 97) is owner-confirmed, with TEST ONLY MockUSD collateral. Network/runtime verification, deployment readiness/approval, signing and broadcast remain false. No real treasury, signer or owner address is invented. The [blank-input checklist](docs/owner-support-decision/CHAIN97-UNSIGNED-CHECKLIST.md) records what is still needed before any separately authorized deployment. The 7% size-fee coefficient and true zero-output/dust handling remain open policy boundaries.
