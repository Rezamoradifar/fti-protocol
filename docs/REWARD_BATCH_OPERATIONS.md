# V3 reward batch operation

This candidate requires fresh deployment and rebuilt artifacts. It does not
upgrade existing immutable contracts. Do not deploy it to mainnet on the basis
of local tests; independent security review and public-testnet validation remain
necessary.

A `payRewards(1..100)` transaction attempts at most that many queued entries.
Recipients and amounts come exclusively from `pendingReward`. Successful
payments emit `Claimed` and increase `RewardBatchPaid.accounts`; that count is
successful payments, not attempted transfers. An empty queue is a valid no-op.

A blocked/unsupported recipient emits `RewardPaymentDeferred`. Its transfer,
queue removal and liability reduction revert together inside a self-only
external call. Other recipients can still be paid. A persisted cyclic cursor
prevents one failing recipient from monopolizing the queue. Individual claims
still use the direct transfer path and remove their queue entry on success.
Failures must not be interpreted as forfeited rewards.

Each isolated call is limited to 150,000 gas. The parent requires at least
190,000 gas before an attempt, so undersupplying transaction gas cannot silently
turn healthy recipients into deferred transfers. Unusual collateral contracts
may exceed this bound; direct claims remain available, but the intended exact
18-decimal collateral must be validated on the target network. All transfers
check both sender and recipient balance deltas. Unsupported fee tokens are
rejected without losing the beneficiary balance.

The keeper waits for each receipt and uses 25-entry settlement/volume/monthly
batches and 100-attempt cash batches. A receipt with zero successful payments
backs cash retries off for 60 seconds and continues considering optional
auto-buys. That retry clock is process-local; the queue and balances are on-chain.
A restart may make one immediate retry. Gas funding and a running keeper remain
required; clicking Reward alone does not promise completion of the whole queue.

Hourly and monthly allocation phases block batch cash payout. Pending auto-buy
collateral is excluded from cash batches. Failed auto-buy execution preserves
its balance; only its owner may release it to cash or choose partial execution.
Existing `pause()` semantics are unchanged: new funding is paused, while accrued
settlement and withdrawal remain possible.

## Reproduce

```sh
npm ci
npm run build:web
npm test
FTI_SCALE_REPORT_DIR=qa node --test test/funded-reward-scale.test.mjs
```

The scale tests create independently calculated 1,000- and 10,000-position
network fixtures using compiler-derived storage slots in a local Ganache chain.
They deploy **unmodified production bytecode**. A local-only temporary storage
writer batches fixture creation; its code is removed and the exact original
runtime (including immutables) is verified before validation. They run hourly/monthly
settlement and payout transactions, and reconcile allocated sums against an
independent BigInt ledger. They exercise a blocked recipient, continuation by
another keeper/caller, fixed destinations, duplicate prevention, and bounded
transaction gas. Initial registration and funding RPC transactions are replaced
by fixture seeding; these tests are not a claim of end-to-end registration load
or public-network throughput. The smaller V3 tests cover actual funding,
settlement, auto-buy failure/success/release, direct claims and monthly gates.

Optional browser QA needs separately installed Playwright and Chromium:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  FTI_QA_DIR=qa node scripts/qa-v3-rewards.mjs
```

It uses only a fresh local chain and test collateral, and checks real Reward
button transactions, deferred cash, retry, empty-queue disabling and mobile
layout. A missing browser executable is a failed prerequisite, not a pass.
