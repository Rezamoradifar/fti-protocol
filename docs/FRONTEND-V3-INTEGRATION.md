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

## Wallet selection and mobile update

Injected EVM wallet selection uses EIP-6963, with legacy injected-provider fallback. Each signer and its account/network listeners belong to the chosen provider. The wallet chooser does not itself submit financial transactions.

WalletConnect uses the pinned official `@walletconnect/ethereum-provider` 2.26.0, bundled locally into `web/vendor/walletconnect.js` and loaded only when selected. `WALLETCONNECT_PROJECT_ID` is a public Reown ID read from the protected web service environment and exposed through `/api/config`. Only chain 97 is requested. Set the project origin allowlist to `https://ftiprotocol.com` in Reown. Supported EVM wallets may connect by QR or their mobile app; this does not mean every wallet supports BNB Testnet.

The server permits WalletConnect/Reown network endpoints and modal styles only when a valid project ID is configured. The compiled SDK is included in the verified UI fingerprint. Core contract dependency declarations and compiled contract artifact hashes must remain unchanged; the installer allows only this pinned wallet-provider addition and resolves the current installed UI configuration through existing systemd drop-ins.

Small-screen header controls wrap, card/form grid children may shrink, addresses wrap and tables keep their own scrolling. These changes build and have automated provider/API checks; visual mobile and real wallet pairing still require verification after installation. No public wallet transaction was executed by this update.
