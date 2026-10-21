# Recover the FTI web process after source fingerprint drift

The operator's 21 October screenshots show repeated `Deployment/build release
mismatch` exits in `fti-continuity-web.service`, with no listener on localhost
port 3110. This explains the observed public Nginx 502 responses. The runtime
computes a fingerprint over source files as well as original generated assets;
editing a source module or adding a new `.mjs` in `scripts/` changes it.

`tools/recover-mainnet-source.py` targets only the already deployed mainnet
profile from commit `ba82373a83d63fba0643332371cfb6d62903c849`. It restores
source integrity rather than changing the deployment's expected fingerprint or
disabling any verifier. The 129 baseline source hashes were extracted from that
exact Git commit. All six artifact hashes are pinned to its published mainnet
deployment record.

## Run on the FTI VPS

Use Python 3 as root. Running without arguments only prints the proposed files:

```sh
python3 recover-mainnet-source.py
python3 recover-mainnet-source.py --apply
```

The tool checks effective systemd configuration, original contract sources,
artifacts, package/config files, and the complete candidate fingerprint before
changing anything. Only direct source files in `scripts`, `frontend` and
`landing/src` can be restored or quarantined. Changed original files come from
the pinned Git commit over HTTPS and must match their pinned SHA-256. Unknown
additional source files are retained in the private backup before removal from
the fingerprint inputs. Contract files, deployment JSON, RPC settings, systemd
configuration, Nginx, the Keeper, dependencies, and served versioned UI assets
are not modified. No blockchain transaction is submitted.

Before stopping the web process, it creates and rereads backups under
`/var/backups/fti-source-recovery/recovery-*`. Service configuration and
environment files are backed up privately; their contents are never printed.
The tool prints its exact rollback command. It checks the unchanged service
identity, protected files, complete source fingerprint and artifacts again,
then starts the existing web unit. The existing startup verifier still checks
chain, code, creation transactions and contract roles. A failed health/config
check restores the pre-repair files. Concurrent operator changes stop rollback
instead of being overwritten.

Configuration identity excludes only the five recognized runtime fields in
systemd's `ExecStart` output: start/stop timestamps, PID, exit code and exit
status. The executable, arguments and `ignore_errors` setting remain included,
alongside the ordered environment files and byte hashes of the unit, drop-ins,
environment and deployment files. An unknown `ExecStart` format is rejected.
The prior version hashed the raw output, so its own `systemctl stop` could cause
`CONCURRENT_CONFIGURATION_CHANGE`, then prevent automatic rollback. The new
version uses backup record schema V2 and rechecks configuration after stopping
the service during rollback too.

If that earlier error occurred, retain the existing backup. Run the corrected
tool with `--apply` to inspect the current state and create a fresh independent
backup before any change. Do not rerun the old rollback helper. V1 records are
not silently accepted as V2 identities. A running, healthy process does not
hide altered source on disk: recovery skips a restart only when both the
complete source fingerprint and health checks already match.

`FTI_WEB_RECOVERED` confirms local `/health` and `/api/config`, including chain
56 and the pinned deployment identity. It does **not** mean end-to-end wallet
signing or all public routes passed. The tool prints separate follow-up results
for `/api/state` and referral placement. Restoring the original backend can
leave the earlier history-based registration/RPC problem outstanding; address
that separately after the service is available. Never change the expected
deployment fingerprint just to make an unverified new backend start.

If a protected file or original generated bundle does not match, or the
original complete fingerprint cannot be reconstructed, the tool refuses to
mutate the release. Retain that output for a targeted follow-up.

## Validation and limits

`python3 test/mainnet-source-recovery.test.py` passed 29 local tests. They cover
the real JavaScript `releaseManifest` calculation, successful recovery, private
backups before service stop, health-failure rollback, rollback after partial
replacement, concurrent edits, contract/artifact/bundle drift, symlinks,
download tampering and strict environment-file parsing. The service-inspection
tests also cover the actual `systemctl show` representation: one repeated
`EnvironmentFiles=` row per file, preserved in order. A later RPC override must
not discard the earlier `web.env` or its `DEPLOYMENT_FILE`. The first tool
version lost those earlier rows and could stop with `UNSAFE_PATH` before the
recovery plan or any source mutation. This parser bug is now reproduced by a
regression test using the real service inspector and fixed without relaxing
path, deployment, ownership or fingerprint validation. Missing settings now
produce specific error codes rather than an empty-path error.

Additional regressions reproduce stop/start transitions using the real service
inspector rather than a mocked constant identity. They cover successful repair,
health-failure rollback after a PID change, rejection of actual configuration
changes during stop, restarts between inspection reads, changed command
arguments, unknown output fields and refusal of legacy backup records. The
lifecycle tests failed with the previous implementation and pass with the fix.
The CLI tests also cover a healthy process with drifted source and a healthy,
matching release that needs neither backup nor restart.

No SSH login or server mutation was performed from the development environment.
The operator's latest output confirms creation of backup
`/var/backups/fti-source-recovery/recovery-8nvibprc`, followed by the concurrency
error; it does not confirm recovery. Read-only public checks returned HTTP 200
for `/health`, `/api/config` and `/api/state`, with the pinned mainnet identity,
while referral placement still returned 503. These observations do not prove
which process is serving the domain or whether the on-disk source is repaired.
The corrected operator command must run on the actual FTI server before its
production outcome can be claimed.
