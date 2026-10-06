# Local large-trade fee proposal

**Status: local, reversible review experiment only.** The correction `T=max(500 USD,5% of live reserve)` is approved for local implementation. The 7% curve coefficient remains a provisional review parameter, not final economic approval. This folder is separate from the published PR #6 review state (`5e0809f`) and the canonical review directory. No push, merge, deployment, fund release, or new governance authority is part of this work.

## Intended behavior

- Ordinary buys and normal partial sells up to **500 USD use only the nominal 3% base fee**, regardless of reserve size or trading history. Extra fees apply only when the current trade exceeds both 500 USD and 5% of pretrade live reserve.
- The threshold uses **pretrade live redeemable reserve**, not lifetime volume, a time window, previous sellers, wallet identity, unaccounted donations, or the price-protection fund.
- There is no active global-pressure fee, decay timer, personal waiting lock, or hard trade-size/hourly sale cap.
- Manual purchases still consume their **gross cash amount** from the unchanged binary-owned lifetime quota. Automatic purchases use the same fee curve, but remain outside that manual quota.
- Wallet transfers still burn 3% of the gross tokens, subject to the existing atomic rounding and dust rules.

“3%” and “below 10%” describe nominal continuous rates. All cash is stored in integer USD atoms (18 decimals); a fee is rounded upward once. A tiny amount can therefore realize a larger percentage, or fail existing dust/displayed-price-growth checks. The current prototype still rejects some dust/precision operations. The user has asked for alternatives to those reverts; retaining the existing code during this fee-floor amendment does not mean the user accepted that as the final exit policy.

## Formula

Let:

- `R` be pretrade redeemable reserve
- `S` be pretrade circulating token supply
- `V = A` for a buy with gross USD payment `A`
- `V = floor(q × R / S)` for a normal partial sale of `q` tokens
- `T = max(500 × 10^18, R / 20)` in 18-decimal USD atoms (5% remains exact even when fractional)
- `B = max(V − T, 0)`

The total fee is:

`F = ceil(0.03 × V + 0.07 × B² / (B + T))`

For `V <= T`, the surcharge is exactly zero and `F = ceil(0.03 × V)`. The existing bootstrap exception with `R = 0` or `S = 0` remains base-only even above 500 USD. That preserved exception is a review policy, not an inference that protected cash is live reserve. A normal full-supply terminal redemption (`q = S`) pays all `R` with **zero fee**. The existing emergency redemption exception remains fee-free, including partial redemptions.

For `V > T`, `B + T = V`. Define `H = max(20 × 500 × 10^18, R)` and the integer `X = 20V − H`; implementation computes:

`F = ceil((300 × 400 × V² + 700 × X²) / (10000 × 400 × V))`

This is one combined rational calculation with one final ceiling. It does not independently round base and surcharge or derive fees from rounded basis points. `V,R <= MAX_RESERVE = 10^30` bounds the combined numerator by `4 × 10^65`, well below `uint256`; the denominator is at most `4 × 10^36`. Intermediate products are also within range. No unchecked arithmetic is used.

Example with `R = 10,000`, `T = 500`:

| Gross trade V | Base fee | Extra fee | Total F | Net value V − F |
|---:|---:|---:|---:|---:|
| 100 | 3 | 0 | 3 | 97 |
| 500 | 15 | 0 | 15 | 485 |
| 1,000 | 30 | 17.5 | 47.5 | 952.5 |
| 5,000 | 150 | 283.5 | 433.5 | 4,566.5 |

Examples apply to buys and nonterminal, nonemergency sales with that pretrade gross value.

## Smoothness and limits

Before atomic rounding, the fee and its first derivative are continuous at `T`. Above `T`, the marginal fee is `0.03 + 0.07 × (1 − T²/V²)`, which is strictly below 10% when `T > 0`; below `T`, it is 3%. Thus increasing trade size does not create an abrupt surcharge cliff at the threshold. Integer outputs still change in discrete atoms.

