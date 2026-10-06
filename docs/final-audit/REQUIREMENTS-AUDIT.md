# FTI independent requirements audit

Status: completed final-source review with independently reviewed full-suite test migration, 2026-10-06 UTC. Current scope addendum: the owner retained the existing support model on 2026-10-06; H01 is resolved by that decision, not by implementing the former policy. The original evidence and historical checkpoint are unchanged. Local review only. No deployment, publication or real-fund transaction was performed by this review.

## Scope and evidence standard

The reviewed target is the combined `FTIRetirementReviewToken` + `BinaryPlan` candidate, its keeper, API, frontend and unsigned deployment checks. `FTIToken`, `FTIReserveToken` and `FundedBinaryPlan` are historical alternatives and are not substitutes for testing this pair. Historical reports with 177, 208 or 250 passing cases do not validate new changes.

The matrix distinguishes source inspection, executed tests, synthetic fixtures and unanswered requirements. Exact frozen files and checksums accompany this report. This review cannot prove the absence of all defects or economic risks, nor guarantee what a future reviewer will find.

## Conclusion and remaining issues

The current contract pair reproduced exactly in an independent build, and the selected economic, lifecycle, precision, hostile-collateral and interface checks listed below passed. The initial stale-cycle closure authorization defect was corrected before the frozen final pair. No unresolved critical code defect was identified in the covered final-source checks.

The owner-selected support scope is reconciled; this is **not external security certification or deployment clearance**:

1. **H01 resolved by owner scope decision, with economics unchanged.** On 2026-10-06 the owner chose to retain this current model. Buy fees remain in live reserve R. The full 5% Binary token allocation goes to R for positive supply S and to protected H at zero supply. H remains inactive, excluded from pricing, and unavailable for automatic insurance or loss repair. Only permanent governed retirement after liability checks disposes of H to the fixed development recipient. The former buy-fee-funded / Binary 4/1 automatic-support policy is superseded for this version; it was not implemented. Exact-ratio minting requires no support subsidy for ordinary accepted trade growth under the current allocation, while backing checks still reject a collateral deficit. See [the explicit decision](../OWNER-SUPPORT-DECISION-2026-10-06.md).
2. **Closed validation gap: complete inherited-suite migration.** A separately frozen, test-only migration now passes the unchanged `npm test` command: 447/447 cases in 49 files, with zero failures/skips/cancellations. Independent review verified all ten test diffs, replayed the exact patch, checked 99 frozen inputs and confirmed production code unchanged. This supersedes the earlier focused-only validation limitation. Historical/mixed-model tests remain identified; counts are not added to the earlier 173-case checkpoint. See the full-suite migration review and E11 below.
3. **Remaining policy and deployment boundaries.** The 7% large-trade coefficient remains provisional. True zero-output trades and tiny transfer/final-sale dust can still revert. Emergency exits are fee-free; zero-supply references are historical, not spendable backing. Continuing new Binary membership after permanent token closure is not implemented: its token injection reverts atomically. The owner has confirmed BNB Smart Chain Testnet, chain 97, with TEST ONLY MockUSD. Live network/runtime, public addresses, nonce and signer ownership remain unverified; all deployment readiness/approval/signing/broadcast flags remain false. Ganache fixtures do not validate a live deployment.
4. **Coverage limits.** No rendered-browser/live-wallet pass or fresh 300,000-wallet/full-network gas-capacity claim is made. The complete suite includes a fresh current-token 100-user EVM load; per-call batching, that bounded load and hostile gas tests do not prove production throughput. Global carried-pool ownership remains the chosen global model; these mechanical tests do not establish Sybil resistance, profitability or investment suitability.

## Findings corrected before the reviewed freeze

