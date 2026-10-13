#!/usr/bin/env bash
# Build and rehearse in a private isolated directory. No RPC/signing/service writes.
set -euo pipefail
umask 077
[[ $# == 1 && "$1" =~ ^[a-f0-9]{40}$ ]] || { echo 'Usage: bash prepare-mainnet-candidate.sh FULL_REVIEWED_SHA' >&2; exit 2; }
[[ $EUID == 0 ]] || { echo 'Run on the FTI server as root.' >&2; exit 2; }
rev="$1"
case "$(uname -m)" in x86_64) arch=x64;; aarch64) arch=arm64;; *) arch=unknown;; esac
node_bin="${FTI_NODE_BINARY:-/opt/fti/runtime/node-v22.23.3-$arch/bin/node}"
if [[ ! -x "$node_bin" && -z "${FTI_NODE_BINARY:-}" ]]; then node_bin="$(type -P node || true)"; fi
[[ "$node_bin" = /* && -x "$node_bin" && "$(basename "$node_bin")" == node ]] || { echo 'Node 22+ required; set FTI_NODE_BINARY.' >&2; exit 2; }
node_dir="$(cd -- "$(dirname -- "$node_bin")" && pwd -P)"
work="$(mktemp -d /var/tmp/fti-mainnet-candidate.XXXXXXXX)"
mkdir "$work/home" "$work/tmp"
printf 'FTI_MAINNET_CANDIDATE_DIR=%s\n' "$work"
/usr/bin/env -i HOME="$work/home" TMPDIR="$work/tmp" PATH="$node_dir:/usr/local/bin:/usr/bin:/bin" LANG=C.UTF-8 CI=1 NO_COLOR=1 \
 GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null NPM_CONFIG_USERCONFIG="$work/home/.npmrc" \
 /bin/bash --noprofile --norc -s -- "$rev" "$work" <<'PREPARE' 2>&1 | tee "$work/prepare.log"
set -euo pipefail
umask 077
rev="$1"; work="$2"; stage=node; result=FAILED
finish(){
 code=$?; trap - EXIT
 printf '{"schema":"FTI_MAINNET_CANDIDATE_V1","commit":"%s","stage":"%s","result":"%s","exitCode":%d,"submitted":false,"servicesActivated":false,"usersImported":0,"readyToBroadcast":false}\n' \
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
npm --prefix landing ci
stage=compile
npm run compile
stage=web
npm run build:web
npm --prefix landing run build
stage=tests
node --test --test-concurrency=2 test/mainnet-*.test.mjs test/wallet-discovery.test.mjs test/continuity-monitor.test.mjs test/funded-keeper.test.mjs test/fresh-testnet.test.mjs test/global-frontend.test.mjs test/site-routing.test.mjs test/v3-server.test.mjs test/event-server.test.mjs
stage=templates
cp config/mainnet-input.example.json "$work/mainnet-input.REQUIRED.json"
cp config/mainnet-transactions.example.json "$work/mainnet-transactions.REQUIRED.json"
cp config/mainnet-services.env.example "$work/mainnet-services.REQUIRED.env"
stage=complete; result=MAINNET_CANDIDATE_PREPARED
printf 'FTI_MAINNET_CANDIDATE_PREPARED=%s\n' "$work"
echo 'Local rehearsal complete. No public RPC, private keys, transactions or service switches.'
echo 'Existing-user mainnet launch still requires an explicit financial migration policy and matching funded importer.'
PREPARE
