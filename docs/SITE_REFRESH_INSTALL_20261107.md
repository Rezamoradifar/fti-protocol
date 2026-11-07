# Installing the 7 November FTI website refresh

`tools/install-site-refresh.py` builds a self-contained Python installer for the
refreshed public website, member interface and customer-services API. Its default
mode performs a read-only preflight. `--apply` stages a new release and restarts
only `fti-continuity-web.service`. No VPS installation was performed from the
development workspace.

## Deployment identity and boundaries

The installer accepts the existing BNB mainnet deployment only: chain 56,
token `0x43755B1E813b2d41F669ea08bcf859De07195eA1`, binary plan
`0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9`, source revision
`ba82373a83d63fba0643332371cfb6d62903c849` and its pinned source fingerprint.

It discovers the active release from systemd's effective configuration and the
running process. The service must use the existing `fti-v3` account and a release
under `/opt/fti/releases`. Unsupported wrappers, Node arguments, relative
deployment-file paths, unknown dependencies or changed source fingerprints stop
preflight with a specific error. The source checkout is never assumed to be the
live installation.

Before any write, both the public and loopback `/` and `/app/` responses must
match the exact HTML in that active release. A differing Nginx document root or
stale public document stops preflight. The installer does not edit Nginx. Matching
documents cannot by themselves prove how every proxy location is configured;
the post-start checks must also prove that the candidate documents and assets are
actually public, or the web-service switch is rolled back.

The financial source, original compiled artifacts, environment files and keeper
are retained. The original `web/app.js` and wallet bridge are part of the frozen
fingerprint and remain byte-identical. New browser files use an immutable
`/fti-site-refresh-<digest>/` path, including the workspace CSS and customer-widget
chunks. Public landing assets retain their build hashes. Earlier assets remain
available for browser tabs that were already open.

Updated server modules execute from a separate runtime folder in the staged
release. They continue to import the original operational deployment verifier.
The original verifier must pass on both the previous and staged release before
the service changes. No verifier, contract identity or expected fingerprint is
weakened to accept the new website.

## Build and package in an isolated checkout

Use the project's normal completed web and landing builds. Packaging checks the
landing manifest, all file hashes, required routes, runtime imports and compressed
asset consistency. It requires the final `customer-widget.js`, its CSS and chunks,
as well as `/support/` and `/vpn/` landing outputs.

From this repository's root, with the builds already completed:

```bash
python3 tools/install-site-refresh.py \
  --package "$PWD" \
  --output /tmp/fti-site-refresh-release.py
```

The command refuses to overwrite an existing output and prints its SHA-256 and
release identifier. Publish that exact file at an immutable Git commit. Use the
printed SHA-256 when downloading it on the VPS; do not substitute a branch URL
or an unverified installer. The generated file requires Python 3.9+ on the VPS
with its standard-library `lzma` module and reuses the service's existing Node
executable and dependencies. A bounded XZ envelope stores the complete payload;
every individual file still has its size and SHA-256 validated after decoding.
It performs
no npm installation, Git checkout or package downgrade there.

## Preflight and apply on the existing FTI VPS

After downloading and checking the exact package hash:

```bash
python3 /tmp/fti-site-refresh-release.py
python3 /tmp/fti-site-refresh-release.py --apply
```

Run as root. The first command does not create release directories, private
stores, backups or service changes. The second prints a precise rollback command
before cutover. A minimum of 400 MiB free space and 14,000 available inodes is
required; a larger byte budget is enforced when the measured stage requires it.
File count, file size, decompression and total copy size are bounded.

The update stages beside the old release and atomically publishes the completed
directory. A dedicated systemd drop-in selects the new working directory and
entrypoint. Existing unit settings and environment files are retained; only the
required private data paths are added to `ReadWritePaths`. The deployment path is
kept absolute and points to the original file.

Post-start checks compare the public and loopback financial configuration and
health, six public routes, three member routes, immutable JS/CSS bytes and MIME
types, the customer API configuration and unauthenticated support access. Both
private data directories are checked in the actual service mount namespace with
short-lived probe files. These checks do not sign a wallet request, submit a
financial transaction, create a customer lead or enable an external AI/VPN
provider.

