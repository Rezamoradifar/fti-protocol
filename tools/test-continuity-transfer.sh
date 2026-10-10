#!/usr/bin/env bash
# Isolated local-EVM checks on the server; no signing or live contract changes.
set -euo pipefail
FTI_REV="${1:?Pass the reviewed full commit SHA}"
[[ "$FTI_REV" =~ ^[a-f0-9]{40}$ ]] || { echo 'Full commit SHA required'; exit 1; }
case "$(uname -m)" in
 x86_64) FTI_ARCH=x64 ;;
 aarch64) FTI_ARCH=arm64 ;;
 *) echo 'Unsupported architecture'; exit 1 ;;
esac
FTI_RUNTIME="/opt/fti/runtime/node-v22.23.3-$FTI_ARCH/bin"
test -x "$FTI_RUNTIME/node"
export PATH="$FTI_RUNTIME:$PATH"
FTI_CHECK_DIR="$(mktemp -d /var/tmp/fti-transition-check.XXXXXX)"
git clone --single-branch --branch fix/funded-point-floor-20261009 \
 https://github.com/Rezamoradifar/fti-protocol.git "$FTI_CHECK_DIR"
cd "$FTI_CHECK_DIR"
git checkout --detach "$FTI_REV"
test "$(git rev-parse HEAD)" = "$FTI_REV"
npm ci
npm run compile
node --test --test-concurrency=2 test/*.test.mjs 2>&1 | tee verification.log
npm run build:web
echo "TRANSFER_VERIFICATION_PASS: $FTI_CHECK_DIR/verification.log"
echo 'Local EVM only. No users, live contracts, services or funds were moved.'
