# Testnet operations

The web server provides static UI, ABI, chain reads and a restricted RPC relay. User transactions are wallet-signed. The keeper uses a separate funded gas wallet without admin authority. Keep deployer and council secrets off the web server.

The local demo has unlocked disposable test accounts and time controls. Bind it to localhost or an SSH tunnel. Do not publish that mode. For the static browser launcher on a server, use HTTPS; its page performs no server-side signing. For the full testnet panel, place HTTPS and rate limits in front of the localhost server.

## Keeper flow

1. Drain volume propagation jobs in 50-step batches.
2. After the epoch boundary, begin closure. Deposits remain paused while settlement is incomplete.
3. Process points and allocate rewards in 50-member batches. No user token transfers happen in these loops.
4. Process calendar months sequentially when ready.
5. While idle, scan up to five accounts per pass for funded auto-buys. Failed purchases preserve the beneficiary claim.

On restart, the keeper resumes on-chain cursors. The architecture bounds work per transaction; it does not make total work constant or prove hourly settlement capacity for millions of accounts.

## Monitoring

`GET /health` reports RPC reachability and block number. `GET /api/state` reports reserves, accounting, queues and settlement phase. Monitor overdue epochs, queue growth, gas wallet balance, RPC failure, pause state and accounting differences. An unsolicited direct USD transfer can make actual balance exceed accounted balance; such USD cannot be rescued by this implementation.

The activity page shows up to 100 events from the last 1,500 blocks. Full historical indexing needs a separate indexer. Keeper logs are structured JSON. No external alerting service is configured by default.

## systemd example

Install under `/opt/fti-protocol` with a dedicated `fti` user. Protect environment files with mode 600. Adjust the Node binary path for your installation.

```ini
[Unit]
Description=FTI Testnet Panel
After=network-online.target
[Service]
User=fti
WorkingDirectory=/opt/fti-protocol
ExecStart=/usr/bin/node --env-file=/etc/fti/web.env scripts/server.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
[Install]
WantedBy=multi-user.target
```

Run a separate service using `scripts/keeper.mjs` and `/etc/fti/keeper.env`. The web environment must not contain private keys. The keeper environment needs only its gas wallet key. The owner must arrange HTTPS, backups and monitoring before a public service is treated as operational.
