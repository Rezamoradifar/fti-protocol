#!/usr/bin/env bash
# Web-only activation; no deployment or Keeper signing.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077
[[ $EUID == 0 ]] || { echo 'Run on the FTI VPS as root.' >&2; exit 2; }
tool_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source=/var/tmp/fti-metamask-release.DkBBCLZm
[[ "$(git -C "$source" rev-parse HEAD)" == ba82373a83d63fba0643332371cfb6d62903c849 ]]
git -C "$source" diff --quiet
git -C "$source" diff --cached --quiet
web_pid="$(systemctl show fti-continuity-web.service --property=MainPID --value)"
[[ "$web_pid" =~ ^[0-9]+$ ]] && (( web_pid > 1 ))
node_bin="$(readlink -f "/proc/$web_pid/exe")"
[[ "$node_bin" == /opt/fti/runtime/node-v22.*/bin/node && -x "$node_bin" ]]
export PATH="$(dirname -- "$node_bin"):$PATH"
cd -- "$source"
npm ci
npm run compile
npm run build:web
npm --prefix landing ci
npm --prefix landing run build
# Prompts for the private mainnet RPC on the terminal, without echoing it.
python3 "$tool_dir/activate-mainnet-web.py" --source "$source"
