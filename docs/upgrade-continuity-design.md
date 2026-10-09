> Historical stage note: see [current implementation status](continuity-implementation-status.md) for the subsequently implemented UUPS contracts, extended export and monitor. Legacy collateral-transfer limitations remain.

# Governed continuity architecture (owner approved, not implemented)

## Stable contract identity

Future token and binary releases should use ERC-1967 proxies with UUPS implementations. Each implementation must use initializer-based storage, locked implementation initializers, namespaced storage and documented storage layout. Constructor/immutable-based existing contracts cannot simply be placed behind a proxy. Upgrade authorization belongs exclusively to the existing 72-hour timelock; its proposer is the 5-of-7 council. The council must not receive a direct upgrade or collateral withdrawal bypass.

Stable proxy addresses retain users, genealogy, token balances and reserves during compatible upgrades. Before any new implementation is scheduled, validate storage compatibility, financial invariants, initializer replay protection, unauthorized upgrades, direct implementation calls and cross-contract version compatibility. A failed upgrade must revert atomically. Downgrading code is not assumed to reverse state changes. Any rollback must be independently storage-compatible and tested.

## New-address migrations

A new-address migration needs an explicit state machine: prepare, freeze all relevant writes, reconcile, import bounded batches, transfer only authorized collateral, verify, activate. Regular pause does not freeze old payout/settlement/transfers. Snapshot roots must bind chain ID, source contracts, source block hash, schema and target migration identity; proofs and imports must be unique and replay-protected. No usable replacement balance may be minted before its collateral and old duplicate-claim path are accounted for. Reconcile each wallet and aggregate liability totals, including all non-member token holders, allowances/authorizations, pending settlement work and historical claim status.

Old protected USD cannot be transferred with rescue. Emergency redemption is an irreversible holder redemption mechanism, not a general migration shortcut. Where a permitted transfer path does not exist, retain legacy claims and display them separately from new funded claims. Any payout/redeposit requires the beneficiary's own consent and actual transfer. Do not label this partial coexistence as full migration.

## Implemented first step

`scripts/migration-inventory.mjs` exports a read-only fixed-block member inventory, topology, member financial counters, reward/auto/dirty/job queues, token member balances and core global books. It checks reciprocal genealogy, depth, source code hashes when supplied, accounting and block hash consistency; writes a new file with mode 0600 and no private keys. It refuses overwritten reports. It always declares migrationReady=false. It does not yet export all non-member token holders, allowances, historical epoch mappings or monthly builder state. It does not import data, move money, or implement proxy upgrades. These gaps are deliberate activation blockers.
