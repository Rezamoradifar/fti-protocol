# Move FTI to a new Ubuntu server

The installer restores the existing chain-97 deployment. It does not deploy contracts, migrate on-chain balances, activate the experimental liquidity branch, or start a transaction signer. Main is the supported migration source; the experimental branch stays separate.

## 1. Old server: preserve private state

Stop any running `testnet-100.mjs --write` or `testnet-journey.mjs --write` job gracefully (Ctrl+C) before backup. The web service can remain running. In the existing `/root/fti-protocol` checkout:

```bash
cd /root/fti-protocol
git pull --ff-only
python3 scripts/migration-backup.py --project "$PWD" --output /root/fti-migration.tar.gz
```

This copies the project snapshot, deployment addresses, compiled artifacts, any project-local secrets/helper accounts, test journals in `/root/.fti-testnet-100` and `/root/.fti-testnet-journey`, `/etc/fti` and FTI systemd files. It omits `.git`, `node_modules`, QA images and symlinks. Backups are private mode 600. Keep the archive and checksum outside GitHub and chat. Keys only held in an interactive shell's environment are NOT recoverable from this backup; keep their original secure source. Custom files outside these paths, external databases, cron jobs and TLS/domain configurations require a separate backup. This is an FTI backup, not a backup of other projects on the old server.

Do not rerun with the same output filename; choose a new name for a new snapshot. The script refuses active test writers to avoid an inconsistent transaction journal.

## 2. New server: copy and install

Use a fresh Ubuntu 22.04/24.04 server with root SSH access, at least 2 GB RAM and sufficient disk for the snapshot and build. If the VPS firewall is separate from UFW, allow incoming TCP 3080 and 3090 there. SSH must remain allowed.

```bash
apt-get update
apt-get install -y git python3 openssh-client
scp root@70.33.249.57:/root/fti-migration.tar.gz /root/
scp root@70.33.249.57:/root/fti-migration.tar.gz.sha256 /root/
cd /root
sha256sum -c fti-migration.tar.gz.sha256
git clone https://github.com/Rezamoradifar/fti-protocol.git /root/fti-installer
read -rp "New server IP or domain: " FTI_PUBLIC_HOST
export FTI_PUBLIC_HOST
bash /root/fti-installer/scripts/install-new-server.sh /root/fti-migration.tar.gz
```

SCP asks for the OLD server's password/key. Check its SSH fingerprint using a trusted existing record. Use `scp -P PORT` if that server uses a nondefault SSH port. Never send those credentials in chat.

The installer:

- Fetches the latest official Node 22 binary for x64/arm64 and checks its published SHA256. Node lives under `/opt`; it does not depend on an interactive nvm session.
- Clones main to `/opt/fti-protocol` and builds as an unprivileged `fti` service user.
- Extracts the entire snapshot to the private `/root/fti-migration-restore`, validates archive paths and every checksum, then copies only the current deployment JSON and five required artifacts into the app. It does not recompile/replace the deployed contracts' artifacts.
- Builds the React app and the independent landing. `FTI_APP_URL` is built from the new host, so landing links do not keep sending visitors to the old server.
- Checks all five contracts and token/binary binding using read-only RPC calls before activating services.
- Runs the app behind Nginx on port **3080**, with backend on **127.0.0.1:3081**, and serves the landing on **3090**.

Existing install paths and occupied ports cause a stop, not a destructive overwrite. If an installation stops halfway, inspect the error and existing paths instead of deleting them or rerunning blindly. These scripts were checked locally; the target server itself is only verified when these commands run there.

## 3. Check before cutover

```bash
systemctl status fti-testnet-web --no-pager
curl -fsS http://127.0.0.1:3080/health
curl -fsS http://127.0.0.1:3080/api/config
curl -fsS http://127.0.0.1:3080/api/state
curl -fsS http://127.0.0.1:3090/ -o /dev/null
```

Open `http://NEW_SERVER_IP:3080` for the application and `http://NEW_SERVER_IP:3090` for the landing. Compare contract addresses with the old server. The health route's configured chain ID alone is not proof of network identity; the installer also performs the read-only preflight above.

Use `journalctl -u fti-testnet-web -n 60 --no-pager` for service errors. Do not post environment files, helper wallets or journals. Activity may return 503 if the RPC rejects logs; optionally set `EVENT_RPC_URL` in `/etc/fti/web.env` and restart the service. A new VPS does not itself repair the upstream RPC. Set a working `RPC_URL`/`EVENT_RPC_URL` as exported variables before installation to use a chosen provider.

## 4. Preserve the same test wallets and resume deliberately

The private journals stay in `/root/fti-migration-restore/private/home/`. To restore them to their normal root-owned locations without overwriting existing ones:

```bash
python3 - <<'PY'
import pathlib,shutil
base=pathlib.Path('/root/fti-migration-restore/private/home')
for name in ('.fti-testnet-100','.fti-testnet-journey'):
    src=base/name;dst=pathlib.Path('/root')/name
    if not src.exists():continue
    if dst.exists():raise SystemExit('Destination exists; inspect '+str(dst))
    shutil.copytree(src,dst)
    print('Restored',name)
PY
```

Do not delete pending-transaction journals or generate replacement wallets to bypass a problem. A stale `.lock` file needs manual inspection: confirm the old writer stopped and there is no current writer before removing only that lock. Keep the JSON journal. Resume with the original funder's test private key entered only on the new terminal. Public testnet locks are unchanged by migration.

## 5. Keeper, domains and final cutover

The application is a web reader/transaction interface. Automated settlements need the separate `scripts/keeper.mjs` process. Its old unit/config are preserved privately for review, but are not started automatically: a signing key must not be copied into the web service. Stop the old keeper before running a replacement with the same key; two instances can conflict on transaction nonces. Until a keeper is started, settlement requires a permissionless caller.

Keep the old service available until new-server checks pass. DNS, HTTPS certificates and a keeper cutover are separate from copying the app. For a public wallet-facing domain, configure HTTPS before broader use; do not paste old TLS private keys into GitHub. The new IP/domain was not provided at preparation time, so no DNS change or certificate issuance has been performed.

Source: https://github.com/Rezamoradifar/fti-protocol
Landing source: `landing/`
Experimental contract candidate: `fix/liquidity-safety` (not activated by this installer)
