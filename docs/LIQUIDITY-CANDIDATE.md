# Experimental liquidity safety candidate

This branch changes contract bytecode. It is NOT an upgrade to the already deployed FTI contracts and MUST NOT replace their source/artifacts for verification. Use a separate checkout. Existing user balances, addresses and live service remain on the old deployment. No mainnet release is approved by these tests.

## Changes

- Buyback and floor support each receive a global budget equal to 5% of that fund at the start of a support window. Windows last at least 24 hours and reopen on the next operation. New deposits, whale fees, extra wallets, small sales and transfers cannot refill an open budget. Unused budget is not carried forward. The first budget may be small because it opens on the first injection.
- These are discrete windows, NOT a strict rolling-24-hour cap: sales near a boundary may use the end of one budget and the start of the next. The 5% value is an experimental policy choice, not an optimized or validated production parameter. Funds can still decline over successive windows. Support still targets historical ATH/floor where possible, but no longer spends an entire fund in one window.
- Optional scheduled exits reserve unlocked tokens in the owner's wallet. Users specify total size, chunk size, minimum NET USD per FTI, interval (15 minutes to 7 days) and deadline (up to 30 days). Anyone may execute one ready chunk and pays gas; proceeds always go to the order owner. There is no automatic keeper or guaranteed execution. Missed intervals do not accumulate immediately executable chunks. Partial/final chunk amounts use the same current curve and normal fees.
- Owners can cancel unexecuted portions even during a trading pause or after expiry. Cancellation releases the token reservation and sends no money. Reservations block direct sales and transfers/transferFrom of reserved amounts. Minimum-price failures and failed USD transfers revert the complete chunk atomically.
- Direct sales remain available for unreserved unlocked holdings. Optional scheduling is NOT a global withdrawal cap and does NOT prevent users from splitting direct sales to reduce the existing whale fee. Enforced exit-rate limits or punitive new fees were not silently introduced.
- React includes create/check/execute/cancel controls on the isolated liquidity demo. No localStorage or server stores wallet private keys. The budget display is a page-load snapshot, not a continuously updated guarantee.
- Activity fetching disables RPC batching, paginates backwards in 100-block ranges, adaptively splits rejected ranges, and bounds request count. A shared 15-second cache/in-flight request prevents duplicate work. Persistent provider failure returns 503, not an invented empty history. This improves compatibility; it does not guarantee a public RPC's availability.
- Ethers upgraded to 6.17.0. Production dependency audit reports zero known advisories at this check. Development/compiler/chain tooling still reports advisories; this is not an audited production release.

## Mathematical argument and limits

Let X = real reserve + virtual reserve, and S = real + virtual token supply. Conservative integer buy costs round UP and mint only when net payment covers the cost. Therefore X'/S'^5 >= X/S^5. Integer gross redemption rounds DOWN; the reserve debit (net payout plus extra fee allocation) never exceeds gross redemption, so selling also cannot lower X/S^5. Transfer burns lower S without lowering X; support transfers increase X. Starting from X/S^5 >= V/S0^5 yields gross redemption of all real tokens <= real reserve. Queue execution calls the same sale path; reservation and cancellation move neither supply nor cash. BigInt model and EVM tests check the inequality without floating-point comparison.

This does not guarantee a seller's purchase price, a fixed USD price, sustained returns, a fair order in a mempool, stablecoin solvency, or freedom from bugs. The model does not reproduce all adversarial execution conditions. MockUSD is an intentionally unrestricted test collateral, including its block-recipient test method; it is unsuitable for real collateral. Front-running a chunk may move price within the user's permitted limit. Failed or expired orders are cancellable but need an owner transaction.

## Reproducible checks

- `npm ci && npm test`: baseline protocol, math, journal sale and new liquidity/event tests.
- `node scripts/liquidity-stress.mjs`: independent integer model, 100 holders, full exit, 1,000 split sales and reverse selling order, with no new inflows. All holdings are assumed unlocked and no time elapses during exit; sustained-sell surcharge is off in this model. See `liquidity-stress-results.json`. Price can still fall substantially (about 56% in these scenarios).
- `npm run build:web` and the existing `UI_QA=1` local browser harness: actual buy, create scheduled exit, execute one chunk and cancel remainder, plus mobile overflow and JavaScript error checks.
- `npm audit --omit=dev`: runtime dependency scan. `npm audit` includes remaining development tooling advisories.

## Isolated trial

Use a separate clone of `fix/liquidity-safety`, then `npm ci` and `npm run demo`. This creates a fresh local chain only. Its local time controls allow testing unlocks without changing the public testnet clock.

A new public testnet deployment requires explicit `LIQUIDITY_CANDIDATE=1` as well as the normal RPC, deployer and configuration inputs. Output goes to `deployments/liquidity-candidate.json` (exclusive create), never to `deployments/testnet.json`. Do not retry deployment blindly after an interrupted transaction: inspect receipts first. Save separate artifacts and deployment files. Set `DEPLOYMENT_FILE=deployments/liquidity-candidate.json` and a separate port when serving it. Do not run the existing service installer against a live installation for this candidate. Existing public-testnet journey scripts default to the old deployment file and are not automatically pointed at the candidate.

Before production: independently review source, select and validate policy parameters, address development supply-chain risks and deployment recovery, and test with the intended real collateral and an adversarial execution model. No assets are migrated by this branch.
