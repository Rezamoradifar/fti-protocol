#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[ "$(id -u)" = 0 ] || { echo 'Run as root on the existing FTI testnet server.'; exit 1; }
if systemctl is-active --quiet fti-v3-load-1000.service; then echo 'Test already running. Use: tail -f /root/fti-v3-1000.log'; exit 0; fi
FTI_RELEASE="$(systemctl show fti-v3-web.service -p WorkingDirectory --value)"
test -s "$FTI_RELEASE/artifacts/FTIReserveTokenV3.json"
case "$(uname -m)" in x86_64) FTI_ARCH=x64;; aarch64) FTI_ARCH=arm64;; *) exit 1;; esac
FTI_NODE="/opt/fti/runtime/node-v22.23.3-$FTI_ARCH/bin/node"
test -x "$FTI_NODE"
FTI_RUNNER=/root/fti-v3-1000.mjs
curl -fsSL --retry 3 https://raw.githubusercontent.com/Rezamoradifar/fti-protocol/ac8f21fadf1f4d20157091720a29fa38f90a6283/tools/testnet-v3-1000.mjs -o "$FTI_RUNNER"
echo "73798c1ccc4c8f4dc6a0ca8eab70370c4bed25f9e0b6d0b88bf8f1827b60977f  $FTI_RUNNER" | sha256sum -c -
# Place the module next to the installed dependencies, without changing service code.
FTI_MODULE="$FTI_RELEASE/tools/fti-public-1000.mjs"
cp "$FTI_RUNNER" "$FTI_MODULE"
export V3_SERVER_CONFIG=/etc/fti-v3/web.env
export V3_DEPLOYMENT_FILE=/var/lib/fti-v3/b1c2ea914dee1e05d55f761ad3b1804aa6ada6b4/deployment.json
export V3_ARTIFACT_DIR="$FTI_RELEASE/artifacts"
"$FTI_NODE" "$FTI_MODULE"
FTI_KEY_FILE=/root/.fti-v3-1000-funder.key
if [ ! -s "$FTI_KEY_FILE" ]; then
  echo 'Use a separate funded BNB TESTNET gas wallet. Do not use the active keeper wallet.'
  read -r -s -p 'Dedicated TESTNET private key (hidden, stored only on this server): ' FTI_TEST_KEY </dev/tty
  echo
  [[ "$FTI_TEST_KEY" =~ ^(0x)?[0-9a-fA-F]{64}$ ]] || { unset FTI_TEST_KEY; echo 'Invalid key format.'; exit 1; }
  printf '%s' "$FTI_TEST_KEY" > "$FTI_KEY_FILE"
  unset FTI_TEST_KEY
fi
chmod 600 "$FTI_KEY_FILE"
systemd-run --unit=fti-v3-load-1000 --collect \
  --property="WorkingDirectory=$FTI_RELEASE" \
  --property=TimeoutStopSec=240s \
  --property=StandardOutput=append:/root/fti-v3-1000.log \
  --property=StandardError=append:/root/fti-v3-1000.log \
  --setenv="V3_SERVER_CONFIG=$V3_SERVER_CONFIG" \
  --setenv="V3_DEPLOYMENT_FILE=$V3_DEPLOYMENT_FILE" \
  --setenv="V3_ARTIFACT_DIR=$V3_ARTIFACT_DIR" \
  --setenv="TEST_FUNDER_KEY_FILE=$FTI_KEY_FILE" \
  --setenv=TEST_KEEPER_CONFIG=/etc/fti-v3/keeper.env \
  --setenv=TEST_BUDGET_TBNB=5 \
  --setenv=TEST_WAIT_HOURLY=1 \
  --setenv=TEST_STATE_DIR=/root/.fti-v3-testnet-1000 \
  "$FTI_NODE" "$FTI_MODULE" --write
echo 'Started independently of SSH. Follow: tail -f /root/fti-v3-1000.log'
echo 'Reports and private journals: /root/.fti-v3-testnet-1000/'
echo 'If the gas budget or balance runs out, fund this same test wallet and rerun this command to resume.'
