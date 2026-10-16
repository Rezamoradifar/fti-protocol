# FTI landing — React redesign

Standalone React 19 landing. English/Persian RTL, dark/light themes, responsive navigation, token tabs and FAQ. Fonts and hashed JS/CSS are bundled locally for the existing CSP. No wallet transactions, contracts or economic rules are changed.

## Build and test

Use Node.js 22+, Python 3.10+, and a Linux host for installer tests:

```sh
npm ci --prefix landing
npm run build --prefix landing
npm run test:install --prefix landing # root required only for CLI/lock integration test
cd landing
npx playwright install --with-deps chromium
npm test
```

Browser tests cover 320/390/768/1440px, FA/EN, dark/light, JavaScript/console errors, failed resources, fonts under production CSP, horizontal overflow, anchor targets, mobile menu/Escape, tabs, FAQ and preference persistence. PNGs are written to `landing/test-results`. The static test server intentionally returns 404 for `/app/` and `/token/`: those separate workspaces are **not** included in the landing build. The tests check link destinations and same-page navigation; test workspace availability separately on production.

`FTI_CHROMIUM_PATH` can point tests at an installed Chromium. CI installs standard Playwright Chromium. `FTI_TEST_ORIGIN` can run these tests against a separate staging origin instead of starting the local server. Tests change local browser preferences only and do not sign wallet transactions.

## Safe server installation

**Build in a separate checkout/release directory, never in `/opt/fti-protocol/landing`.** That directory contains the active docroot; building there would delete live files before an installer could back them up. The build rejects this known live location; the installer rejects source/target overlap. Do not use `scripts/update-unified-site.sh` for this landing-only release.

From a verified, built checkout outside the live directory:

```sh
sudo bash landing/install-dist.sh
```

Prerequisites: Linux `renameat2(RENAME_EXCHANGE)` support, Python 3.10+, `curl`, a working TLS certificate, and `nginx -t`. Defaults are the existing `/opt/fti-protocol/landing/dist` docroot and `https://ftiprotocol.com`, resolved directly to `127.0.0.1`. No service restart, configuration edit or contract deployment is performed. No private keys are needed.

The installer:

- Locks the docroot's parent against concurrent installations.
- Validates a build-generated SHA-256 `release.json`, HTML references and absence of symlinks.
- Stages on the same filesystem, sets public read permissions and retains previous immutable assets. Conflicting same-name asset contents fail closed.
- Atomically exchanges the complete directories; requests never see a missing docroot. The old directory remains intact for rollback.
- Checks exact HTTP response bytes and MIME types for HTML, JS, CSS and fonts. Redirects, TLS failures, HTML fallbacks and incorrect bytes fail verification. Proxy environment variables are bypassed for these local checks; TLS verification remains enabled.
- Restores the previous directory on errors or handled INT/TERM/HUP. A failed first install removes the candidate. Failed candidates are retained as `dist.failed.*` for inspection. Success retains `dist.backup.*`; nothing prunes backups automatically.

For an isolated staging server, `--source PATH --target PATH --origin http://127.0.0.1:PORT --resolve ''` overrides the defaults. The target must be a real directory, not a symlink. Unsupported atomic exchange fails before moving the live directory. SIGKILL, power loss, a failed filesystem or interference from another deployment tool cannot be handled by a process trap: keep the reported backup and inspect the directory state before recovery. Coordinate other deployment tooling separately; only this installer honors its lock.

For manual rollback, replace the backup path below with the **exact** successful install output. Stop other deployments first. This atomically swaps the previous directory back and retains the current candidate at the backup path:

```sh
sudo python3 - /opt/fti-protocol/landing/dist /opt/fti-protocol/landing/dist.backup.EXACT_ID <<'PY'
import ctypes, os, sys
live, backup = sys.argv[1:]
assert os.path.isdir(live) and os.path.isdir(backup)
assert not os.path.islink(live) and not os.path.islink(backup)
libc = ctypes.CDLL(None, use_errno=True)
if libc.renameat2(-100, os.fsencode(live), -100, os.fsencode(backup), 2):
    raise OSError(ctypes.get_errno(), 'Atomic rollback failed')
PY
```

After install or rollback, independently check the public domain in a fresh browser, including mobile, Persian/RTL, both themes, navigation and resource errors. Confirm `/app/`, `/token/`, and the council link reach their existing workspaces. Compare the served assets to this build. **An installer success is local HTTP verification, not proof that the public site has launched.**

Default member link: `/app/`; build-time `FTI_APP_URL` overrides it. Token link: `/token/`; council: `https://council.ftiprotocol.com/`. Telegram/X: `FTIProtocol`; email: `Support@FTIProtocol.com`.
