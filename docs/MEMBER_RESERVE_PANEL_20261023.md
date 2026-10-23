# Member reserve panel — 23 October 2026

The member workspace uses the approved dark glass design with a restrained
FTI/USDT reserve illustration, grouped balances and mobile bottom navigation.
Existing membership, rewards, activity and wallet controls remain connected to
their existing handlers. The illustration is decorative; it is not a transfer,
balance, return forecast or indication that buying membership buys FTI.

Review: [PR #45](https://github.com/Rezamoradifar/fti-protocol/pull/45).
The reviewed commit and its exact immutable download command are recorded in the PR description. The packaged payload is identified by the digests below.

## Install on the existing FTI VPS

Run this block as root on the existing production VPS. The installer requires
the verified registration-recovery installation: entry
`/fti-registration-recovery-ff3a049443fc8e64b07e/entry.js` and application SHA-256
`74010d2c0b831cecf9c61213b0453e35f0270107ccb20df9ff5f5cef623809f5`.
It checks those bytes, the original immutable bundle, referral bootstrap,
deployment identity, service identity and public/origin HTTP responses before
changing HTML. A different installation is rejected rather than overwritten.

Use the commit-pinned command in the PR description. It downloads the packaged
installer, verifies its SHA-256, runs read-only preflight, then invokes `--apply`.
Do not substitute the branch tip or an unverified remote script.

The first Python invocation performs read-only preflight. `--apply` publishes
immutable JS, CSS and WebP files, verifies their bytes and MIME types, then
atomically switches only `web/index.html`. The entry module runs the installed
referral context before the application; pending-request recovery remains in
the application. No build, dependency installation or service restart occurs.

Private backups are written under `/var/backups/fti-member-reserve-panel/`.
The installer prints the exact `ROLLBACK_COMMAND` for its backup; retain that
line. Post-switch verification failure automatically restores the prior HTML
when it still owns the change, while preserving concurrent operator edits.
Repeating the same installation verifies its existing assets without another
HTML switch or backup.

Successful installation ends with
`FTI_MEMBER_RESERVE_PANEL_INSTALLED_NO_RESTART`; an unchanged verified repeat
reports `FTI_MEMBER_RESERVE_PANEL_ALREADY_INSTALLED`.

## Packaged SHA-256 digests

| Artifact | SHA-256 |
| --- | --- |
| Installer | `4c38d3d9ed38f386a7d79c3315caef734aa09e62750cfae6e82b3631aa8788ff` |
| Application | `ffd767350eed3b147a87e3d0830cdf9862d347a2fb8e4b490f21d8390978d414` |
| Packaged stylesheet | `1d670f8b0bbd177367896e4f2f3f1e0f4ec4d74c42e0872b5be2f821fe05f023` |
| Illustration | `27f8968f3353a95e51b14df74943bfd723909a408043eff0a305cdb6892e705d` |

The packaged stylesheet uses the installer's flat immutable image URL, so its
digest differs from the locally built stylesheet that refers to `assets/`.

## Validation and limits

- Local focused Node checks: 62 passed.
- Local installer suite: 28 passed, one skipped because this executor cannot
  switch to an unprivileged service UID/GID. CI runs all 29, with no skips.
- CI service-UID HTTP readability and deterministic package reproduction:
  passed for the packaged code revision. This checks JS, CSS and WebP reads
  under the private installation umask.
- Cloud-browser manual verification passed on mobile and desktop, including
  day/night, all four member tabs, settings bounds at 320 CSS px, wallet chooser
  open/cancel, motion pause/persistence and scrolling the complete membership
  card/network action above the fixed dock. See `design-qa.md`.
- The dedicated browser matrix contains 35 cases per engine (19 new member
  interactions and 16 existing identity cases), including the exact installed
  base stylesheet (SHA-256
  `12f294040117dd35e4e2c0d30b4e1f08e8da9727487b6a96458d089e5c95fece`).
  Final Chromium/WebKit CI status and links are recorded in the PR description.
- Mobile WebKit follow-up fixes explicitly size the disclosure language control
  and keep a focused form control above the fixed dock and virtual keyboard.
- This is a UI update. The running server dependencies, contracts, RPC,
  deployment identity and keeper are unchanged by the installer.
- No real-wallet mainnet registration, purchase, reward claim or signature is
  established by these checks. `REAL_WALLET_REGISTRATION_NOT_TESTED` states
  that remaining acceptance limit; it is not an installation failure.

Neither this document nor local/CI results establish that the VPS has already
installed the new panel. Confirm the installation result and the externally
served version after the operator runs the command.

The installer does not replace the existing shared workspace stylesheets. The
new member stylesheet is loaded last and scoped to `data-surface="member"`.
A checked-in fixture and browser routing verify compatibility with the actual
installed `panel-identity.css`, rather than only a freshly rebuilt shared skin.
The mobile logo dimensions are explicit so both baselines have the same layout.
