# V3: 100-wallet EVM test

This test deploys the production V3 contracts to Ganache and exercises 100 distinct
participating wallets (31 genesis wallets and 69 new registrations). It does not
send transactions to a public network or use real private keys.

```sh
npm ci
npm run compile
FTI_100_REPORT=/tmp/fti-v3-100-results.json node test/v3-load.test.mjs
```

Coverage includes funding and binary placement; independent hourly reward
calculations and batched cash payments; 200 manual buys across two cycles;
100 transfers and 100 delegated transfers with exact burn accounting; auto-buy
failure, preserved pending funds and keeper retry; release to cash; monthly
Builder processing; council pause and a 72-hour timelock; 100 emergency
redemptions on a reverted snapshot; all-holder normal exits and 0.20 restart
quotes. Exact token collateral and binary liabilities are checked repeatedly.

The separate V3 regression tests cover the $500 boundary, larger-sale caps,
support depletion, tiny ATH repairs, blocked payouts and deployment/API checks.

## Read-only fork of the installed BNB testnet deployment

Set `FTI_FORK_DEPLOYMENT` to the installed deployment JSON and `FTI_FORK_RPC`
to a working BNB testnet RPC. The test first checks chain ID 97 and all five
recorded deployed code hashes, pins a block, then performs every transaction
only inside a local fork. It impersonates the deployment's genesis and council
addresses locally. No public-chain wallet keys are needed.

```sh
FTI_FORK_DEPLOYMENT=/path/to/deployment.json \
FTI_FORK_RPC=https://bsc-testnet-dataseed.bnbchain.org \
FTI_100_REPORT=/tmp/fti-v3-100-fork-results.json \
node test/v3-load.test.mjs
```

Fork mode requires the fresh deployment: 31 inactive genesis members and zero
token supply. It refuses to erase existing memberships or holdings to make the
test pass. A successful local run does not prove a successful fork run or a
public-network load test. Browser interactions are not part of this test.

The JSON result is written only after every assertion passes. Counters include
successful transactions on the emergency snapshot even though that snapshot is
subsequently reverted. Contract deployments, helper-driven settlement and the
keeper's transaction are additional to the counted scenario transactions.
