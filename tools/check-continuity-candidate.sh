#!/usr/bin/env bash
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
command -v git >/dev/null
FTI_DIR="$(mktemp -d /opt/fti/continuity-check.XXXXXX)"
git clone --single-branch --branch fix/funded-point-floor-20261009 https://github.com/Rezamoradifar/fti-protocol.git "$FTI_DIR"
cd "$FTI_DIR"
git checkout --detach "$FTI_REV"
test "$(git rev-parse HEAD)" = "$FTI_REV"
npm ci
npm run compile
node scripts/compile-continuity-layout.mjs
node --test --test-concurrency=1 \
 test/funded-keeper.test.mjs \
 test/recovery-freeze.test.mjs \
 test/point-floor-candidate.test.mjs \
 test/continuity-upgrade.test.mjs \
 test/continuity-monitor.test.mjs \
 2>&1 | tee "$FTI_DIR/verification.log"
echo "CONTINUITY_CHECK_PASS: $FTI_DIR"
echo 'Local simulated checks only. No server services or deployed contracts were replaced.'
