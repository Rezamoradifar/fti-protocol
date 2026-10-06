#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "$(id -u)" -ne 0 ]; then
  echo 'Run as root on the server.'
  exit 1
fi

DEPLOYMENT_FILE="${DEPLOYMENT_FILE:-deployments/v3-testnet.json}"

node --input-type=module -e '
import fs from "node:fs";
const file=process.env.DEPLOYMENT_FILE||"deployments/v3-testnet.json";
const c=JSON.parse(fs.readFileSync(file));
if(c.chainId!==97||c.mode!=="testnet")throw Error("BNB testnet deployment required");
if(c.tokenContract!=="FTIReserveTokenV3")throw Error("FTIReserveTokenV3 deployment required");
if(c.binaryContract!=="FundedBinaryPlan")throw Error("FundedBinaryPlan deployment required");
if(c.councilContract!=="SevenGuardianCouncil")throw Error("SevenGuardianCouncil deployment required");
if(Number(process.versions.node.split(".")[0])<22)throw Error("Use Node 22 or newer");
'

npm ci
npm run build:web

APP_DIR="$(pwd)"
NODE_BIN="$(command -v node)"

cat > /etc/systemd/system/fti-v3-testnet-web.service <<UNIT
[Unit]
Description=FTI V3 React Testnet Workspace
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN $APP_DIR/scripts/server-v3.mjs
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=3001
Environment=RPC_URL=https://bsc-testnet-dataseed.bnbchain.org
Environment=DEPLOYMENT_FILE=$DEPLOYMENT_FILE
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now fti-v3-testnet-web
systemctl restart fti-v3-testnet-web

if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw allow 3001/tcp
fi

curl --retry 12 --retry-connrefused --retry-delay 2 --fail --silent --show-error \
  http://127.0.0.1:3001/health

printf '\nFTI V3 workspace is running on port 3001. Put HTTPS/Nginx in front of this port for public access.\n'
