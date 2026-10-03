> **Superseded on the V2 branch:** this file is the historical PR3 reserve-token report. For `fix/zero-start-animal-protection`, use `docs/TOKEN-V2.md` for the current zero-start/no-lock/animal-support/emergency design.\n\n# Real-reserve FTI candidate

**Version note:** this report records PR #3 / `feat/reserve-token`. In the later `fix/funded-binary` candidate, the token uses paginated cumulative lock queues (no 64-live-lock ceiling), and an optional new `FundedBinaryPlan` changes the reward policy. See [FUNDED-PLAN](FUNDED-PLAN.md) for that implementation and its separate validation. The historical statements and results below describe the earlier candidate.

This branch implements the owner's requested **3% buy fee, 3% sell fee and 3% transfer burn**, with an exact reserve/share value that increases after each successful positive trade or transfer. It is a new token model and a separate deployment, not an upgrade to the already deployed CRR token. It includes the auto-buy fixes from pull request #2.

The implementation is in `contracts/FTIReserveToken.sol`. The existing `FTIToken.sol`, public contract addresses and live website deployment have not been replaced. The existing binary reward economics have not been redesigned.

## What the price means

Let `R` be recorded, actually funded collateral and `S` be all outstanding FTI shares, including the permanently locked anchor. The exact internal price is `R / S`; `price()` reports its floor at 18 decimals. Net sale proceeds are lower because of the sell fee. This is not an external exchange price or a guarantee of dollar value, principal or profit. No transactions means no automatic price growth.

The invariant covers successful positive operations admitted by the contract. Rounded displayed prices can remain equal for very small operations. Zero transfers are no-ops. Trades below the minimum mint or positive-payout threshold revert; a residual balance worth less than one payable collateral base unit is not a promise of a fractional-wei payment.

## Real backing at startup and after the last user exits

The first paid membership allocation initializes the reserve. For a first purchase of one membership unit, the binary plan sends **5 test USD**, and the token issues **50 FTI to itself**, at an initial price of 0.10. Those 50 shares are permanently locked. No administrator can transfer, redeem or rescue them. They are displayed separately from user circulation.

If the first allocation is larger, the funded anchor is proportionally larger. Every later membership allocation increases the reserve without creating shares. Bootstrap allocation size is therefore an economic parameter; first-member ordering matters. For example, adding membership allocations before anyone buys FTI increases its starting trading price. It does not give someone a right to buy later at 0.10.

All **circulating user tokens** can be covered by the reserve, subject to maturity and the stated asset/rounding assumptions. The nonredeemable anchor remains after the users exit. The remaining reserve backs it, preserving the last internal price for the next buyer without a reset. The phrase “last token” must not be used to conceal this permanent anchor.

Direct collateral transfers to the token address are protected surplus: they do not change recorded `R`, quotes, or minting. Use the binary plan's funded allocation path for reserve support. Collateral cannot be withdrawn by administrative rescue.

## Formulas and proof

All calculations use integer base units. `fee(x) = ceil(3*x/100)`. Rounding a fee upward changes it by less than one collateral/token base unit compared with exact 3%.

| Operation | State transition |
| --- | --- |
| Buy gross amount `A` | `m = floor((A - fee(A))*S/R)`; `R' = R+A`; `S' = S+m` |
| Sell `T` FTI | `g = floor(T*R/S)`; `out = g-fee(g)`; `R' = R-out`; `S' = S-T` |
| Transfer `T` FTI | Burn `b = fee(T)`; receiver obtains `T-b`; `R'=R`; `S'=S-b` |
| Later membership allocation `D` | `R'=R+D`; `S'=S` |

Buy: `(R+A)*S - R*(S+m) >= fee(A)*S > 0` for an accepted purchase.

Sell: `(R-out)*S - R*(S-T) = R*T-out*S >= fee(g)*S > 0` for an accepted positive payout.

Transfer: positive burn reduces the denominator with unchanged positive backing.

With anchor `a>0`, total user circulation is `C=S-a`. Its gross redemption is `floor(R*C/S) <= R`; the net payout is smaller. The inequality remains true after each valid operation, so exit order and splitting cannot overdraw the recorded reserve. They can change who receives retained fees; split sales are not claimed to have identical proceeds to a single sale.

The contract checks the stronger exact inequality `newR*oldS > oldR*newS` during each positive operation. Numeric bounds keep each product at or below `1e66`, below the uint256 maximum. It also checks physical collateral backing. The displayed ATH is updated to the nondecreasing rounded price.

## Changes from the old curve

| Topic | New real-reserve token |
| --- | --- |
| Price | Real recorded collateral divided by real outstanding shares |
| Virtual reserve / CRR | Removed from price and solvency calculations |
| Buy and sell fees | Fixed 3%, retained in the reserve |
| Transfer fee | 3% of the transferred amount burned |
| Whale and sustained-sell tiers | Removed; a large admitted sale pays the same nominal 3% |
| Dip discount | Removed |
| Separate buyback/floor funds | Removed; compatibility getters return zero |
| Paid token membership allocation | All 5 USD per unit enters the reserve; not the old 80/20 split |
| Manual buy allowance | Existing units/rank/milestone allowance retained |
| Acquisition cap | Existing 1,000,000-FTI allowance reference retained **only for the cap**, not as supply or backing |
| Locking | Existing wallet-clock OR time deadlines retained |

The acquisition rule is `balanceAfter*100 <= 1,000,000 FTI + circulationAfter`. It is not a guarantee that one person owns at most 1% of actual circulating supply. Multiple wallets are not independent people. Large purchases exceeding an allowance or cap revert rather than silently bypassing it.

