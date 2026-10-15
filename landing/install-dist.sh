#!/usr/bin/env bash
set -Eeuo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/dist"
target=/opt/fti-protocol/landing/dist
parent=${target%/*}
[[ $EUID -eq 0 ]] || { echo 'Run with sudo bash.' >&2; exit 1; }
[[ -s "$source_dir/index.html" && -d "$source_dir/assets" ]] || { echo 'Build landing first.' >&2; exit 1; }
nginx -t
mkdir -p "$parent"
stage=$(mktemp -d "$parent/.landing-stage.XXXXXX")
backup="$parent/dist.backup.$(date +%Y%m%d-%H%M%S).$$"
installed=0
moved=0
cleanup() {
  code=$?
  if (( code != 0 )); then
    if (( installed )); then rm -rf -- "$target"; fi
    if (( moved )); then mv -- "$backup" "$target"; fi
    echo 'Installation failed; previous landing restored when available.' >&2
  fi
  rm -rf -- "$stage"
  exit "$code"
}
trap cleanup EXIT
cp -a "$source_dir/." "$stage/"
# Keep hashed assets referenced by browsers that loaded the previous HTML.
if [[ -d "$target/assets" ]]; then cp -an "$target/assets/." "$stage/assets/"; fi
find "$stage" -type d -exec chmod 755 {} +
find "$stage" -type f -exec chmod 644 {} +
if [[ -e "$target" ]]; then mv -- "$target" "$backup"; moved=1; fi
mv -- "$stage" "$target"
installed=1
curl --fail --silent --show-error --max-time 20 --resolve ftiprotocol.com:443:127.0.0.1 "https://ftiprotocol.com/?release=$(date +%s)" -o "$parent/.landing-check.$$"
cmp "$target/index.html" "$parent/.landing-check.$$"
rm -f "$parent/.landing-check.$$"
while IFS= read -r asset; do
  curl --fail --silent --show-error --max-time 20 --resolve ftiprotocol.com:443:127.0.0.1 "https://ftiprotocol.com$asset" -o /dev/null
done < <(grep -oE '/assets/[^" ]+\.(js|css)' "$target/index.html")
echo "Landing installed. Previous version: $backup"