- **High: stale closure approval across cycles.** The initial token let a mature selector/timestamp authorization survive restart and a later final sale. The final token increments `lifecycleNonce` on every zero-to-positive mint, clears old close/retire authorizations and requires the expected nonce in Council approval calldata. Tests cover both a mature old authorization and a fully voted but unexecuted old Council proposal. An old scheduled timelock operation is usable only after fresh current-cycle Council authorization and a new full 72-hour wait; this is explicit renewed consent.
- **Medium: current-facing lifecycle contradictions.** English/Persian entry documentation and current UI/admin/landing copy now distinguish ordinary restart, irreversible buy closure, same-owner pending conversion and later retirement. Historical reports remain historical.
- **Medium: stale ABI/config evidence.** The unsigned preparer was refreshed against final source/artifact pins and now verifies the nonce-bearing lifecycle ABI and new auto/conversion APIs. Forty preparation checks include rejection of actual old token/Binary source and artifact bytes. API capability reporting now probes deployed getters rather than trusting the local ABI alone.

### Rationale for retaining the current allocation

With exact minting, routing all buy fees outside live R changes the price proof. For example, pretrade R=100 USD and S=1,000 FTI, a 100 USD buy with a 3 USD fee mints 970 FTI. If only 97 USD enters live R, the new ratio is 197/1,970 = 0.1, exactly equal to the old ratio. Strict growth would reject it without an explicit support transfer. Under the current code, all 100 USD enters R and the ratio rises to 200/1,970. These are different economic allocations.

The owner selected the current allocation rather than that alternative. A future minimal-injection policy, outside this approved version, would need to specify the post-operation reserve target, where the fee is first accounted, and the exact authorized transfer from H. For a buy alone under full-precision flooring, the minimal top-up needed to exceed the old ratio is at most one USD atom if the fee is initially outside R. This mathematical observation does not implement or approve such a policy. Unexpected collateral loss, fee-on-transfer assets and emergency exits are different cases and must not be described as automatically insured.

## Requirements-to-evidence matrix

Evidence identifiers below refer to the final-source runs in the next section. Synthetic history/readiness fixtures are explicitly distinguished from organic funded activity.

