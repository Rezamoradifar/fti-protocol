# Current restart and permanent-shutdown review

This document supersedes the earlier no-restart/token-only-retirement text, preserved at `immediate-auto-review/RETIREMENT.before-auto-restart.md` for provenance. It describes the combined local candidate, not a deployed change.

## Owner-confirmed support scope (2026-10-06)

The [owner decision](OWNER-SUPPORT-DECISION-2026-10-06.md) retains existing economics: buy fees stay in R; the full 5% Binary token allocation goes to R while S > 0 and protected H while S = 0. H is inactive and excluded from price and seller payouts; it provides no automatic insurance or loss repair. Its only disposition is the permanent governed retirement path below, after liability checks, to the fixed development recipient. The earlier automatic-support proposal is superseded for this version, not implemented.

## Ordinary terminal redemption and restart

Normal final redemption pays live reserve minus the current-trade fee, burns all remaining supply, sets live reserve to zero, and credits the fee to the fixed development recipient's separate claim. Emergency redemption retains its fee-free rule.

The token stores the last valid exact reserve/supply pair. An ordinary empty cycle (`lifecycleClosed`) may restart through manual or active automatic buy using that exact reference, even if the rounded display has fewer digits. The new buyer's gross payment alone forms new live backing and net-of-fee assets mint their shares. Prior protected support, development claims and unsolicited surplus stay segregated. Old manual-quota spending never resets. Quotes and UI must not treat an empty historical reference as current redeemable liquidity.

## Permanent buy shutdown, then cash conversion, then retirement

`closeBuysPermanently()` requires its own explicit Council authorization and the existing 72-hour timelock. Execution rechecks zero supply and live reserve plus a paused, quiescent bound Binary. Pending auto and development claims do not block this first step. The resulting `buysPermanentlyClosed` marker cannot reset. It blocks buys, automatic buys, injections and reopening.

This marker alone enables `BinaryPlan.releaseClosedTokenAutoToCash(start,limit)` while Binary is paused with phase zero. Any caller may process 1..100 stable member-list entries. Each beneficiary's auto earmark becomes that same beneficiary's cash claim; no USD moves, no destination can change, no debt is forgiven, and development gains nothing. Partial batches preserve unprocessed liabilities and duplicate batches cannot pay twice. A temporary pause or ordinary zero-supply interval cannot authorize conversion.

After conversion and actual payment of token-side development claims, retirement still uses a separate explicit Council approval and 72-hour timelock, and rechecks all existing zero-supply/backing/claim/auto/quiescence conditions. It sends protected support to the fixed development recipient. Raw donations require a separate delayed recovery action. Binary point pool, builder pool and cash claims remain in Binary and are not retirement proceeds; beneficiaries can still claim their cash.

Council authorizations must not silently apply to a later restarted cycle; refer to final token source/tests for cycle invalidation. Governance delays do not authorize sweeping active backing.

## Limits

Keeper availability and network execution are not guaranteed. Permanent retirement does not define a successor binary funding split; post-shutdown registrations/top-ups fail atomically because injection is blocked. Existing claims remain owed. True zero-net-output dust and the provisional 7% fee coefficient are separate unresolved boundaries. Test-only synthetic numeric fixtures are not evidence that every economic state is naturally reachable.
