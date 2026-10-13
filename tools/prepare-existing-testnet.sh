#!/usr/bin/env bash
# Stage a pinned release, back up port 3110 and prepare an UNSIGNED same-chain
# migration. Never create test users, read signing keys or change live services.
set -euo pipefail
umask 077
[[ $# == 1 && "$1" =~ ^[a-f0-9]{40}$ ]] || { echo 'Usage: bash prepare-existing-testnet.sh FULL_REVIEWED_SHA' >&2; exit 2; }
[[ $EUID == 0 ]] || { echo 'Run on the existing FTI server as root.' >&2; exit 2; }
rev="$1"
case "$(uname -m)" in x86_64) arch=x64;; aarch64) arch=arm64;; *) arch=unknown;; esac
node_bin="${FTI_NODE_BINARY:-/opt/fti/runtime/node-v22.23.3-$arch/bin/node}"
if [[ ! -x "$node_bin" && -z "${FTI_NODE_BINARY:-}" ]]; then node_bin="$(type -P node || true)"; fi
[[ "$node_bin" = /* && -x "$node_bin" && "$(basename "$node_bin")" == node ]] || { echo 'Node 22+ required; set FTI_NODE_BINARY to its absolute path.' >&2; exit 2; }
node_dir="$(cd -- "$(dirname -- "$node_bin")" && pwd -P)"
work="$(mktemp -d /var/tmp/fti-existing-testnet.XXXXXXXX)"
mkdir "$work/home" "$work/tmp"
printf 'FTI_EXISTING_TESTNET_DIR=%s\n' "$work"
/usr/bin/env -i HOME="$work/home" TMPDIR="$work/tmp" \
 PATH="$node_dir:/usr/local/bin:/usr/bin:/bin" LANG=C.UTF-8 CI=1 NO_COLOR=1 \
 GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
 NPM_CONFIG_USERCONFIG="$work/home/.npmrc" \
 /bin/bash --noprofile --norc -s -- "$rev" "$work" <<'PREPARE' 2>&1 | tee "$work/prepare.log"
set -euo pipefail
umask 077
rev="$1"; work="$2"; stage=node; result=FAILED
finish() {
 code=$?; trap - EXIT
 printf '{"schema":"FTI_EXISTING_TESTNET_PREPARATION_V1","commit":"%s","stage":"%s","result":"%s","exitCode":%d,"chainId":97,"submitted":false,"liveActivated":false,"usersMoved":false,"fundsMoved":false}\n' \
  "$rev" "$stage" "$result" "$code" > "$work/result.json"
 exit "$code"
}
trap finish EXIT
major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$major" =~ ^[0-9]+$ ]] && (( 10#$major >= 22 )) || { echo 'Node >=22 required.' >&2; exit 2; }
stage=checkout
mkdir "$work/source"; cd "$work/source"
git init -q
git remote add origin https://github.com/Rezamoradifar/fti-protocol.git
git -c credential.helper= fetch --depth=1 origin "$rev"
git checkout --detach FETCH_HEAD
[[ "$(git rev-parse HEAD)" == "$rev" ]] || { echo 'Checkout identity mismatch.' >&2; exit 3; }
stage=dependencies
npm ci
stage=compile
npm run compile
stage=web
npm run build:web
stage=tests
node --test --test-concurrency=2 test/address-migration*.test.mjs test/hourly-cap-*.test.mjs test/referral-layout.test.mjs test/continuity-upgrade.test.mjs
stage=source_backup
printf 'FTI_BACKUP_LOG=%s/backup.log\n' "$work"
python3 -I tools/backup-users-state.py --ports 3110 --output-root "$work/backups" > "$work/backup.log" 2>&1
snapshot="$(python3 -I - "$work" <<'PY'
import json, pathlib, sys
base=pathlib.Path(sys.argv[1])/'backups'
results=list(base.glob('capture-*/result.json'))
if len(results)!=1: raise SystemExit('Exactly one completed backup required')
r=json.loads(results[0].read_text())
if r.get('result')!='FTI_USERS_BACKUP_SAVED' or r.get('archiveRestoreCheck')!='PASS':
    raise SystemExit('Verified backup required')
folder=results[0].parent/'data'/'port-3110'
cfg=json.loads((folder/'deployment-public.json').read_text())
if cfg.get('chainId')!=97: raise SystemExit('Existing testnet 97 required')
print(folder)
PY
)"
export FTI_MIGRATION_RPC_URL=http://127.0.0.1:3110/rpc
stage=source_preflight
node scripts/migrate-addresses.mjs preflight --config "$snapshot/deployment-public.json" \
 --source-artifacts "$snapshot/artifacts" --out "$work/source-preflight.json"
stage=unsigned_plan
node scripts/migrate-addresses.mjs deploy --config "$snapshot/deployment-public.json" \
 --source-artifacts "$snapshot/artifacts" --out "$work/migration-deploy-unsigned.json"
stage=complete; result=EXISTING_TESTNET_PREPARED
printf 'FTI_EXISTING_TESTNET_PREPARED=%s\n' "$work"
echo 'Backup and unsigned migration plan prepared. No transaction or service switch.'
echo 'Migration preserves source logic and state. Installing this candidate logic is a separate governed upgrade.'
echo 'Source freezing, migration and reopening require the existing 5-of-7 council and 72-hour timelock.'
PREPARE
