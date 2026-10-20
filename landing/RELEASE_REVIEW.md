# Landing release review — 15 October 2026 UTC

Scope: PR #39, inspected from `1e75e9851d40dea43f7a161249b1a68fab52d40e`; retains the concurrent responsive fixes from `03b33f69cf69da9154a12d1f76a41ff10bd412a9`. No smart contracts, economics, backend routes or server configuration changed.

## Confirmed findings and fixes

| Finding | Resolution / evidence |
| --- | --- |
| Live root blank; browser reports `Cannot read properties of null (reading 'useState')` in `app.js?v=20261015-landing2` | New isolated React 19 bundle mounts without page/console errors in Chromium. Live domain still serves the old entry; no server install claimed. |
| Existing CSP disallows Google Fonts stylesheet/font origins | Bundle Manrope and Vazirmatn locally with hashed filenames. Browser tests use the production-style CSP and report no blocked requests. |
| 320px grid content and 768px orbit overflow | Shrinkable tracks/content and scoped illustration clipping. FA/EN x dark/light x 4 widths pass no-horizontal-overflow and visible-content-boundary checks. |
| Directory move left a missing-docroot interval | Linux atomic directory exchange; concurrent reader test sees only old or new content across 100 exchanges. |
| HTTP 200 alone did not establish correct static assets | Verify status 200, exact bytes and MIME for HTML, JS, CSS and fonts; SHA-256 manifest validates the staged build. Wrong-body, wrong-MIME, 404 and redirect responses trigger rollback. |
| Concurrent installs and interrupts lacked protection | Parent flock; INT/TERM/HUP rollback; actual CLI SIGTERM test restores old content. Unsupported exchange, invalid source, symlinks, Nginx failure and overlap fail safely. |
| Building from the known live checkout deletes live dist before backup | Reject that known live build location; installer rejects overlapping source/target; document isolated checkout procedure. |

## Executed checks

- `npm run build --prefix landing`: PASS, one React runtime and hashed bundled outputs.
- `FTI_CHROMIUM_PATH=/tmp/chromium npm test --prefix landing`: **18 PASS**. Headless Chromium obtained from the registry-distributed `@sparticuz/chromium` package after the standard Playwright browser download failed in this environment. Tests use real rendering and DOM interaction, not JSDOM.
- `npm run test:install --prefix landing`: **15 PASS** on Linux with actual temporary filesystem exchanges and local HTTP/curl verification; Nginx preflight is simulated. This does not validate the production Nginx setup.
- `bash -n landing/install-dist.sh`, `git diff --check`: PASS.
- Production dependency audit: 0 reported vulnerabilities.
- Visually inspected full-page screenshots: 390px Persian/light, 320px Persian/dark, 1440px English/dark. Automated captures cover all 16 width/language/theme combinations. No real Android/iOS device testing was performed.
- Live browser observed root blank and its React exception. `/app/` and `/token/` render their existing workspaces. Council root redirects to `/admin/`, which renders. These are page-load checks; wallet operations, RPC health, balances and transactions were not tested.

## Release gates still open

1. Review/merge this landing-only PR after CI passes. CI workflow now builds, exercises installer failure recovery and runs Playwright; its result must be checked on the final remote commit.
2. Build in an isolated checkout and run the installer on the actual FTI server. No FTI server execution capability was used in this review; production filesystem, release SHA and installation are not verified.
3. Check the public domain in a fresh desktop/mobile browser after installation: new hashed assets, no React/console/resource errors, Persian RTL, themes and links. Local HTTP success alone does not close this gate.
4. Keep the printed backup. See README for rollback and limitations around hard kills/power loss/filesystem failure.

Status: locally verified candidate, **not confirmed deployed or launched**. PR remains Draft pending release verification.
