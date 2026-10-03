# FTI Token V2 — zero start, animal support and emergency redemption

**Branch:** `fix/zero-start-animal-protection`

This document is the working specification for the V2 candidate on this branch. It does **not** change or upgrade any already-deployed immutable contract. It is not a security audit, mainnet approval, profit promise or 100/100 certification.

## Requested changes implemented

### Zero start

* Deployment starts with `reserve = 0`, `totalSupply = 0`, `price() = 0`.
* There is no pre-minted anchor supply and no configured `P0`.
* Binary membership support may add real collateral through `inject()`, but **never mints FTI**, including the first funded registration.
* The first actual manual/automatic token purchase creates circulating FTI.

Membership support is still economically separate from a token trade: `inject()` has no 3% trading fee.

### No token vesting locks

V2 does not use the previous 5,000-wallet / 30-day short lock or the 20k/28k/36k/44k / 90-day vesting stages.

`locked(wallet) = 0` and `unlocked(wallet) = balanceOf(wallet)`.

Execution safety is instead provided by:

* user-specified `minTokens` / `minUSD`,
* transaction deadlines,
* a transparent sell-size impact,
* a normal-mode maximum single sale,
* a global hourly gross-redemption capacity.

These controls are not a guarantee of execution during congestion, collateral failure or emergency conditions.

## 3% buy/sell fee and animal-support allocation

Interpretation used in V2: **one percentage point of the 3% base fee**, not 1% of the fee amount.

For a gross value `A`:

* 97% is the user's buy-value / sell payout before any large-sale impact.
* 1% of gross value is represented by fully-backed FTI minted to two immutable animal-support wallets.
* The two wallets split that support token amount 50/50 (rounding dust goes to the second wallet).
* 2% of gross value remains reserve-accretive.

No unsupported/free-value animal token is minted. On an established reserve with price `P = R/S`, animal support shares are derived from the 1% collateral value at the pre-operation reserve/share ratio.

There is **no transfer tax** in V2. Wallet-to-wallet transfers use standard ERC20 balance movement.

## Buy formula

Let `R` be recorded reserve, `S` current FTI supply and `A` gross buy collateral.

For an established supply:

```
userAssets   = A - 3% fee
animalAssets = 1% of A
userMint     = floor(userAssets * S / R)
animalMint   = floor(animalAssets * S / R)
R'           = R + A
S'           = S + userMint + animalMint
```

Because only 98% of the gross buy value is represented by newly minted shares while 100% enters reserve, an admitted established-state buy is reserve/share accretive.

When `S == 0`, V2 uses one base share unit per collateral base unit for the first mint calculation: 97% user shares and 1% animal-support shares. Any previously injected membership support is real reserve and therefore affects the post-buy reserve/share value. This bootstrap behavior must be explicitly reviewed before public deployment.

## Sell formula and anti-whale protection

Base sell fee remains 3%. One percentage point is represented by animal-support FTI. In normal mode a size-based additional impact remains entirely in reserve.

Current candidate parameters:

* first 1% of current supply: 0 additional impact,
* 1% to 5% sale size: additional impact rises linearly from 0% to 3%,
* larger quotes can rise toward a maximum 7% extra impact,
* normal single transaction cap: 5% of current supply,
* normal hourly gross redemption capacity: 15% of the reserve snapshot at the start of that hour.

These numbers are **candidate risk parameters**, not final economic approval. They require adversarial simulation and public-testnet gas/operations testing.

Splitting a sale can reduce per-transaction size impact, therefore the global hourly capacity is an additional protection. Multiple-wallet/Sybil behavior is not solved by this mechanism.

## Builder buy-limit multiplier

The original per-unit manual limits remain:

| Rank | Base manual-buy allowance per membership unit |
| --- | ---: |
| B0 | 500 |
| B1 | 600 |
| B2 | 700 |
| B3 | 800 |
| B4 | 1,000 |

Only builder ranks (`rank > 0`) use the price multiplier.

After the first actual token purchase, `launchPrice` is recorded. Each time the internal reserve/share price reaches another 10x milestone, the builder multiplier doubles:

```
10x  -> 2x builder allowance
100x -> 4x
1000x -> 8x
...
```

The multiplier is capped at 1024. B0 does not receive the multiplier. Milestone synchronization is automatic on token buys, sells and binary reserve support, and can also be called permissionlessly.

Internal reserve/share growth is not a promise of market value or user profit.

## Seven-wallet emergency governance

The Council contains seven owner slots and requires five approvals. Owner-key rotation is possible only through a 5-of-7 proposal targeting the Council itself.

The healthier emergency design deliberately does **not** allow the council to transfer the reserve to an arbitrary administrator wallet.

After a 5-of-7 council proposal and execution, `activateEmergencyExit()` switches the token to **redemption-only** mode:

* new token buys stop,
* wallet-to-wallet transfers stop,
* normal whale/hourly redemption caps are bypassed,
* size-impact surcharge becomes zero,
* holder sells remain available as fee-free pro-rata emergency redemptions,
* no animal-support FTI is minted during emergency redemption, so all holders (including the support wallets) can drain modeled reserve and supply to zero;\n* collateral rescue remains prohibited.

This means liquidity is evacuated by token holders through on-chain redemption rather than swept by governance.

Emergency mode intentionally suspends normal trading fees and anti-whale throttles because the purpose is orderly pro-rata liquidation, not continued trading. Normal recovery/unpause requires the governance path. The standard governance delay is fixed at 72 hours in V2; `updateDelay` reverts, so the council cannot later reduce the timelock to zero.

## Important remaining review items

This change only addresses the requested token/governance items. It does not make the entire FTI project 100/100.

Before any public-value deployment, at minimum:

1. independently audit the V2 contracts;
2. fuzz/invariant-test animal mint accounting, first-buy bootstrap and full-exit orderings;
3. stress-test anti-whale/hourly-cap behavior and multi-wallet splitting;
4. verify the exact collateral asset on a realistic fork/public testnet;
5. review the binary compensation model and retained reserves separately;
6. measure ancestor/settlement gas and keeper capacity;
7. reconcile all website/PDF wording with this branch;
8. define migration policy because existing contracts are immutable;
9. review legal/regulatory treatment of membership-funded rewards and token reserve support.

