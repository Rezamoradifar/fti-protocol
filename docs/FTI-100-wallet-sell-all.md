# FTI BNB Testnet: sell all FTI in our 100 test wallets

Only BNB Testnet (chain 97), with synthetic `tUSD`, never real USD or mainnet.
Sells the **remaining FTI balance** held by the 100 wallets generated in the
private `/root/fti-fresh-100-testnet/wallets-PRIVATE.json` file. Includes FTI
from a potential 300k/500k tUSD buy if it later occurred in test wallet #0.
It does not buy FTI, claim rewards, refund memberships, or move anyone else's tokens.

This is not an instant guaranteed exit: on-chain single-sale, hourly-outflow,
liquidity, reserve, gas, and net pricing constraints are enforced. If all circulating
FTI is in one remaining test wallet, an ordinary full-cycle exit may complete at
once. Otherwise, reruns across real-hour windows may be required. Do not
split >500 tUSD holdings into artificially exempt small orders.

On the reviewed FTI VPS `vps-titan-5320` (as root with pinned Node 22):

```bash
NODE='/opt/fti/runtime/node-v22.23.3-x64/bin/node'
"$NODE" /root/fti-sell-all-testnet.cjs prepare --budget-test-bnb 0.12 --gas-ceiling-gwei 1
"$NODE" /root/fti-sell-all-testnet.cjs status
```

Review the exact digest and status before the irreversible testnet sales.
A **new separate 0.12 tBNB maximum gas reserve** applies to this liquidation
program; it is distinct from the earlier 100-wallet test budget.

```bash
KEY='/root/fti-private/fti-testnet-funder.key'
DIGEST='EXACT_DIGEST_FROM_PREPARE'
nohup "$NODE" /root/fti-sell-all-testnet.cjs sell --send \
 --confirm-plan "$DIGEST" --funder-key-file "$KEY" --max-steps 50 \
 > /root/fti-liquidation.log 2>&1 </dev/null &
tail -n 50 /root/fti-liquidation.log
"$NODE" /root/fti-sell-all-testnet.cjs status
```

The signed transaction is journaled before broadcast with a receipt/tx-hash
check. An uncertain transaction is never blindly re-sent. The 100-wallet or
large-trade runners must **not be active concurrently**. Neither private keys
nor raw signed transactions must be sent to ChatGPT.

Local safety tests:

```bash
node --check tools/fti-sell-all-testnet.cjs
node --test test/fti-sell-all-testnet.test.cjs
```

No live BNB Testnet liquidation has been executed by publication of this script.
