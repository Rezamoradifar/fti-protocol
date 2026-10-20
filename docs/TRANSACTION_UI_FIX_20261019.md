# Membership and transaction UI follow-up

Inspected release: 2425164e89a36c6ae18c4fd5e7d011ae057c217f.

Confirmed defects and fixes:
- A submitted transaction whose receipt wait failed could unlock the form for another send. Its known hash is now retained in the current browser tab across reloads, scoped to chain and wallet. Before another operation, the receipt must resolve; the UI then asks the user to review updated balances instead of immediately sending again.
- A failed API refresh after a confirmed transaction displayed an operation error. Confirmation and balance-refresh failure are now reported separately.
- Membership state and collateral balance could change while approval was being confirmed. Both are checked again before requesting register/addUnits. Unit input now rejects fractional/empty/invalid integer input before BigInt parsing.
- Speed-up replacement receipts and wallet cancellations are distinguished.

Limits: tracking begins once a transaction hash is returned. It does not resolve a provider send failure with no hash, cross-device/new-tab submissions or dropped/replaced transactions without an available receipt. Such cases still require wallet/explorer inspection; the application never automatically resends.

Verification: production web build, 11 Node tests (receipt tracking, membership gates, language policy/catalog), 2 UI installer/rollback tests, 5 Keeper activation tests, 16 local Chromium panel layout checks at widths 320/390/844/1280 in Persian/English and dark/light. No mainnet transaction was submitted. Physical iPhone Safari and a funded membership journey remain unverified.

The public API responded with epoch 4, phase 0, monthPhase 0, rewardQueue 0 in the observed snapshot. This is not proof of ongoing Keeper health. A full local RPC health attempt failed connectivity. `tools/check-mainnet-health.mjs PUBLIC_KEEPER_ADDRESS` checks API freshness against the chain, contract code presence and public Keeper balance without accessing credentials or sending transactions. The default low-gas warning threshold is 0.001 BNB, configurable with FTI_KEEPER_MIN_GAS_WEI; it is an operational threshold, not an estimate of required spending. This command is an on-demand check, not an installed monitoring/notification service.

Install via the existing landing and UI updater scripts. Backups and rollback are unchanged. No contracts, economic rules, Keeper service, or backend configuration were modified.