The successful result also reports the actual public response encoding,
`Cache-Control` and `Vary: Accept-Encoding` observations for one workspace and one
landing asset. Compressed response bytes must decode to the expected asset. If a
proxy strips cache or compression headers, the report records that absence; the
existence of compressed build files alone is not reported as live compression.

An HTTP failure, import failure or source-verification failure triggers automatic
rollback when cutover has occurred. A successful result is printed only after
the checks pass. Browser/mobile-wallet acceptance and real external provider
delivery remain separate checks.

## Private data and optional providers

Existing support data is retained at its configured `FTI_SUPPORT_DATA_DIR`, with
the established default under `/var/lib/fti-support/`. Customer data uses
`FTI_CUSTOMER_DATA_DIR`, defaulting to:

```text
/var/lib/fti-customer-services/56-0x13ac3af4fe3e72dccffd52ab67e4d884b6d97df9
```

The application directories are private (`0700`) and owned by the service account.
They are not copied into any public tree and are not removed on rollback. Include
them in the operator's normal private backup policy. A configured custom location
must meet the installer's path and permission checks before applying.

The installer does not add API keys, choose an AI model, activate NodeShield,
enable provider charging or alter existing provider settings. Follow
[`CUSTOMER-SERVICES.md`](CUSTOMER-SERVICES.md) for genuine provider configuration
and acceptance evidence.

For accurate per-client rate limits behind Nginx, first verify that the actual API
proxy overwrites the client-supplied header using:

```nginx
proxy_set_header X-Real-IP $remote_addr;
```

Only after that check, `FTI_CUSTOMER_TRUST_PROXY=loopback` enables the application's
restricted loopback-header policy. The installer does not enable it blindly or
edit unseen Nginx configuration. Without that configuration, clients behind the
same reverse proxy share the conservative peer limit.

## Rollback

Use the exact `ROLLBACK_COMMAND` printed during installation. The backup is under
`/var/backups/fti-site-refresh/refresh-*` and includes the installer, original HTML
and the previous owned drop-in, if there was one. The complete prior release also
remains in its original location.

Restore verifies the original release fingerprint and relevant configuration
before switching back. If an operator has edited the environment, deployment file,
owned drop-in or protected HTML meanwhile, it stops instead of overwriting those
changes. It retains the failed candidate and all private data for inspection.

## Local validation

The final generated package is `tools/install-site-refresh-release.py`:

| Item | Verified value |
| --- | --- |
| Release identifier | `site-refresh-3380b7283878d16cc1341cfe` |
| File size | 11,487,927 bytes |
| SHA-256 | `30276370d44f2e1a2efb96144dfc84ec68cba7d6abdb7c9a9e937c6f41495b8e` |
| Git blob SHA-1 | `0203a6370e3af2a1c376389f37016bd907629daf` |
| Payload | 152 workspace files, 196 landing files, 18 runtime modules, 129 canonical files |

All packaged workspace, landing and runtime bytes were compared with the frozen
final builds and sources. All 129 canonical source files match the pinned
`ba82373a83d63fba0643332371cfb6d62903c849` recovery baseline. The generated installer
passed `--help`, complete payload/hash validation and gzip/Brotli consistency
checks. Its rewritten server and modules passed a real Node import from a
temporary staged root with the canonical source and existing dependencies. This
check made no network requests or systemd calls and did not start the financial
server. The original production artifact set is not present in the development
workspace, so the full deployment fingerprint remains a mandatory VPS preflight
check; it is not claimed as a local production-verification result.

The installer transaction suite passed **21 tests**. Browser acceptance and
production installation have not been verified by these checks.

Run the transaction fixtures with:

```bash
python3 test/site-refresh-install.test.py
```

The fixtures simulate systemd and HTTP locally. They exercise real file staging,
atomic publication, source/asset preservation, no-write preflight, checksum and
symlink rejection, immutable-asset collisions, failed startup rollback, manual
configuration conflicts and private-data retention. Their passing result is not
evidence that the installer has run on the production VPS.
