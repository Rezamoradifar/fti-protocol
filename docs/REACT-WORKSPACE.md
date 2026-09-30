# FTI React workspace

English, responsive React 19 interface with a bundled production build. Existing contract addresses, APIs, signing and transaction flows are retained. The visual layout is in `frontend/main.jsx`; `frontend/controller.js` initializes the existing imperative contract controller after React mounts. Keep React from re-rendering controller-owned subtrees until the controller is migrated to React state. No external scripts, fonts or analytics are loaded.

## Build

Use Node 22 or newer. Run `npm ci` then `npm run build:web`. The server serves the generated production bundle from `web/`. `npm start` and `npm run demo` rebuild it automatically. No Solidity rebuild or redeployment is required for frontend changes.

## Ubuntu testnet installation

From the repository on your server, run `bash scripts/install-testnet-web.sh` as root. Requires an existing `deployments/testnet.json` with mode `testnet` and chain 97. Installs the `fti-testnet-web` systemd service on port 3001, with automatic restart. If UFW is already active it opens this port. An upstream hosting firewall may also need to allow TCP 3001. This does not stop the separate local demo on port 3000.

For production public access, put port 3001 behind an HTTPS reverse proxy using your domain. The direct IP endpoint is useful for read-only testnet preview; wallet injection can require HTTPS or a wallet browser. The UI requires an injected EIP-1193 wallet; WalletConnect is not included.

Logs: `journalctl -u fti-testnet-web -n 80 --no-pager`.

All assets are test assets. Source verification on BscScan remains a separate step. No private key belongs in the web service configuration.