| ID | Requirement | Principal implementation | Executed evidence | Limits / audit status |
|---|---|---|---|---|
| B01 | One paid unit is 100 USD: 90 point pool, 5 token funding, 4 builders, 1 development | BinaryPlan `_fund` | E1, E2, E6 | Passed exact funding/accounting cases; full 5% goes to R at S > 0 or H at S = 0, retained by owner decision H01 |
| B02 | Builder pool split is 1.6 / 1.2 / 0.8 / 0.4 USD per unit | BinaryPlan `_fund` | E2 | Passed all four tier amounts with one and six eligible builders |
| B03 | At least five units must be paid in the same earned hour | BinaryPlan `beginEpochClose`, `epochUnits` | E1 | Passed four units then one in separate hours and same-hour five-unit top-up |
| B04 | Under-gate cash carries, never diverted to development | BinaryPlan `beginEpochClose`, `_nextEpoch` | E1 | Passed under-gate/no-point carry; only exact distribution residual goes to development |
| B05 | Rank derives from funded, capped paid points at 100/200/500/1000 | BinaryPlan `processEpoch`, `cumulativePaidRankPoints` | E5, E6 | Four threshold boundaries use synthetic prior history; Builder I also reached through 20 real funded epochs |
| B06 | Old rank applies to current-hour cap and auto split | BinaryPlan phase 1 snapshot, phase 2 promotion | E5, E6 | Old-rank allocation precedes permanent rank advancement |
| B07 | Base point caps 5/10/15/20/25; protection rows apply next hour | BinaryPlan `cap`, `frozenLevel` | E5, E10 | All 20 cap entries checked; low-PV protection/next-row regression explicitly synthetic |
| B08 | Matched excess above cap flushes; unmatched imbalance carries | BinaryPlan phase 1 matched raw subtraction | E6; source inspection | Organic cap/matching history checked; no claim that every possible network shape was explored |
| B09 | Global full-pool pro rata; 20 USD is a target, not a ceiling | BinaryPlan phase 2 `Math.mulDiv` | E1, E10 | Above/below-target funded pro rata; no-point pool carry is not a Sybil-resistance guarantee |
| B10 | Monthly tier entitlement once per lifetime, at most 20% of pool per wallet | BinaryPlan `beginBuilderMonth`, `processBuilderMonth` | E2 | One and six TEST_ONLY tier-four builders; all four tier caps/carry and lifetime exclusion checked |
| Q01 | Manual quota per paid unit: 500/600/700/800/1000 at current rank | BinaryPlan `tokenBuyLimit` | E1 | All five rates and paid-unit top-ups checked with explicitly seeded ranks |
| Q02 | Remaining quota subtracts lifetime gross manual spend; selling does not reset | BinaryPlan `authorizeTokenBuy` | E1 | Gross spend, sales/transfers, quota failures and atomic rollback checked |
| Q03 | Builders double quota at each 10x milestone from 0.1; Members do not | token `_syncMilestone`; Binary `tokenBuyLimit` | E1; source inspection | 10x and 100x transitions checked; multiplier remains capped at 1024 |
| Q04 | Automatic purchases do not consume manual quota | token `_buy` automatic branch | E3, E6 | Manual ledger unchanged by successful automatic mint/retry/restart |
| T01 | Ordinary amount <=500 USD has 3% fee; large curve remains provisional 7% coefficient | token `_tradeFee` | E1, E3, E4, M1 | 500 boundary and larger fees checked; 7% remains provisional, ceil rounding explicit |
| T02 | Wallet transfer burns 3% of gross, no USD fee | token `_update` | E1, E3 | Gross burn, actual net transfer and sub-display growth checked; one-atom dust rejects |
| T03 | Mint full precision floor(netAssets*S/R), not a rounded displayed price | token `quoteBuy` | E3 | Exact-ratio mint and old rounded-price overmint counterexample checked |
| T04 | Accepted ordinary positive-supply operations strictly increase real R/S | token `_requireGrowth` | E3, M1 | Positive exact growth may leave the 18-decimal display unchanged; zero exact growth rejects |
| T05 | UI communicates tiny exact growth honestly with adaptive precision | frontend price formatting, API ratio state | E7 | Unit/API/renderer-function checks passed; rendered-browser screenshots were not run |
| A01 | Auto off by default; fixed 5% of eligible Builder hourly rewards | Binary `autoSnapshot`, phase 2 | E6 | Default off and actual 20-epoch organic Builder qualification checked |
| A02 | Enable at 12:30 applies to the 13:00 settlement; exactly 13:00 schedules 14:00; disable stops attempts immediately | Binary `setAutoBuy`, `_rollAutoSetting`, `autoEnabledFrom` | E6 plus separate timing edge | 12:30→13:00, 12:59, exact boundary, off/on, active repeat and old backlog checked |
| A03 | No user price cap; attempt new allocation during reward settlement at current quote | Binary `executeImmediateAuto`, `_performAuto` | E6 | Only new allocation attempted atomically; older pending remains separate |
| A04 | Mint directly to beneficiary and never re-debit outside wallet cash | token `autoBuy`; Binary cash claims | E6 | Beneficiary mint and separate cash-release/claim ownership checked |
| A05 | Failed auto is isolated and pending, retry only while enabled | bounded self-call; keeper | E6 | Tax/revert/gas failure pending and enabled-only keeper retry checked; service timing not guaranteed |
| A06 | Reentrancy protected and gas bounded; batch must advance | Binary guarded outer allocation, self-only helper | E6; E0 | Nested callbacks, bounded exhausted child and positive cursor progress checked |
| L01 | Ordinary zero supply is restartable in same contract | token `quoteBuy`, `_buy`, final `sell` | E6 | Manual/automatic same-contract restart checked; permanent marker still forbids reopening |
| L02 | Restart uses last exact R/S; never allocates old H, donations or development claims | token referenceReserve/referenceSupply | E6 | Exact fractional anchor, alternate buyer, repeated micro cycles, old support/claim/donation isolation checked |
| L03 | Normal final seller pays normal fee; fee reserved as isolated development claim | token `sell`, `claimDevelopmentFees` | E4, E6 | Terminal boundary fees, isolated owed claim, blocked/taxed payment and callbacks checked |
| L04 | Permanent close requires 5/7, 72 hours, zero S/R and paused quiescent Binary | token close, Council, timelock | E6 | 5/7, delay, revocation, zero backing and quiescent Binary checked; fixtures identified in tests |
| L05 | Permissionless bounded pending-auto conversion pays same user's cash entitlement | Binary `releaseClosedTokenAutoToCash` | E6 | Real Binary partial/repeated bounded same-owner conversion checked; ordinary zero supply rejects |
| L06 | Retirement after clearing token claims/auto, H to fixed development, Binary cash protected | token `_requireRetirementReady`, `retirePermanently` | E6 | Final token retirement and surviving Binary cash claim checked; future membership continuation absent |
| L07 | No stale approval/proposal may close a later cycle | token Council authorization and lifecycle generation | E6; final nonce source inspection | Both mature authorization reuse and unexecuted prior-cycle Council proposal reject |
| C01 | Binary funds, live R, H, development fees and donations are distinct | both `accounting` functions | E1, E2, E3, E4, E6 | Separate tracked balances and liabilities checked; direct donations remain surplus |
| C02 | Token/Binary/collateral/governance/development binding immutable and matched | token `bind`, constructors | E4 | All binding dependencies and immutable/fixed recipient checks passed |
| C03 | Taxed/blocked collateral and callbacks cannot steal or double allocate | exact balance deltas and guards | E1, E4, E6 | Taxed/blocked collateral, rollback and nested-entry cases checked; arbitrary collateral safety not guaranteed |
| C04 | All large loops bounded; stateful regressions exercise lifecycle interactions | max batch, volume jobs, monthly phases, milestone bound | E6, E0, E11; source inspection | Bounded steps/gas progress and fresh 100-user lifecycle load checked; no full-network throughput guarantee |
| I01 | Frontend/API select correct lifecycle/auto ABI and report shutdown truthfully | server, frontend ABI/config handling | E7 | Deployed getter probing, block-hash coherence, new ABI and truthful lifecycle states checked |
| I02 | Old source/artifact pins fail; final unsigned preparation verifies exact canonical inputs | prepare-retirement-deployment, verification script | E8 | 40 preparation/entrypoint checks, independent five-artifact rebuild and actual old-pin rejection |
| H01 | Explicitly retain current R/H allocation; supersede former automatic-support policy | Existing `_buy`, `inject`, `_requireRetirementReady`, `retirePermanently`; no new code | Owner decision 2026-10-06; E1/E3/E4/E6 support unchanged mechanics | RESOLVED BY OWNER SCOPE DECISION: buy fees to R; Binary 5% to R at S > 0, H at S = 0; H inactive, no automatic insurance; retirement-only disposition after liability checks. Former policy is not implemented |

