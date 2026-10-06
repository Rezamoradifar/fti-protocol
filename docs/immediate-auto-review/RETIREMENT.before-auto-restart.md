# Separate permanent-retirement review

Status: local implementation and test candidate only. The earlier 250-tested fee-floor/hourly-unit candidate is preserved as a separate review artifact and its original token contract remains available for comparison. This copy adds `FTIRetirementReviewToken`; it does not replace that contract or authorize deployment, signing, publication or moving real money. The retirement-specific demo and unsigned preparation entry point select this new variant; historical direct-deployment scripts must not be used for it.

## Settled direction

- Keep the approved ordinary $500/5%-of-live-reserve size-fee threshold and current-hour five-registration-unit binary gate
- A **normal final holder sells net of the fee**, rather than receiving the earlier fee-free full reserve
- The terminal fee belongs to the development fund, and may not remain ownerless redeemable backing
- Permanent retirement requires zero token supply and no token-related claims outstanding
- Retirement is governed by the existing five-of-seven council and a 72-hour delay
- The approved residual destination purpose is the development fund; the actual public recipient address is still a constructor review parameter, not an invented or recovered wallet
- After permanent retirement there is no reopen, new mint or support injection

The provisional 7% curve coefficient, exact fractional precision/dust handling, active price-protection releases, and broader post-token binary operation are not newly approved by this lifecycle direction.

## Explicit terminal-fee variant

For normal terminal `q=S`, gross is pretrade live `R`. Compute the same combined-once-ceiled current-trade fee as ordinary sales. Pay `R−F` to the seller, burn all `S`, set live reserve to zero, and credit `developmentFeeClaim += F`. This is a fixed-beneficiary reserved liability, outside live reserve and outside protected support.

The seller's redemption does not depend on an immediate development-fund transfer. A separate permissionless `claimDevelopmentFees()` sends the already-owed amount only to the immutable development recipient. It cannot substitute another recipient. A failed collateral transfer reverts the claim payment and restores the liability. It does not undo a previously completed seller redemption. Retirement is blocked until this claim is actually paid.

Examples under the provisional current-trade curve, before any atom rounding difference: terminal gross 100 USD pays 97 and reserves a 3 USD development claim; gross 500 pays 485 and reserves 15; gross 1,000 pays 952.50 and reserves 47.50; gross 10,000 pays 9,068.25 and reserves 931.75. At live reserve at least 10,000 USD, a normal full-supply sale has a nominal 9.3175% fee under this provisional curve. It is not silently assumed to have a universal 3% final fee.

This is a deliberately documented reserved-claim variant, not a hidden assumption that the council may sweep unpaid development claims. Publication/deployment review must include this timing distinction. Emergency redemptions retain their earlier fee-free exception, including a final emergency sale.

USD conservation at normal final sale:

- Before: actual USD = live R + protected support + prior development claim + unaccounted surplus
- Seller receives R−F
- After: live R=0, supply=0, development claim increases by F
- Actual USD continues to cover protected support + development claim; no fee is counted twice

There is no live post-sale R/S at zero supply; the retained reference quote is historical.

## Retirement authority and conditions

`approveRetirementAction(selector)` is callable only by the bound Council contract. Its normal execute path requires five current-owner approvals, retaining the owner-generation rotation fix. Approval names only `retirePermanently` or `recoverRetiredDonations`, not arbitrary calls or destinations.

Execution also requires the bound FTITimelock, its fixed 72-hour schedule, and at least 72 hours since the token's explicit council approval. Council approval and timelock scheduling may occur together, so this need not be a 144-hour process. The approval is consumed atomically. There is no automatic expiry; the Council can explicitly revoke it before execution with `revokeRetirementAction`. Cancelling a timelock operation alone does not erase the token authorization. It approves the selector's full eventual eligible balance, not an invented fixed amount. This additional explicit council approval prevents a later timelock proposer-role expansion from bypassing the requested council vote for these actions.

Execution rechecks:

1. Token totalSupply=0 and redeemable reserve=0
2. developmentFeeClaim=0
3. A bound BinaryPlan with matching token, USD, governance, guardian and development addresses
4. BinaryPlan.totalAuto=0
5. BinaryPlan is paused, with no unfinished hourly or builder-month settlement
6. Current-hour epochUnits=0 and all volume jobs processed
7. Actual collateral covers all token-accounted funds