**The design is not split-proof or wallet-splitting-proof.** A user can divide an order into trades at or below each current live threshold, paying only the base fee each time. With an initial `R = 10,000`, a single 1,000 buy has a 47.5 fee, while two sequential 500 buys have total fees of 30. The second threshold rises after the first buy, and token outputs also change with the reserve/share price. Splitting sales similarly changes reserve, supply, and proceeds while avoiding the extra fee when each trade stays small. No promise of equal single/split outputs, anti-bot protection, or economic manipulation resistance is made.

Large earlier trades can change live `R`, `S`, and price. They do not leave behind a separate fee state that taxes a later small trade. A later transaction at or below 500 USD or at or below 5% of its own pretrade live reserve pays only the base fee, regardless of wallet or elapsed time. The floor does not create cross-wallet fee state.

The fee-free terminal redemption is a separate lifecycle exception. It creates a deliberate change from normal partial-sale fees and is not covered by the smooth nonterminal fee claim.

## Cash, supply, and protection fund

For buys:

1. Compute the fee using pretrade `R` and `S`
2. Consume gross manual authorization only for manual buys
3. Retain the entire payment `A` in live reserve
4. Mint `floor((A − F) × WAD / pretradePrice)` to the buyer

For normal partial sells:

1. Compute `V = floor(qR/S)` and `F` from pretrade state
2. Burn the sold `q` tokens without a second transfer tax
3. Pay `V − F`; the retained fee remains in live reserve

The current implementation retains exact-ratio and displayed-price strict-growth checks. Failed min-out, dust, deadline, quota, collateral, or range checks revert the entire transaction, including manual authorization. In particular, dust reversion is an unresolved implementation boundary the user wants alternatives to, not a newly approved policy. Exact nominal growth does not promise profitability, a market-price floor, or a profitable exit for every holder.

At zero supply, binary support is assigned to the **price-protection fund** (`priceProtectionFund`). This resolves its stated purpose, but does not approve the trigger, authority, beneficiary rights, spending mechanism, or release policy. There is **no fund spending/release/conditional deployment function** in the contract. The fund is excluded from live `R`, trading thresholds, minting price, final redemption, and price milestones. USD rescue remains blocked. Positive-supply binary support still enters live reserve under the existing rule.

`accounting()` continues to compare actual USD cash with `reserve + priceProtectionFund`; unsolicited USD donations remain unaccounted surplus. The legacy `unallocatedReserve()` getter aliases the new fund name for compatibility. The legacy `ReserveQuarantined` event is retained; its old field name does not change the new documented fund purpose.

Full redemption leaves `R = S = 0`, retains a historical reference price, and sets `lifecycleClosed`. Protected fund cash remains untouched. Later buys and automatic buys remain blocked pending an approved restart policy; later zero-supply injections remain protected. The fixed 0.10 launch/milestone anchor, rank rules, manual quota rules, and existing 1,024× milestone cap are unchanged.

## Quote and compatibility API

- `buyFeeBps()` returns the actual **base rate**, 300, not a size-adjusted rate
- `buyFeeQuote(amount)` returns `(feeAmount, netAssets)` in USD atoms; a dust quote may have zero net assets, and this helper alone is not an execution authorization
- `quoteBuy(amount)` returns tokens after the size-based fee and applies the existing restart/dust requirements
- `sellFeeQuote(tokens)` returns `(feeAmount, payout, gross)` in USD atoms, including the terminal/emergency exception
- `quoteSell(tokens)` retains `(payout, feeBps, gross)`; its `feeBps` is now an explicitly **truncated indicative average** and must not be used to reconstruct the actual fee
- `sellImpactBps(tokens)` is similarly indicative. A positive sub-basis-point surcharge can round to zero here; use the exact fee helper
- Legacy `Sold` event basis-point fields are indicative under the same convention
- All former pressure getters (`pressureWad`, `lastPartialSellAt`, `currentSellPressure`, `previewSellPressure`, and pressure constants) return zero. `SELL_PRESSURE_ACTIVE` is false. They are deprecated compatibility surfaces and never drive a fee

