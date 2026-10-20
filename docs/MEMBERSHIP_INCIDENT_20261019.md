# Membership deposit gate investigation

The public mainnet state response observed at block 128571590 reported epoch 1,
phase 0, epochEnd 1792123200 and block timestamp 1792420715. The volume queue,
point pool and reward queue were empty. Neither pause nor recovery freeze was set.
The funded contract requires phase == 0 AND block.timestamp < epochEnd in _fund.
This state therefore rejects both registration and additional units. The original
UI only checked phase/pause and exposed a generic nested wallet error.

The UI now checks the deposit window before allowance transactions, checks it
again after approval, disables unavailable purchases with a visible explanation,
and extracts nested wallet errors. Contract code and economic rules are unchanged.

Operational recovery still required:
1. Read the current state again; the observation above is not a permanent state.
2. In the existing governance/settlement workspace, connect a gas-funded wallet.
   Settlement is permissionless; do not use governance proposal actions.
3. If volume is queued, Process volume until the queue is drained.
4. If phase is zero and the hourly deadline passed, use Close epoch once and wait
   for its receipt. If phase is nonzero, use Process settlement, waiting for each
   receipt and refreshing state, until phase is zero with a future epochEnd.
5. Confirm the Keeper's mainnet configuration, separate wallet and gas balance.
   tools/check-mainnet-keeper.py is read-only; it does not activate a Keeper.
   Without recurring settlement, deposits close again at the next hourly boundary.
6. Verify the member's actual transaction after recovery; no member wallet or
   transaction hash was supplied in this incident.

Validation: production web build; 3 new membership/error tests, 5 wallet discovery
checks and 2 overlay tests passed. No live transaction or server install performed.
