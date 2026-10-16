#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077
[[ $EUID == 0 ]]
source="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
web_pid="$(systemctl show fti-continuity-web.service --property=MainPID --value)"
[[ "$web_pid" =~ ^[0-9]+$ ]] && (( web_pid > 1 ))
node_bin="$(readlink -f "/proc/$web_pid/exe")"
[[ "$node_bin" == /opt/fti/runtime/node-v22.*/bin/node && -x "$node_bin" ]]
export PATH="$(dirname -- "$node_bin"):$PATH"
cd -- "$source"
npm ci
npm run build:web
python3 tools/apply-mainnet-ui.py --source "$source"
python3 tools/check-mainnet-keeper.py
