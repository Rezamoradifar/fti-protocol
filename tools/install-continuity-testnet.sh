#!/usr/bin/env bash
set -Eeuo pipefail
umask 027
FTI_REV="${1:?Pass the full reviewed commit SHA}"
[[ "$FTI_REV" =~ ^[a-f0-9]{40}$ ]] || exit 1
[[ "$(id -u)" = 0 ]] || { echo 'Run as root'; exit 1; }
case "$(uname -m)" in x86_64) FTI_ARCH=x64;; aarch64) FTI_ARCH=arm64;; *) exit 1;; esac
FTI_BIN="/opt/fti/runtime/node-v22.23.3-$FTI_ARCH/bin"
test -x "$FTI_BIN/node"
export PATH="$FTI_BIN:$PATH"
id fti-v3 >/dev/null
nginx -t
FTI_DIR="/opt/fti/releases/continuity-$FTI_REV"
FTI_STATE="/var/lib/fti-continuity/$FTI_REV"
FTI_CONF=/etc/nginx/conf.d/fti-domain.conf
FTI_STAMP=$(date -u +%Y%m%dT%H%M%SZ)-$$
FTI_BACKUP="/var/lib/fti-continuity/backups/$FTI_STAMP"
test -s "$FTI_CONF"
if test -d "$FTI_DIR"; then
 test "$(git -C "$FTI_DIR" rev-parse HEAD)" = "$FTI_REV"
else
 git clone --single-branch --branch fix/funded-point-floor-20261009 https://github.com/Rezamoradifar/fti-protocol.git "$FTI_DIR"
 git -C "$FTI_DIR" checkout --detach "$FTI_REV"
fi
install -d -o root -g fti-v3 -m 0750 "$FTI_STATE" /etc/fti-continuity "$FTI_BACKUP"
cd "$FTI_DIR"
export FTI_SOURCE_REVISION="$FTI_REV"
npm ci --no-fund
npm run compile
node scripts/compile-continuity-layout.mjs
node scripts/check-upgrade-layout.mjs docs/storage-layout/FundedBinaryPlanUpgradeable.json artifacts/storage-layout/FundedBinaryPlanUpgradeable.json
node scripts/check-upgrade-layout.mjs docs/storage-layout/FTIReserveTokenUpgradeable.json artifacts/storage-layout/FTIReserveTokenUpgradeable.json
npm run build:web
(cd landing && node build.mjs)
node --test --test-concurrency=2 test/continuity-upgrade.test.mjs test/continuity-deployment.test.mjs test/funded-keeper.test.mjs test/continuity-monitor.test.mjs test/market-curve.test.mjs test/continuity-auto-setup.test.mjs
export FTI_SOURCE_REVISION="$FTI_REV" FTI_STATE
# Do not accept edits to the reviewed checkout.
git diff --quiet HEAD -- contracts frontend scripts web/style.css web/favicon.svg landing package.json package-lock.json
if ! test -s "$FTI_STATE/deployment.json"; then
 if test -e "$FTI_STATE/genesis-secrets.json"; then echo 'A previous deployment started but has no completed record. Stop and inspect; no duplicate deployment was attempted.'; exit 1; fi
 if test "${2:-}" = --auto; then
  node scripts/prepare-continuity-auto.mjs
  node scripts/deploy-continuity-auto.mjs
 else
 read -r -s -p 'BNB TESTNET RPC URL (hidden): ' RPC_URL </dev/tty; echo
 read -r -s -p 'DEPLOYER TESTNET private key (hidden): ' DEPLOYER_PRIVATE_KEY </dev/tty; echo
 read -r -s -p 'KEEPER TESTNET private key, gas-only (hidden): ' KEEPER_PRIVATE_KEY </dev/tty; echo
 read -r -p 'Seven distinct council PUBLIC ADDRESSES, comma-separated: ' FTI_COUNCIL </dev/tty
 DEPLOYER_PRIVATE_KEY="${DEPLOYER_PRIVATE_KEY/#0X/0x}"
 [[ "$DEPLOYER_PRIVATE_KEY" = 0x* ]] || DEPLOYER_PRIVATE_KEY="0x$DEPLOYER_PRIVATE_KEY"
 export RPC_URL DEPLOYER_PRIVATE_KEY KEEPER_PRIVATE_KEY FTI_COUNCIL
 node --input-type=module <<'JS'
