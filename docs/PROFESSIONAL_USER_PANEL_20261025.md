# Professional member panel — 2026-10-25

This release updates the existing FTI member workspace. Its application and
member-only stylesheet contain the account overview, membership/network tools,
rewards, activity and support interface. The existing FTI reserve illustration,
fonts and logo remain in use. Amounts and membership status come from existing
read paths; decorative artwork is not a balance or return forecast.

## Installation boundary

`tools/install-professional-user-panel.py` packages the reviewed build into a
self-contained installer. Installation publishes immutable application, referral
entry, member stylesheet and WebP files, then atomically changes only
`web/index.html`. It requires no build, npm install or service restart on the VPS.

The existing referral context runs before the application. Existing bootstrap
guard scripts and fallback HTML/CSS are preserved byte-for-byte when present.
The reviewed official-channel overlay is also preserved when installed, at
`/fti-official-channel-626c532ec31a4fd0280d9208/official-channel.js`; its pinned
bytes are checked locally and over HTTP rather than accepting arbitrary extra
scripts.
The browser SDK, shared stylesheets, landing page, server and optional history
reader/keeper source remain protected. Environment files and user databases are
not installer inputs and are never modified. Contracts, chain addresses, RPC
settings, deployed source fingerprints and service configuration are unchanged.

Two exact reviewed predecessors are accepted:

| Predecessor | Required module entry | Required application SHA-256 |
| --- | --- | --- |
| Member reserve panel | `/fti-member-reserve-9c9273e8a6637861d8b3/entry.js` | `26a077538e86dc33fc5b7f9ca719730ef95c0df41203188747dd401681fb8835` |
| Panel reliability | `/fti-panel-reliability-ebf8b5f2b9ef1814db51/entry.js` | `000f3cdac0d81f9d3e3f63adb97dca1e9b8ce1ab3cf7a54dfb5c05ae9b835b10` |

The installer also verifies each predecessor's exact theme/art, the optional
bootstrap guard and fallback fragments, original immutable base application,
vendor imports, referral blob, canonical mainnet configuration, active release
directory and `fti-continuity-web.service` identity. Unknown or mixed versions
fail before the HTML switch. A read-only browser inspection on 25 October 2026
confirmed the live reliability entry, shared stylesheet paths, boot guard and
official-channel overlay. The public configuration matched every pinned mainnet
address and source fingerprint. This new package has not been installed on the
production VPS by this session.

## User experience

| Area | Delivered behavior |
| --- | --- |
| Overview | Wallet balances, membership, weaker lifetime volume, verified current point cap and pending auto-buy, with no invented income figures |
| Network | Branch volumes, carried units, personal invitation copy and the existing searchable binary tree |
| Membership | Existing inviter retention, balance/approval checks and pending-request recovery remain connected to the real transaction flow |
| Rewards | Claimable rewards, capability-checked auto-buy preferences and pending-fund actions; batch processing remains under expandable settlement tools |
| Activity | Readable recent protocol events, exact-address wallet filter and text search; this bounded view is not complete wallet history |
| Help | User video, whitepaper, official announcements, FAQs and a support email draft prepared for the user's email application |
| Freshness | Identity-isolated snapshots expire after 120 seconds, recheck on visibility changes and preserve retained values with an explicit stale state |
| Layout | Five-item mobile dock, RTL/LTR, dark/light styles, existing fonts/artwork and exact rotating site emblem |

New copy is available in Persian and English, with 135 additional keys each in
Arabic, Turkish and Simplified Chinese. Existing language controls remain in
place. Support drafts are not a new server-side ticket service and require the
user to send the email from their email application.

The screenshots in `design/professional-panel/` are actual browser captures of
the new build using the exact deployed shared styles. Their visible test-data
banner distinguishes synthetic UI test balances from production wallet data.

## Build and package

From the final reviewed source checkout, install the root and landing
dependencies and build the workspace:

```sh
npm ci --ignore-scripts
npm ci --prefix landing --ignore-scripts
npm run build:web
python3 tools/install-professional-user-panel.py \
  --package . --output /tmp/install-professional-user-panel-release.py
```

