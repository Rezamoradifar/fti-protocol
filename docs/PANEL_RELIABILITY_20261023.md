# Panel reliability update — 2026-10-23

This incremental installer updates the existing member panel without a build or a
service restart on the VPS. It publishes immutable application, referral entry,
bootstrap guard, theme and image files, then atomically changes `web/index.html`.
It preserves the existing referral context and shared stylesheets.

The required installed member application is
`26a077538e86dc33fc5b7f9ca719730ef95c0df41203188747dd401681fb8835`, with entry
`/fti-member-reserve-9c9273e8a6637861d8b3/entry.js` and theme
`/fti-member-reserve-theme-43c907b32da4849cc469/theme.css`.
The installer checks the exact existing application, entry, theme and artwork,
the canonical mainnet configuration, the active release directory and the
`fti-continuity-web.service` identity before writing anything.

## Build and package

From the reviewed source revision:

```sh
npm ci --ignore-scripts
npm run build:web
python3 tools/install-panel-reliability.py \
  --package . --output /tmp/install-panel-reliability-release.py
```

Packaging consumes `web/app.js`, its legal notice, `web/member-reserve-panel.css`
and its one local WebP image, `web/boot-guard.js`, and the marked bootstrap style
and shell from `web/index.html`. It prints the installer and asset SHA-256 hashes.
The package embeds every new asset and does not download files while installing.
Rebuilding twice must produce identical installer bytes.

Release publication must provide a complete immutable Git commit and the exact
SHA-256 of `tools/install-panel-reliability-release.py`. Download that file to a
temporary path, verify its checksum, then run it as root on the FTI VPS:

```sh
python3 "$fti_panel_fix"
python3 "$fti_panel_fix" --apply
```

The first command performs a read-only preflight. Successful application prints
`FTI_PANEL_RELIABILITY_INSTALLED_NO_RESTART`. A repeated application verifies the
same installed assets and prints `FTI_PANEL_RELIABILITY_ALREADY_INSTALLED`.

## Verification and rollback

Before the HTML switch, the installer verifies the new asset bytes and MIME
types through both the local origin and the public HTTPS site. It checks all
three installed panel routes after the switch, confirms the public and origin
configuration still agree, and checks that protected runtime files and the
running service have not changed. Public assets receive explicit readable modes
even if the root shell uses `umask 0077`.

Backups are private under `/var/backups/fti-panel-reliability/install-*`. Each
application prints its own exact `ROLLBACK_COMMAND`; keep that line. The command
restores only the previous HTML after checking the active release and HTML
hashes. Verification failure during application restores the previous HTML
automatically, while preserving a concurrent operator edit.

`RUNTIME_READ_ONLY` reports the local server and optional history-cache file
hashes and advertised history capability fields. A `null` capability means the
running server did not advertise it. This installer does not change backend
source, release fingerprints, service configuration, chain addresses or wallets.
The history interface bounds its own read; a successful UI installation does
not prove the live backend has a matching request deadline. The installer does
not call `/api/events`, so unavailable or slow history does not block a healthy
panel deployment.

After installation, run the manual [Panel production smoke workflow](https://github.com/Rezamoradifar/fti-protocol/actions/workflows/panel-production-smoke.yml)
from the published revision. Select `https://ftiprotocol.com` and supply the
printed application SHA-256 as `expected_app_sha`. Chromium and WebKit check the
real deployed pages, API responses and wallet chooser using fresh browser
contexts. No browser installation on the VPS is needed. Download the workflow
artifacts for a failed run. There is no recurring schedule.
The workflow must be present on the repository's default branch before GitHub
shows its manual action. The [production smoke operator guide](PANEL_PRODUCTION_SMOKE.md)
also documents an explicit local CLI run from a reviewed checkout when the
workflow is still on a feature branch.

An actual wallet registration still requires the separately agreed wallet
acceptance check. Neither the installer nor the production smoke sends a
transaction or signs a message.