Small/manual and auto-buy tranches unlock after 5,000 new registrations **or** 30 days. Manual lifetime purchases reaching 500 USD create four stages at 20,000/28,000/36,000/44,000 further registrations **or** 90 days. At most 64 live tranches are retained per wallet. This limit can block additional frequent buys until locks mature; permissionless auto-buy does not bypass it. Available pending auto-buy income can still be released through the binary plan.

## Validation and limits

Results and exact outputs are in `reserve-validation.json`, `reserve-validation-output.txt` and `reserve-simulation-300000.json`.

* Actual local EVM: 100 new users registered, bought, transferred and sold all their FTI. 100 buys, 20 transfers, 100 sales and 321 accounting/price checks passed. No circulating FTI remained. Local-only time advancement matured locks; public testnet deadlines were not bypassed.
* Actual local EVM: a 50,000 test USD purchase and complete sale returned 48,485.006121824303642484 test USD with the same 300-basis-point sell fee and an increased internal price.
* Independent BigInt model: 300,000 wallets, 300,000 buys, 399,999 sales, 59,999 transfers and 1,059,998 invariant checks. Largest admitted purchase: 500,000 simulated USD. No new funds were introduced during the final complete exit. All user balances ended at zero. The model assumes mature locks and does not execute binary rewards or EVM transactions.
* EVM adversarial checks cover collateral taxes on either party, collateral callback reentrancy, a deliberate backing deficit, blocked payouts, rescue restrictions, zero/dust operations, expired/min-output quotes, full exits, repeated exits, allowance/maturity checks and the real binary auto-buy flow.
* A closed own-funded example paid 100 test USD, then received 96.857352941176470587 on a full sale, despite the internal price rising on both operations. Internal price growth is **not** buyer profit.
* The React build and HTTP/API smoke passed against a fresh reserve-token deployment, including model selection, ABI, account balances and supply/anchor separation. Browser rendering and click-through were not rerun: the available environment could not download its Chromium bundle. Existing historical UI reports are not evidence for this new model. Run `UI_QA=1 UI_BASE_URL=http://127.0.0.1:3082 node scripts/local.mjs --reserve-token` in an environment with Playwright/Chromium to repeat the updated browser journey.

The 300,000-wallet result proves neither RPC throughput nor full-project capacity. Token trades do not iterate over all holders, but the binary plan has separate global settlement work and ancestor-processing costs. Its carried-pool capture, Sybil incentives and large-member settlement limitations remain documented in `ECONOMIC-REVIEW.md` and `CORE-REVIEW.md`. Passing diagnostics for those weaknesses is not a fix.

The asset must be an exact-transfer, non-rebasing 18-decimal ERC20 with reliable balances. The test deployment uses MockUSD, which has no monetary value. A frozen, seized, depegged or malicious real asset, paused contract, network outage or insufficient gas can prevent an exit or change real-world value. A backing deficit causes operations to revert; it is not repaired by accounting assertions. Source tests are not independent security review or mainnet approval.

## Reproduce without touching the active server

Use a separate checkout of branch `feat/reserve-token`. Do not switch the directory used by the running production service.

```bash
git clone --branch feat/reserve-token https://github.com/Rezamoradifar/fti-protocol.git fti-reserve
cd fti-reserve
npm ci
npm run test:reserve
npm run simulate:reserve
npm run demo:reserve
```

After `npm run build:web` and `npm run compile`, `node scripts/reserve-http-smoke.mjs` reproduces the HTTP checks on its own temporary chain and exits automatically.

The private local demo listens on **127.0.0.1:3082** and uses a fresh local chain on **127.0.0.1:8546**. Each restart resets it. From your computer, use `ssh -L 3082:127.0.0.1:3082 root@185.114.206.44` and visit `http://localhost:3082/token/`. Keep the unlocked-account demo off the public Internet.

The React workspace selects the new ABI and explains reserve pricing, fees and the anchor when `tokenContract` is `FTIReserveToken`. The existing marketing landing page and browser deployment launcher describe the legacy deployed model; they have not been repointed to this candidate.

## Separate BNB testnet deployment

This candidate has **not** been deployed to the public testnet by this change. A new token and binary plan are necessary because existing binding is one-time. Existing positions are not automatically migrated.

Prepare `deployments/testnet-input.json` using the example's 31 Genesis, five council and development addresses. Keep existing helper-account backups private. Run the following in the separate checkout. The private key is entered only in your local terminal and is never needed in chat:

```bash
(
set -e
npm run build:web
npm run compile
export RPC_URL='https://bsc-testnet.bnbchain.org'
export CONFIG_FILE='deployments/testnet-input.json'
export RESERVE_DEPLOYMENT_FILE='deployments/reserve-testnet.json'
read -rsp 'Testnet deployer private key: ' DEPLOYER_PRIVATE_KEY
echo
export DEPLOYER_PRIVATE_KEY
node scripts/deploy-reserve.mjs
)
```

The script accepts only chain 97, validates addresses and creates a progress journal before broadcasting. Each deployment records its nonce, expected address, hash and receipt. It refuses to overwrite the old deployment or an existing progress journal. It does not automatically resume a failed deployment: inspect recorded receipts and pending nonces first; never delete the journal to force another run.

After a successful deployment, run the panel with:

```bash
RPC_URL='https://bsc-testnet.bnbchain.org' \
DEPLOYMENT_FILE='deployments/reserve-testnet.json' \
HOST=127.0.0.1 PORT=3082 npm start
```

Use the new config for a separate keeper as described in `OPERATIONS.md`. Explorer verification uses `DEPLOYMENT_FILE=deployments/reserve-testnet.json node scripts/verify.mjs` with a locally configured Etherscan API key. `node scripts/verify.mjs --prepare --reserve-token` only checks compiler-input reproducibility; it is not public explorer verification. No private wallet key is required for source verification.