Packaging consumes `web/app.js`, its unchanged legal notice,
`web/member-reserve-panel.css` and that stylesheet's one local WebP. It validates
the required member-panel controls, rewrites the image URL to its flat immutable
installation name and embeds each asset with a SHA-256 digest. Existing boot
scripts and fallback HTML are not repackaged. No installation-time asset download
is needed. Rebuilding with identical inputs must reproduce identical installer
bytes.

## Packaged release

`tools/install-professional-user-panel-release.py` is 581,610 bytes. Its decoded
application and artwork match the final build exactly; its stylesheet matches
the final build with only the local artwork URL rewritten for immutable
installation. A second independent package run and `cmp` reproduced the exact
installer bytes. Python compilation of both template and package passes.

| Artifact | SHA-256 |
| --- | --- |
| Installer | `1a96f3223ed3255334dc5d5d1c2ae1e9e3855a04ebb00c9e1aedbe75866781c6` |
| Application | `7837237848d2e527a05eca098a7f819c597b438f70b3a2fbb0c040ff9415e45d` |
| Packaged stylesheet | `4f2eb86ee5257736d127d9c8dbaf6bbfe459761062b6d71e1e288b58db55e380` |
| Existing illustration | `27f8968f3353a95e51b14df74943bfd723909a408043eff0a305cdb6892e705d` |

Publish this packaged installer at an immutable Git commit before preparing the
operator download command. On the existing FTI VPS, download it from that
reviewed revision to `$fti_panel_fix`, verify the checksum, then run it as root:

```sh
printf '%s  %s\n' \
  '1a96f3223ed3255334dc5d5d1c2ae1e9e3855a04ebb00c9e1aedbe75866781c6' \
  "$fti_panel_fix" | sha256sum --check -
python3 "$fti_panel_fix"
python3 "$fti_panel_fix" --apply
```

The first invocation is read-only preflight. The application verifies new asset
bytes and MIME types through both local origin and public HTTPS before switching
HTML, then rechecks all three panel routes, configuration, service identity and
protected runtime hashes. It does not call `/api/events` or submit blockchain
transactions. Explicit `0755` public directories and `0644` assets work even
under a root shell's private `umask 0077`.

Success prints `FTI_PROFESSIONAL_USER_PANEL_INSTALLED_NO_RESTART`. A verified
repeat prints `FTI_PROFESSIONAL_USER_PANEL_ALREADY_INSTALLED` without another
HTML switch or backup.

## Backup and rollback

Private backups are stored under
`/var/backups/fti-professional-user-panel/install-*`, with `0700` directory and
`0600` backup files. Retain the exact `ROLLBACK_COMMAND` printed by the installer.
That command checks the active release and current/backup HTML hashes before
restoring only the previous HTML.

Failed post-switch verification restores the previous HTML automatically if the
installer still owns the change. A concurrent operator edit is preserved rather
than overwritten. Interrupted asset publication leaves no partial immutable
filename. Previously served versions remain available for rollback.

## Verification status and limits

- Focused Node unit checks: 148 passed.
- Chromium: 57 cases passed, comprising 41 existing cases and 16 new
  professional-panel cases. These are browser checks with controlled fixtures,
  not signed mainnet transactions.
- WebKit: pending CI; no WebKit completion is claimed.

The focused installer suite currently runs 41 tests: 39 pass locally; ownership
and unprivileged-service HTTP fixtures skip because this executor cannot change
file owner or service UID/GID. Root CI must run:

```sh
sudo env PYTHONDONTWRITEBYTECODE=1 FTI_REQUIRE_SERVICE_UID_HTTP_TEST=1 \
  python3 test/professional-user-panel-install.test.py -q
```

Checks cover both predecessor variants, bootstrap preservation, payload hashes,
fixed artwork, CSS resource boundaries, MIME checks, private/public permissions,
partial-write safety, unchanged environment/database fixtures, atomic rollback,
concurrent edits, idempotence and committed predecessor-package pins.

Root CI results and the immutable published release revision must be recorded
after publication. No live install, wallet signature, mainnet membership
purchase or financial transaction is established by these checks.
`REAL_WALLET_REGISTRATION_NOT_TESTED` records that separate acceptance limit;
it is not an installation error.
