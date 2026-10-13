#!/usr/bin/env bash
# FTI visual-only mobile installer repair. Uses already verified local package.
set -euo pipefail
umask 077
[[ "$(id -u)" == 0 ]] || { echo 'RUN_AS_ROOT' >&2; exit 1; }
[[ "$(hostname)" == 'vps-titan-5320' ]] || { echo 'WRONG_FTI_SERVER' >&2; exit 1; }

old='/root/fti-premium-mobile-gh.aSkLpUHg'
work="$(mktemp -d /root/fti-mobile-fix-v2.XXXXXXXX)"
log='/root/fti-mobile-premium-v2.log'
[[ -f "$old/fti-mobile-premium.css" && -f "$old/install-fti-mobile-premium.py" ]] || {
  echo 'ORIGINAL_VERIFIED_PACKAGE_NOT_FOUND' >&2; exit 1;
}
cp -- "$old/fti-mobile-premium.css" "$work/fti-mobile-premium.css"
cp -- "$old/install-fti-mobile-premium.py" "$work/install-fti-mobile-premium.py"
printf '%s  %s\n' \
 '53ecc94a7a70533f851b21bd3e3aa547b22f4aa0a174df1cd29df584db188e21' \
 "$work/fti-mobile-premium.css" | sha256sum -c -
printf '%s  %s\n' \
 '936a20dee173f91ec516c4db5eb062d3ef4d2d1d8fa03c078d48b22ce9a492b4' \
 "$work/install-fti-mobile-premium.py" | sha256sum -c -

rev='85a100a104c5d6bf4f30812112f4b382a1d76d67'
curl -fLsS --retry 3 --connect-timeout 10 --max-time 60 \
 "https://raw.githubusercontent.com/Rezamoradifar/fti-protocol/$rev/tools/fti-mobile-premium-v2.patch" \
 -o "$work/v2.patch"
printf '%s  %s\n' \
 '448decf4b52e14174ded7004b8c48a444389735b8dd0e23ddf4583a78f47eb4e' \
 "$work/v2.patch" | sha256sum -c -
( cd "$work"; patch --batch --fuzz=0 -p0 < v2.patch )
printf '%s  %s\n' \
 '11a11eea37517e3475b40137f929b00a5fe1be1384e53b26c9de085e2f17c220' \
 "$work/install-fti-mobile-premium.py" | sha256sum -c -
python3 -m py_compile "$work/install-fti-mobile-premium.py"

# A previous successful/partial install is not overwritten.
if [[ -e /var/backups/fti-visual-mobile/active.json ]]; then
  echo 'EXISTING_MOBILE_OVERLAY_STATE: no changes applied. Inspect before retrying.'
  python3 -I -u "$work/install-fti-mobile-premium.py" --status
  exit 0
fi

printf 'STAGE=APPLY_FIXED_INSTALLER\n'
python3 -I -u "$work/install-fti-mobile-premium.py" \
  --apply --css "$work/fti-mobile-premium.css"
printf 'FTI_MOBILE_PREMIUM_V2_INSTALLED\n'
