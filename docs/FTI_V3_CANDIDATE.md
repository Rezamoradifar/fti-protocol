# FTI V3 No-Charity Contract Candidate

This candidate removes the charity allocation from FTIReserveTokenV3.
Buy and sell fees remain 3%, retained entirely in the pricing reserve.
No charity wallets, fee-token minting or CharityMinted event remain.
Normal purchases mint only the beneficiary tokens; normal sales only burn
sold tokens. Membership support stays separate and never mints FTI.

Owner-authorized update on 2026-10-08: ordinary transfers and transferFrom
burn 3% of the gross amount, rounding up to a token base unit. A 100 FTI
transfer debits 100, credits 97 and burns 3. Positive zero-net transfers are
rejected; zero transfers remain valid. Self-transfers also burn the fee.
Minting, sale burns and emergency redemption are not taxed a second time.
The frontend shows the on-chain net/burn quote before confirmation.

Unchanged: zero premint/initial price, no time or wallet-count locks,
minOut/deadline protection, 5% gross single-sale
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
release FTI_V3_INTEGRATED_20261008 with explicit 300 bps reserve and transfer-burn fee metadata.
Startup verification checks the on-chain transfer fee and deployment metadata.
Consumers must use freshly compiled V3 ABI/artifacts for this release.

This is source for a NEW testnet deployment. Existing immutable contracts,
recorded addresses and published services are not upgraded in place.
No public-chain transaction or mainnet deployment is authorized or performed
by this code change. Independent audit and production governance remain open.

## Integrated release

Deployment now assigns normal governance to FTITimelock (72 hours), with SevenGuardianCouncil as its only initial proposer (5 of 7 approvals). Emergency authority stays with the council. Server and keeper verify the shared source/artifact fingerprint, network, deployed code hashes and roles before starting. See [Persian integration specification](FTI_INTEGRATED_TESTNET_FA.md) for exact implemented economics, unresolved specification conflicts and reproducible owner-run instructions. The 3% transfer burn is explicitly authorized by the owner; sale limits are unchanged.
