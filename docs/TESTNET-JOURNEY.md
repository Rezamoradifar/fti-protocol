# Testnet user journey

Run from the repository using Node 22+ and the existing artifacts and `deployments/testnet.json`. Do not redeploy or overwrite artifacts.

Read-only: `node scripts/testnet-journey.mjs`

Transactions: enter a test-only funding wallet key locally as `TEST_PRIVATE_KEY`, then run `node scripts/testnet-journey.mjs --write`. This sends real transactions on chain 97 and spends tBNB. It creates three dedicated wallets and funds each up to 0.01 tBNB. Initial funder balance requirement is approximately 0.032 tBNB; subsequent runs replenish these wallets when needed. Per-transaction estimated fee is capped at 0.003 tBNB and each run is capped at 60 transactions. These are safety limits, not a total fixed fee quote.

The script verifies contract code, token/binary binding and accounting, checks website APIs, registers a parent and two children (1+2+2 units), verifies placement, buys 10 test USD of FTI, checks locked-sale rejection, processes available volume and due settlement batches, and claims available rewards. It may process existing permissionless global queues. It does not pause contracts, change governance or modify auto-buy preferences.

Pending hourly settlement, sell and transfer are reported as PENDING. Rerun the same command after the printed epoch end to settle and claim. Sell/transfer only execute after actual wallet-clock or time unlock; the public testnet clock is never changed. Website API problems are WARN messages and do not silently count as passes. The script does not automate injected browser-wallet interaction or BscScan source verification.

Wallet keys and transaction checkpoints are saved with mode 0600 under `~/.fti-testnet-journey/`, outside the repository. Preserve this folder to resume safely. Never share or commit it. Use the same funder on subsequent runs. Pending transaction hashes are checked before resuming; unresolved transactions stop the script instead of being blindly resent.

`RPC_URL` defaults to the BNB Testnet public RPC. `SITE_URL` defaults to `http://127.0.0.1:3080` for execution on the application server.
