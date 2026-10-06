# Owner support-scope decision — 2026-10-06

## Decision and authorization boundary

After the choice was explained as retaining the existing model versus moving buy fees into a separate fund, the owner answered: «همین مدل رو نهایی کن» (“Finalize this same model”). The selected scope is the current `FTIRetirementReviewToken` + `BinaryPlan` candidate. A separate explicit confirmation selected BNB Smart Chain Testnet, chain 97. This decision finalizes the economic scope; it is not approval to sign or broadcast transactions, publish code, or use real collateral.

## Retained rules

- R is live redeemable backing; S is circulating token supply; H is the separately tracked protected fund (`priceProtectionFund` / `unallocatedReserve`)
- A buy puts its full gross payment, including the fee, into R. Net-of-fee assets determine the exact-ratio token mint. Buy fees are not diverted to H
- Each 100 USD membership-unit payment allocates 90 to the point pool, 5 to token funding, 4 to builder pools and 1 to development. The full token-funding 5% enters R when S > 0 and H when S = 0, without minting FTI; there is no 4/1 token-funding split
- H remains protected and inactive. It is excluded from pricing, fee thresholds, seller payouts and the new buyer’s backing on restart. It does not automatically insure losses, repair collateral deficits or subsidize trades
- Ordinary zero supply is restartable at the retained exact reference ratio. It does not release H, old development claims or unsolicited donations
- H can be disposed of only through permanent governed retirement: separate five-of-seven Council authorization, the existing 72-hour delay, permanent buy closure, and all on-chain readiness/liability checks. The recipient is the fixed development address; no replacement address is selected here
- Final retirement requires zero token supply and R, cleared token development claims and pending auto claims, and paused/quiescent Binary settlement. Binary reward cash, point and builder pools remain in Binary for their existing beneficiaries. Thus “liability checks” does not mean sweeping or forgiving remaining Binary cash claims
- Untracked donations are separate from H and require the separate delayed post-retirement recovery action

## H01 resolution

H01 is **resolved by an explicit owner scope decision**, not by implementing the former automatic-support policy. The earlier buy-fee-funded / Binary 4/1 active-support proposal is superseded for this version. No contract, artifact, test, economic formula, permission or executable deployment path changes in this update.

Exact-ratio minting with buy fees retained in R does not require H transfers for strict growth on accepted ordinary positive-supply transactions. This is an accounting statement, not a profit, insurance, liquidity, solvency or execution guarantee. Underbacking still causes the existing checks to reject a transaction.

## Evidence and remaining boundaries

The full 447/447 run (49 files, 18 suites) occurred on 2026-10-06 from 00:46:08 to 01:57:45 UTC, before this documentation/UI-copy update. The 173-case checkpoint overlaps it and is not added. Original logs, checkpoint files, frozen manifests and `docs/full-suite-review/` reports remain execution-time history, including H-policy statements that were then open. They are not rewritten as newly completed evidence. Current scope is this decision and the updated requirements matrix; focused copy/build checks are recorded separately in [validation](owner-support-decision/VALIDATION.md).

The 7% large-trade coefficient remains provisional; true zero-output/dust handling and post-permanent-closure membership continuation remain boundaries. No fresh full-suite rerun, browser/live-wallet validation, production-capacity proof or independent external security certification is claimed by this update.

The only selected future target is chain 97 with TEST ONLY MockUSD. Public addresses and nonce are blank. Network/runtime verification, deployment readiness and approval, signing, broadcasting and deployment remain false. See [the unsigned checklist](owner-support-decision/CHAIN97-UNSIGNED-CHECKLIST.md). No network, SSH, GitHub or real-fund action is part of this update.