import fs from 'node:fs';
import {JsonRpcProvider,Wallet,isAddress,ZeroAddress,formatEther} from 'ethers';
const rpc=process.env.RPC_URL;new URL(rpc);
const dao={threshold:5,partners:process.env.FTI_COUNCIL.split(',').map(a=>a.trim())};
if(dao.partners.length!==7||new Set(dao.partners.map(a=>a.toLowerCase())).size!==7||dao.partners.some(a=>!isAddress(a)||a===ZeroAddress))throw Error('Enter seven distinct nonzero PUBLIC council addresses');
const p=new JsonRpcProvider(rpc,undefined,{batchMaxCount:1});
try{
 if((await p.getNetwork()).chainId!==97n)throw Error('Expected BNB TESTNET chain 97');
 const key=raw=>{if(!/^(?:0x)?[a-f0-9]{64}$/i.test(raw||''))throw Error('Private key format is invalid');try{return new Wallet('0x'+raw.replace(/^0x/i,''));}catch{throw Error('Private key is invalid');}};
 const deployer=key(process.env.DEPLOYER_PRIVATE_KEY),keeper=key(process.env.KEEPER_PRIVATE_KEY);
 if(dao.partners.some(a=>a.toLowerCase()===keeper.address.toLowerCase()))throw Error('Keeper must not be a council guardian');
 if(deployer.address===keeper.address)throw Error('Use separate deployer and gas-only keeper wallets');
 for(const [role,wallet] of [['Deployer',deployer],['Keeper',keeper]]){const balance=await p.getBalance(wallet.address);console.log(role+': '+wallet.address+'; test BNB: '+formatEther(balance));if(balance===0n)throw Error(role+' needs test BNB');}
 fs.writeFileSync(process.env.FTI_STATE+'/dao.json',JSON.stringify(dao),{mode:0o640,flag:'wx'});
 const line=(key,value)=>key+'='+JSON.stringify(value)+'\n';
 fs.writeFileSync(process.env.FTI_STATE+'/web.env',line('RPC_URL',rpc)+line('DEPLOYMENT_FILE',process.env.FTI_STATE+'/deployment.json')+line('FTI_SOURCE_REVISION',process.env.FTI_SOURCE_REVISION)+line('WALLETCONNECT_PROJECT_ID','04efbb394027fd24f16da8bd2c1e5930')+line('PORT','3110')+line('HOST','127.0.0.1'),{mode:0o640});
 fs.writeFileSync(process.env.FTI_STATE+'/keeper.env',line('RPC_URL',rpc)+line('DEPLOYMENT_FILE',process.env.FTI_STATE+'/deployment.json')+line('FTI_SOURCE_REVISION',process.env.FTI_SOURCE_REVISION)+line('KEEPER_PRIVATE_KEY',keeper.privateKey),{mode:0o640});
}finally{p.destroy();}
JS
 DAO_CONFIG="$FTI_STATE/dao.json" V3_TESTNET_SECRETS="$FTI_STATE/genesis-secrets.json" V3_DEPLOYMENT_FILE="$FTI_STATE/deployment.json" node scripts/deploy-continuity-testnet.mjs
 unset DEPLOYER_PRIVATE_KEY KEEPER_PRIVATE_KEY FTI_COUNCIL RPC_URL
 fi
fi
chown root:fti-v3 "$FTI_STATE"/{deployment.json,web.env,keeper.env,dao.json}
chmod 0640 "$FTI_STATE"/{deployment.json,web.env,keeper.env,dao.json}
chmod 0600 "$FTI_STATE/genesis-secrets.json"
# Rollback restores the domain and prior continuity units; contract state remains on-chain.
cp -p "$FTI_CONF" "$FTI_BACKUP/fti-domain.conf"
for FTI_ROLE in web keeper; do
 FTI_UNIT="/etc/systemd/system/fti-continuity-$FTI_ROLE.service"
 if test -f "$FTI_UNIT"; then cp -p "$FTI_UNIT" "$FTI_BACKUP/$FTI_ROLE.service"; fi
 systemctl is-active "fti-continuity-$FTI_ROLE.service" >"$FTI_BACKUP/$FTI_ROLE.active" || true
