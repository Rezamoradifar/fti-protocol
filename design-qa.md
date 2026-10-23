# Member reserve panel design QA

final result: passed

The user selected the reserve-flow style and clarified that the target was the
member account panel. The accepted target is the revised member dashboard,
not the earlier public landing concept. This review covers visual and manual
interaction acceptance; final automated CI evidence is recorded in PR #45.

## Evidence and normalization

- Source visual truth: `docs/design/member-reserve/approved-mobile.jpg`, from
  the selected generated member-panel design (original 853 × 1844 pixels).
- Implementation: `docs/design/member-reserve/mobile-dark.jpg` and
  `mobile-light.jpg`; desktop: `desktop-dark.jpg`.
- Full comparison: `docs/design/member-reserve/comparison.jpg` (source left,
  implementation right). Focused balance/art/action comparison:
  `balance-comparison.jpg`, with each crop taken from its own actual region.
- Mobile CSS viewport: 390 × 844, density 1. The browser's 405-pixel iframe has
  a 15-pixel classic RTL scrollbar, leaving 390 CSS pixels. The complete
  1363 × 936 browser capture was cropped to the content, without the scrollbar
  or surrounding canvas. The source is scaled proportionally to width 390 and
  padded by its one-pixel rounding difference to a 390 × 844 comparison frame.
- State: Persian, disconnected wallet, dark appearance, overview, read-only
  captured testnet preview. The 20-pixel preview banner, chain 97 and older
  captured network data explicitly identify this as a preview. No real account
  balances or financial results are asserted. Empty balances remain `—`.
- Final manual preview additionally used the exact installed shared identity
  stylesheet, SHA-256
  `12f294040117dd35e4e2c0d30b4e1f08e8da9727487b6a96458d089e5c95fece`.
  New browser cases load that fixture; the existing identity matrix separately
  covers freshly built shared styles.

## Findings and fixes

- Resolved P1: the RTL settings sheet originally extended beyond the left
  edge. Setting the sheet's text direction and anchoring mobile sheets to the
  header fixes both directions. Closed sheets now have no layout boxes.
  Post-fix 320-pixel evidence: `mobile-settings-320.jpg`; the measured sheet
  bounds are x31–319 in the classic-scrollbar viewport, with 320 content pixels.
  Language, appearance and refresh controls remain reachable.
- Resolved P2: the first balance card was about 458 pixels tall, placing both
  the trade action and membership summary too far down. The empty-wallet view
  now omits redundant balance explanations and disabled duplicate actions,
  retains their mounted controller hooks, and uses a 128-pixel mobile artwork
  region. Connected wallets reveal the original actionable account controls.
  The trade action is fully visible in the final initial viewport.
- Resolved clipping uncertainty: the membership card begins below the first
  viewport's main balance/action region. A natural scroll exposes the entire
  card and network action above the fixed dock, as shown in
  `mobile-membership-scroll.jpg`. Measured card y390.23–653.53 and network
  action y588.53–632.53 are above dock y758–832. They are not trapped behind it.

The initial final Chromium manual review had no remaining P0/P1/P2 usability findings. The additional vertical
scroll compared with the mock is intentional: the real controller's read
status, data freshness, rank progression and 44-pixel network disclosure are
retained. This is an adaptation of the selected style to the existing product,
not a claim that every viewport has identical pixel placement to the mock.

## Mobile WebKit follow-up

The dedicated WebKit run exposed two additional interaction findings after the
Chromium manual review: the native settings disclosure opened but its language
select did not render, and native focus scrolling left the membership input
behind the fixed bottom dock. The settings language row/select now have explicit
layout dimensions. The member viewport guard keeps the active form field above
the measured dock and virtual keyboard after native focus/resize settles; root
scroll padding also reserves dock space. This affects presentation only. The
same browser assertions remain in place, with polling for settled focus geometry.
Final cross-engine results are recorded in PR #45.

## Required fidelity surfaces

- Fonts/typography: existing local FTI Vazirmatn and Manrope are preserved;
  Persian RTL wrapping, clear value hierarchy and tabular amounts were checked.
  Latin headings retain the product's existing Orbitron style. No rasterized
  interface text or financial data is used.
- Spacing/layout: grouped balances, secondary trade action, membership summary
  and four-tab dock match the selected hierarchy. Mobile settings, 44-pixel
  controls, safe-area bottom spacing, full-card scrolling and desktop sidebar
  were checked. Operational text creates documented extra vertical content.
- Colors/tokens: obsidian/forest surfaces, lime actions and warm white text use
  the current product palette. Existing accessible green/light tokens remain
  active in day mode; the dark illustration remains an intentional artwork
  window inside the light balance surface.
- Images: the local 1200 × 500 WebP is 50,598 bytes and follows the selected
  FTI-medallion/USDT-vessel stream composition. It is a real generated raster
  asset. The supplied brand mark and established product icons are reused.
  No placeholder art or invented financial graphic replaces the target.
- Copy/content: the actual wallet, collateral, claimable reward and membership
  fields remain bound to their existing IDs. Collateral is named generically
  because the controller identifies the selected collateral. The illustration
  has an educational caption for assistive technology and implies no automatic
  token purchase when membership units are purchased.

## Manual browser interactions and console

Verified in the cloud browser: all four member navigation tabs and page titles;
settings open/close and bounds; day/night switching; pause of the decorative
motion, paused CSS state and persistence after reload; wallet chooser open and
cancel; membership form availability; and scrolling the full membership action
above the dock. No wallet authorization or transaction was sent. Desktop and
mobile rendered with the installed shared stylesheet.

No application JavaScript error was observed. The browser logged one unrelated
extension metadata error from its own `chrome-extension://` content script.
Automated tests separately cover unavailable-data states, real controller
snapshot rendering, disconnect clearing, reduced motion and broader languages.

## Follow-up polish

- P3: feather the illustration's horizontal background edges more closely to
  the surrounding glass surface.
- P3: increase the optical size of the existing theme glyph.
- P3: a later compact rank summary could reduce the first screen's scroll.

## Implementation checklist

- [x] Inspect the selected panel target and the live existing member surface.
- [x] Use the real artwork and preserve all controller/transaction hooks.
- [x] Compare normalized full-view and focused visual evidence together.
- [x] Fix actionable layout/settings findings and capture their corrected states.
- [x] Check mobile/desktop, day/night and the primary account interactions.
- [x] Keep production installation separate from preview and CI verification.
