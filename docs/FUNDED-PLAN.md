> **V2 branch note (2026-10-04):** token lock/anchor/fee/governance statements below describe the earlier PR4 baseline. On `fix/zero-start-animal-protection`, `docs/TOKEN-V2.md` is authoritative for token mechanics: zero supply at start, no time/wallet-count locks, 1 percentage point of the 3% buy/sell fee allocated as fully-backed FTI to two animal-support wallets, anti-whale sell protection, builder-only 10x allowance milestones, and 5-of-7 emergency redemption mode. Binary reward economics remain separately under review.\n\n# Attributed-credit binary plan and scalable token locks

This is a **separate review candidate**, on `fix/funded-binary`, building on the real-reserve candidate in PR #3. It is not deployed to public testnet or the live website. Existing immutable contracts and user positions are unchanged. It is not an independent audit, a safety score of 100, or approval to accept real funds.

## What was fixed

| Confirmed issue | Candidate behavior | Evidence |
| --- | --- | --- |
| A new 500 USD self-controlled subtree could collect 9,450 USD from an unrelated carried point pool | Source-specific credits and a hard 20 USD/paid-point ceiling; the same subtree receives 40 USD both with and without 9,000 USD unrelated carry | `funded-economics.test.mjs` |
| An inactive ancestor could activate later and collect previously queued volume | Eligibility is captured at the funding serial; no retroactive points, credits or ranks | Delayed-keeper activation regression |
| Global builder carry could fund unrelated later qualifiers | Each ancestor has purchase-attributed current-month credits; previous retained funds never finance new rewards | Two-month regression with unrelated 160 USD tier-1 carry |
| Hourly settlement scanned all members twice | Only touched, active ancestors enter a one-pass settlement list | Sparse settlement regression; one touched account among 31 members |
| The keeper scanned inactive members for auto-buy and waited between all batches | Pending enabled auto accounts have an indexed queue; successful batches continue sequentially after receipts | Keeper tests and funded auto-buy regression |
| 64 active token locks blocked frequent buys | Five cumulative checkpoint queues, binary-search maturity reads and 64-item pagination | 80 live purchases; 265 mixed tranches; exact deadline/clock boundaries |
| Binary collateral checks assumed ordinary transfer behavior | Exact sender and recipient deltas, reserve checks and reentrancy guards | Taxed transfers, callback attempts, blocked claims and deficit tests |

Legacy `BinaryPlan.sol` remains in the repository so old deployments, historical diagnostics and comparisons remain reproducible. Select **FundedBinaryPlan** explicitly to use these reward fixes. Passing a legacy diagnostic still means its legacy weakness was reproduced.

## Compensation policy changes — read before deploying

This is **not the original compensation formula with an invisible security patch**. The original 20 USD threshold adjusted protection; it did not cap dollar payouts. This candidate makes **20 USD a maximum gross point reward** and changes who is entitled to pool funds. Low funding can produce less than 20 USD. Income is not guaranteed.

Each paid unit still costs 100 test USD: 90 point funding, 5 token reserve support, 4 builder funding, 1 development allocation. For a purchase of `U` units at depth `D>0`, each of its `D` ancestors is attributed:

```
point credit = floor(90 USD * U / D)
tier credit  = floor(tier allocation * U / D)
```

Builder tier allocations remain 1.6 / 1.2 / 0.8 / 0.4 USD per unit. Only ancestors already active at that purchase's funding serial receive its volume and credits. A genesis slot with zero units is not active. An ancestor activated while a keeper is delayed cannot retroactively earn old volume. At depth zero there are no ancestors, so that purchase's point and builder funding is retained.

For each active ancestor, left/right unit counts and left/right dollar credits are separate. On hourly settlement:

1. `raw = min(left units, right units)`; `paid = min(raw, rank/protection cap)`.
2. Consume each side's credit proportionally to its matched units, rounding down.
3. `eligible = floor(consumed credit * paid / raw)`, or zero if `raw=0`.
4. `reward = min(eligible, 20 USD * paid)`.
5. Consume all raw matches, keep unmatched heavy-side units **and their credit**, and move unused matched funding to retained reserves.

