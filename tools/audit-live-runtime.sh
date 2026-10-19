#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077
[[ $EUID == 0 ]]
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
pid="$(systemctl show fti-continuity-web.service --property=MainPID --value)"
[[ "$pid" =~ ^[0-9]+$ ]] && ((pid>1))
node_bin="$(readlink -f "/proc/$pid/exe")"
[[ "$node_bin" == /opt/fti/runtime/node-v22.*/bin/node && -x "$node_bin" ]]
live_dir="$(systemctl show fti-continuity-web.service --property=WorkingDirectory --value)"
[[ "$live_dir" == /opt/fti/releases/* && -d "$live_dir/node_modules" ]]
mkdir -p /var/backups/fti-runtime-audit
report_dir=$(mktemp -d /var/backups/fti-runtime-audit/check-XXXXXXXX)
cd -- "$live_dir"
"$node_bin" "$source_dir/scripts/audit-installed.mjs" "$report_dir/installed"
[[ "$(systemctl show fti-continuity-web.service --property=MainPID --value)" == "$pid" ]]
printf 'FTI_LIVE_RUNTIME_AUDIT_COMPLETE report=%s/installed.json\n' "$report_dir"
