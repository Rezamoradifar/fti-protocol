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

`python3 test/mainnet-source-recovery.test.py` passed 11 local tests. They cover
the real JavaScript `releaseManifest` calculation, successful recovery, private
backups before service stop, health-failure rollback, rollback after partial
replacement, concurrent edits, contract/artifact/bundle drift, symlinks,
download tampering and strict environment-file parsing.

No SSH login, VPS backup, server execution or production recovery was performed
from the development environment. The prepared operator command must run on
the actual FTI server before production results can be claimed.
