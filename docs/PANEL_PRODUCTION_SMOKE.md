# Verify the installed FTI panel in a real browser

The `Panel production smoke` workflow reads the actual HTTPS site after an
operator installs a release. It does not replace API responses with fixtures,
connect a wallet, request accounts, sign, approve or send a transaction.

Run the workflow manually from GitHub Actions. Choose
`https://ftiprotocol.com` and supply the **application** SHA-256 printed in the
release notes, rather than the installer checksum. The browser must actually
download that application digest for workspace checks to pass. Omitting the
digest checks the currently served UI without establishing its exact release.

GitHub only exposes a newly added manually dispatched workflow after its
definition exists on the repository's default branch. Until then, run the same
test file from a development/CI checkout with Playwright browsers installed:

```bash
cd landing
FTI_PRODUCTION_SMOKE=1 \
FTI_TEST_ORIGIN=https://ftiprotocol.com \
FTI_EXPECTED_APP_SHA=APPLICATION_SHA256_FROM_RELEASE_NOTES \
npx playwright test tests/production-smoke.spec.mjs --workers=1 --retries=0
```

Set `FTI_BROWSER=webkit` for the mobile WebKit run; Chromium is the default.
Use the workflow or a test workstation for browser dependencies. The VPS
installer does not need to download or run browsers.

Five checks run per engine: the actual landing page, member navigation and
settings/language/theme, wallet chooser open/cancel, token workspace and admin
workspace. Script/stylesheet and requested WebP HTTP and MIME failures, application JavaScript
errors and CSP errors fail the check. Successful member captures and diagnostic
JSON, plus failure screenshots/traces, are retained as workflow artifacts.
Workspace readiness includes the actual public read success notice, including
after a language reload, before further controls are exercised. This prevents
the language check from cancelling an unfinished startup read; JavaScript and
CSP diagnostics remain strict.

Each case starts with a fresh browser context. An HTTP/RPC tripwire blocks
non-read requests and unknown/signing/transaction methods before forwarding;
WebSockets are blocked entirely. The wallet chooser case first rejects any
detected injected/announced wallet provider, then only opens and cancels the
chooser. It never chooses a wallet or WalletConnect transport.

Ordinary browser CI skips these five tests unless the explicit production flag
is present. The workflow has no schedule and performs no recurring monitoring.
Its source allowlist restricts browser entry and network reads to FTI HTTPS origins. Three Node
regressions exercise origin validation and the mutation tripwire.

Passing proves that the installed public pages render and these UI controls
work from the test runner. It does not establish real-wallet registration,
referral settlement, trading, rewards, balances or financial correctness.
