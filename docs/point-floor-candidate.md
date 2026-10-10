# Funded minimum-point candidate — 9 October 2026

This is an isolated candidate, not an update to the deployed FundedBinaryPlan. Existing addresses, balances and test journals are untouched. The owner authorized the proposed funded-point settlement with unpaid matching volume retained.

## Changes

FundedBinaryPlanFloor requires the V3 target token. For each beneficiary, it computes the original capped, source-attributed matching budget, then reduces payable integer points to floor(budget / 20 USD). If no point is funded, no reward or credit is consumed. Otherwise the attributed budget is allocated, credit is debited proportionally between legs, and only paid matching units are subtracted. Remaining matching volume and unspent credits remain eligible in later epochs. Deferred volume is not a funded debt or a promise that later deposits will suffice. The $20 floor covers gross hourly reward, including the existing 5% auto-buy portion when enabled.

Protection increases when an account's payable point count is reduced for insufficient funding, including epochs with zero payable points. The existing hourly rank thresholds remain 100/200/500/1000 cumulative matched units; each unit costs $100. Existing splits remain 90% points / 5% token support / 4% builder / 1% development. The 1% development allocation remains in the same permissionless reward queue.

The keeper now prioritizes finalized cash payouts over new volume jobs while no hourly or monthly settlement is active. This prevents continuous incoming purchases from starving cash payouts. This is a code-level prevention, not proof that starvation caused any particular live wallet's missing payout.

## Validation

Compilation passed; floor contract runtime is 21,586 bytes (below EIP-170). Six keeper tests passed, including queue starvation and receipt waiting. A real local EVM integration test passed: depth-10 contributions fund $90 for four points instead of five; one matched unit on both legs remains, all per-wallet paid-point rewards are at least $20, cash/development transfers are exact, repeated payout does not duplicate transfers, zero-credit carry does not receive another reward, rank 1 starts at 100 matched units, and books balance across epochs with one-account processing batches.

## Deployment boundary

Do not copy the keeper into the existing verified release: its startup verifies a source fingerprint, and altering that release invalidates verification. Existing deployment scripts still target FundedBinaryPlan, deliberately; they do not deploy this candidate. A separate release/deployment integration and state migration plan are needed before activating FundedBinaryPlanFloor on testnet. No production or testnet contract replacement, live payout, or server installation was performed. Token pricing is unchanged because no replacement numeric growth law was specified; token support and sale rules remain the agreed V3 rules.
