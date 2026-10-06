# Current record pointer — updated 2026-10-06

The current combined candidate is covered by [the 447-case full-suite validation](immediate-auto-review/VALIDATION.md), [requirements audit](final-audit/REQUIREMENTS-AUDIT.md), and [owner support decision](OWNER-SUPPORT-DECISION-2026-10-06.md). H01 is resolved by retaining existing economics; automatic H insurance is outside scope. The original fee-floor report below is preserved verbatim as a historical 2026-10-05 record, including its then-open issues and 250-case count; it is not current validation for the later combined candidate.

---

# Current local fee-floor and hourly-unit review

Status: local review only, 2026-10-05 UTC. No push, merge or deployment is authorized. The $500 fee-floor correction and current-hour five-registration-unit gate replace the previous review semantics. The 7% surcharge coefficient remains provisional.

The prior 208-case validation belongs to the published pressure-fee revision, not this source. Its unchanged record is preserved in [the historical validation](validation/2026-10-04-pressure-review-validation.md). Current checks are being rerun against the revised source; see [fee rules](SIZE-FEE-PROPOSAL.md) and [registration-gate validation](REGISTRATION-UNIT-GATE-VALIDATION.md).

Completed current-source coverage, exact hashes and remaining limits are recorded below. Final closeout: 2026-10-05 10:20 UTC.

## Complete current-source coverage

All **32 current top-level test files / 250 distinct cases** passed, with zero failures, skips or cancellations in the credited final runs. This was verified through separate recorded selections, not one `npm test` wrapper invocation. The per-selection coverage map excludes the five duplicate UI-group cases. It does not reuse the earlier 208-case result.

- Coverage map: `validation/2026-10-05-fee-floor-coverage.json`, SHA-256 `a22cca47c95dc6b77e1f90c6ecce8ed5a89b444e8a1752a80c86543ca2edc9a0`
- Source/test/config manifest: `validation/2026-10-05-fee-floor-source-manifest.json`, SHA-256 `8567d994dd21ddd9fb3239cc80259fa37abaaa954dd6c0ea7d2d552480a5b96a`
- All 82 recorded first-party inputs and 11 compiled artifacts match their frozen hashes at closeout

The 250 cases include historical compatibility tests as labeled; they are not all tests of the new fee curve. Failed preliminary runs remain diagnostic history and are replaced only by the named successful final-source reruns.

## Successful selections

- Production compilation passed; FTIReserveToken runtime 14,000 bytes, BinaryPlan 19,384 bytes
- Independent verification input recompiled and matched all five canonical creation bytecodes
- Final fee-floor-focused suite: 33/33 passed, zero failed
- Five migrated EVM files (funded-locks, integrated-economics, reserve-token, revised-economics, zero-supply-quarantine): 61/61 passed
- Current token-only arithmetic model: 7/7 passed, including instrumented 300,000-wallet simulation
- UI/API selection: 13/13 passed (frontend-trade-quotes, integrated-server-state, token-gas, review-entrypoints); some are also included in broader groups and must not be double-counted
- Web and landing builds passed; syntax/whitespace checks passed
- Hourly gate: 13 paid-point and 26 protocol cases passed; the clean final 13-case rerun against the current fee-floor artifact confirms no source/artifact drift
- Canonical paid-rank auto-buy example over $500 passed: $544.50 gross, fee $16.589577594123048669; max-price ceiling rejects one atom below and executes exactly at the ceiling, without consuming manual quota or protected cash

The complete integrated-binary-funding final run passed 23/23. The broad quota/collateral/governance/load selection passed 40/40; the historical/utility compatibility selection passed 39/39. Together with the other selections and duplicate exclusions, these establish the 250 distinct cases above.

Both 100-user live-EVM load tests completed 100 buys, 20 transfers and 100 normal exits, paying exactly 1,790 USD from 1,785 USD of buys plus 5 USD of positive-supply support. They left R=S=0 and preserved the canonical 500 USD / historical-funded 655 USD protected buckets. Their inherited `exitMode` log string still says `normal-pressure-fees-final-full-refund`; that text is a legacy label, not the executed fee model. Both used the current fee-floor artifact recorded in the manifest.

## Observed price transitions

The instrumented current model records 759,963 accepted ordinary operations with positive supply on both sides: 299,999 buys, 399,965 partial sells, 59,999 transfers. Every displayed-price and exact-R/S transition rose; equality and decline counts are zero. One bootstrap buy and one terminal sale are separately counted. No emergency trades or rejected attempts occurred in that deterministic path. Registration injections and 1,059,965 invariant checks are not the denominator. The strict-growth acceptance condition means this is an observed accepted-path result, not an estimated worst-case probability or a guarantee that every attempted operation executes. Separate EVM tests cover dust/min-out failures.

Simulation output: `reserve-sizefee-floor-simulation-300000.json`, SHA-256 `05de33fcb381bb19827ba56af40c134b961648a282c292a2e4a764d9b6cf6d48`. Historical simulation artifacts were not overwritten. This independent model does not prove binary settlement equivalence, gas throughput, adversarial completeness or profitability.

## Exact principal source

- FTIReserveToken: `c92a91a9cd21335c5eeef805faba5185204bd39c5d239bb339eb19a4a825b3be`
- BinaryPlan: `92a39d6f728b492b46ae54f53d36e15d8d20a1c1a082acca81bcdc6babe81789`
- Fee-floor-focused amendment patch: `35acbf2aec786523ef62ebb01c87f8ac25a72b97dde8ae04f778164f84868149`

## Limitations

Rendered browser QA was blocked before page load because Chromium could not create its process-singleton socket (Operation not permitted). Automated quote/API checks and builds passed; a rendered-browser pass is not claimed. Ganache used its JavaScript fallback for the unavailable native uWS build. The API test emitted an existing MaxListeners warning without failing.

The 7% coefficient, protected-fund ownership/trigger/spending policy, bootstrap exception, restart and precision/emergency exceptions remain review issues. The user has requested alternatives to dust reverts; current guards are not a newly accepted final dust policy. See the exact-claim and open-dust-options sections in SIZE-FEE-PROPOSAL.md. No protected-fund auto-release was implemented. This is not an audit or deployment approval; no GitHub changes were published.
