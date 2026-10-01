# Experimental economic decisions

The uploaded specification and simulator did not define one unambiguous implementation. These are explicit **test-release choices**, not a claim of final owner approval for production economics. Original detailed Persian notes remain in DECISIONS.fa.md.

| Topic | Implemented behavior |
| --- | --- |
| Rank | Minimum cumulative lifetime units across both legs. B1/B2/B3/B4 at 100/200/500/1,000. Matching does not erase rank history. |
| Minimum settlement | Five units accumulated since the last successful settlement. |
| Skipped hours | Money and volume carry. Missed hourly caps do not accumulate; one cap applies when settlement resumes. |
| Rank snapshot | Current processing uses the previous rank cap; earned upgrades apply to the next epoch cap. Auto-buy settings freeze during processing. |
| Protection | Exact pool/point ratio compared with 20. Equal values and skipped settlement preserve the level. No price or income floor is guaranteed. |
| Dust | Retained in the point pool. |
| Settlement delay | Registration/top-ups pause after the epoch boundary until processing finishes. Empty missed hours collapse on resume. |
| Scale | At most 100 ancestor propagation steps or 100 members per transaction. Total cost still grows with network depth and member count. |
| Genesis | 31 distinct positions in a complete tree; no initial units or synthetic funds. Positions become reward-eligible only after paying for units. |
| Rewards | Pull claims. A failed transfer preserves the claim and cannot stop another wallet from claiming. |
| Auto-buy | 5% of eligible Builder hourly rewards becomes a pending purchase. In the contract-core candidate, the maximum is gross USD paid per FTI received, including fees and curve impact. A third-party executor must use the entire pending amount; only the beneficiary may execute part. Disabling auto-buy also blocks execution of pending purchases. These protections require a new deployment; the existing testnet contract is unchanged. |
| Failed auto-buy | Funds remain owed; the beneficiary can release them to a cash claim. |
| Purchase allowance | Lifetime gross manual buys consume allowance. Auto-buys and transfers are exempt. Selling does not restore it. |
| Price multiplier | Governance with timelock can double the multiplier after another 10x price milestone. Maximum multiplier 1,024. No TWAP oracle is implemented. |
| Registration token share | Five USD per unit: 80% reserve-support fund and 20% floor-support fund. No mint. |
| Support | Internal reserve top-up, not a market token buyback. Support ends when its fund is exhausted. |
| Small/automatic purchase lock | 5,000 new registered wallets or 30 days, whichever comes first. The time backstop is a proposed addition. |
| Vesting | The purchase reaching cumulative manual spending of 500 USD, and later purchases, has four tranches at +20,000/+28,000/+36,000/+44,000 wallets; each has a 90-day backstop. Earlier purchases are not relocked. |
| End of phase | Random and retroactive unlock times are removed. The wallet counter can continue past 200,000. |
| Lock bound | At most 64 live tranches per wallet; expired tranches are pruned before purchases. |
| Holding cap | 1% of virtual plus real supply, checked at acquisition only. This does not prevent multiple wallets or cap ownership of real circulating supply. |
| Partial orders | Invalid orders revert rather than partially filling. |
| Transfers | Unlocked tokens only, registered/funded recipient, 3% burn, no new recipient lock, no self-transfer. |
| Sustained selling | Exact 5,000-new-wallet prefix-sum window; minimum 1,000 USD gross sales and sales/buys >=1.3. |
| Builder month | Gregorian UTC, sequential processing after needed hourly closures. Eligibility uses rank acquisition by the month boundary. |
| Builder payouts | Snapshot pool, equal shares capped at 20% per wallet, one positive award per pool per lifetime; zero awards do not consume eligibility. |
| Governance | Fixed five owners, three votes. Emergency pause through council; unpause and sensitive actions through 72-hour timelock. No council rotation is implemented. |
| Pause | New business operations pause; previously earned claims and permissionless settlement remain available. |
| Upgrade | Non-proxy contracts. Economic changes require a new deployment and migration. |
| Collateral | 18 decimals and exact transfers. Supplied deployment uses test-only MockUSD. |

The curve reserve argument guarantees neither principal recovery nor sale at the displayed marginal price. Virtual reserve is not spendable collateral. Mainnet readiness, external review and load capacity are not established by the reference simulation.