The existing cap table remains. The protection level compares **eligible funding before the hard USD cap** with `20 USD * paid points`, so it can rise or fall. The reported point value is average actual allocated cash per paid point; it is not a promise that all wallets have the same payout per point. Auto-buy still receives 5% of an enabled, already-ranked wallet's point reward; the beneficiary can release it to cash.

Builder payouts are at most the wallet's own attributed credits for the closing month, subject to its rank at cutoff, one payout per rank, and the existing 20%-of-month-tier cap. Old `builderCarry` is a historical retained-funding total, **not a reusable future reward pot**. A newly qualified account cannot collect it.

**Retained point and builder reserves are permanently protected, nonclaimable collateral in this candidate. They are not a participant's refundable principal, another participant's reward, development income, or an administrator withdrawal allowance. They are not automatically injected into the token either.** There is no function to redistribute or rescue these funds. This avoids recycling unattributed surplus into a new extraction opportunity, but can retain a large fraction of membership payments. A different refund or reserve-use policy would require a separately specified and tested economic change.

The 300,000-wallet accounting scenario makes that consequence visible: out of 90,003,100 simulated USD membership inflow, approximately 11,620,329.24 is allocated as point rewards, 563,626.10 as builder rewards, **65,285,716.89 is retained in the point reserve**, 3,036,497.90 in the builder reserve, and 4,096,743.87 remains unmatched point credit. Development receives 900,031 and token reserve support receives 4,500,155. These are a specified scenario's results, not forecasts, promised returns or actual deposits.

## Accounting argument

Every purchase partitions its point and builder allocations among its own ancestor credits plus retained remainders. Processing a queued ancestor moves its amount to assigned credit or retained funds; it cannot create new credit. Matching consumes at most the wallet's assigned credit, moves the actual reward to a pending liability, and retains the remainder. Claims remove a liability only when that exact amount is delivered.

The contract exposes the partitions through `fundingAccounting()`:

```
pointPool        = queuedPointCredit + assignedPointCredit + retainedPointReserve
builderAccounted = queuedBuilderCredit + assignedBuilderCredit + retainedBuilderReserve
USD balance     >= pointPool + builderAccounted + totalPending + totalAuto
```

Direct donations can create surplus; they do not create attributed rewards. Tests assert the partition equality separately from the contract's backing requirement. Multiple wallet addresses are still not proof of independent people. The model prevents a newly created unrelated tree from capturing a global carried pool; it does not prove that all collusion, referral manipulation or identity fraud is impossible.

## Token and lock behavior

The real-reserve token still uses `R / S`, a permanently funded and nonredeemable anchor, 3% buy and sell fees retained in reserve, and a 3% transfer burn. The mathematical proof and collateral assumptions are in [RESERVE-TOKEN](RESERVE-TOKEN.md). This value is an internal gross redemption value, not a market-price or profit guarantee. No activity means no automatic price increase. Net sale proceeds deduct the fee; deadlines, pauses, dust and collateral availability still apply.

`lockVersion=2` replaces the 64-live-tranche ceiling. There are five independent queues: short holds plus each vesting stage. Within each queue, wallet-clock and time deadlines are monotone. Cumulative amounts allow `locked()` to read each queue with binary search, giving `O(5 log purchases)` lookup rather than a full lock scan. An explicit range guard prevents uint64 deadline truncation.

The existing OR-unlock conditions are unchanged: small/manual and auto purchases use 5,000 registrations **or** 30 days; the four vesting groups use 20,000/28,000/36,000/44,000 registrations **or** 90 days. Histories consume storage and transaction gas as purchases accumulate. They are not automatically deleted. `pruneLocks` was removed. `lockInfo()` now returns only the first 64 active entries; use `lockCount()` and `lockPage(wallet, offset, limit)` for the remainder. The web panel and `/api/locks` paginate this interface.

## Scale and operational boundaries

