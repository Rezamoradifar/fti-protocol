# Registration inviter draft preservation

Base: `723acfa99a8dfe3db109295f44da74e433c48a30` on
`release/fti-mainnet-candidate-20261016` (PR #41), not the older `main`.

## Scope

The existing controller reads `sponsor` once, after asynchronous initialization.
It does not preserve manual input over a reload, and workspace navigation can
remove the invitation query. A browser bootstrap now captures the invitation
before loading that unchanged controller. It accepts `sponsor`, `referrer` and
`ref`, normalizes to `sponsor`, and restores a valid draft into an empty enabled
registration field. Same-tab session storage is bounded to 24 hours. URL query
propagation also supports internal link navigation and new-tab clicks.

New explicit invitations take priority. Invalid/conflicting invitations never
fall back silently to an older inviter. Deliberate clears remain cleared, even
when storage writes fail. Existing disabled member fields and nonempty live
edits are not overwritten. Inviter data is not added to external links, RPC/API
URLs or wallet URI schemes. No browser prototypes are modified.

This is draft persistence, not transaction authorization. All existing checksum,
chain, membership, collateral, allowance, placement-integrity and contract checks
remain in the original controller. No RPC, contract, balance, 31-wallet layout,
server unit, Nginx configuration or release-verification code is changed.

## Checks

- `node --test test/referral-context.test.mjs`: 23 pass, 0 fail locally.
- Node syntax checks pass for the new modules and changed build script.
- Isolated Chromium DOM harness: 18 checks pass across 320/390/1280px; it used
  synthetic history/storage and a local submit handler. This is not a real
  SafePal/MetaMask connection, live placement API, or signed transaction test.
- Full application build and full-suite status must be checked on the final
  GitHub commit. They were not run locally because dependencies were unavailable.

## Release boundary

Not installed on the VPS. Do not edit files in a live release, replace deployment
fingerprints, bypass manifest verification, or restart the live service merely
because these source tests pass. Build `npm run build:web` in an isolated checkout
and use the reviewed frontend-only staging/rollback procedure after CI/review.
Verify the built asset, invitation URL, wallet return, placement response and
membership receipt separately. Do not send a real registration transaction just
to test this UI change. The standalone landing bundle is not changed; generated
invitations in the current controller point directly to `/app/`.
