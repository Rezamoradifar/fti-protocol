#!/usr/bin/env bash
# Interactive BNB testnet bootstrap. Existing sites/contracts are never changed.
set -euo pipefail
umask 077
[[ $EUID == 0 && -t 0 && -t 1 ]] || { echo 'Run as root in an interactive server terminal.' >&2; exit 2; }
candidate=bc2163070a6e79bcc129a6a788e61c4ace402bdf
runner_rev=1d3945617d785d18135ea7bf91df2b3f40adb1e0
runner_hash=e3b2576a18528e3e6b734b417f98e528d6373cb013bb93587d1fa0b6ce3731c5
marker="/root/fti-fresh-testnet-runner/$candidate/deployment-requested.json"
[[ ! -e "$marker" ]] || { echo "A deployment was already requested. Inspect $marker and its journal; no repeat." >&2; exit 2; }

missing=0
for command in curl git python3 tar xz flock; do command -v "$command" >/dev/null || missing=1; done
if (( missing )); then
  command -v apt-get >/dev/null || { echo 'Install curl, git, Python 3, tar, xz and flock first.' >&2; exit 2; }
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl git python3 tar xz-utils util-linux
fi

# A private shared bootstrap lock prevents overlapping setup attempts. The
# underlying runner independently locks signing and keeps its one-shot marker.
task_dir="$(mktemp -d /root/fti-complete-testnet.XXXXXXXX)"
exec 9>"/root/.fti-complete-testnet.lock"
flock -n 9 || { echo 'Another complete installer is running.' >&2; exit 2; }
printf 'BOOTSTRAP_DIRECTORY=%s\nREVIEWED_SOURCE=%s\n' "$task_dir" "$candidate"

case "$(uname -m)" in
  x86_64) arch=x64; node_hash=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de;;
  aarch64) arch=arm64; node_hash=a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f;;
  *) echo 'Supported architectures: x86_64 and aarch64.' >&2; exit 2;;
esac
node_bin="/opt/fti/runtime/node-v22.23.3-$arch/bin/node"
[[ -x "$node_bin" ]] || node_bin="$(command -v node || true)"
node_ok=0
if [[ -n "$node_bin" && -x "$node_bin" ]]; then
  if "$node_bin" -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)' >/dev/null 2>&1; then node_ok=1; fi
fi
if (( ! node_ok )); then
  archive="node-v22.23.3-linux-$arch.tar.xz"
  curl --proto '=https' --tlsv1.2 -fL --retry 2 --connect-timeout 15 --max-time 600 \
    "https://nodejs.org/dist/v22.23.3/$archive" -o "$task_dir/$archive"
  printf '%s  %s\n' "$node_hash" "$task_dir/$archive" | sha256sum -c -
  tar --no-same-owner --no-same-permissions -xJf "$task_dir/$archive" -C "$task_dir"
  node_bin="$task_dir/node-v22.23.3-linux-$arch/bin/node"
  [[ "$("$node_bin" --version)" == v22.23.3 ]]
fi

runner="$task_dir/start-fresh-testnet.py"
curl --proto '=https' --tlsv1.2 -fL --retry 2 --connect-timeout 15 --max-time 120 \
  "https://raw.githubusercontent.com/Rezamoradifar/fti-protocol/$runner_rev/tools/start-fresh-testnet.py" -o "$runner"
printf '%s  %s\n' "$runner_hash" "$runner" | sha256sum -c -

python3 -I - "$runner" <<'PY'
import getpass
from pathlib import Path
import re
import runpy
import sys

helpers = runpy.run_path(sys.argv[1])
folder = helpers['private_dir'](Path('/root/.fti-private'))
keyfile = folder / 'testnet-deployer.key'
if keyfile.exists() or keyfile.is_symlink():
    helpers['check_key_path'](str(keyfile))
    print('EXISTING_PRIVATE_KEY_FILE=' + str(keyfile))
else:
    print('Enter the private key of your dedicated funded TESTNET deployer wallet locally.')
    key = getpass.getpass('TESTNET deployer private key (hidden): ').strip()
    if not re.fullmatch(r'(?:0[xX])?[0-9a-fA-F]{64}', key):
        raise SystemExit('Invalid private key format. No file created.')
    raw = key[2:] if key.lower().startswith('0x') else key
    order = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
    if not 0 < int(raw, 16) < order:
        raise SystemExit('Invalid private key scalar. No file created.')
    helpers['write_new'](keyfile, ('0x' + raw + '\n').encode())
    helpers['check_key_path'](str(keyfile))
    print('SAVED_PRIVATE_KEY_FILE=' + str(keyfile))
print('When asked for PRIVATE KEY FILE PATH, enter: ' + str(keyfile))
PY

echo 'BNB TESTNET 97: enter your public deployer, seven council addresses and chosen gas budget.'
echo 'The runner builds/tests the pinned candidate, shows the full plan, and then requests its exact confirmation.'
python3 -I -u "$runner" --node "$node_bin"
echo 'CONTRACT DEPLOYMENT FINISHED. Use the printed VERIFIED_RESULT file for the web/Keeper activation step.'
echo 'Keep the bootstrap directory and all deployment journals. No website, Keeper or mainnet switch was performed.'
