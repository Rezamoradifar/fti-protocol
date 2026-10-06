# UI/API adaptation: immediate auto-buy and restartable zero supply

Local, unpublished source adaptation in the isolated combined review candidate. No deployment metadata, contract source, keeper source, real wallet, GitHub branch, or live service was changed by this UI task. Contract/keeper/test revisions in the shared candidate were supplied separately by the coordinating contract task.

## Included changes

- Applied and SHA-256-verified all 12 files in the exact-price source overlay before adapting the UI. `applied-overlay.json` records that input. Exact integer/rational reserve-price helpers remain intact.
- Removed the member maximum-price input. The current form sends `setAutoBuy(bool)` only; the fixed allocation is 5%, off by default, at the current full-precision quote including fees.
- Enable targets the next UTC wall-clock hourly allocation boundary: 12:30 first applies at 13:00, and a request exactly at 13:00 targets 14:00. Enable remains available during overdue/in-progress settlement because the contract excludes old backlog. Disable stops new purchase attempts and retries immediately. Saving an already active setting does not postpone it.
- The API reads effective enablement and the scheduled setting separately from lazily rolled member storage. `wallet.autoEnabled` is effective permission; `wallet.autoStoredEnabled` is raw storage; `wallet.nextAutoSetting` has `enabled` and `effectiveAt`. The old `maxAutoPrice` field is retained for read compatibility and is zero/deprecated in the current Binary.
- The UI explains that allocation attempts only the new 5%; failures stay pending for the same beneficiary. Keeper retries are bounded while a request remains active, without an execution deadline or uptime guarantee. Owner release only changes pending auto to their claimable cash; Claim to wallet is separate. Claimed wallet funds are never re-debited.
- Normal zero supply is a restartable empty interval on the new token. Its retained exact reference fraction is displayed separately from the undefined zero-supply live ratio. Restart does not capture protected support or existing development claims.
- Permanent buy closure is a separate governed marker. Only that marker, together with paused Binary and phase zero, permits permissionless pending-auto conversion. No closure, retirement, or permissionless-conversion action was added to the admin UI.
- Capability flags require successful getter calls against the configured deployed addresses, not just local artifact signatures. Missing selectors use a conservative historical mode; operational RPC errors remain failures. Historical price-cap preference editing is intentionally unavailable in this no-cap review interface.
- All `/api/state` reads use one block number with a final block-hash check. A changed block rejects the response instead of displaying mixed-state ratios/settings. Exact fraction text wraps on narrow layouts.
- Updated stale landing/admin wording about pending-auto conversion, zero-supply restart and ordinary net final-sale payouts.

## Verification

The final result and frozen hashes are recorded in `verification.json`, `ui-source-hashes.json`, and `ui-build-hashes.json`.

Commands:

```sh
npm run build:web
npm run build --prefix landing
node --check scripts/server.mjs
node --check frontend/controller.js
node --test --test-concurrency=1 \
  test/exact-price.test.mjs \
  test/frontend-trade-quotes.test.mjs \
  test/workspace-markup.test.mjs \
  test/workspace-state.test.mjs \
  test/workspace-routing.test.mjs \
  test/immediate-auto-ui.test.mjs \
  test/workspace-integration.test.mjs \
  test/retirement-server-state.test.mjs \
  test/integrated-server-state.test.mjs \
  test/event-server.test.mjs
```

The API suites use fresh ephemeral contracts and loopback HTTP/RPC. They cover capability probing against missing getters, operational RPC failures, reorg-style changed hashes, scheduled/effective enablement, immediate disable during matching, fresh ABI routes, ordinary zero-supply restart without support/claim capture, and nonce-bound governed closure before retirement.

The UI suites cover server-rendered structure, state gates, repeated/deep-link/back-forward routing, wallet error states, stale-data write blocking, full-precision amounts and quote deltas. They are not browser-render, screenshot or live-wallet tests. Full legacy EVM suites were not run by this UI task and old max-price policy tests are not claimed to pass. Separate contract-task validation owns organic immediate-auto behavior and keeper tests.

`ui-api-previous-timing.log` is superseded exploratory validation from the earlier timing policy; only `ui-api.log` and the final verification manifest describe the current result.

Observed non-fatal environment warnings: Ganache native µWS binary unavailable on Node 24, falling back to its JavaScript implementation; HTTP server listener warnings; npm's existing `http-proxy` configuration warning.
