# Continuity transition verification — 10 October 2026

This release strengthens validation of the current UUPS contracts. It does not
introduce a collateral sweep, replacement token mint, or new-address importer.
The reviewed supported transition is a council/timelock implementation upgrade
at the existing token and binary proxy addresses. Existing monetary rules are
unchanged. It is not mainnet approval or evidence of a live migration.

Current source addresses reported by the server on chain 97 (not independently
queried by this release's local tests):

| Component | Address |
| --- | --- |
| Binary proxy | `0xC3A9E55ED97B4E92816D45Dc8054FD9c080F0126` |
| Token proxy | `0x9e4cA9dE14Ae34Cf59Cd1e120e018f339aFC356c` |
| Council | `0xDf74188f147A428f5B649C6bec20d5b958F7c90A` |
| Timelock | `0x898A8dC3ef00924572Cd193CFA3d2b04aD1632B1` |

The server read reported threshold 5/7, delay 72 hours and zero proposals. A
fresh genesis deployment must not be substituted for migration of these users.

## New verification gate

`scripts/verify-continuity-transition.mjs before.json after.json` compares two
complete fixed-block exports. Both components must be recovery-frozen, hourly
and monthly processing must be complete, and volume jobs drained. It requires
testnet/local chain identity, later destination snapshot block, stable proxy
and collateral addresses/code hashes, and changed implementation addresses.

It compares every exported member, topology, rank and rank timestamps, carried
and cumulative volume, funding credit, cash and automatic liability, token
holding (including non-member holders), allowance, hourly points/claim flags,
monthly builder data/ordering, queues, collateral balances/approval, development
claims, authority addresses, reserves, supply, cycle and accounting books.
Candidate point totals and pre-protection point value now appear in inventory.
An entirely empty extra calendar month is ignored; funded months and ordering
are retained. Comparisons survive JSON serialization without losing uint256
precision. Missing sections, approximate reads, partial settlement and changed
state fail the gate. No failed comparison authorizes reopening.

The files must come from the verified fixed-block export tools and reviewed
layouts. A comparison of files is not an independent proof that supplied data
matches chain state. Missing RPC history or state must stop export; do not
substitute `latest` data or synthesize missing balances.

## Execution tests

The expanded local-EVM upgrade test compares full exports before and after the
governed upgrade while frozen. It includes pending auto-buy rewards, a
non-member token holder and ERC20 allowances. After governed reopening it tests
cash payment exactly once, auto-buy exactly once, allowance-based transfer,
sell with the expected collateral payout, buy, new registration and repeated
units. It also deliberately corrupts 29 data/state conditions to ensure the
comparison fails rather than silently accepting a partial migration.

Normal `npm run compile` now generates storage layouts along with artifacts.
Previously a fresh installation could fail the layout test despite valid
contracts because those files had not been generated.

`tools/test-continuity-transfer.sh REVIEWED_COMMIT` checks out an isolated copy
on the server, compiles, runs all tests and builds the frontend. It does not
read signing keys, stop services, vote, change live implementation addresses,
move funds or switch frontend configuration. The script tests a local EVM,
even when executed on a server hosting BNB-testnet services.

## New-address migration remains blocked

An independent-address transfer needs a bounded, replay-protected importer for
all state, collateral handoff, terminal source retirement and post-import
verification. None is supplied by this release. The comparison explicitly
rejects changed contract addresses. Do not use USD rescue, irreversible token
redemption or an arbitrary owner withdrawal as a migration shortcut. Token
allowances on a new address cannot be treated as new user consent.

The current deployed proxy suite can retain funds/users through a compatible
upgrade; old constructor contracts have different restrictions. A locally
passing proxy transition does not prove migration from those legacy contracts,
an upgrade to arbitrary future logic, 100,000-user capacity or live BNB network
execution. Live rehearsal must use independent test fixtures, actual 5-of-7
approvals and the real 72-hour delay. Do not shorten deployed governance delay.
