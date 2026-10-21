# FTI mainnet event RPC repair

The public referral-placement route returned HTTP 503 with an `eth_getLogs`
error code of `-32005` during the 21 October check. The main health and state
routes returned 200. The deployed server at revision
`ba82373a83d63fba0643332371cfb6d62903c849` already supports `EVENT_RPC_URL`:
its placement index reads Registered logs in 1,500-block chunks through that
provider, while contract state and wallet RPC use the main provider.

BNB Chain's official endpoint documentation says `eth_getLogs` is disabled on
its listed public mainnet endpoints:
https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/
The existing code therefore permits a configuration-only repair. No source
fingerprint, deployment metadata or contract change is needed.

## Operator command

Place both pinned, checksum-verified files in the same private directory:

- `recover-mainnet-source.py`
- `repair-mainnet-event-rpc.py`

Run as root on the FTI VPS:

```sh
python3 recover-mainnet-source.py --apply
python3 repair-mainnet-event-rpc.py --apply
```

The first command repairs any remaining source drift with its own backup;
it skips restarting an already matching, healthy release. The second command
requires that verified source and deployment identity. It first tries HTTPS
RPC URLs already present in the service's environment files, then the public
fallback published by PublicNode at https://bsc.publicnode.com/.

Every candidate must report chain 56, agree with the current primary RPC on a
recent block hash, and answer both historical and recent 1,500-block Registered
log queries. Returned logs must match the requested contract, event and block
range. A candidate that cannot pass is never installed. Private RPC URLs and
provider error messages are not printed. The developer environment could not
verify PublicNode access (HTTP 403); the actual VPS preflight is mandatory.

The selected URL is appended as `EVENT_RPC_URL` to the last effective systemd
environment file. This preserves every original byte and all other settings.
Environment files are reread on service restart; no unit edit or daemon reload
is needed. Before writing, the tool saves and rereads a private backup under
`/var/backups/fti-event-rpc/repair-*`, including the original environment, other
unit/environment/deployment files, integrity manifest and both rollback helper
files. It prints the exact rollback command. Existing backups are retained.

Only the web service restarts. The source fingerprint, artifacts, main RPC,
contracts, deployed addresses, Keeper and frontend assets are unchanged. The
existing startup verifier remains enabled. No transaction is signed or sent.

The tool waits for the local mainnet health/config checks, then gives the
existing placement index up to six minutes to read its history. Keep the SSH
terminal open during this step. `FTI_PLACEMENT_HISTORY_WARMING` is a progress
message. If health or placement fails, the tool restores the exact prior
environment and restarts the web service. Concurrent edits stop rollback
rather than overwriting newer operator changes.

`FTI_EVENT_RPC_AND_PLACEMENT_READY` means the local health, pinned mainnet
configuration and placement endpoint passed. It does not mean a new user has
completed wallet signing, token approval or an on-chain registration.

## If no usable provider is found

`NO_USABLE_LOG_RPC_NO_CHANGES_PRIVATE_RPC_REQUIRED` means no candidate passed
and the event-RPC tool made no change. Obtain a BNB Smart Chain mainnet HTTPS
endpoint that supports historical `eth_getLogs` with at least 1,500 blocks per
query. Enter the URL only in the server's hidden terminal prompt:

```sh
python3 repair-mainnet-event-rpc.py --apply --private-rpc
```

Do not paste provider credentials into chat, GitHub, command arguments or
public logs. This mode tests only the explicitly supplied endpoint and uses
the same backup, identity checks and rollback path.

## Validation

`python3 test/mainnet-event-rpc-repair.test.py` passes 15 tests. Fixtures use the
real service inspector, repeated environment-file rows, real source/artifact
hashing, atomic file replacement and changing process IDs. Tests verify
private backup before mutation, last-file precedence, preservation of the
primary RPC and sources, health/placement rollback, concurrent-edit refusal,
wrong-chain/block/log rejection, mandatory historical and recent log probes,
and credential-safe errors. All 29 source-recovery tests also pass.

No SSH execution or production mutation was performed from this environment.
The operator must run the pinned command and return its outcome before a live
repair can be claimed.
