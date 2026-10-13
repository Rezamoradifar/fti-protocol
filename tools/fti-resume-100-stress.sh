#!/usr/bin/env bash
# Safe resume of existing FTI 100-wallet BNB Testnet (97) run.
set +x
set -euo pipefail
umask 077
test "$EUID" = 0 && test "$(hostname)" = "vps-titan-5320" || { echo WRONG_FTI_SERVER; exit 1; }
NODE='/opt/fti/runtime/node-v22.23.3-x64/bin/node'
SRC='/root/fti-fresh-testnet-runner/run-d0o29raa/candidates/fresh-DtCQihcY/source'
SCRIPT='/root/fti-fresh-100-testnet.cjs'
STATE='/root/fti-fresh-100-testnet'
KEY='/root/fti-private/fti-testnet-funder.key'
test -x "$NODE" && test -d "$SRC" && test -f "$SCRIPT" && test -d "$STATE" || { echo FTI_SOURCE_OR_WALLETS_MISSING; exit 1; }
printf '%s  %s\n' '61254b192d45040f26e1f22a86a8bc01e70243461e31fb58e72c0e5757268f5f' "$SCRIPT" | sha256sum -c - || exit 1
test -f "$KEY" && test ! -L "$KEY" && test "$(stat -c %a "$KEY")" = 600 && test "$(stat -c %u "$KEY")" = 0 || { echo PRIVATE_TESTNET_SIGNER_KEY_NOT_ROOT_0600; exit 1; }
if test -e "$STATE/operation.lock"; then
  echo PREVIOUS_TEST_LOCK_EXISTS_DO_NOT_REMOVE
  ps -eo pid,etime,args | grep '[f]ti-fresh-100-testnet.cjs run' || true
  python3 - <<'PY'
import json
p='/root/fti-fresh-100-testnet/journal-PRIVATE.json'
j=json.load(open(p))
q=j.get('pending')
print('PENDING_RECEIPT:',{k:q.get(k) for k in ('label','hash')} if q else None)
PY
  exit 2
fi
read -r DIGEST MODE <<<"$(python3 - <<'PY'
import json
from pathlib import Path
p=Path('/root/fti-fresh-100-testnet')
plan=json.loads((p/'plan.json').read_text())
j=json.loads((p/'journal-PRIVATE.json').read_text())
assert plan['chainId']==97 and len(plan['walletAddresses'])==100
assert plan['digest']==j['planDigest']
assert j.get('transactionCount',0)<1600
assert int(j['upperNativeReserved'])<int(plan['maxTotalNativeWei']),'BUDGET_LIMIT'
completed=j.get('completed',{})
def count(prefix):
    return sum(k.startswith(prefix+'-') and k[len(prefix)+1:].isdigit() for k in completed)
nums={k:count(k) for k in ('register','buy','transfer','sell','auto-pref')}
mode='done' if all(v==100 for v in nums.values()) else 'full' if all(v>=3 for v in nums.values()) else 'pilot'
import sys
print('STATUS',nums,'PENDING_HASH',j.get('pending',{}).get('hash') if j.get('pending') else None,file=sys.stderr)
print(plan['digest'],mode)
PY
)"
if test "$MODE" = done; then echo FTI_100_ALREADY_COMPLETE; exit 0; fi
cd "$SRC"
"$NODE" "$SCRIPT" status >/root/fti-100-resume-preflight.log 2>&1 || {
  echo FTI_READ_ONLY_PREFLIGHT_FAILED
  tail -n 30 /root/fti-100-resume-preflight.log
  exit 1
}
LOG="/root/fti-100-resume-$MODE.log"
if test "$MODE" = pilot; then
  nohup "$NODE" "$SCRIPT" run --pilot --send --confirm-plan "$DIGEST" --funder-key-file "$KEY" >"$LOG" 2>&1 </dev/null &
else
  nohup "$NODE" "$SCRIPT" run --send --confirm-plan "$DIGEST" --funder-key-file "$KEY" >"$LOG" 2>&1 </dev/null &
fi
echo "FTI_RESUME_STARTED mode=$MODE pid=$! log=$LOG"