No member scan is performed on-chain. `totalAuto` is the binary's existing aggregate of earmarked automatic-purchase claims. `unitsSinceSettlement` is not used, because old registration units do not govern the current-hour threshold.

Binary cash rewards, point-pool carry, and builder funds belong to the binary's separate accounting. They are not token reserve or retirement proceeds. They are not swept, forgiven or forced to zero; users retain their cash claims in that contract.

## Residual funds and unsolicited donations

`retirePermanently()` sends the tracked priceProtectionFund to the fixed development recipient and irreversibly sets the retired/closed state before transfer. It reports any unaccounted USD surplus separately rather than silently including it in the protected-support payment.

Unaccounted USD is recoverable only by a distinct `recoverRetiredDonations()` action after retirement, requiring a fresh explicit council approval plus the same delay. It uses the same fixed destination and rechecks zero supply/backing/claims. This separate action makes donation disposition visible. It also handles unsolicited USD sent to the token address after retirement; an ERC20 token cannot stop third parties from sending such donations.

No function accepts an arbitrary destination, uses active token backing, or touches funds held by the binary. Invalid development destinations such as zero, the token or the USD contract are rejected; binding also rejects the binary as destination and requires its configured development recipient to match. An EOA or contract parameter is allowed for review; code presence alone would not establish treasury ownership or safety. The actual public recipient must be verified before deployment.

## Integration blockers and open boundaries

- **Pending auto claims:** after terminal token closure, they cannot execute as buys. Existing BinaryPlan permits only the beneficiary to convert pendingAuto to their own cash claim. An inactive/lost beneficiary can therefore block retirement. A possible bounded, permissionless conversion inside BinaryPlan would preserve each beneficiary's cash entitlement; it is not implemented or approved by this token-only variant.
- **Membership after retirement:** rejecting token injections makes a subsequent BinaryPlan registration/top-up revert atomically, including the entire $100 unit. It does not silently redirect the $5 support share or strand a partially paid unit. Continuing the binary after token retirement requires an approved successor/migration or funding-allocation policy, because its token address is immutable. The $20 point-value target does not govern this issue.
- **Dust:** the new fee-net terminal path still requires positive transferable net USD. Extremely small backing may be consumed by atomic fee rounding and fail current dust checks. No token ownership is destroyed for zero payout. The user has requested alternatives to reverts; this is an unresolved boundary, not an accepted final dust policy.
- **No restart:** closure and retirement do not implement a new lifecycle, token replacement, active price-support trigger or protection-fund subsidy
- **Real deployment configuration:** chain confirmation, secure signer, development treasury, seven council owners and 31 genesis addresses remain separate verified inputs

## Validation

Focused tests and final source hashes are recorded in `retirement-review/VALIDATION.md`. The earlier 250-test result certifies the preserved fee/gate candidate only and must not be presented as validation of this new lifecycle contract.

## Pending-auto liveness proposal: not implemented

A possible BinaryPlan-owned operation is `releaseClosedTokenAutoToCash(start, limit)`, with a maximum batch of 100 member entries. It would require that the bound token is irreversibly lifecycle-closed, the binary is paused and no hourly allocation is in progress. For each beneficiary, move the entire pendingAuto amount to that same address's pendingReward, decrement totalAuto and increment totalPending by the same amount. It would transfer no USD, change no recipient, consume no manual token quota, and preserve total binary liabilities exactly. Existing beneficiary-controlled release remains available.

The operation could be permissionless because it only makes an unexecutable token-buy earmark withdrawable by its existing beneficiary. This is a proposed permission/behavior change, so it remains unimplemented pending the user's decision. It is not a council sweep, debt forgiveness, forced payment or global unbounded scan.

Required tests before accepting that proposal:

- Before lifecycle closure, reject with no accounting changes
- After closure, preserve each beneficiary's full cash entitlement and all USD balances
- Enforce 1..100 bounded processing and stop cleanly at memberCount
- Partial batches leave retirement blocked until totalAuto is truly zero
- Repeating a processed batch cannot create duplicate cash claims
- Keep point-pool carry, builder funds, rank/units and lifetime manual-buy spending unchanged
- Refuse unsafe concurrent hourly allocation and preserve backing checks
- Only the beneficiary can subsequently withdraw their cash; keeper/council cannot choose a different recipient

None of these proposed conversion tests constitute implemented or passed behavior in this review.