## Independently executed arithmetic evidence

`check_integer_requirements.py` completed on 2026-10-06 with deterministic seed 20261006. Across 100,000 generated states it checked 65,703 in-range positive-output buys, 100,000 partial sells, 100,000 transfer burns and 82,668 in-range exact-reference restart mints, plus 30 fee-threshold boundary cases. Real-ratio strict growth and the uint256 cross-product/fee bounds passed. Out-of-range or zero-output cases were not counted as accepted transactions. This is a separate integer model, not an EVM simulation or proof of source equivalence.

## Earlier focused checkpoint and complete-suite evidence ledger

E0–E10 below preserve the earlier 173-case focused checkpoint: 49 independently rerun or added by this audit and 124 reviewed from implementation/UI/preparation runs. E11 is the later complete repository run: 447/447. Report 447 as the current full-suite count; do not add 173 to it. The 41 UI unit cases are already included in E7's 56; the nine restart cases are already included in E6's 27.

| ID | Execution / scope | Result | Evidence |
|---|---|---|---|
| E0 | Independent unmodified-source compilation | Pass; complete token/Binary artifact files byte-identical to final outputs | `independent-compile.log` |
| E1 | Current-pair fee, funding, gate, quota, milestone and hostile-collateral integration selection | 17/17 passed | `independent-canonical-economics.log`; excludes three obsolete auto cases |
| E2 | New audit-only one-/six-builder monthly scenarios | 2/2 passed | `independent-monthly.log`; explicit TEST_ONLY rank seeding |
| E3 | Exact ratio/rounding EVM suite | 9/9 passed | `independent-precision.log`; TEST_ONLY numeric-state fixture |
| E4 | Binding, terminal fee, isolated claim and callback selection | 15/15 passed | `independent-binding-terminal.log`; no obsolete retirement-helper case credited |
| E5 | Audit-adapted four paid-rank boundary scenarios and full cap table | 4/4 passed | `independent-rank-boundaries.log`; synthetic prior history, real funded allocation |
| E6 | Implementation final real-Binary auto + restart + keeper run, reviewed against frozen hashes | 27/27 passed, plus 1/1 separate timing-edge case | Reviewed final-contract-tests and timing-edge logs; timing edge uses synthetic rank |
| E7 | Final UI/API selection and workspace/landing builds, reviewed manifest hashes | 56/56 passed; builds passed | Reviewed `ui-api.log`, source/build manifests and verification summary |
| E8 | Final offline unsigned-preparation/entrypoint checks, reviewed source/artifact validation | 40/40 passed | Reviewed preparation report/log and independent five-artifact rebuild evidence |
| E10 | Audit-adapted low-PV protection and underbacking/rank rollback scenarios | 2/2 passed | `independent-protection-deficit.log`; explicitly synthetic fixtures |
| E11 | Full unchanged npm-test command after reviewed test-only migration | 447/447 passed; 49 files, zero failures/skips/cancellations | `FULL-SUITE-MIGRATION-INDEPENDENT-REVIEW.md` and `.json`; exact patch/input/log hashes verified |
| M1 | Separate 100,000-state integer model and 30 fee boundaries | Passed | `check_integer_requirements.py` and `.json`; not EVM equivalence evidence |

