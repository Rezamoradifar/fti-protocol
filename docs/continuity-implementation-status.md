# Continuity implementation status — 9 October 2026

## Implemented

- Separate UUPS binary and token implementations (`FundedBinaryPlanUpgradeable`, `FTIReserveTokenUpgradeable`) and ERC-1967 `FTIProxy` with mandatory atomic initialization.
- Implementation initializers locked; proxy initializers run once. Existing economics, source-attributed books, $20 gross funded-point floor, recovery freeze, governance and token membership binding retained.
- Initialization and every upgrade validate the 72-hour delay, council threshold and proposer role. Upgrades require governance, both components frozen, backing, matching component identifier and the OpenZeppelin UUPS UUID check. Existing governance is a five-of-seven council proposing via a 72-hour timelock; direct council/deployer upgrades are rejected. App storage is append-only regular storage, with OZ Initializable's namespaced initializer state. Do not describe all app storage as namespaced.
- Storage-layout export and compatibility gate reject removed/moved/renamed fields and changed types. This is an off-chain review gate; it cannot prove that new logic is safe or stop malicious governance from scheduling unreviewed code. Review inherited storage and pinned dependency versions for every upgrade.
- Fixed-block financial/network inventory plus extended export covering non-member token holders, current allowances, token ledger logs, per-user historical hourly points/settled/auto flags, monthly funding/credit/claim eligibility and original builder ordering. Ordering is decoded from storage using a verified compiled layout. Queue totals and token supply are reconciled. Full export requires settled hourly/monthly phases and drained volume work, but never declares migrationReady=true.
- Read-only monitor detects collateral deficits, credit-book mismatches, settled points below $20 and broken payout queues. It prepares unsigned freeze calldata; it does not submit votes, sign, freeze or run a scheduled service automatically.
- Isolated server check script clones the reviewed revision, compiles, generates layouts and runs local EVM tests. It never changes current services/contracts or reads server signing keys.

## Validation results

Final relevant suite: 14 tests passed, zero failures. The actual local EVM upgrade preserved user records, rank, carried volume, credits, pending development/user rewards, token balances, allowances, reserves, supply, ATH and proxy addresses. Export reconstruction reconciled non-member holdings, monthly storage ordering and assigned per-user credits. Solidity compilation passed: binary 23,779 bytes; token 17,027 bytes; proxy 130 bytes. Shell syntax validation passed. These are local results, not a deployed migration.

## Validation boundaries

Actual local proxy tests must cover initialization replay/implementation takeover, unauthorized/unfrozen upgrade rejection, council/timelock scheduling, proxy implementation change, state/address/financial continuity, component mismatch and exact once-only reward transfers after reopening. Monitor tests cover anomaly detection and incomplete-epoch handling. Export tests cover non-member balances, approvals, historical/monthly data and storage-based builder membership reconstruction.

## Hard legacy limitation — not solved by a new contract

The deployed old binary cannot upgrade and forbids rescue of USD/FTI. Its already locked, unallocated pool cannot be swept to a new contract by the owner or by this code. The old token's emergency redemption is permanent and pays holders; it is not an owner migration transfer. No importer or replacement balance can make inaccessible collateral move. Accordingly no full legacy migration or funded replacement state is implemented or claimed. Existing wallets must retain old claims; any voluntary redemption/redeposit needs beneficiary actions and reconciliation. Never double-count the same backing across versions.

No testnet proxy rollout, frontend address switch, old contract retirement or mainnet approval has occurred. Live inventory must use the old deployment's verified code hashes and an RPC able to serve the fixed block for the duration of the export. Published specifications and compatibility gates are not an independent security audit. Existing source contracts and user journals remain untouched.

## Owner confirmation: $16 protection trigger

The upgradeable binary candidate keeps the $20 gross funded payout floor. Protection uses the aggregate eligible reward budget divided by the capped candidate points **before** the per-wallet $20 funding filter. A value strictly below $16 increases protection one level (maximum 3); $16 through $20 holds the current level; above $20 reduces it one level. With no candidate points, the level holds. Finalized `calculatedPointValue` is distinct from the actual paid `pointValue`. Candidate totals are reset at the beginning of matching. New fields are appended to storage, preserving the previous layout. This change applies only to the new upgradeable candidate; older constructor contracts and live deployments are untouched.

Token price remains reserve / supply. Support is not counted twice or injected proactively to accelerate growth: it remains separate until an actual shortfall below the price high requires repair, under the existing rules. No faster-growth guarantee is introduced.
