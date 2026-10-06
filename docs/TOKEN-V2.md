# Current FTI token and binary review

Local branch: `experiment/size-fees-review`, based on PR5 `8fa961c5feb679a0d35077ddf2f0ff4b1a360ffd`. Canonical combination: BinaryPlan + FTIReserveToken. This is draft, undeployed review source with outstanding policy decisions, not a production or investment guarantee.

## 1. Membership cash and placement

Each paid unit costs 100 USD: 90 goes to the global point pool, 5 to the token contract, 4 to monthly builder pools and 1 to development claims. Builder shares are 40/30/20/10. Registration occupies the chosen sponsor's left then right slot; top-ups increase the same position's cumulative units and propagate volume to its ancestors. Membership funding itself never mints FTI.

Membership funding requires an open binary epoch and a nonpaused plan; processing/settlement may be needed at the hour boundary. Removing token waiting locks does not remove the binary settlement lifecycle.

## 2. Paid-point ranks and hourly distribution

Normal caps for Member/B1/B2/B3/B4 are 5/10/15/20/25 paid points. Protection levels use the existing rows 5/10/12/16/20, 5/10/10/12/15, and 5/10/10/10/10. The applicable cap is frozen for the epoch. Every raw matched pair is consumed; capped excess is flushed, while unmatched stronger-side volume remains.

Rank thresholds are cumulative **capped, funded settlement points** 100/200/500/1,000. Raw descendant units and flushed points do not count. Rank is permanent. The current epoch uses the pre-promotion rank and auto-buy eligibility; promotion follows funded allocation.

The review interprets 'actually paid points' as points credited by a successful funded settlement, not the user's later pull-payment withdrawal. That interpretation remains explicit/provisional. A different claim-dependent rule would need separate accounting for mixed hourly/monthly/development liabilities; a cash claim cannot be reverse-mapped to points from USD alone.

Settlement requires at least five registration units purchased in the current hour, not five points or wallets and not units accumulated across hours. One $500 registration or top-up contributes five current-hour units. Under-five hours retain the entire point pool as cash carry. At five or more units, a positive eligible capped-point total is also required.

The available global pool is distributed proportionally to capped paid points. Values above 20 USD are permitted; values below 20 do not halt payout. The 20 USD value is only a target that moves existing protection levels for the next epoch. No permanent retained reward reserve or hard 20 USD ceiling is introduced.

Only the exact integer remainder after proportional allocations goes to development, leaving the distributed hourly pool at zero. If there are no eligible paid points, the whole pool remains protected carry for a later eligible epoch; it is not rounding and is not diverted to development. Ownership/concentration risk from this provisional carry policy remains open: later eligible participants can receive funding accumulated before they qualified.

Monthly builder payouts preserve the legacy equal-share rule capped at 20% of the available pool per wallet, once per wallet per pool, with reusable remaining carry. FundedBinaryPlan's different attributed-credit/hard-ceiling/permanent-retention model is historical and is not the canonical deployment target.

## 3. Token authorization and fixed milestone anchor

Total manual capacity = cumulative paid units × current rank base limit × applicable multiplier. Member/B1/B2/B3/B4 limits are 500/600/700/800/1,000 USD per unit. Members always use multiplier 1; builders use the global latched price multiplier. Remaining capacity is max(total − lifetime gross manual purchases, 0). Promotions/top-ups apply the current formula to all paid units and grant only additional capacity; spending is never reset by selling, transfers or token lifecycle transitions.

The binary consumes authorization atomically with the token buy. A failed token/collateral operation restores the ledger. Only the bound token can consume it. Automatic purchases use the beneficiary's separately allocated reward cash, are callable on the token only by the binary, and do not consume manual quota.

The milestone anchor is fixed at 0.10 USD. Reaching a live quote of 1 USD doubles builder capacity, 10 USD gives four times, and so on. The inherited multiplier is global, never decreases, and is capped at 1,024. It is not a personal counter from each builder's qualification date. Transfers that burn supply can raise the quote and trigger these milestones without adding cash; that does not demonstrate reserve income or profit.

## 4. Real reserve, protected zero-supply funding and token formulas

Initial owned supply is zero. At positive supply S, redeemable reserve R gives displayed internal quote floor(R × 10^18 / S). At zero supply, the quote is initial/historical reference only; there is no live R/S.

