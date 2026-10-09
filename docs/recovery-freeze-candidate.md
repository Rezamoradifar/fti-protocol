# Recovery freeze candidate — 9 October 2026

## Implemented (isolated, not deployed)

FundedBinaryPlanFloor now has a separate recovery freeze. Unlike ordinary pause, it blocks registration/funding, volume processing, hourly/monthly settlement, claims/batch payments, auto-buy execution/preferences and cash release. SevenGuardianCouncil or governance may freeze; only governance (the configured 72-hour timelock in tests) may reopen. Reopening checks backing.

FTIReserveTokenRecovery is a separate V3-derived candidate. Recovery freeze blocks token purchases/sales/injection/emergency redemption, ERC20 transfers including transferFrom, and approval changes. It does not sweep assets. Original pricing/support/fees are retained. The old FTIReserveTokenV3 source remains unchanged.

A governance-only checkpoint records a nonzero snapshot root, recent prior block hash and serial while BOTH components are frozen. This is an attestation, not a verified complete state import, entitlement proof or permission to withdraw collateral. Reopen both components via a timelock batch. The keeper idles when the binary recovery freeze is active.

## Scope limits

These contracts remain constructor-based, non-upgradeable candidates. UUPS proxy integration, complete migration exports/imports, funded collateral transfer and live rollout are NOT implemented. Existing contracts and balances were not changed. The existing deploy script does not deploy these candidates. Freeze requires an authorized on-chain transaction and cannot undo already stolen assets. Another token's direct transfers/donations are outside this freeze and must be reconciled in migration books. Do not deploy to mainnet or label recovery complete.

## Validation

Solidity compilation: binary 22,948 bytes; token 15,150 bytes (both below EIP-170). Seven keeper tests cover payouts, receipt waits, starvation prevention and no recovery writes. Local actual-contract governance test exercises rejection at four council approvals, freeze at five, blocked financial/token operations, unchanged balances, checkpoint and atomic reopening after the 72-hour timelock, resumed transfers/payouts and replay rejection. The funded floor and fixed-block inventory integration test is rerun against the updated binary.
