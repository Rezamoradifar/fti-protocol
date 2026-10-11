#!/usr/bin/env bash
# Stage and verify a pinned release; never switch a service or sign an upgrade.
set -euo pipefail
umask 077
[[ $# == 1 && "$1" =~ ^[a-f0-9]{40}$ ]] || { echo 'Usage: bash prepare-builder-controls.sh FULL_REVIEWED_SHA' >&2; exit 2; }
rev="$1"
node_bin="${FTI_NODE_BINARY:-}"
if [[ -z "$node_bin" ]]; then
  case "$(uname -m)" in x86_64) arch=x64;; aarch64) arch=arm64;; *) arch=unknown;; esac
  node_bin="/opt/fti/runtime/node-v22.23.3-$arch/bin/node"
  [[ -x "$node_bin" ]] || node_bin="$(type -P node || true)"
fi
[[ "$node_bin" = /* && -f "$node_bin" && -x "$node_bin" && "$(basename "$node_bin")" == node ]] || {
  echo 'Node >=22 required. Set FTI_NODE_BINARY to its absolute executable path.' >&2; exit 2;
}
node_dir="$(cd -- "$(dirname -- "$node_bin")" && pwd -P)"
base="${FTI_CANDIDATE_ROOT:-$HOME/fti-candidates}"
mkdir -p -- "$base"
work="$(mktemp -d "$base/builder-XXXXXXXX")"
work="$(cd -- "$work" && pwd -P)"
mkdir -p "$work/home" "$work/tmp"
printf 'FTI_CANDIDATE_DIR=%s\n' "$work"
# A clean environment is not an OS sandbox; execute reviewed commits only.
/usr/bin/env -i HOME="$work/home" TMPDIR="$work/tmp" \
  PATH="$node_dir:/usr/local/bin:/usr/bin:/bin" LANG=C.UTF-8 CI=1 NO_COLOR=1 \
  GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  NPM_CONFIG_USERCONFIG="$work/home/.npmrc" \
  /bin/bash --noprofile --norc -s -- "$rev" "$work" <<'BUILD' 2>&1 | tee "$work/install.log"
set -euo pipefail
umask 077
rev="$1"; work="$2"; stage=node; result=FAILED
finish() {
  code=$?; trap - EXIT
  printf '{"schema":"FTI_BUILDER_CANDIDATE_V1","commit":"%s","stage":"%s","result":"%s","exitCode":%d,"liveActivated":false,"fundsMoved":false}\n' \
    "$rev" "$stage" "$result" "$code" > "$work/result.json"
  exit "$code"
}
trap finish EXIT
major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$major" =~ ^[0-9]+$ ]] && (( 10#$major >= 22 )) || { echo 'Node >=22 required.' >&2; exit 2; }
node --version
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
stage=storage
node scripts/check-upgrade-layout.mjs docs/storage-layout/FundedBinaryPlanUpgradeable-20261009.json artifacts/storage-layout/FundedBinaryPlanUpgradeable.json
stage=tests
node --test --test-concurrency=2 test/global-builder-controls.test.mjs test/funded-keeper.test.mjs test/continuity-deployment.test.mjs test/continuity-upgrade.test.mjs test/address-migration*.test.mjs test/builder-installer.test.mjs
stage=web
npm run build:web
stage=complete; result=CANDIDATE_PREPARED
printf 'FTI_BUILDER_CANDIDATE_PREPARED: %s/source\n' "$work"
echo 'NOT ACTIVATED: existing web/keeper, deployment config, proxy addresses and balances are unchanged.'
echo 'Review the existing governed upgrade/migration and matching release provenance before switching services.'
BUILD
