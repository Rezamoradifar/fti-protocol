# FTI protocol: local paid-points/global-pool review

This draft review combines **BinaryPlan** with **FTIReserveToken**. It is a local engineering candidate, not an independently audited, deployed or finally approved financial product. Draft publication is authorized; merge and deployment remain on hold.

Read [the current rules and unresolved decisions](docs/TOKEN-V2.md) and [the current validation record](docs/CURRENT-REVIEW-VALIDATION.md). Earlier 119-test and integrated-pressure results cover different source states and do not certify this revision.

## Canonical flow

- Each $100 paid membership unit splits $90 into the global point pool, $5 into the token contract, $4 into builder pools (40/30/20/10), and $1 into development claims. Top-ups keep the same wallet position.
- Hourly matched points are capped by rank and the existing protection level; matched excess is flushed. Funded capped points allocated in settlement, rather than raw branch units, accumulate toward rank thresholds 100/200/500/1,000. Counting allocation rather than later cash withdrawal is an explicit provisional interpretation.
- The global hourly pool is distributed proportionally across capped paid points. $20 is a protection target, not a hard ceiling or a reason to stop payouts. Only the exact rounding residual goes to development. No-eligible-hour carry is provisional and retains ownership/concentration risk.
- Manual token capacity is all paid units × current rank limit ($500/$600/$700/$800/$1,000) × the builder-only price multiplier, minus lifetime gross manual purchases. Auto-buy uses allocated rewards outside that quota.
- Token supply starts at zero; the initial quote and fixed milestone anchor are $0.10. Buys retain all cash and mint using the 97% net value. Transfers burn 3% and credit 97% to the recipient. Charity is removed.
- Positive-supply reserve injections add redeemable backing without minting. Zero-supply injections go into a separately tracked, protected, unallocated bucket pending ownership approval; the first minter cannot capture them.
- Partial sales use an **experimental, not finally approved** 3% base plus up to 7% global-pressure surcharge. There are no age, newcomer-count or hard transaction/hourly waiting caps. A full-supply sale pays all redeemable backing and reaches R=S=0; protected unallocated cash remains separate. Restart is review-gated.
- The council owner-rotation stale-approval fix is included, with a nominal 5-of-7 emergency council and fixed 72-hour normal timelock. Independent security review is still required.

## Run locally

Use the pinned dependencies and a supported Node environment. The validation environment currently uses Node 24 with Ganache's JavaScript fallback; project CI previously specified Node 22.

```sh
npm ci
npm test
npm run demo
```

The canonical in-memory demo explicitly selects FTIReserveToken + BinaryPlan and serves at http://127.0.0.1:3082 by default. It uses mock USD and fresh ephemeral accounts. Keep it private. No real funds or existing chain state are used.

```sh
npm run build:web
npm run build --prefix landing
node scripts/verify.mjs --prepare --reserve-token
```

Verification preparation recompiles standard input and checks bytecode locally; it does not deploy or sign transactions. `npm run deploy` now selects the canonical reserve-token/BinaryPlan script, but execution remains a separate user-authorized step with final parameters and real wallet addresses. Never send private keys in chat.

## Historical alternatives

FundedBinaryPlan is retained for comparison/regression only. Its branch-attributed credits, hard $20 ceiling, raw-unit ranks and nonclaimable retained reserves are **not** the current canonical economic direction. Explicit local historical demo: `npm run demo:historical-funded`. Existing source/tests document those differences rather than endorsing them.

The old FTIToken curve and browser deployment launcher are historical. The launcher still contains incompatible curve/governance artifacts and its default launch command is blocked. Do not treat it as a release path for this candidate. Existing deployment files are historical records and were not overwritten.

## Remaining decisions and limits

Before any release: resolve protected zero-supply fund ownership, restart lifecycle, zero-eligible-hour carry ownership, exact paid-point semantics, pressure-fee parameters/split behavior, ordinary precision-dust exits and emergency exceptions. The existing 1,024× milestone multiplier cap and self-transfer-induced quote growth are also disclosed. Rank and monthly pool accounting need independent economic review; no returns, floor price or universal profitable exit is guaranteed.

No GitHub push, merge, mainnet transaction or deployment is authorized by this README or its test results.
