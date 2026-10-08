# FTI V3 No-Charity Contract Candidate

This candidate removes the charity allocation from FTIReserveTokenV3.
Buy and sell fees remain 3%, retained entirely in the pricing reserve.
No charity wallets, fee-token minting or CharityMinted event remain.
Normal purchases mint only the beneficiary tokens; normal sales only burn
sold tokens. Membership support stays separate and never mints FTI.

Unchanged: zero premint/initial price, no time or wallet-count locks,
zero-tax ERC20 transfers, minOut/deadline protection, 5% gross single-sale
limit, 20% hourly net-outflow limit, B1–B4 allowance multiplier (up to 16x),
5-of-7 council and irreversible pro-rata emergency redemption.
FundedBinaryPlan now records a unique queue of finalized cash beneficiaries.
payRewards(batch) pays up to 100 queued accounts directly, with amounts and
recipients fixed by pendingReward. It is permissionless, disallows partially
processed hourly/monthly settlement, and leaves remaining entries durable.
The keeper automatically drains the queue after settlement; claim() remains
a fallback and removes the beneficiary from the queue to prevent double pay.
Optional auto-buy funds remain reserved until execution or release to cash.

## Deployment compatibility

The constructor now accepts (stable, governance, council), without animal
wallet parameters. Bought/Sold event signatures remove charityTokens.
The deployment script creates only 30 Genesis helper wallets and emits
release FTI_V3_NO_CHARITY with explicit 300 bps reserve fee metadata.
Consumers must use freshly compiled V3 ABI/artifacts for this release.

This is source for a NEW testnet deployment. Existing immutable contracts,
recorded addresses and published services are not upgraded in place.
No public-chain transaction or mainnet deployment is authorized or performed
by this code change. Independent audit and production governance remain open.
