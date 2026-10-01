# Binary plan, token and anti-Sybil economic review

**Historical legacy diagnosis:** the findings below describe the old global-pool binary plan and curve token. The separate attributed-credit and real-reserve candidate is described in [FUNDED-PLAN](FUNDED-PLAN.md). Legacy diagnostic tests remain intentionally reproducible; they do not run the new reward model.

Review date: 2026-09-30 UTC; revalidated on the contract-core candidate on 2026-10-01 UTC. Baseline: main 2e1507f6405544815a0f3534426f684c5654b1de. The contract-core candidate changes auto-buy execution but leaves reward allocation and the token curve unchanged. The three local diagnostic scenarios below are included in this branch. Findings are not an independent audit or a safety certification. See CORE-REVIEW.md for the new fixes and the distinction between diagnostic and regression tests.

## Definition and result

Here, reverse/self-funding abuse means a single economic owner controlling a tree of addresses, buying volume beneath them, recycling rewards, capturing other participants' funding, or bypassing address/transaction-based limits. Unique addresses do not establish unique people. The current system is NOT proven resistant to this behavior.

## Findings

### HIGH — carried global pool can be captured by a newly funded private subtree

`processEpoch` sets pointValue = pointPool / totalPaidPoints and pays every available pool dollar (apart from integer dust) to current paid points. `cap` limits point count, not USD income. There is no maximum point value, origin-based attribution or age restriction on the carried funds.

Reproduction on a local EVM with three newly registered, self-controlled addresses: an unrelated genesis leaf buys 100 units (10,000 test USD). No active account has balanced points, so 9,000 remains in pointPool. A newly registered parent buys one unit and its two new children buy two units each: 500 USD total. That parent is the only eligible matched participant with two paid points. It receives 9,450 USD, giving the group 8,950 USD net before gas. Its parent and ancestors in this scenario have no purchased units; this is permitted by current registration rules. This does not require access to genesis private keys: the attacker can register under an available inactive genesis leaf.

The baseline with the same three-wallet subtree and no unrelated carried pool pays 450 of 500 USD. Therefore the exploit is allocation of other people's funding, not creation of money or an accounting overdraft. Requiring active sponsors alone does not solve pool capture in general; active ancestors would share the proceeds rather than impose a hard USD ceiling.

The tests assert these observations and therefore PASS when the weakness exists. They are demonstrations, not anti-abuse regression protections. Once the policy is changed, the expected outcomes must be changed.

### HIGH — no person/group-based enforcement

One address can register only once, and placement cannot form a cycle because parents already exist. Nevertheless, one person can own many addresses. Point caps, the 1% token acquisition cap, purchase allowances and the builder 20%-per-address share are not group caps. Multiple qualifying addresses can aggregate rewards. This is a code finding; total profitability depends on other participants, placement, qualification costs and timing.

Genesis positions keep volume while inactive. A position activated later can use retained volume and qualify for rank once settlement processes it. This is explicitly documented in code, but creates preferential early-position optionality and must be disclosed and policy-reviewed.

### MEDIUM — transaction-based whale fee can be reduced by splitting

`quoteSell` calculates whale surcharge from only the current sale, not aggregate sales by the economic owner. In the local test, a 400 USD purchase was unlocked after 31 simulated days. One full sale had an 8.70% quoted fee and paid 354.243999999999888935 USD; ten sales each had a 3% fee and together paid 376.461855773032705416 USD. Both paths began from the identical EVM snapshot; the final proceeds include the normal support/rounding effects along each path. Ten small sales of the same unlocked holding can receive more than one full sale. The demonstrated path uses one wallet; extra addresses are not required. Optional exit orders call this same sale path and do not fix the fee property. The sustained-sell detector can eventually raise fees, but small volumes below its 1,000 USD threshold avoid it; its window advances by registrations, not elapsed time.

### HIGH at large scale — settlement throughput and keeper availability

