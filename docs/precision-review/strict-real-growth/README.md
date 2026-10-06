# Approved exact-ratio strict-growth candidate

Isolated local candidate. No publication or deployment.

Two contract changes from the untouched canonical copy:
1. Active minting floors `netAssets * supply / reserve` once using full-precision `Math.mulDiv`; it no longer divides by an already-rounded price.
2. The active-trade guard requires `R_after*S_before > R_before*S_after` and collateral solvency, without requiring the 18-decimal display getter to advance. Each product is bounded by 1e66 from existing reserve/supply limits, below uint256 capacity.

Fees, backing/support routing, bootstrap reference pricing, zero-supply terminal exceptions, and all other lifecycle rules stay unchanged. Exact equality still fails the ordinary active-trade guard. No support money is used merely to force a visible tick.

## Verified focused results

Eight EVM tests passed, followed by one additional tiny-sell/transfer EVM test. Coverage includes tiny positive exact buy growth with an unchanged getter, $1 at a very large reserve, zero exact growth rejection with submitted-transaction rollback, normal 3% fees and size fees, manual/automatic quote and quota, split buys, backing, bootstrap, and final redemption. Tiny positive-payout sales and two-atom transfers also succeed while their getter stays unchanged; zero-output dust still fails.

Broader current-token regressions are being run separately. Final results and compile logs will be saved here when complete.

## Display contract

Read pre/post reserve and totalSupply as BigInt snapshots. For positive supplies, exact price-change numerator is `R_after*S_before - R_before*S_after`; denominator is `S_after*S_before`. Derive formatting from these values without JavaScript Number conversions. Extra decimal digits describe a calculated R/S ratio, not higher token/collateral granularity or additional precision in the legacy 18-decimal price getter. At zero supply, use historical/reference labeling.

## Limits

Token/USD quantities remain finite 18-decimal atom amounts. No infinite precision, all-trades-execute guarantee, external-market-price guarantee, anti-whale split resistance, support-release allocation, or audit certification is implied. Trades with zero valid output, invalid bounds, insufficient authorization, insolvency or other legitimate failures can still revert.
