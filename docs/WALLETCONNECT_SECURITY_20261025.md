# WalletConnect security repair — 25 October 2026

The production dependency graph previously included Zod 3.25.76 and 3.22.4
through EthereumProvider's AppKit, Coinbase and ABI-validation dependencies.
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
reports affected Zod versions below 4.6.6. Upstream EthereumProvider 2.26.0 and
AppKit 1.8.24 still require Zod 3 consumers. Zod 4 changes record, default and
error APIs, so overriding that major version without migrating its consumers
would risk breaking wallet flows. Loading `zod/v3` from a newer package would
also retain the older array parser; this repair does neither.

## Runtime change

- Keep the official WalletConnect transport and signing protocol at 2.26.0,
  using `@walletconnect/universal-provider` directly.
- Add the first-party `frontend/walletconnect-adapter.js` EIP-1193 bridge and
  `frontend/walletconnect-modal.js` accessible pairing screen. The QR renderer
  is pinned to `qrcode` 1.5.4.
- Remove the unused AppKit/social-login/Coinbase/Zod dependency tree entirely.
  No advisory suppression or incompatible dependency override is introduced.
- Preserve the existing `walletConnectProvider(projectId, chainId)` export,
  injected wallet selection, SafePal detection, controller transaction review
  and wallet-session disconnect integration.
- Request only the configured BNB namespace (56 or 97), route reads through
  the existing same-origin `/rpc`, validate session expiry and account/method
  authorization, and reject signing after account revocation or chain drift.
- Reuse valid sessions silently, coalesce interactive pairing, and remove the
  QR screen after approval, rejection, expiry or cancellation. Cancellation
  disconnects only the new pairing through Core's supported pairing API;
  UniversalProvider 2.26's deprecated `abortPairingAttempt` is a no-op.
- Keep pairing secrets within the active QR/link interface. They are never
  logged or added to the page URL. Official Trust Wallet and MetaMask links
  require a user click; other wallets can scan, open or paste the standard
  WalletConnect URI. No automatic app navigation is performed.

## Verification

Fresh production installation in a separate empty directory using the committed
manifest and lockfile, `npm ci --omit=dev --ignore-scripts`, followed by
`npm audit --omit=dev --audit-level=high`: **zero vulnerabilities**.
The same npm audit in the working checkout also reports zero production
vulnerabilities. The development-only Ganache toolchain is outside this claim.

45 focused Node tests pass across adapter behavior, injected wallet discovery,
SafePal identification, remote session cleanup and network configuration.
The adapter tests include late approval after cancellation, empty-account
revocation suppressed by the upstream transport, wrong-chain and expired
sessions, coalesced requests, signatures routed through the correct namespace,
and exact official mobile-link encoding. Account-change events are intersected
with the wallet-approved target-chain namespace. Send/sign requests require an
active approved caller, an approved method, and a matching payload/domain
network. Canceled underlying connections settle before another pairing starts,
so a late approval cannot overwrite a newer authorized session.

Six Chromium pairing-screen cases pass: FA/EN at 390/1440 pixels, a painted QR
canvas, no horizontal overflow, clipboard copy, fixed official link hosts,
keyboard focus containment/restoration, cancellation and a usable QR-failure
fallback. These tests use a clearly synthetic pairing URI and submit no wallet
signature or financial transaction.

The SDK build's esbuild input graph contains no Zod, AppKit or Coinbase modules.
The final SDK bytes and hash must be taken from the final release build rather
than an earlier prototype. Both `web/vendor/walletconnect.js` and its linked
legal-notice file must be included by the reviewed installer. Installing only
the member application's HTML/JavaScript while preserving the old SDK does not
apply this security repair. Existing immutable baseline assets remain retained
for rollback; the active member, token and admin entries must all resolve the
new SDK.

Real mobile-app handoff, relay authorization and signed mainnet user journeys
remain a separate acceptance check. Browser fixtures and an npm audit do not
establish their completion.

## Primary references

- [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
- [Zod migration guide](https://zod.dev/v4/changelog)
- [Zod subpath versioning](https://zod.dev/v4/versioning)
- [Trust Wallet mobile integration](https://developer.trustwallet.com/developer/develop-for-trust/mobile)
- [Trust Wallet deep links](https://developer.trustwallet.com/developer/develop-for-trust/deeplinking)
- [WalletConnect URI format](https://eips.ethereum.org/EIPS/eip-1328)