This is a fresh local candidate, not a storage-layout-compatible upgrade. The local integrations and reference model are being migrated to this fee-floor revision; historical pressure artifacts remain separately labeled and do not validate it.

## Focused validation

Run only the new focused proposal suite, after compiling:

```sh
npm run compile
node --test --test-concurrency=1 test/size-fee-proposal.test.mjs
```

The tests compile clearly named `TEST_ONLY_` numeric-state and membership fixtures in memory; no production setter is added. They check boundary/base behavior in both directions, the 1,000/5,000 examples, later-wallet and time independence, actual cash/supply/strict growth, bootstrap and terminal closure, protection-fund exclusion, once-rounded fees and exact fractional threshold, atomic failure rollback, numeric bounds, split-order limitation evidence, auto/manual quota behavior, transfer burn, and emergency exceptions.

Historical pre-floor local result on 2026-10-04 UTC (does not validate the current amendment):

- Standard production compilation: passed; `FTIReserveToken` runtime 13,945 bytes (below EIP-170)
- Focused proposal tests: **21 passed, 0 failed**, final run 48.4 seconds
- Includes one production `BinaryPlan` integration check for gross manual quota and unchanged unranked-Member automatic-reward eligibility; automatic purchase fee math is separately exercised through the explicit test membership fixture
- `node --check` on the new test and source `git diff --check`: passed
- Ganache used its Node.js fallback because the native µWS module does not match this Node build; tests completed successfully
- Proposal contract SHA-256: `4fa03926aae9239897a5ff3f8b57ad1475e61a97ec60be8da3cbfcc496655967`
- Canonical review contract remains unchanged at SHA-256 `88ad7b354f4ae170b10b83f710b65215ec57ed27b4387258461ec93aa339d743`

A focused pass is not a full regression run, economic approval, independent security audit, deployment approval, or evidence that legacy pressure tests apply to this revision.

## Current fee-floor validation checkpoint

On 2026-10-05 UTC, production compilation passed with `FTIReserveToken` runtime 14,000 bytes. The final focused fee-floor suite passed **33/33**, 0 failures (73.2 seconds). Token source SHA-256: `c92a91a9cd21335c5eeef805faba5185204bd39c5d239bb339eb19a4a825b3be`. Exact token/focused-test amendment patch SHA-256: `35acbf2aec786523ef62ebb01c87f8ac25a72b97dde8ae04f778164f84868149`.

This covers reserves below/at/above the $10,000 threshold intersection, both $500 execution boundaries, 5%-dominant thresholds, unsupported collateral decimals, one combined ceiling, an explicit one-atom overcharge counterexample from prematurely flooring the reserve threshold, min-out failures, preserved bootstrap/final/emergency exceptions, protected-fund exclusion, independent wallet/time behavior and automatic/manual quota treatment.

Measured current model result: **0 falling / 759,963 accepted ordinary positive-supply operations**. Both displayed price and exact R/S rose on all 299,999 buys, 399,965 partial sells and 59,999 transfers; equal counts were zero. One bootstrap buy and one terminal sale are excluded from that denominator; no emergency trades or rejected attempts occurred in this deterministic path. Registration injections and the 1,059,965 invariant-check count are not trading denominators. The strict-growth acceptance guard conditions this result; it is not a probability estimate, exhaustive adversarial proof, binary-settlement equivalence or return guarantee. See `reserve-sizefee-floor-simulation-300000.json`; the earlier pressure simulation file is retained unchanged.

The new UI quotes exact USD fee amounts using block-pinned reads, keeping legacy FTIToken compatibility. UI/API focused checks passed 13/13 and both web/landing builds passed. Browser rendering could not be checked because Chromium process-singleton socket creation was denied by the environment. Broader current-source regression is complete: all 32 top-level files / 250 distinct cases passed through recorded partitioned runs, with no failed/skipped/cancelled credited cases. Full per-selection provenance and limitations are in `CURRENT-REVIEW-VALIDATION.md`; the old 208-case result is not used.

