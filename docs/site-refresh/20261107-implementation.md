# FTI website and customer-services refresh

Prepared on 7 November 2026 (Asia/Tehran) from
`fix/panel-completion-20261025` at
`6f957513e3468061d5f30907d6acfef7773eec96`.

## Delivered behavior

The homepage has a quieter light default, the existing FTI mark, a static token
illustration and four prominent destinations: membership, token tools, support
and VPN. Saved dark-mode and language choices remain supported. First visits
default to English; Persian is last in the seven-language menu. Query language,
referral parameters and route fragments survive language changes.

Live contract readers load when the visitor approaches the data section. A
failure in that optional module leaves the rest of the homepage usable and
offers a reload action. Full translation catalogs are deferred for the initial
English visit. The member workspace has larger task navigation, avoids repeated
history rendering and suspends chart reads when hidden or outside the viewport.

The support launcher is available on the homepage, documents and workspace.
The full support UI and API calls begin on click. Dedicated `/support/` and
`/vpn/` pages expose the same reviewed guidance and consent-based contact form.
Customer requests are durable, deduplicated and withdrawable; guardians can
review them through the existing signed support session. See
[`../CUSTOMER-SERVICES.md`](../CUSTOMER-SERVICES.md) for the privacy, authentication
and optional provider boundaries.

The default assistant is a guided support and conversion flow. Its optional AI
adapter routes questions into approved help topics; it does not operate wallets,
invent quotations, send outbound campaigns or replace a staffed support team.
No live AI key or external messaging account was configured during this work.
VPN ordering remains unavailable until the real NodeShield provider passes the
documented payment-to-delivery acceptance checks and its live health check.

## Measured asset change

The previous live English entry was fetched from `https://ftiprotocol.com/`.
Its JavaScript asset was `main-M5KASVMF.js`, and its CSS asset was
`main-R2WIXQ4T.css`. The fetched responses did not expose `Content-Encoding` or
`Cache-Control` even when Brotli/Gzip was requested.

| Initial homepage asset | Previous live response | New local build |
| --- | ---: | ---: |
| JavaScript, uncompressed | 940,161 bytes | 261,956 bytes |
| JavaScript, Gzip | Not served in the observed response | 78,820 bytes |
| Main styles plus support launcher | 153,929 bytes | 42,554 bytes |

The new JavaScript total includes all static imports and the launcher: eight
modules. It excludes click/scroll-loaded modules, fonts and the externalized
95,793-byte original brand image. The source image was embedded in the previous
bundle. Raw initial JavaScript falls by about 72%; raw styles fall by about 72%.
These are build payload comparisons, not a measured production load-time or
Core Web Vitals improvement. The deployment must still be installed and the
public compression/cache headers checked. Machine-readable totals are in
[`20261107-build-performance.json`](20261107-build-performance.json).

## Validation

Both `npm run build:web` and `npm run build` in `landing/` succeeded after the
final launcher and light-theme contrast corrections. The latter verifies one
React runtime, split assets, local asset hashes, compression variants and six
public routes.

In-memory rendering also verified all seven homepage languages and exercised the
actual support launcher with a stubbed service boundary, without launching a
browser. Those checks establish markup and event behavior, not pixel layout.

The following focused run passed **77 tests**:

```bash
node --test test/global-frontend.test.mjs test/complete-translations.test.mjs \
  test/member-activity.test.mjs test/site-routing.test.mjs \
  test/landing-bootstrap.test.mjs test/token-price-data.test.mjs \
  test/hourly-pool-data.test.mjs test/support-ticket-ui.test.mjs
```

The customer-services, signed support and static-response checks also passed.
They exercise real local HTTP requests and synthetic temporary records, including
consent, persistence, idempotency, withdrawal, expiry, origin validation, guardian
revocation, stale-session isolation, literal rendering, optional AI consent and
VPN readiness. They do not create production leads, external messages, payments,
VPN orders or blockchain transactions. Installer validation and packaging are
documented in [`../SITE_REFRESH_INSTALL_20261107.md`](../SITE_REFRESH_INSTALL_20261107.md).

Browser scenarios exist for mobile/desktop layout, RTL, navigation, deferred data,
optional-chunk failure and contact forms. In this environment Chromium failed
before opening a page with `socket() failed: Operation not permitted`; the cloud
browser could not reach the isolated localhost server either. These scenarios
are **not counted as passing**, and no screenshot of the refreshed design is
presented as a verified render. The non-browser payload-budget assertion passed.

## External credibility work

Official Sourcify responses confirm exact creation/runtime source matches for
six deployment addresses. This is source verification, not an independent
security audit. The external submission and news packet is in
[`../external-readiness/20261107-readiness.md`](../external-readiness/20261107-readiness.md)
and [`../external-readiness/20261107-submission-drafts.md`](../external-readiness/20261107-submission-drafts.md).

The official CoinMarketCap add-cryptoasset form was opened and public project
facts were entered. It was **not submitted**. Representative identity, official
contact control, launch date, supply reconciliation and the requested public logo
asset still require confirmation; no agreement, Priority purchase or advertising
order was accepted. The screenshot
[`20261107-cmc-form-draft.png`](20261107-cmc-form-draft.png) records the unsent
draft, not a receipt or listing approval.

CMC Community publishing, CMC-integrated news and a tracked market listing have
different requirements. No editorial coverage, audit badge, exchange listing or
third-party endorsement is claimed by the new interface or this release.

## Deployment state

This release is prepared for the existing FTI VPS. It has **not** been installed
on `ftiprotocol.com` from the development workspace. The verified live financial
identity remains chain 56, source revision
`ba82373a83d63fba0643332371cfb6d62903c849` and token
`0x43755B1E813b2d41F669ea08bcf859De07195eA1`.

Use the immutable, checksum-verified installer described in the installation
guide. Successful Git publication or a completed local build does not establish
production deployment, successful mainnet buying/selling or VPN delivery.
