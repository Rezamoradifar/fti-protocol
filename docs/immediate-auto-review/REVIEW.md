# Immediate auto-buy review candidate

Local, isolated candidate. No deployment or publication approval is implied. Source work is not a completed validation result; see final logs/manifests before using.

## Approved behavior implemented

- Five percent remains fixed and default auto remains off. `setAutoBuy(bool)` has no user price input.
- Enable at 12:30 applies to the reward allocation closing at 13:00, using the price at actual transaction execution. A request exactly at 13:00 schedules 14:00. If settlement runs late it does not use a fictional historical quote. No reward means no purchase.
- Scheduling uses the next wall-clock boundary, not an overdue epoch's end. `autoEnabledFrom` prevents a later enable from applying to an older backlog even when the setting has matured. Enable can be accepted between settlement transactions; an old snapshot cannot acquire future eligibility. A redundant already-active enable does not postpone activation. Rank eligibility still uses the pre-allocation rank.
- Disable is accepted between transactions in any settlement phase and stops subsequent purchases/retries immediately. An already snapshotted five-percent earmark remains owned pending cash; no third party captures it. The beneficiary can release it to their cash claim.
- Immediately after each eligible allocation, attempt only the newly allocated five percent, not any older pending amount. The token's current exact quote becomes minimum output in the same transaction. The token mints directly to the beneficiary; manual quota is untouched.
- A self-only child call under the outer reentrancy guard isolates all quote, account debit, collateral transfer, token mint and post-transfer verification. Revert restores the child's changes while other allocations continue. Return/revert data are not copied unboundedly.
- Gas forwarding is capped at 600,000 and additionally preserves 300,000 gas after the allocation and queue writes for outer completion. Phase-two calls require an initial 900,000 gas and persist at least one member's progress before a low-gas batch break.
- Failed purchases remain in an indexed beneficiary-owned pending list. Keeper checks up to five pending accounts per step, preflights a bounded 900,000-gas call, then sends if currently executable. Prioritized hourly/monthly work and keeper/network availability mean this is best-effort earliest opportunity, not guaranteed wall-clock execution. A state change between preflight and transaction can still make a transaction fail.
- An already-authorized old snapshot remains an owned earmark through disable; re-enable can later execute it once active. The active-from guard prevents a later request from creating a previously false old snapshot. Disable never confiscates or forgives pending funds.
- The existing manual pending execution keeps owner-partial/third-party-full controls. No money already withdrawn to a wallet is automatically reclaimed or spent.

## Permanent shutdown conversion and ordinary restart

Ordinary zero-supply intervals are restartable under the separately reviewed token update. Therefore `lifecycleClosed` is NOT the cash-conversion gate. The converter requires the new irreversible `buysPermanentlyClosed()` marker, Binary paused, and no in-progress hourly allocation.

`releaseClosedTokenAutoToCash(start,limit)` is permissionless, uses stable member-list indexes, and accepts 1..100 entries. It moves each wallet's pending auto balance to that SAME wallet's pending cash claim. It transfers no USD, changes no recipient, consumes no manual quota, and preserves total liabilities. Repeated or overlapping batches do not duplicate cash. Unprocessed beneficiaries remain pending and prevent final retirement through its unchanged totalAuto check. Development/builder/point funds are not used.

The marker is distinct from later governance retirement and must be set by the token's Council/72-hour permanent-buy-shutdown flow. Temporary pause, emergency status, or an ordinary last sale are insufficient. This breaks the retirement/auto-claim circular dependency without enabling a governance sweep.

## Integration notes

- `Member.maxAutoPrice` is retained only for ABI layout compatibility and is zero/deprecated; it must not be displayed as a meaningful cap.
- New views: `effectiveAutoEnabled`, `nextAutoSetting`, `pendingAutoAccountCount`, `pendingAutoAccounts`.
- New events: `AutoSettingScheduled`, `ImmediateAutoDeferred`, `ClosedAutoReleased`; existing `AutoExecuted` reports successful immediate or retried purchases.
- The offline unsigned preparer has been refreshed to the final source/artifact pins and independently rebuilt; see the separate unsigned-preparation evidence. Ten test files have now completed reviewed policy-aware migration, and the full repository run passed 447/447. Earlier focused checkpoint logs remain separate and are not added to the full count.
- UI/API adaptation and new restart-token integration are separate coordinated changes. Do not mix source/artifact hashes from intermediate runs.
