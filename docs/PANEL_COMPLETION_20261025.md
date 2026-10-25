# FTI panel completion — 25 October 2026

This change completes the existing professional member panel and resolves the
specific registration-fixture, translation and production dependency failures
observed on revision `d5865550d25ecc68cc512d5bbd8e0ac8aae74d83`.

## Changes and boundaries

| Area | Result |
| --- | --- |
| Registration checks | Fixed local EVM time and deterministic block increments. An explicit regression verifies rejection at the hourly boundary without debiting funds, followed by successful registration after settlement. Production contracts and economic rules are unchanged. |
| Translations | Existing shared translations remain canonical; member-only copy is additive. Turkish wallet and Chinese membership labels again pass the original checks. New support/history copy has 64 additional keys each in Arabic, Turkish and Simplified Chinese, alongside inline Persian and English. Existing Russian/Spanish partial-translation notices remain. |
| WalletConnect | Direct pinned official UniversalProvider transport and a first-party QR/mobile screen replace the AppKit/Coinbase/Zod tree. No advisory suppression or incompatible major-version override is used. |
| Support | Private durable tickets, full references, member/team replies, status, pagination and new-reply badges. Admin operations require a fresh successful council role read. Email-draft support remains available. |
| Personal history | Explicitly requested, bounded pages of installed FTI contract address events back to deployment. Canonical receipts, snapshot-bound cursors, progress and exact CSV export of loaded verified records. This excludes unrelated assets, native BNB transfers and internal calls. |
| Administration | Guardian terminology and the five-of-seven approval requirement are displayed clearly. Permissionless settlement remains permissionless. |

Support access uses an explicit EIP-191 message signature, never a financial
transaction or token allowance. Single-use challenges expire after five minutes
and bind the wallet, origin, chain and binary contract. Thirty-minute bearer
sessions remain only in memory and are cleared on wallet/role changes. Every
ticket read enforces ownership or fresh council authority. EIP-1271 contract
wallet authentication is not implemented; unsupported signatures fail closed.
Support records contain user-submitted text and must be included in the
operator's private server backup policy. The installer retains them on rollback.

History reads pin a canonical snapshot with twelve confirmations on BNB mainnet.
Each page covers at most 1,000 blocks and returns at most 50 verified events.
Failures retain earlier verified pages. An empty page continues toward the
verified deployment boundary instead of declaring that the wallet has no history.
CSV exports quote untrusted values and neutralize spreadsheet formula prefixes.

The new member and administrator features are capability-gated by
`supportTicketVersion: 1` and `memberHistoryVersion: 1`. An old server keeps the
new API controls hidden instead of claiming unsupported capabilities.

## Verification evidence

- Registration/genesis checks: 9 passed, including the hourly-boundary regression.
- Mainnet governance checks: 4 passed.
- Shared/member/completion localization checks: 55 passed.
- Wallet transport/discovery/session/network checks: 45 passed; an independent
  adapter/discovery/SafePal/prepared-send selection passed 56 checks after review.
- Fresh production dependency audit: zero vulnerabilities. Physical production
  inventory: 138 package paths, zero findings. Development-only Ganache findings
  are excluded from this production claim.
- Support authentication, durability and isolated UI checks: 13 passed.
- Personal history checks: 19 passed, including actual local EVM logs/receipts.
- HTTP integration checks enforce origins, private ownership, failed-role-read
  rejection and read-only history input validation.
- Seven new Chromium completion cases cover member tickets, guardian replies,
  history/CSV and FA/EN mobile dark/light layouts using the installed shared CSS.
- Six Chromium pairing cases cover QR rendering, official app links, clipboard,
  focus/cancellation and QR-failure recovery.
- Frozen-runtime cold start passes original deployment and on-chain verification
  against real disposable local proxies. Source/implementation corruption remains
  rejected. No deployed release check is bypassed to enable the new API.

Final full-suite, installer, immutable package reproduction and remote CI results
are recorded with the published release. Screenshots and wallet signatures in UI
tests use clearly labeled synthetic fixtures. No real user wallet signature,
mainnet registration, purchase, sale or payout was performed in this session.

## Installation

`tools/install-panel-completion.py` packages the final build into the
self-contained `tools/install-panel-completion-release.py`. Run without `--apply`
for read-only preflight. The release command must use an immutable published Git
revision and verify its exact SHA-256 before execution.

The release preserves the current contracts, deployed source identity, RPC
settings, environment, keeper, existing users and original runtime for rollback.
It stages a separate web release with the reviewed original source files and
existing public assets/artifacts. The original fingerprint must match before
cutover. The browser application and patched wallet SDK use immutable paths;
new backend modules live outside the fingerprinted source directories. Cold
start still performs the original deployment/build and on-chain checks.

The existing server dependency tree is reused. No npm operation is performed on
the VPS. The production audit above describes the new source dependency graph;
the immutable browser SDK contains the repaired WalletConnect graph. It is not
an inventory assertion about historical packages retained in the previous
runtime for rollback.

Only the web service gets a dedicated working-directory/entrypoint override.
Cutover requires a restart and bounded health/configuration/API checks. The
printed `ROLLBACK_COMMAND` removes only the owned override and restores the
previous web runtime. Private support records remain outside both releases.