Each hourly close visits every member twice, even inactive members. At 200,000 members this needs at least 4,000 transactions at the contract maximum batch of 100, excluding ancestry processing. The supplied keeper uses 50, requiring 8,000 transactions. Its 5-second timer allows at most 720 attempts per hour, and it waits for receipts. Even the idealized 8,000 * 5 seconds is over 11 hours; actual completion can be slower. New registrations/top-ups are blocked after epochEnd until closure finishes.

Ancestry processing is bounded per transaction but not in total work: each purchase propagates to every ancestor. A deliberately deep chain makes aggregate work quadratic during sequential growth. Permissionless processing permits additional keepers but supplies neither gas funding nor automatic capacity. Two hundred thousand users per hour is NOT a validated operating scale. See Solidity's gas/loop guidance: https://docs.soliditylang.org/en/latest/security-considerations.html#gas-limit-and-loops

### Long-term economic limitation — rewards require funding

For each 100 USD unit, 90 goes to the point pool, 5 to token support funds, 4 to builder pools and 1 to development. These contracts implement distribution of registration/top-up funds; they contain no external trading, sales-profit or yield source. With no new funding, only existing funded balances can be distributed. The five-unit settlement threshold can delay distributions. Principal repayment for a purchased membership unit is not implemented.

Token reserve coverage is a different property. Under the curve and collateral assumptions, tested conservative integer arithmetic preserves the reserve inequality; a payout at the current curve price is not a refund of the buyer's original payment. Support budgets do not create USD or guarantee the floor. See CORE-REVIEW.md for the exact reserve inequality and the scope of the EVM tests.

## Prioritized redesign proposal — not silently applied

1. Specify the economic objective first: a funded-reward membership program with variable returns, or a principal-repaying product. Current code only implements the former. Remove any guaranteed-principal/price/return promise.
2. Bound the USD value per point and the amount of carried funding releasable per epoch. These reduce the size of immediate pool capture but do NOT alone prove resistance over repeated epochs or colluding addresses. The existing 20 USD protection threshold is not currently such a cap and should not be reinterpreted without an explicit policy change.
3. Define which new funding can reward which eligible volume, when eligibility takes effect, and how old carry is distributed. Test the aggregate attacker-owned group, including repeated epochs, rank/builder income, recycled payouts and remaining assets. A per-address test is insufficient.
4. Decide whether identity/beneficial-owner controls are required. A wallet-only on-chain system cannot infer that several private keys belong to one person. Identity checks introduce their own privacy and operating obligations; do not advertise them as infallible.
5. Replace transaction-local punitive whale fees with a clearly specified split-resistant mechanism if that is required. A global flow fee affects honest users and can be griefed; a wallet flow fee remains Sybil-sensitive. Do not choose either silently.
6. Redesign settlement throughput before a large launch: active-participant indexing or a different reward accounting architecture, measured gas/cost/catch-up deadlines, and funded redundant keepers. Raising MAX_BATCH does not solve total work and can hit block gas limits.
7. Keep test collateral separate. MockUSD's unrestricted faucet and recipient-blocking hook are for testing only. A real stablecoin requires exact decimals, transfer behavior, issuer/freeze/depeg and solvency assessment. Independently audit the final bytecode, privileges and deployment process.

## Scope and reproduction

New diagnostic EVM tests: `node --test --test-concurrency=1 test/economic-adversary.test.mjs` after compiling this candidate. All actions are local, with test assets. No attack was run on the public deployment. Existing public contract addresses and server are unchanged.

This review adds evidence and proposed requirements; it does not implement a new compensation formula. Contract changes would require a separately deployed version and explicit migration rules. Existing tests establish selected behavior, not absence of undiscovered vulnerabilities.

Baseline diagnostic result: 3 passed, 0 failed. One baseline and two confirmed weaknesses; a passing diagnostic does not mean the weaknesses were fixed. The candidate's full run is recorded in core-validation.json.