### Reproducibility and hashes

- Binary source SHA-256: `9844e9b6b14553e0eb14352d43ab65e0cefda18d7c07a87101d074959c198271`
- Token source SHA-256: `89de8c1e8babbb0b5cf8ad20b92d96f176f2d3f89e9319e7328c7c52f0676ccb`
- Binary full artifact SHA-256: `74c55aff04054d58d9f7ea9c9720032a0d6fe7572b248fa881dca0b9ee1cd4cb`
- Token full artifact SHA-256: `f7821bc76f101bc010d5c61a34408f821f2867e13f53007308335036e0d8d0dd`
- Keeper source SHA-256: `d53789135e14713e8e1fc6f14d689a42cba0185b86b3c06bbace79c44a7b11d2`
- Compiler: solc 0.8.30, optimizer 200 runs, viaIR, Shanghai
- Runtime sizes: Binary 21,277 bytes; token 20,877 bytes, both under the 24,576-byte EIP-170 limit

`COMBINED-SOURCE-MANIFEST.json` identifies the full-suite snapshot inputs; its `-173-CHECKPOINT` predecessor preserves the earlier test versions. Production contracts are unchanged. `TEST-INVENTORY.json` identifies selected case names, commands and result logs. Audit-only test adaptations do not modify production contracts. Generated interim logs are not final evidence. Non-fatal Ganache native-µWS fallback and HTTP listener warnings are environment limitations, not silently suppressed passes.

### Commands used for the earlier independent EVM selections

From the isolated frozen copy with pinned dependencies:

```sh
node scripts/compile.mjs
node --test --test-concurrency=1 --test-skip-pattern 'unranked Members|TEST_ONLY builder auto' test/retirement-integrations.test.mjs
node --test --test-concurrency=1 test/independent-monthly-audit.test.mjs
node --test --test-concurrency=1 test/support-precision.test.mjs
node --test --test-concurrency=1 --test-name-pattern 'fixture binds|constructor rejects|fixed recipient|bind rejects|normal terminal q=S|permissionless fee claim|emergency partial|blocked seller|blocked or taxed development-fee|terminal seller payout|development-fee payout' test/retirement-review.test.mjs
node --test --test-concurrency=1 --test-name-pattern 'TEST ONLY prior paid history' test/independent-rank-boundaries.test.mjs
node --test --test-concurrency=1 --test-name-pattern 'TEST ONLY dense matches|funding deficit blocks allocation' test/independent-rank-boundaries.test.mjs
```

The later complete run used `npm test` without filters. Its ten test-only changes are approved for exact-hash integration; final packaging must preserve those tested file bytes. The owner-decision documentation/UI-copy update is subsequent to E11 and does not rerun or relabel 447/447. Its focused checks are recorded separately in [decision-update validation](../owner-support-decision/VALIDATION.md).
