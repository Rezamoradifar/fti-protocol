#!/usr/bin/env bash
# FTI visual-only mobile overlay: pinned GitHub payload, local integrity checks.
set -euo pipefail
umask 077

[[ "$(id -u)" == 0 ]] || { echo 'RUN_AS_ROOT' >&2; exit 1; }
[[ "$(hostname)" == 'vps-titan-5320' ]] || { echo 'WRONG_FTI_HOST' >&2; exit 1; }
command -v curl >/dev/null
command -v sha256sum >/dev/null
command -v base64 >/dev/null
command -v tar >/dev/null
command -v python3 >/dev/null

repo='Rezamoradifar/fti-protocol'
# Immutable GitHub commit containing the five fully matched source chunks.
rev='f1eda575edba90e0fc5850c56911d9e2543707e2'
work="$(mktemp -d /root/fti-premium-mobile-gh.XXXXXXXX)"
log='/root/fti-mobile-premium-github-install.log'

printf 'PACKAGE_DIRECTORY=%s\n' "$work"
for i in 1 2 3 4 5; do
  curl --fail --location --silent --show-error --retry 3 \
    --connect-timeout 12 --max-time 60 \
    "https://raw.githubusercontent.com/$repo/$rev/packages/fti-mobile-premium-20261013.part$i.b64" \
    --output "$work/part$i.b64"
done

( cd "$work" && sha256sum --check <<'CHECKSUMS'
11834ac9d8437f95f076c9cf7d35c6218146cd0a05767b43a3340c770299b75b  part1.b64
ee71f23c4b829aa6a6edd6a4c310f0b4bd0c6f0f4edc7dab09da6ab02f06aa23  part2.b64
2e99f623c0d74f8d8ffbe80c83c53655aff81789475a7b148342fe44e0027f66  part3.b64
615d18d515370dd01f8af6421e69454767675201480656e923923f45f6cba3be  part4.b64
9e0d7c24543069d04bb22b2b0db2c05f0c352423126e64ec1b9fa956ffa0954c  part5.b64
CHECKSUMS
)

cat "$work"/part{1,2,3,4,5}.b64 | base64 --decode > "$work/package.tar.xz"
printf '%s  %s\n' \
  'c16609e19d4a421bc6f6f732c0581be4bc2f7fe42f7e7d554b0e107183c3a5e2' \
  "$work/package.tar.xz" | sha256sum --check -

expected="$(printf 'fti-mobile-premium.css\ninstall-fti-mobile-premium.py' | sort)"
found="$(tar -tf "$work/package.tar.xz" | sort)"
[[ "$found" == "$expected" ]] || { echo 'UNEXPECTED_ARCHIVE_CONTENT' >&2; exit 1; }
tar -xJf "$work/package.tar.xz" -C "$work" --no-same-owner --no-same-permissions

printf '%s  %s\n' \
  '53ecc94a7a70533f851b21bd3e3aa547b22f4aa0a174df1cd29df584db188e21' \
  "$work/fti-mobile-premium.css" | sha256sum --check -
printf '%s  %s\n' \
  '936a20dee173f91ec516c4db5eb062d3ef4d2d1d8fa03c078d48b22ce9a492b4' \
  "$work/install-fti-mobile-premium.py" | sha256sum --check -

python3 -m py_compile "$work/install-fti-mobile-premium.py"

# Only once the package has passed all checks may the background installer run.
nohup python3 -I -u "$work/install-fti-mobile-premium.py" \
  --apply --css "$work/fti-mobile-premium.css" \
  >"$log" 2>&1 < /dev/null &

printf 'FTI_MOBILE_INSTALL_STARTED_PID=%s\n' "$!"
printf 'INSTALL_LOG=%s\n' "$log"
printf 'PACKAGE_DIRECTORY=%s\n' "$work"
printf 'Monitor: tail -n 70 %s\n' "$log"
