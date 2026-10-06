# Current validation scope after full-suite migration

The completed full `npm test` run passed 447/447 across 49 top-level test files and 18 suites, with no failures, skips or cancellations and exit 0. Production source and artifacts are unchanged. Exactly 10 test files were migrated after independent review of interface updates, timing, precision and lifecycle expectations; tests and invariant assertions were not removed to obtain a pass.

The earlier 173 selected-case checkpoint is preserved in its dated logs and audit records. It overlaps the full 447 and must not be added to it. The full suite intentionally includes historical FTIToken/FTIReserveToken/FundedBinaryPlan regressions and explicitly synthetic fixtures; those are not organic qualification or deployment evidence for the current pair.

Authoritative full-run evidence is under `../full-suite-review/`: FULL-SUITE-FINAL.json, full-suite-final.log, full-suite-input-hashes.txt, full-suite-input-verification.log, TEST-MIGRATION-MANIFEST.json, TEST-MIGRATION.patch and INDEPENDENT-MIGRATION-REVIEW.json. The initial 395/447 baseline remains preserved as a failed baseline, not hidden or counted as a successful result.

Runtime: Node 24.19.0; Solidity 0.8.30; Ganache JavaScript fallback. Node 22 was not separately tested. This full run is not a new three-hour soak, browser-render check, live-wallet check, external security audit or production-capacity measurement.

H01 is resolved by the [owner’s 2026-10-06 scope decision](../OWNER-SUPPORT-DECISION-2026-10-06.md): retain buy fees in R, route the full Binary 5% to R at S > 0 and H at S = 0, and keep H protected/inactive without automatic insurance. H is disposed of only at permanent governed retirement after liability checks. The former automatic-support policy is superseded, not implemented. The 7% size-fee coefficient and true zero-output/dust policy remain open. All 39 requirements were assessed; a scope decision and passing tests do not constitute deployment clearance.

The full-suite result above predates the narrow documentation/UI-copy update. Contracts, test files and original validation evidence are unchanged. [Decision-update checks](../owner-support-decision/VALIDATION.md) are a separate focused run, not a new full-suite pass.