## Decisions still needed

1. Approve or revise the provisional 7% smooth-curve coefficient; the local $500-and-5% threshold correction is already approved
2. Accept the transparent split-order limitation, or specify a different tradeoff; no anti-split restriction has been silently added
3. Specify price-protection-fund trigger, authority, ownership/beneficiary rights, and spending/release policy before any such mechanism is built
4. Decide post-terminal restart behavior; the current gate remains closed
5. Confirm any desired changes to the preserved base-only bootstrap, tiny-amount/precision exits, emergency fee exceptions, and unchanged milestone limits
6. Complete broader integration validation and independent security/economic review before publication or deployment

## Hourly registration-unit clarification

The distribution gate is five registration units purchased in the current hour, not five points or five wallets, and not units accumulated across hours. A single $500 purchase contributes five units. Under-five hours keep the entire point pool as cash carry; previous hours' units do not help open the next hour's gate. At five or more current-hour units, the pool can settle only when eligible capped paid points are positive; zero eligible points still preserve all cash. Only exact proportional-allocation rounding goes to development. No 20 USD minimum point value is promised.

## Exact claim, displayed quote, and exits

For positive circulating supply, the exact reserve/share ratio is `P=R/S` in consistent units. The current displayed 18-decimal quote is `floor(R×10^18/S)`. The current buy implementation divides net value by that rounded pretrade quote; replacing it with higher-precision mint arithmetic is a separate open precision decision. A holder with `q` token atoms has a nominal proportional claim `qR/S`, but ordinary sale gross value is floored to whole USD atoms and the actual payout is gross minus the current fee. Therefore nominal spot value is not the same as a fee-net liquidation payment.

Sequential transactions change both reserve and supply, so later quotes and aggregate proceeds generally differ from one initial spot quote multiplied by all sold tokens. The terminal exception is explicit: if the submitted amount is the whole remaining supply, the sale pays all live R, burns all S, and leaves R=S=0. There is no live post-sale price at S=0; the retained `referencePrice` is historical only. Protected fund cash is excluded.

The measured model result of zero displayed/exact price declines in 759,963 accepted positive-S ordinary operations is conditioned on current acceptance checks and that deterministic input sequence. It is not a worst-case adversarial probability or a promise that all attempted operations can execute. Normal accepted price growth also does not promise investor profit after fees or sequential exits.

## Open alternatives to dust reversion

These are review choices, not implemented or approved changes. No choice may silently destroy a holder's remaining positive ownership or treat a zero cash payout as a completed compensated sale.

1. **Exact-ratio growth with a more precise display.** Keep strict exact R/S growth, but stop requiring every accepted trade to advance the fixed 18-decimal displayed price by one atom. Use a higher-precision or explicitly rounded display. This can remove `price step too small` reverts when exact growth exists, without spending the protection fund. It does not solve a gross or net payout below one USD atom, and an unchanged rounded display would be possible.
2. **Optional aggregation before execution.** Let a holder combine amounts, or opt into a clearly specified batch, until the fee-net payout reaches a transferable USD atom. Preserve the holder's token balance/claim until execution, allow cancellation, and quote against execution-time R/S with min-out protection. Any custody, temporary reservation, batching-fee and allocation rules must be agreed first; no compulsory waiting lock is approved.
3. **Fractional-claim accounting.** Preserve sub-atom redemption entitlement in a higher-precision claim ledger and pay it when enough entitlement accumulates. The physical USD token still cannot transfer fractions of its smallest atom. Liability conservation, terminal treatment, who bears rounding and claim ownership need a separate audited design before any tokens could be burned for such a claim.

Automatically moving protected fund cash into live reserve merely to make each tiny displayed-price step positive is not part of these approved corrections. Such a fallback could be repeatedly triggered by dust-sized operations, transfers value to current holders, and remains unapproved. Restart, later support funding into a closed lifecycle, protected-fund eligibility and release authority also remain open.