done
cat >"$FTI_BACKUP/rollback.sh" <<ROLLBACK
#!/usr/bin/env bash
set -euo pipefail
systemctl stop fti-continuity-web.service fti-continuity-keeper.service || true
cp -p '$FTI_BACKUP/fti-domain.conf' '$FTI_CONF'
for role in web keeper; do
 if test -f '$FTI_BACKUP/'"\$role.service"; then cp -p '$FTI_BACKUP/'"\$role.service" "/etc/systemd/system/fti-continuity-\$role.service"; else systemctl disable "fti-continuity-\$role.service" || true; rm -f "/etc/systemd/system/fti-continuity-\$role.service"; fi
done
systemctl daemon-reload
for role in web keeper; do if test "\$(cat '$FTI_BACKUP/'"\$role.active")" = active; then systemctl start "fti-continuity-\$role.service"; fi; done
nginx -t
systemctl reload nginx
ROLLBACK
chmod 0700 "$FTI_BACKUP/rollback.sh"
FTI_SWITCHING=1
rollback_on_error(){ local result=$?; trap - ERR; if test "${FTI_SWITCHING:-0}" = 1; then bash "$FTI_BACKUP/rollback.sh" || true; fi; exit "$result"; }
trap rollback_on_error ERR
for FTI_ROLE in web keeper; do
 FTI_UNIT="/etc/systemd/system/fti-continuity-$FTI_ROLE.service"
 cat >"$FTI_UNIT" <<UNIT
[Unit]
Description=FTI continuity TESTNET $FTI_ROLE
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=fti-v3
Group=fti-v3
WorkingDirectory=$FTI_DIR
EnvironmentFile=$FTI_STATE/$FTI_ROLE.env
ExecStart=$FTI_BIN/node scripts/$(test "$FTI_ROLE" = web && echo server || echo keeper).mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
UMask=0027
[Install]
WantedBy=multi-user.target
UNIT
done
systemctl daemon-reload
systemctl enable fti-continuity-web.service fti-continuity-keeper.service
systemctl restart fti-continuity-web.service
FTI_HEALTHY=0
for FTI_TRY in $(seq 1 30); do
 if curl -fsS --max-time 5 http://127.0.0.1:3110/health >/dev/null; then FTI_HEALTHY=1; break; fi
 sleep 2
done
test "$FTI_HEALTHY" = 1
python3 - <<'PY'
from pathlib import Path
import re
p=Path('/etc/nginx/conf.d/fti-domain.conf');s=p.read_text()
if not re.search(r'server_name\s+ftiprotocol\.com(?:\s|;)',s):raise SystemExit('Expected FTI domain configuration')
s,n=re.subn(r'proxy_pass\s+http://127\.0\.0\.1:(?:3081|3108|3110)/?;', 'proxy_pass http://127.0.0.1:3110;',s)
if n==0:raise SystemExit('Expected upstream not found')
p.write_text(s)
PY
nginx -t
systemctl reload nginx
for FTI_ROUTE in / /app/ /token/ /admin/ /api/config /health; do
 curl -fsS --max-time 20 --resolve ftiprotocol.com:443:127.0.0.1 "https://ftiprotocol.com$FTI_ROUTE" -o /dev/null
 echo "PASS $FTI_ROUTE"
done
systemctl restart fti-continuity-keeper.service
systemctl is-active --quiet fti-continuity-web.service fti-continuity-keeper.service
FTI_SWITCHING=0
trap - ERR
echo "FTI_CONTINUITY_INSTALLED: https://ftiprotocol.com/"
echo "Deployment record: $FTI_STATE/deployment.json"
echo "Rollback: bash $FTI_BACKUP/rollback.sh"
echo 'Fresh TESTNET contracts only. Former users, contracts and funds were not transferred or deleted.'
