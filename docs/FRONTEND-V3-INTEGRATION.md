# Integrated FTI V3 frontend

The landing page and member, token and governance workspaces share a Persian/English interface, language preference, jade/charcoal styling and responsive navigation. Landing metrics and the five contract addresses come from the installed server API; no deployed address is hardcoded.

The token workspace exposes V3 cycle/ATH/start-price/builder-multiplier data and emergency pro-rata redemption. Ordinary trading is disabled during token pause or emergency unwind. Selling accepts token holders who received a transfer without membership; membership still gates buying. Registration is disabled while deposits are paused or settlement is active. Existing contract minimum-output, deadlines, purchase limits, council approvals and timelock methods remain in force.

## Build

```sh
npm ci
npm run build:web
(cd landing && FTI_APP_URL=/app/ node build.mjs)
node --test test/v3-server.test.mjs
```

The server must serve landing/dist at `/`, the compiled workspace at `/app/`, `/token/`, `/admin/`, and its existing `/api` and `/abi` routes on the same origin.

## Validation and deployment limits

Both production bundles build successfully. The V3 server integration test passes using locally deployed production contracts. Browser visual checks could not be completed: the available browser could not reach the local preview, and its URL policy disallowed local files. Wallet transaction behavior has not been tested through a browser for this frontend change.

The offline `preview/` files in the delivery ZIP are design previews only: wallet actions are disabled, live metrics are unavailable, and they do not send transactions. Production bundles retain the real controller and contract integration.

The installed V3 release verifies a source fingerprint that includes frontend code. Do not overwrite files in an existing pinned release or edit its fingerprint. A separately built and verified UI release/configuration is required before restarting the production web service. This change does not deploy, redeploy or modify contracts, change the existing keeper, or report a successful 100-wallet public-testnet run.
