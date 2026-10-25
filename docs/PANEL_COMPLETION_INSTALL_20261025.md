# Completed member panel installation — 25 October 2026

The self-contained installer combines the professional member UI, corrected
shared translations, the patched Universal Provider wallet bridge, paginated
personal protocol history with CSV export, and wallet-authenticated support
threads. It performs one restart of `fti-continuity-web.service`. It does not
send blockchain transactions or publish support requests.

## Deployment boundary

The active release is never modified. The installer accepts the reviewed member
reserve, panel reliability or professional panel HTML and verifies their pinned
assets, boot fallback, referral wrapper, optional official-channel overlay,
mainnet addresses, source identity and existing runtime helper pins. The old
release's full manifest and artifact identity must also match the live
configuration during read-only preflight, as the service UID/GID, before any
staging or switch. Unexpected source drift stops with an `OLD_RELEASE_...
_SERVICE_UNCHANGED` diagnostic and leaves the running service untouched. This
requirement makes a restart into the preserved original release a verified
rollback path; an already-running process alone does not prove that it can
restart successfully.

The deployment source fingerprint includes every immediate JavaScript source
file in `scripts`, `core` and the other release source directories. Adding the
new API modules there would prevent a normal verified restart. The installer
therefore creates a sibling release with these boundaries:

- Public `web`, `landing/dist` and `artifacts` trees are copied with file/count/
  byte limits. Symlinks, private dotfiles and unknown file types are rejected.
- Exactly 129 canonical text files from approved revision
  `ba82373a83d63fba0643332371cfb6d62903c849` reconstruct the fingerprinted source.
  Each source is checked against the separately published source-recovery pins.
- Original generated `web/app.js`, original wallet SDK and artifact bytes remain
  copied from the existing release. Their exact deployment fingerprint and
  artifact hashes must match the live mainnet configuration before cutover.
- Eleven current backend modules live in a content-addressed directory outside
  the fingerprinted source directories. Only their relative import paths change.
  Original contract creation, runtime code, proxy implementation, guardian,
  timelock, collateral and accounting verification still runs on normal startup.
- The new UI, stylesheet, artwork and wallet bridge have immutable URLs. The new
  app binds directly to the new bridge URL and the reviewed existing ethers URL.
  Earlier immutable assets remain available for rollback.
- The existing `node_modules` tree is shared through one deliberate link; no npm
  installation runs on the VPS. Only its existing ethers runtime is used by the
  server. The patched browser bridge is a self-contained Universal Provider
  bundle. This does not claim that every old installed dependency was upgraded.

No environment file, deployment file, credential, keeper setting or user-data
directory is copied or overwritten. A dedicated web-only systemd drop-in sets
only `WorkingDirectory`, `ExecStart`, and one additional `ReadWritePaths` grant
for `/var/lib/fti-support/56-0x13ac3af4fe3e72dccffd52ab67e4d884b6d97df9`.
Existing environment references and sandbox protections remain effective.
The support directory is owned by the actual systemd user/group and has mode
`0700`; backup records have mode `0600` in a root-only backup directory.

A random sibling build directory is published atomically with Linux
`renameat2(RENAME_NOREPLACE)` only after a complete inventory exists. Interrupted
copying leaves the live release and final destination intact. A completed stage
retained after rollback can be reused only when its complete inventory matches.
An operator-created final-directory collision is preserved.

## Verification and rollback

Default invocation is read-only preflight. `--apply` prepares the sibling,
checks its manifest as the service UID/GID, verifies imports, installs the owned
drop-in, reloads systemd and restarts only the web service. Both HTTP origins must
serve the exact new assets and canonical deployment configuration. Read-only
API probes verify unauthenticated support rejection, cross-origin rejection and
invalid-history-address rejection without asking for a signature, creating a
ticket or triggering a history scan.

After restart, a small random canary is created, fsynced and removed inside the
actual web process mount namespace, as the service UID/GID. This checks the
private support path under the unit's real `ProtectSystem` view. `nsenter` and
`setpriv` must be available before installation begins. No fake support request
is posted.

Failure restores the previous web-only systemd entry by removing the exact owned
drop-in and restarting the old release. Concurrent unit, original HTML, staged
HTML or protected runtime edits are preserved and reported. Private support
records and immutable release files are retained. Keep the exact printed
`ROLLBACK_COMMAND`; its backup installer verifies the record and owned bytes.

Success is `FTI_PANEL_COMPLETION_INSTALLED_WEB_RESTARTED`; an exact verified
repeat is `FTI_PANEL_COMPLETION_ALREADY_INSTALLED`. The separate
`REAL_WALLET_REGISTRATION_NOT_TESTED` marker remains honest: local EVM and browser
checks do not establish a real user's signed mainnet transaction.

## Reproduce locally or in CI

After the normal root production build:

```sh
python3 test/panel-completion-install.test.py -q
node --test test/panel-completion-runtime.test.mjs
python3 tools/install-panel-completion.py --package . \
  --output /tmp/install-panel-completion-reproduced.py
cmp tools/install-panel-completion-release.py \
  /tmp/install-panel-completion-reproduced.py
```

A shallow checkout is supported. Reproduction and the isolated boot fixture use
the canonical bytes embedded in the committed release and independently verify
all 129 recovery pins; they do not require the old Git object or a network fetch.
Bootstrap packaging without a previous release can read the reviewed Git
revision locally.

The local runtime fixture deploys fresh local EVM proxies from an isolated,
canonical source tree, adds the new overlay without changing its manifest,
starts the real server, checks the new APIs and existing state/RPC behavior, and
confirms that altered source or proxy implementation metadata still fails.
Its generated public bundles and wallets are fixture data, not production
addresses or transactions. A separate `systemd-analyze verify` fixture confirmed
the drop-in syntax with `ProtectSystem=strict`; this executor did not run the
production systemd service or its mount namespace.

## Canonical ethers route compatibility

The original runtime serves `/vendor/ethers.js` directly from
`node_modules/ethers/dist/ethers.min.js`; it does not need a physical
`web/vendor/ethers.js`. The installer now preserves that optional file
when present and records its absence when missing. The actual Node package
and immutable UI copy must both match the reviewed ethers SHA-256 from
`config/mainnet-ui-release.json`, and both HTTP routes are verified.

Regression fixtures use the real absent-copy layout through preflight, install,
repeat and rollback. Extra checks cover optional-copy preservation, SDK mutation,
symlink rejection and unexpected absolute paths. The canonical cold-start test
removes the generated copy and verifies the actual server route.
