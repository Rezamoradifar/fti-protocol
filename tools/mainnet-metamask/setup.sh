#!/usr/bin/env bash
# Run only in the reviewed isolated release checkout. No transaction signing.
set -euo pipefail
umask 077
[[ $EUID == 0 && $# == 1 && "$1" =~ ^[a-f0-9]{40}$ ]] || { echo 'Usage (root): bash tools/mainnet-metamask/setup.sh FULL_REVIEWED_SHA' >&2; exit 2; }
[[ "$(git rev-parse HEAD)" == "$1" ]] || { echo 'Wrong release revision' >&2; exit 2; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo 'Tracked source changes require review and a commit' >&2; exit 2; }
case "$(uname -m)" in x86_64) arch=x64;; aarch64) arch=arm64;; *) arch=unknown;; esac
node_bin="${FTI_NODE_BINARY:-/opt/fti/runtime/node-v22.23.3-$arch/bin/node}"
if [[ ! -x "$node_bin" && -z "${FTI_NODE_BINARY:-}" ]]; then node_bin="$(type -P node || true)"; fi
[[ "$node_bin" = /* && -x "$node_bin" && "$(basename "$node_bin")" == node ]] || { echo 'Node 22+ required; set FTI_NODE_BINARY' >&2; exit 2; }
export PATH="$(dirname -- "$node_bin"):/usr/local/bin:/usr/bin:/bin"
node -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(2)'
npm ci
npm --prefix landing ci
npm run compile
npm run build:web
npm --prefix landing run build
node --test --test-concurrency=2 test/mainnet-approved-profile.test.mjs test/mainnet-metamask.test.mjs test/continuity-public-1000-policy.test.mjs
python3 -m unittest discover -s tools/mainnet-metamask -p 'test_*.py' -v
work="$(mktemp -d /var/tmp/fti-metamask-operator.XXXXXXXX)"
rpc_created=''
cleanup(){ if [[ -n "$rpc_created" ]]; then rm -f -- "$rpc_created"; fi; }
trap cleanup EXIT
if [[ -z "${FTI_MAINNET_RPC_FILE:-}" ]]; then
 [[ -z "${FTI_MAINNET_RPC_URL:-}" ]] || { echo 'Use a private RPC file for this setup' >&2; exit 2; }
 rpc_created="$work/operator.rpc"
 python3 - "$rpc_created" <<'RPC'
import getpass, os, sys, warnings
# Fail closed if hidden input is unavailable; never fall back to echoed input.
warnings.simplefilter('error', getpass.GetPassWarning)
with open('/dev/tty', 'w') as tty:
    value = getpass.getpass('GetBlock mainnet RPC (hidden; not a wallet key): ', stream=tty).strip()
if not value:
    raise SystemExit('Empty RPC')
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as out:
    out.write(value + '\n')
    out.flush()
    os.fsync(out.fileno())
RPC
 export FTI_MAINNET_RPC_FILE="$rpc_created"
fi
node tools/mainnet-metamask/build.mjs --out "$work/public" | tee "$work/build-result.json"
digest="$(python3 - "$work/build-result.json" <<'DIGEST'
import json, sys
print(json.load(open(sys.argv[1]))['digest'])
DIGEST
)"
python3 tools/mainnet-metamask/install.py --directory "$work/public" --digest "$digest" | tee "$work/install-result.json"
echo 'STATIC SIGNING PAGE ONLY: no transaction was submitted, no web/Keeper deployment was activated.'
echo 'Review final-SHA CI and public-testnet evidence before approving any mainnet transaction in MetaMask.'
