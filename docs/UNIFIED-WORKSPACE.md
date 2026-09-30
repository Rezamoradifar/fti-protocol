# Unified website and member workspace

The public landing page and the wallet application share port **3090**:

- `/`: English protocol landing page.
- `/app/`: member workspace; sections use `#overview`, `#network`, `#trade`, `#rewards`, `#activity` and `#admin`.
- `/api/`, `/rpc`, `/abi/`, `/vendor/`: same-origin backend routes.
- `/health`: current backend health and network.

The previous application on port 3080 is retained. Node stays bound to `127.0.0.1:3081`; Nginx exposes the public routes. The panel's assets use relative URLs so `/app/app.js` cannot collide with the landing bundle `/app.js`.

## Update the existing new server

Run this on **185.114.206.44**, after it has been installed using `install-new-server.sh`:

```bash
(
set -e
cd /opt/fti-protocol
runuser -u fti -- git pull --ff-only
bash scripts/update-unified-site.sh
)
```

Then open `http://185.114.206.44:3090/app/`. Use a hard refresh if the browser retains an earlier bundle. The updater discovers the Node runtime from the systemd service, builds both frontends, validates Nginx, restarts the web service and checks the shared routes. It keeps frontend and Nginx rollback copies under `/var/tmp/fti-site-rollback.*` and restores those files if the update fails. It refuses an unrecognized/custom Nginx configuration. No private key, contract deployment, ABI compilation, or keeper activation is involved.

The updater is for the installation layout created by `install-new-server.sh`; it does not relocate a custom server. That installer also uses the unified routes for new migrations. With a domain and HTTPS, the same relative routes continue to work. External wallets must be injected into the browser: on mobile, open the URL in the wallet browser. This release does not include WalletConnect or email/password accounts.

## User flows

1. **Overview:** FTI, available tokens, locked balance, test USD, claimable rewards, manual purchase allowance, rank progress and protocol accounting. Disconnected balances remain blank rather than fabricated.
2. **Membership:** register beneath a sponsor, add units, view direct left/right children and lifetime/carried volume. Copyable invitations prefill the sponsor on the membership screen. They do not reserve a placement slot.
3. **Buy and sell:** live curve quotes, slippage-adjusted minimum output, remaining allowance, exact available-balance fill, and on-chain confirmation. Locked balances disable sales and explain the unlock conditions. Fees and caps are enforced by the existing contracts.
4. **Token availability and transfer:** UTC deadlines and wallet thresholds for each tranche. Transfers require a different recipient with purchased membership units and retain the existing 3% burn.
5. **Rewards:** claim allocated cash, save the auto-buy preference and price limit, buy using pending auto funds or release them to claimable cash, and inspect settlement and reserve pools.
6. **Activity:** actual recent protocol events, explorer links, explicit RPC failure state and retry.
7. **Governance:** permissionless settlement calls, council proposals and timelock execution. UI access does not confer a contract role.

Balances and ranks refresh every 15 seconds and before writes. The wallet signs its own requests; no signing key is sent to the web server. These are the existing legacy BNB testnet contracts. The separate scheduled-exit candidate is not activated by this update.

## Development and validation

```bash
npm ci
npm run build:web
npm run demo
```

The local chain is ephemeral. `UI_QA=1 node scripts/local.mjs` runs the browser journey when Playwright/Chromium are available. Set `PLAYWRIGHT_PATH`, `BROWSER_BUNDLE` and/or `BROWSER_EXECUTABLE` if using an external browser installation. `UI_BASE_URL` can point the journey at an Nginx `/app/` route in front of the local chain. It must never be used to bypass holding periods on a public network.

The browser journey checks registration, adding units, quotes, purchase, a blocked locked sale, a sale after a **local-only** time advance, transfer, auto-buy settings, reward claim, council proposal, responsive navigation, deep-link reload, and activity-service failure/retry. Screenshots are saved locally under `qa/`; summarized results are in `docs/ui-test-results.json`.

This is frontend and routing validation, not an independent security audit or a guarantee about protocol economics.