* Tree depth is capped at 64. A deeper registration reverts before funds or a sponsor slot are consumed. Balanced trees can accommodate 300,000 accounts well below this limit; arbitrary infinitely deep placement is no longer accepted.
* The 300,000-new-wallet BigInt simulation covers 60 accounting epochs and six simulated months, with 4,876,290 ancestor visits. It reconciles every wallet's credit and reward balances against global cash funding.
* It performs 298,228 sparse hourly account visits versus 18,303,720 visits for a hypothetical two-pass whole-member scan of the same member counts. These are model operation counts, **not measured blockchain gas savings**.
* Purchases still create ancestor-processing work. At an hour boundary, new registrations/top-ups still wait for the volume queue and epoch to close. Sparse lists remove inactive-account scans but do not prove that all 300,000 accounts can transact and settle within one hour.
* The keeper uses 25-item funded batches, waits for each receipt, immediately continues available work, and waits five seconds when idle or failing. It still needs a funded gas wallet and a working RPC. Public-chain congestion, failures, gas pricing and full-load capacity remain unvalidated.

## Validation scope

See `funded-validation.json` and `funded-validation-output.txt` for actual test commands, outcomes and artifact hashes, and `funded-simulation-300000.json` for the arithmetic scenario. The independent BigInt reference is also compared against actual EVM wallet credits, ranks and rewards over two epochs.

Tests use disposable local chains and valueless MockUSD. Local time travel and the test-only monotone clock fixture are not offered on public testnet. The production contracts have no such clock override. HTTP/API smoke and the React build are recorded separately; browser rendering and wallet click-through were not rerun because Chromium was unavailable in this environment. Existing historical UI screenshots do not validate this candidate.

Dependency audit on 2026-10-01: `npm audit --omit=dev --json` reported **zero** production dependency findings; the full development/toolchain audit reported **nine** affected packages (one critical, six high, one moderate, one low), under Ganache and solc dependencies. These findings remain open and are recorded in `funded-dependency-audit.json`; they were not hidden with audit suppressions. Do not expose the unlocked Ganache demo or use it with valuable keys. The suggested force-fix includes a Ganache major-version downgrade and a compiler change; neither was applied silently to the tested compiler/bytecode. Zero reported runtime advisories is not proof of zero vulnerabilities.

No public deployment or live-server replacement occurred. The existing contracts cannot be upgraded by pulling this branch. Independent review, public-testnet operational testing, realistic gas/capacity measurements and a decision on the materially changed compensation policy remain necessary before treating this as a release. Passing tests does not create a 100/100 security certification.

## Run a separate private demo

Use a new directory; keep the running service's checkout and deployment files intact:

```bash
git clone --branch fix/funded-binary https://github.com/Rezamoradifar/fti-protocol.git fti-funded
cd fti-funded
npm ci
npm run test:funded
npm run simulate:funded
npm run demo:funded
```

The demo uses **127.0.0.1:3083** for the website and **127.0.0.1:8547** for its fresh local chain. Each restart resets it. From your own computer, `ssh -L 3083:127.0.0.1:3083 root@185.114.206.44` exposes it at `http://localhost:3083/app/`; the token and admin pages are `/token/` and `/admin/`. Keep the unlocked-account demo private.

After building and compiling, `node scripts/reserve-http-smoke.mjs --funded-plan` starts and checks its own temporary demo, then exits. `node scripts/verify.mjs --prepare --funded-plan` prepares matching verification sources without a signing key, API key or transaction.

## Separate BNB testnet deployment, when ready

This section describes available tooling; it is not a claim that deployment has occurred. Prepare `deployments/testnet-input.json` with the existing 31-genesis/five-council/development address schema. Keep test-wallet secrets only in a protected local environment; never post them in chat or Git.

```bash
npm run build:web
npm run compile
node --env-file=.env scripts/deploy-reserve.mjs --funded-plan
```

The script accepts only chain 97 and writes **deployments/funded-testnet.json**, with a pre-broadcast progress journal. It refuses to overwrite an existing deployment/journal. Inspect receipts and nonces after a partial failure; do not delete the record and blindly redeploy. Configure `RPC_URL`, `CONFIG_FILE` and `DEPLOYER_PRIVATE_KEY` locally as documented for the reserve deployer.

After a deployment is verified, a **separate** web service can use `DEPLOYMENT_FILE=deployments/funded-testnet.json`, `HOST=127.0.0.1`, `PORT=3083` and the testnet RPC. Its keeper must use the same deployment file and its own gas-only key. Source explorer verification uses `DEPLOYMENT_FILE=deployments/funded-testnet.json node scripts/verify.mjs --funded-plan` with a locally configured Etherscan API key. Do not point the live domain at an unreviewed candidate or infer a migration from a successful compile.
