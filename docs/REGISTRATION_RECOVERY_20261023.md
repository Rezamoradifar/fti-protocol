# Registration blocked by an uncertain previous request

The affected screen is the pending-transaction guard, before a new membership
purchase. It is not evidence of a failed sponsor/placement lookup.

## Verified baseline

- Frontend source from `f7498a8`, included in `6763959`, builds the exact live
  `/fti-mainnet-ui-eead15d141fbbc07/app.js`: SHA-256
  `a6ed0da9729698dd66d3db996e8d1dc370d0fd6bd088d0d1730c8f7ab3dcfacc`.
- The installed referral bootstrap remains separately loaded from
  `/fti-referral-c6abd61ddf79782e795c2484/entry.js`.
- Read-only live `/rpc` probes returned `missing trie node` for an older
  `eth_getTransactionCount`, and `limit exceeded` for `eth_getLogs`.
- `submitUnknownCancellation` remembers the actual wallet-returned hash before
  waiting for its receipt, but deliberately retains `unknown:<nonce>` on a
  timeout. The recovery controller previously hid this remembered hash from
  `recoverPending`, which then depended on the failing historical reads.

## Changes

Recovery now tries the remembered hash first and still verifies sender, nonce,
chain, transaction/receipt hashes, canonical block and the existing safe-block
depth. Session guards expose that hint only while the same wallet, signer,
provider and pending record remain current. A visible no-fee retry action
restarts the bounded read-only monitor after it exhausts its budget.

This does not establish that an unbroadcast or hashless legacy request is safe to
forget. Such requests remain recorded until a matching receipt is verified or
the user explicitly completes the existing wallet cancellation flow. Neither a
timeout nor a moving nonce is proof of a failed purchase. No transaction is
automatically sent, retried or cancelled.

## Installation

`tools/install-registration-recovery-ui-release.py` is a self-contained packaged
installer. Default: read-only preflight. `--apply` publishes a new application
filename alongside the current immutable bundle, preserving its relative vendor
imports. A new entry module runs the exact installed referral bootstrap first.
Only `web/index.html` is switched atomically. The installer verifies the pinned
live bundle, referral blob, deployment identity, public/origin HTTP bytes and
MIME, service identity, unchanged protected runtime, and retains a private HTML
backup with a concrete rollback command. Verification failure restores the
previous HTML while preserving concurrent operator edits. Repeating the same
install verifies the existing result without another switch.

No build, service restart, RPC change, contract deployment, keeper activation or
release fingerprint modification is performed by this installer.

## Validation and limits

- The remembered-hash and controller-guard regressions failed on the baseline
  and pass after the fix.
- 109 Node results pass across recovery hints, pending recovery/controller,
  transaction state, cancellation preparation, pending monitor, membership
  purchase flow, direct wallet send, wallet review and transaction hash tests.
- Production workspace build passes after installing both root and landing
  dependencies. The landing dependencies supply the existing local fonts.
- 15 installer filesystem/rollback tests pass. Python/JS syntax checks pass.
- No VPS login, installation, physical SafePal/MetaMask interaction, live
  registration signature or financial transaction was performed in this task.
- The earlier CI dependency audit finding for `follow-redirects` is outside this
  narrow frontend fix. A successful UI build does not resolve that finding.

After installation, reconnect the same wallet and use **Check previous request
again · no fee**. If no matching hash is available, use the wallet's actual
transaction hash in the existing verification form. Do not clear browser data to
remove the pending guard.
