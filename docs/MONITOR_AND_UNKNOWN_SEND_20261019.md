# Read-only monitoring and unknown-send guard

Unknown sends are now recorded before invoking a wallet write. A callback defers every controller write until the pending nonce is read and browser storage accepts the guard. Explicit wallet rejection and pre-broadcast estimate errors release it; ambiguous provider errors retain it. Existing known-hash receipt handling remains. Legacy tab-scoped records are read during migration; new records use local storage scoped by origin, chain and account.

The recovery form takes a transaction hash and checks the on-chain sender, the recorded pending nonce and a mined receipt. It never sends or retries a transaction. A higher nonce alone does not clear the guard. If no transaction was broadcast, or the wallet used a different nonce, recovery requires operator investigation; no unsafe 'retry anyway' button is supplied. This is not a cross-device or cross-subdomain mutex, and concurrent wallet operations outside this interface cannot be prevented.

`install-mainnet-monitor.py` installs a separate unprivileged oneshot service and one-minute timer. It reads public state/RPC and Keeper service status; it has no key, transaction or restart functionality. Alerts are emitted to the systemd journal and `/var/lib/fti-monitor/status.json`. Conditions: gas below 0.001 BNB (warning threshold, not a gas-spend estimate), inactive Keeper, API older than 120 seconds, an unclosed epoch overdue by more than five minutes, or queued settlement work showing no progress for ten minutes. A failed health request also alerts. No email/Telegram integration is configured.

The installer preserves existing managed units in a private backup, rejects unmanaged units and symlinks, validates units, serializes installation, and prints a rollback command. It never modifies the web or Keeper units. Monitoring becomes active only when the operator runs this installer on the VPS.

`audit-live-runtime.sh` inventories the active web release's installed packages without reading environment credentials or modifying dependencies. It writes a private report and checks that the web PID has not changed. Findings do not trigger automatic package changes.

Validation: 15 Node tests (including no-hash transport failure, reload persistence, refusal to resend, mismatched sender/nonce, cancellation and unavailable storage); three monitor-condition tests; one unit-configuration test; production web build and four browser regression cases. Physical iPhone and real wallet signing remain unverified. No mainnet transaction was submitted by these checks.

Live read-only evidence after 21:30 Tehran: the API advanced from epoch 4 to epoch 5, phase 0 and rewardQueue 0. This confirms that hourly transition, not a reward payout to a funded member.
