# Hourly cap flush — local validation

Scope: source candidate on top of PR #32, baseline `95f753f7c4089e8a5401f2ffb3f8a1bd8e567f42`. No live deployment, merge, balance migration, or public-test reset was performed.

## Reviewed behavior

- With sufficient attributed funding, left 15 / right 20 at cap 5 pays 5 points, flushes 10 matches, and leaves left 0 / right 5.
- The cap applies before the existing funded-floor calculation. Within-cap volume that cannot meet the existing 20 USD floor is deferred as before.
- Matched credit above the cap moves into the existing protected retained reserve. It cannot become a cash or auto-buy claim in a later epoch.
- No storage field was added. The constant version getter and flush event identify the behavior without changing the legacy storage layout.
- The API advertises the new policy only after the installed contract successfully returns version 1; an updated ABI alone is insufficient.

## Environment and build

Local Ganache EVM with MockUSD; Node 24.19.0, solc 0.8.30, optimizer/viaIR and Shanghai settings from the repository. This is not evidence of production or public-testnet execution.

| Check | Result |
| --- | --- |
| `npm run compile` | PASS; upgradeable binary runtime 24,346 bytes, 230 below the 24,576-byte limit |
| `npm run build:web` | PASS |
| `git diff --check` | PASS |
| Capability detection and referral storage prefix | PASS |
| Actual unlimited-referral placement contract regression | PASS |
| Existing proxy continuity and layout rejection gates | PASS |
| Fresh deployment rejection gates and local CLI/API integration | PASS |
| Dedicated flush contract suite | PASS; 18 tests, 0 failed/cancelled, 409.2 seconds |
| Builder controls and new-address migration regression | PASS; 13 tests, 0 failed/cancelled, 132.4 seconds |

## Regression coverage and corrections

The dedicated contract suite uses real registration/add-unit transactions, receipt checks, per-wallet integer accounting, balance invariants and event assertions. It covers both orientations of the approved example, equal legs, below/at cap, one-sided volume, all four Builder ranks, no repeated payment, future use of the saved strong leg, 100% auto-buy, depth-dependent underfunding and atomic rounding. The depth-46 case checks zero payable points despite cap overflow.

The first dedicated run reached its 240-second parent timeout in the final deep-tree case; earlier assertions passed. The final run allows 600 seconds and processes that deep case in bounded batches of 100; the smaller-batch tests remain in the suite.

The initial compatibility run exposed three concrete issues which were corrected before rerunning:

1. Old tests reused above-cap rank-qualification carry for later hourly income. Those fixtures now buy fresh units, and the monthly fixture drains their volume queue before closing.
2. The October 9 layout fixture ends at `calculatedPointValue`, not `_autoBuyPercent`. The test now checks its actual prefix and the exact three subsequent fields. The separate referral-layout gate still checks the two PR #32 mapping additions.
3. The migration exporter did not recognize PR #32's `directReferrer` and `directReferralCount` mappings. Both are now included in wallet-keyed raw-slot export, with explicit destination getter assertions. Unknown mapping labels still fail closed.

Ganache used its JavaScript fallback because this Node build lacks its optional native µWS binary. The existing compiler shadowing warning also remains. No browser visual test, dependency security audit, or mainnet readiness claim is made.

## Reproduction

```sh
npm ci
npm run compile
npm run build:web
node --test --test-concurrency=2 test/hourly-cap-*.test.mjs test/referral-layout.test.mjs test/referral-placement-contract.test.mjs test/global-builder-controls.test.mjs test/continuity-upgrade.test.mjs test/address-migration.test.mjs test/fresh-testnet.test.mjs
```

The PR workflow runs these gates on Node 22. Its remote result must be inspected separately; a workflow file is not a passing run.

Before any later upgrade, verify the deployed implementation and storage baseline, drain settlement/volume queues, snapshot the books and explicitly review treatment of existing carry. Existing accumulated carry will be subject to the new cap-flush rule at its first settlement after activation. Follow the existing council/Timelock path; this candidate does not activate itself.
