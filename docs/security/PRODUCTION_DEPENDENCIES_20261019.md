# Production dependency isolation and versioned wallet libraries

The reported five critical findings were reproduced by auditing the physical installed package tree, including Ganache's bundled/shrinkwrapped packages. All affected physical paths in this checkout were under `node_modules/ganache/`. The root lockfile audit alone under-reported these bundled packages.

Changes:
- The mainnet UI installer uses `npm ci --omit=dev`. Esbuild remains available as an explicit build dependency; semver is explicit for the physical audit. Ganache and solc are not installed in this production build checkout. Their versions, Solidity source and compiler settings are unchanged.
- Both the registry audit and physical package audit must pass before building/installing the UI. Audit errors or findings abort before live HTML changes. Reports contain package metadata, not credentials.
- Ethers and WalletConnect are copied into the immutable, versioned UI asset directory. Relative imports bind the UI to these audited build dependencies. The previous absolute imports continued using the old release's vendor files after a UI update.
- The existing private backup, atomic HTML replacement, concurrent-edit protection and rollback behavior remain in place.

Verification: a clean production install contains 307 installed packages, zero findings in both npm's production audit and the physical inventory audit. Production build, 13 targeted Node checks, two installer tests and 51 Chromium language/layout and versioned wallet-module loading checks passed. Audit summary is in `production-dependencies-20261019.json`.

Boundaries: zero known findings in this install is not a security certification. Ganache remains vulnerable in the full development toolchain and must not receive real private keys or be exposed as a production RPC. Its bundled cryptographic stack cannot be safely repaired by blindly forcing a parent-package update; the elliptic advisory https://github.com/advisories/GHSA-848j-6mx2-7j84 lists no patched version. Migrating the contract test harness is a separate change requiring contract regression tests.

This installer does not delete historical server release directories, mutate the live backend's node_modules, restart Keeper, or deploy contracts. Those legacy runtime packages are not covered by the fresh-build result. The new installer must still be executed on the VPS, and the resulting browser behavior verified on the live domain. An upstream deprecation notice for the Safe SDK may remain even though the dependency audit reports no known vulnerability.