All binary injections while S=0 are recorded in `priceProtectionFund` (legacy getter `unallocatedReserve`). They mint no ownership, are not redeemable by the first minter and are not assigned to treasury/development/any wallet. The bucket has no silent allocation or withdrawal route. Its price-protection purpose does not approve a trigger, spending authority, release mechanism or beneficiary ownership; no such mechanism is implemented. Positive-supply injections add to redeemable R without minting.

Actual USD must cover R + unallocatedReserve. Direct unsolicited USD transfers remain unaccounted surplus; the review does not silently award them to a token holder. Thus final R=S=0 does not promise raw USD balance zero when protected or unsolicited funds exist.

Use W=10^18. Buy amount A uses the size-dependent fee F below; the whole A enters R and only floor((A−F)×W/pre-buy quote) is minted to the buyer. Retained fees are not credited a second time.

A positive transfer q burns ceil(3q/100), credits the remaining tokens to the actual recipient and moves no USD. Gross delegated allowance is consumed. Mint/burn calls are not taxed again. Charity is removed completely. Zero transfers remain no-op events.

## 5. Current-trade size fee and complete exit

The locally approved threshold correction is T=max(500 USD,5% of pretrade live reserve). Gross value V is A for a buy and floor(qR/S) for a partial sale. With B=max(V−T,0), F=ceil(0.03V+0.07B²/(B+T)). The 7% coefficient remains provisional. The implementation preserves exact fractional-atom thresholds and rounds the combined fee upward once; it does not reconstruct fees from rounded basis points. USD collateral must have 18 decimals.

At V<=500 USD, and also at V<=5% of live reserve, the surcharge is zero. Thus extra fees require both conditions. The existing R=0/S=0 bootstrap remains base-only, even above 500 USD, as a separately disclosed review exception. Protected-fund cash and unsolicited donations never change the threshold.

Normal partial payout=V−F. Burn all q and subtract only payout from R; retain the fee once. There is no pressure snapshot, decay timer, wallet identity/history charge, personal waiting lock or hard size/hour waiting cap. User minimum output and deadline remain enforced. All former pressure getters return zero.

Before atom rounding, the current-trade fee and its first derivative are continuous at T. Integer outputs are discrete; 3% describes the nominal rate, and tiny dust may revert. The design remains split-able: dividing an order into individually small trades can avoid the surcharge. No anti-bot, split-proof or guaranteed-profit claim is made. UI quotes use exact amount-based fee helpers rather than treating the legacy truncated bps display as exact.

A sale of all remaining owned supply pays all redeemable R with no final fee, burns all supply and leaves R=S=0. Protected unallocated cash and unrelated binary funds are excluded. At S=0 there is no live post-exit R/S price. The prior live quote is frozen only as a historical reference. Automatic restart remains review-gated; no new lifecycle ownership policy is silently enabled.

Normal positive buys, nonfinal sales and transfers must increase both exact R/S and the displayed quote, or revert atomically. Final redemption, fee-free emergency, zero transfers and precision boundaries are explicit exceptions. Two one-atom holders can face ordinary zero-net-output dust deadlock; no zero-payout destruction is silently implemented. Dust rejection is unresolved and the user has requested alternatives, not approved it as the final policy. Exact-ratio/display separation, optional aggregation and preserved fractional claims are outlined in SIZE-FEE-PROPOSAL.md without implementing any of them. The inherited emergency path can resolve that fixture but remains governance dependent.

## 6. Governance and deployment boundary

The owner-rotation stale-approval fix is included: only valid current-owner approvals count, and removed/re-added keys do not revive old consent. The council is 5-of-7 with a fixed 72-hour normal timelock. Emergency activation blocks buys/transfers and permits fee-free pro-rata redemption; it does not sweep backing to administrators. Independent security review is still needed.

Binary token addresses are immutable and token binding is one-time. This is not an in-place upgrade of existing deployments. The default demo/deployment scripts select the canonical corrected token and global-pool binary; FundedBinaryPlan and the old curve/browser launcher are historical alternatives, not release paths for this review. No deployment, transaction signing or merge is authorized by this review.

See CURRENT-REVIEW-VALIDATION.md for exact tested source/results; earlier candidate tests must not be presented as validating this revision.
