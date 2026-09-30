# Runtime patch (existing testnet compatible)

Ethers is pinned to 6.17.0. `npm audit --omit=dev` reports zero known runtime advisories at this check; development tools still report advisories. Contract sources, compiler version and existing deployments are not changed by this runtime patch.

Activity requests are paginated, adaptively split on errors, cached for 15 seconds and deduplicated while in flight. RPC batching is disabled and transport requests have a 15-second timeout. Persistent RPC failure is reported as HTTP 503, not as a successful empty history. Unit tests cover splitting, ordering, block failure and request-budget exhaustion. Public endpoint availability cannot be guaranteed by client changes.

Existing server update: use Node 22+, `git pull --ff-only`, `npm ci`, `npm run build:web`, then `systemctl restart fti-testnet-web`. Do not run Solidity compile/deploy or replace deployment artifacts for this frontend/server update. The systemd port override (3080) is preserved.

The live RPC returned `-32005 limit exceeded` even for a single-block log query during this check. Pagination cannot repair an unavailable upstream. Set `EVENT_RPC_URL` in the service environment to a BNB testnet RPC with working `eth_getLogs` support if the problem persists. The server checks that this provider's chain ID matches the deployment before accepting events; this setting changes only the activity reader, not wallet transactions. Provider credentials remain server-side. A substitute public endpoint was not verified from this workspace.
