# Local permanent-retirement review

This separate candidate adds `FTIRetirementReviewToken`. Read [the lifecycle rules and open boundaries](docs/RETIREMENT-REVIEW.md), [validation](docs/retirement-review/VALIDATION.md), and [unsigned deployment plan](docs/retirement-review/UNSIGNED-DEPLOYMENT-PLAN.json).

The earlier `FTIReserveToken` and `BinaryPlan` remain unchanged. Their previously delivered 250-test candidate is preserved separately. The integrated candidate has 177 recent local checks across lifecycle, fee/governance, current-token accounting/load, helpers, UI/API and safe unsigned-deployment paths. Full repository CI belongs to the exact published commit; earlier results are not being reused as new-contract validation.

## New lifecycle

- Normal final sales pay the holder net of the current-trade fee and reserve that fee as a fixed development-fund claim
- Claim payment is separate from the seller payout, and all token claims must clear before retirement
- Permanent retirement requires the five-of-seven Council, a 72-hour delay, zero supply/backing/claims and a quiescent bound binary
- Tracked protected support goes to the immutable development recipient; untracked donations need a distinct delayed Council recovery action
- No token reopening, new minting or support injection is possible after permanent retirement
- Binary cash claims remain owned by their beneficiaries and cannot be swept by the token

Pending-auto conversion remains unimplemented. An inactive beneficiary can still block retirement; continuing membership after token retirement and terminal precision dust remain open integration decisions. The 7% size-curve coefficient is still provisional.

## Reproduce the focused checks

Use the pinned dependencies and supported Node environment. No real wallet is needed; tests use local Ganache fixtures.

```sh
npm ci
npm run compile
node --test --test-concurrency=1 test/retirement-review.test.mjs test/size-fee-proposal.test.mjs test/governance-rotation.test.mjs
node scripts/verify-retirement-review.mjs
```

The verification script prepares standard input locally and checks creation bytecodes. It never submits transactions or contacts an explorer.

## Deployment boundary

No deployment, signing or real-fund movement occurred for this variant. GitHub draft-review publication has been requested; it is not a production approval. The actual development treasury, seven Council owners, 31 genesis addresses and secure signer are not configured in this copy.

The current retirement demo and unsigned preparer select the new lifecycle/token-binary pair. The older direct deployment scripts remain historical and must not be used for this variant. The unsigned preparation output is not a signing or deployment approval. Existing public contract addresses are historical, including an old three-of-five Council; they are not approved replacements for the new configuration.

For a separate, pinned server checkout with no live service replacement, see [user-run installation](docs/retirement-review/USER-RUN-INSTALL.md). Never expose the unlocked local demo publicly.
