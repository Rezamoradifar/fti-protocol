# Owner-approved migration requirement — 2026-10-09

The owner requires all existing users and important financial state to remain continuous across the next and later releases. This is an implementation requirement, not a statement that migration has occurred.

Required inventory: wallet identity; binary parent/left/right topology; activation serials, depth and units; ranks and rank timestamps; cumulative and carried leg volume; attributed point and builder credits; pending cash and auto-buy rewards and preferences; monthly eligibility/claims and settlement queues; token balances, allowances relevant to membership and cycle purchases; token supply, pricing reserve, support, ATH, cycle and price baseline; development allocations; governance roles; and accounting liabilities and available collateral.

Migration must prevent double claims and duplicate credit, preserve source-attributed accounting, reconcile funded liabilities against real balances, be resumable in bounded batches, and verify every imported user before switching the frontend. A consistent snapshot requires quiescent old contract state; pause alone is insufficient because settlement, payout and token-transfer paths may remain callable. No old user or unpaid balance may be silently dropped.

Current verified source limitations: old FundedBinaryPlan is not proxy-upgradeable; rescue explicitly excludes both USD and token. Token emergency unwind is permanent and owner-initiated redemption pays each holder, not a new contract. Do not activate emergency unwind as a migration shortcut. Do not promise that metadata export releases protected collateral, mint unfunded replacements, or drain user wallets. Existing contract balances cannot be moved without a permitted on-chain path and applicable governance/user actions.

Future architecture must be designed for continuity through governed upgrades or an explicit, funded migration protocol; no arbitrary owner drain or silent economic changes. Preserve the prior deployment until reconciliation and migration are verified. Existing live payouts, contract replacement, wallet signing, and emergency actions have not been executed.
