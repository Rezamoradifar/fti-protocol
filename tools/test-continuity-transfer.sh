#!/usr/bin/env bash
# Local-EVM verification only. No live upgrade, signer or service operations.
set -euo pipefail
umask 077
FTI_REV="${1:?Pass the reviewed full commit SHA}"
[[ $# = 1 && "$FTI_REV" =~ ^[a-f0-9]{40}$ ]] || {
  echo 'Exactly one full, lowercase commit SHA is required.' >&2; exit 2;
}
case "$(uname -m)" in
  x86_64) FTI_ARCH=x64 ;;
  aarch64) FTI_ARCH=arm64 ;;
  *) echo 'Unsupported architecture.' >&2; exit 2 ;;
esac
# An explicit executable is useful on servers using a different Node install.
FTI_NODE="${FTI_NODE_BINARY:-}"
if [[ -z "$FTI_NODE" ]]; then
  FTI_NODE="/opt/fti/runtime/node-v22.23.3-$FTI_ARCH/bin/node"
  [[ -x "$FTI_NODE" ]] || FTI_NODE="$(type -P node || true)"
fi
[[ "$FTI_NODE" = /* && -f "$FTI_NODE" && -x "$FTI_NODE" ]] || {
  echo 'Node >=22 is required. Set FTI_NODE_BINARY to its absolute executable path.' >&2
  exit 2
}
FTI_NODE_DIR="$(cd -- "$(dirname -- "$FTI_NODE")" && pwd -P)"
[[ "$(basename -- "$FTI_NODE")" = node ]] || {
  echo 'The selected executable must be named node.' >&2; exit 2;
}
FTI_CHECK_DIR="$(mktemp -d "${TMPDIR:-/var/tmp}/fti-transition-check.XXXXXX")"
mkdir -p "$FTI_CHECK_DIR/home" "$FTI_CHECK_DIR/tmp"
printf 'FTI_RESULT_DIR=%s\n' "$FTI_CHECK_DIR"
# Do not inherit RPC, wallet, fork, npm-token, Node preload or production config
# variables. The private HOME also prevents reuse of the service user's .npmrc.
# This is environment isolation, NOT an OS/network sandbox for untrusted code.
/usr/bin/env -i \
  HOME="$FTI_CHECK_DIR/home" TMPDIR="$FTI_CHECK_DIR/tmp" \
  PATH="$FTI_NODE_DIR:/usr/local/bin:/usr/bin:/bin" \
  LANG=C.UTF-8 CI=1 NO_COLOR=1 GIT_TERMINAL_PROMPT=0 \
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  NPM_CONFIG_USERCONFIG="$FTI_CHECK_DIR/home/.npmrc" \
  /bin/bash --noprofile --norc -s -- "$FTI_REV" "$FTI_CHECK_DIR" <<'VERIFY' 2>&1 | tee "$FTI_CHECK_DIR/verification.log"
set -euo pipefail
umask 077
rev="$1"; work="$2"; stage=node; result=FAILED
finish() {
  status=$?
  trap - EXIT
  printf '{"schema":"FTI_LOCAL_RUN_V1","scope":"LOCAL_EVM_NOT_LIVE_NETWORK","commit":"%s","stage":"%s","result":"%s","exitCode":%d}\n' \
    "$rev" "$stage" "$result" "$status" > "$work/result.json"
  exit "$status"
}
trap finish EXIT
major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$major" =~ ^[0-9]+$ ]] && (( 10#$major >= 22 )) || {
  echo 'Node >=22 is required.' >&2; exit 2;
}
node --version
mkdir "$work/source"
cd "$work/source"
stage=checkout
git init -q
git remote add origin https://github.com/Rezamoradifar/fti-protocol.git
# Fetch the immutable reviewed revision, not a mutable release branch.
git -c credential.helper= fetch --depth=1 origin "$rev"
git checkout --detach FETCH_HEAD
[[ "$(git rev-parse HEAD)" = "$rev" ]] || {
  echo 'Commit identity mismatch.' >&2; exit 3;
}
stage=install
npm ci
stage=compile
npm run compile
stage=tests
node --test --test-concurrency=2 test/*.test.mjs
stage=build
npm run build:web
stage=complete; result=PASS
printf 'TRANSFER_VERIFICATION_PASS: %s/verification.log\n' "$work"
echo 'Local EVM only. No live migration, upgrade, service switch or funds movement is performed by this runner.'
VERIFY
