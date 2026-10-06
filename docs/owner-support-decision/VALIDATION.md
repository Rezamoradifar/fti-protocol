# Owner support-decision update validation — 2026-10-06

Scope: current documentation and UI copy only, in the source candidate. H01 is resolved by the owner’s explicit scope decision to retain existing economics; the prior automatic-support proposal is superseded, not implemented. No contracts, artifacts, test files, core logic, keeper, deployment scripts or economic formulas changed.

## Checks actually run

Runtime: existing Node **24.19.0**. No dependency installation or full-suite rerun.

- `node --check frontend/controller.js`: passed
- `node --test --test-concurrency=1 test/workspace-markup.test.mjs test/frontend-trade-quotes.test.mjs test/immediate-auto-ui.test.mjs test/workspace-state.test.mjs`: **29/29**, zero failures/skips/cancellations; `focused-ui-tests.log`
- `node --test --test-concurrency=1 test/retirement-deployment.test.mjs test/review-entrypoints.test.mjs`: **40/40**, zero failures/skips/cancellations; `focused-preparation-tests.log`
- `npm run build:web`: passed; `workspace-build.log`
- `(cd landing && npm run build)`: passed; `landing-build.log`
- `node scripts/prepare-retirement-deployment.mjs --describe`: passed against existing frozen pins; `OFFLINE-DESCRIPTION.json` matches the preserved description-only plan
- Five additional direct guards passed: blank config rejects; target selection does not enable authorization/verification flags; five-contract/six-step description is unchanged; current-model rendered policy states R/H routing and retirement-only H disposition; landing and generated bundles expose correct scope and historical-address labels. See `scope-guards.log`. These are ad hoc assertions, not additional full-suite test cases
- SHA-256 comparison confirmed **170 protected pre-existing files unchanged**, covering contracts, artifacts, tests, core, scripts, the 173-case checkpoint, full-suite reports and prior validation evidence. All pre-existing logs also remain unchanged. See `SOURCE-CHANGES.json`

The builds emitted the existing npm `http-proxy` environment-configuration warning and completed successfully. No warning is relabeled as a test failure or hidden.

## Retained canonical hashes

| File | SHA-256 |
|---|---|
| `contracts/BinaryPlan.sol` | `9844e9b6b14553e0eb14352d43ab65e0cefda18d7c07a87101d074959c198271` |
| `contracts/FTIRetirementReviewToken.sol` | `89de8c1e8babbb0b5cf8ad20b92d96f176f2d3f89e9319e7328c7c52f0676ccb` |
| `artifacts/BinaryPlan.json` | `74c55aff04054d58d9f7ea9c9720032a0d6fe7572b248fa881dca0b9ee1cd4cb` |
| `artifacts/FTIRetirementReviewToken.json` | `f7821bc76f101bc010d5c61a34408f821f2867e13f53007308335036e0d8d0dd` |

## Honest boundaries

The earlier 447/447 full repository result predates these copy changes. It is preserved, not rerun or relabeled. The focused counts overlap that run and must not be added to 447 or the historical 173-case checkpoint. Historical reports, including then-open H statements in `docs/full-suite-review/`, describe their execution-time state; the current support scope is [the owner decision](../OWNER-SUPPORT-DECISION-2026-10-06.md).

No rendered-browser/live-wallet check, public-network/RPC access, signing, broadcast, deployment, SSH, GitHub, real-fund action, or new security/throughput certification occurred. Current UI changes are copy-only; underlying historical interfaces and transaction behavior remain unchanged. Historical landing addresses are labeled historical and do not identify a deployment of the new candidate.

The owner confirmed chain 97, TEST ONLY MockUSD. Addresses/nonce remain blank; all preparation-completion, readiness, approval, network/runtime/address/nonce verification, signing, broadcasting and deployment flags remain false in the new status template.
