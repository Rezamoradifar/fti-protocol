> Historical baseline only. The fixed-fee no-charity candidate completed its full serial suite with 119/119 tests passing before this integrated experiment was created. Its frozen patch SHA-256 is 82a1e448480cfa890bb85a015a92250acc4f7c48e7a01428e52311efadaff9ca. The record below preserves the earlier checkpoint and its then-current policies; it does not validate the subsequent full-refund/pressure-fee changes. Current rules are in TOKEN-V2.md and new results belong in INTEGRATED-EXPERIMENT-VALIDATION.md.

# Token revision validation checkpoint — 2026-10-04

Base: PR #5, commit `8fa961c5feb679a0d35077ddf2f0ff4b1a360ffd`.
This is a draft review checkpoint, not deployment approval or a security certification.

## Verified against the revised no-charity source

- Solidity compilation passed with solc 0.8.30, optimizer 200, viaIR, Shanghai. FTIReserveToken runtime: 13,204 bytes, below EIP-170.
- `node --test test/revised-economics.test.mjs`: 12/12 passed. Covers initial 0.10 reference, zero supply, removed charity ABI, 3% buy/sell fees, transfer and transferFrom burns, gross allowance, exact backing, quota, dust rollback, final redemption/reference and restart guard.
- `node --test test/reserve-model.test.mjs`: 5/5 passed. Includes 300,000 wallets, 300,000 buys, 399,966 sells, 59,999 transfers and 1,059,965 checks. This is a BigInt accounting simulation, not a 300,000-wallet EVM/RPC or throughput test.
- `npm run build:web` and `cd landing && npm run build`: passed. Browser wallet click-through was not rerun.
- JavaScript syntax checks and `git diff --check`: passed.
- Dependencies unchanged. Audit snapshot: production zero reported advisories; development/toolchain nine findings, including one critical. No forced Ganache downgrade/compiler migration applied.

Local runtime: Node 24.19.0. Ganache uses its JavaScript fallback because its native uWS binary does not match that Node build. GitHub CI uses Node 22.

- `node --test --test-concurrency=1 test/binary-buy-allowance.test.mjs test/reserve-collateral.test.mjs test/reserve-token.test.mjs test/funded-collateral.test.mjs test/funded-locks.test.mjs`: 37/37 passed, zero failures (200.2 seconds). These are migrated EVM regressions against the revised source.

## Pending broader validation

Full serial `npm test` is running separately. GitHub publication/CI is held pending the user's final decision; no branch or PR has been created. Earlier tests of the charity-based candidate are **not** evidence that this revised economics passes the entire suite. Some legacy tests deliberately confirm inherited economic weaknesses rather than proving them fixed.

## Release-blocking decisions and integration issues

1. Automatic restart is blocked by a temporary review guard. This is not presented as a finalized permanent-closure decision. Residual 3% fees otherwise accrue to the first restart buyer; the arithmetic regression demonstrates fee recapture.
2. At zero supply the last quote is reference/history only, not live R/S. Final redemption and zero-value transfers are explicit strict-growth exceptions. Emergency behavior is inherited and unresolved separately.
3. Existing pre-first-mint binary support accrues to initial token holders. The first-buyer allocation policy must be coordinated with the binary owner; no smoothing, premint or distribution change is silently made.
4. Binary funding can still inject collateral after token lifecycle closure while new token buys are blocked. Coordinate post-closure membership/injection handling before deployment.
5. Binary changes are limited to the token-owned authorization call and cumulative quota ledger/views. Reward distribution and optional reward-funded auto-buys are unchanged.
6. The owner-rotation vote-reuse vulnerability in the inherited Council is outside this token-only patch. A separate prepared governance fix must be reviewed; this PR does not claim governance is secured.
7. No new nonlinear/cohort-profit curve is implemented. Reserve/share accounting and fee retention cannot guarantee profits for all buyer cohorts.

No public-chain transaction, live-service replacement, merge or deployment is part of this checkpoint.
