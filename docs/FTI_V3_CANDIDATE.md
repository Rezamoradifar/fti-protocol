# FTI V3 Owner Decisions Candidate — 2026-10-08

Release: FTI_V3_OWNER_DECISIONS_20261008. New immutable deployment required.

- Zero premint and zero initial reserve. Bootstrap issuance quote $0.10 in cycle 1,
  $0.20 in every subsequent normal cycle. Trading fees raise the actual R/S price.
- Ordinary 3% buy/sell fees stay in reserve; transfers burn 3%.
- Membership support stays separate until a price decline below the recorded ATH.
  Minimum available top-up targets one price base unit above ATH, without minting.
  Exhaustion never adds a sale veto or an unfunded price guarantee.
- Gross ordinary sales <= $500 bypass ordinary sale caps. Complete full-supply
  exit also bypasses caps, pays its fee and remaining support to the fixed
  binary development wallet, clears pricing/support reserve and resets the cycle.
- Above $500 ordinary sales retain previous 5% single-sale and 20% hourly caps,
  plus minOut/deadline. The owner explicitly confirmed these limits on October 8 at 20:14 Tehran;
  no additional punitive fee curve is introduced.
- Optional ranked auto-buy uses 5% of hourly point reward, not monthly Builder
  awards. Failed attempts preserve funds; the keeper retries. Ordinary membership,
  fee, price and cycle purchase allowance rules apply to auto-buy too.
- V3 point rewards use attributable funding without the old $20 maximum.
  $20 is the protection threshold, not an unfunded guaranteed minimum.
  Historical legacy deployments keep their existing cap semantics.
- 5-of-7 council, 72-hour ordinary governance and irreversible emergency unwind
  remain unchanged. Normal cycle restarts do not reverse emergency unwind.
- Direct Reward payouts are bounded to 100 ledger beneficiaries with no replay.

See [owner decisions and exact limits](FTI_OWNER_DECISIONS_20261008_FA.md).
Server/keeper verify release fingerprint, artifacts, economic constants and roles.
No public deployment or mainnet transaction was performed by this source change.
Independent audit and existing dependency-security findings remain open.
