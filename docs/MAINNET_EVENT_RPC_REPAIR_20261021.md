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

### Match the deployed HTTP client

The operator's later screenshots showed `curl` receiving HTTP 200 from dRPC
while Python preflight received HTTP 403. A test using the deployed Node and
ethers client returned `CHAIN_ID=0x38`, then HTTP 400 on the historical
1,500-block log query. This proves chain connectivity through that client;
it does not prove dRPC log access or identify the reason for HTTP 400.

External preflights now use the verified active Node executable and the
release's existing ethers `FetchRequest` transport, matching the server's
HTTP implementation. Python still performs the unchanged chain/block/log
validation and reads the loopback reference block. No SDK installation,
backend source edit or change to the web service's transport is made.

Each external request runs in a short-lived subprocess as `fti-v3`, with
supplementary groups cleared and a minimal environment. The URL and payload
travel only on stdin, never command arguments. The helper allows only its
four read methods, preserves TLS verification, blocks redirects before they
are followed, does not retry denied or rate-limited requests, and enforces
a 12-second transport timeout plus an 18-second process timeout. Ethers
buffers the response internally; the helper rejects bodies above 4 MB.
No inherited `NODE_OPTIONS` or provider credentials are forwarded in the
child environment.

On HTTP/RPC failure, bounded upstream JSON is used only to report a numeric
code and fixed categories such as `BLOCK_RANGE_LIMIT` or
`HISTORICAL_DATA_RESTRICTED`. Those categories are hints derived from the
provider's error text, not independent diagnosis. Raw messages, URLs and
response bodies are never printed. Generic HTTP 400 alone still leaves the
cause unresolved. Failed log preflight cannot select or install a provider.

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

The operator subsequently reported HTTP 403 from an explicitly supplied RPC.
This confirms that a successful check from another machine is insufficient.
The output does not identify the hidden URL or establish the cause of denial.

To test four independently published public services from the actual
VPS, without an API key or hidden prompt, run:

```sh
python3 repair-mainnet-event-rpc.py --apply --public-rpcs
```

This opt-in mode tests PublicNode, Nodies, dRPC and 1RPC in that order, using
the active Node/ethers HTTP transport. Provider references:

- https://bsc.publicnode.com/
- https://docs.nodies.app/rpc-services/pokt-public-rpc-endpoints
- https://drpc.org/chainlist/bsc-mainnet-rpc
- https://docs.1rpc.io/overview/supported-networks

PublicNode's earlier rejection came from the Python-only probe, so its access
through the deployed Node transport remains unconfirmed and is checked once.
Blockmachine is excluded because its published 60-RU/min public capacity is
not suitable for assuming this six-minute historical warmup can complete.
Each candidate receives one bounded
preflight; an HTTP denial or rate limit stops that provider's test. There is
no proxy, alternate-IP routing, authentication workaround, retry loop or
runtime provider rotation. Only the first fully verified provider can be
installed, using the same backup, integrity checks and rollback behavior.
HTTP/RPC failures now identify the read-only method as well as the numeric
code; URLs, credentials and provider response bodies stay private.

Without `--apply`, public mode performs only preflight checks. If every
candidate fails, `NO_USABLE_PUBLIC_LOG_RPC_NO_CHANGES` is reported and no
service or configuration changes occur. These endpoints are candidates,
not a claim of successful VPS access or sustained history-scan capacity.
Placement still must pass after restart; otherwise prior configuration is
restored. The tool does not claim that all public RPC services are unusable
when the bounded list fails.

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

`python3 test/mainnet-event-rpc-repair.test.py` passes 28 tests. Fixtures use the
real service inspector, repeated environment-file rows, real source/artifact
hashing, atomic file replacement and changing process IDs. Tests verify
private backup before mutation, last-file precedence, preservation of the
primary RPC and sources, health/placement rollback, concurrent-edit refusal,
wrong-chain/block/log rejection, mandatory historical and recent log probes,
and credential-safe errors. Public-mode tests cover selection after denial,
backup and preservation of the primary RPC, no prompting, check-only mode,
no changes when all candidates fail, and HTTP denial without retry or leaked
credentials. All 29 source-recovery tests also pass.

Six additional integration cases run the actual ethers transport against an
isolated HTTPS server: successful full provider verification, HTTP 400
classification without credential reflection, HTTP 403 without retry, HTTP
429 without retry, redirect rejection and rejection of an untrusted TLS
certificate. Two isolation cases cover write-method/HTTP refusal and
sanitized timeout/invalid-child-output handling. The test environment cannot
call `setgroups`, even for its own UID; fixtures assert the production
`fti-v3` privilege-drop arguments, then retain the test process's identity.
Production privilege dropping must still succeed on the actual VPS; a
failure stops preflight rather than running Node as root.

No SSH execution or production mutation was performed from this environment.
The operator must run the pinned command and return its outcome before a live
repair can be claimed.
