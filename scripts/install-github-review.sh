#!/usr/bin/env bash
# Review staging only. Obtain BOTH pins from the publication record before use.
# Usage: bash install-github-review.sh COMMIT_SHA40 EXPECTED_TREE_SHA40
# Writes only inside a new directory beneath the current directory. No sudo,
# service installation, production launcher, keeper, public-chain deployment,
# or wallet credentials are used. Tests use disposable localhost/test-wallet
# fixtures; this is not a sandbox for untrusted source code.
set -euo pipefail
umask 077

stop() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
[[ $# == 2 ]] || stop 'usage: bash install-github-review.sh COMMIT_SHA40 EXPECTED_TREE_SHA40 (exactly two arguments)'
[[ $1 =~ ^[0-9a-fA-F]{40}$ ]] || stop 'COMMIT must be an exact 40-hex commit SHA, never a branch or tag'
[[ $2 =~ ^[0-9a-fA-F]{40}$ ]] || stop 'EXPECTED_TREE must be an exact 40-hex Git tree SHA'
readonly COMMIT=${1,,} EXPECTED_TREE=${2,,}
readonly REPO_URL=https://github.com/Rezamoradifar/fti-protocol.git
readonly BASE_PATH=/usr/local/bin:/usr/bin:/bin
export PATH=$BASE_PATH

printf '%s\n' \
  'REVIEW ONLY: this published baseline uses 5-of-7 governance.' \
  'The requested 7-of-7 governance/recovery changes are UNFINISHED and not in this source.' \
  'This is a review checkpoint, not the requested final protocol.' \
  'Passing checks does not constitute an external audit or deployment approval.' \
  'Tests create disposable localhost fixtures and use test-wallet transactions.'
[[ $(uname -s) == Linux ]] || stop 'Linux required'
for tool in git curl tar gzip sha256sum mktemp getconf awk env mkdir tee uname; do
  command -v "$tool" >/dev/null || stop "missing prerequisite: $tool"
done
getconf GNU_LIBC_VERSION || stop 'GNU libc Linux required'
case "$(uname -m)" in
  x86_64) NODE_ARCH=x64; NODE_SHA=f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4 ;;
  aarch64|arm64) NODE_ARCH=arm64; NODE_SHA=d28c8a5bf0a808f0ed434a1dce8c54ae98f0371c0bd86ac58abc613f73e6643f ;;
  *) stop 'unsupported CPU (supported: x86_64 and aarch64/arm64)' ;;
esac
readonly NODE_ARCH NODE_SHA
readonly NODE_VERSION=24.19.0
readonly NODE_FILE="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz"
readonly NODE_BASE="https://nodejs.org/download/release/v${NODE_VERSION}"

# Never reuse, clean, overwrite or remove an existing working tree.
STAGE=$(mktemp -d "$(pwd -P)/fti-github-review.XXXXXXXX")
readonly STAGE
trap 'result=$?; if (( result != 0 )); then printf "Review staging failed; retained for inspection: %s\n" "$STAGE" >&2; fi' EXIT
printf 'New review directory: %s\n' "$STAGE"
mkdir "$STAGE/home" "$STAGE/tmp" "$STAGE/npm-cache" "$STAGE/empty-hooks" "$STAGE/empty-template"
: > "$STAGE/home/npm-user.conf"
: > "$STAGE/home/npm-global.conf"
TOOL_PATH=$BASE_PATH

# Drop ALL inherited environment variables, including secrets, RPC settings,
# NODE_OPTIONS, Git configuration overrides and npm credentials/configuration.
# The clean home also prevents automatic use of ~/.gitconfig, ~/.netrc and ~/.npmrc.
clean_env() {
  env -i PATH="$TOOL_PATH" HOME="$STAGE/home" TMPDIR="$STAGE/tmp" \
    LANG=C LC_ALL=C CI=1 HOST=127.0.0.1 \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 \
    npm_config_cache="$STAGE/npm-cache" \
    npm_config_userconfig="$STAGE/home/npm-user.conf" \
    npm_config_globalconfig="$STAGE/home/npm-global.conf" \
    npm_config_registry=https://registry.npmjs.org \
    npm_config_ignore_scripts=true npm_config_audit=false npm_config_fund=false \
    npm_config_update_notifier=false "$@"
}
git_review() {
  clean_env git -c core.hooksPath="$STAGE/empty-hooks" \
    -c init.templateDir="$STAGE/empty-template" -c credential.helper= \
    -c http.followRedirects=false -c protocol.allow=never \
    -c protocol.https.allow=always "$@"
}

# An empty repository plus an exact-object fetch avoids branch/tag ambiguity.
# No submodules, alternative remotes, SSH, credentials or Git URL rewrites.
git_review init --quiet "$STAGE/fti-protocol"
cd "$STAGE/fti-protocol"
git_review remote add origin "$REPO_URL"
[[ $(git_review remote get-url origin) == "$REPO_URL" ]] || stop 'unexpected remote URL'
git_review fetch --depth=1 --no-tags --no-recurse-submodules origin "$COMMIT"
[[ $(git_review cat-file -t FETCH_HEAD) == commit ]] || stop 'fetched object is not a commit'
[[ $(git_review rev-parse --verify FETCH_HEAD) == "$COMMIT" ]] || stop 'fetched commit does not match the supplied pin'
[[ $(git_review rev-parse --verify 'FETCH_HEAD^{tree}') == "$EXPECTED_TREE" ]] || stop 'fetched tree does not match the supplied pin'
# Fail closed on symlinks and gitlinks, which could escape the intended file tree.
git_review ls-tree -r FETCH_HEAD > "$STAGE/source-tree.txt"
awk '$1 != "100644" && $1 != "100755" {bad=1} END {exit bad}' "$STAGE/source-tree.txt" || stop 'source tree contains symlinks or submodules'
git_review checkout --quiet --detach "$COMMIT"
[[ $(git_review rev-parse --verify HEAD) == "$COMMIT" ]] || stop 'checked-out commit mismatch'
[[ $(git_review rev-parse --verify 'HEAD^{tree}') == "$EXPECTED_TREE" ]] || stop 'checked-out tree mismatch'
if git_review symbolic-ref --quiet HEAD >/dev/null; then stop 'checkout is not detached'; fi
printf 'Repository: %s\nCommit: %s\nTree: %s\n' "$REPO_URL" "$COMMIT" "$EXPECTED_TREE" | tee "$STAGE/verified-source.txt"

# Official Node archive is pinned independently, before extraction or execution.
cd "$STAGE"
clean_env curl -q --fail --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
  "$NODE_BASE/$NODE_FILE" -o "$NODE_FILE"
printf '%s  %s\n' "$NODE_SHA" "$NODE_FILE" | sha256sum -c -
clean_env tar -xzf "$NODE_FILE" --no-same-owner
TOOL_PATH="$STAGE/node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin:$BASE_PATH"
[[ $(clean_env node --version) == "v$NODE_VERSION" ]] || stop 'unexpected Node version'
clean_env node --version
clean_env npm --version
cd "$STAGE/fti-protocol"

# Permit only the reviewed entrypoints and public npm-registry lockfile URLs.
# npm lifecycle hooks remain disabled, including nested npm invocations.
clean_env node --input-type=module <<'NODE'
import fs from 'node:fs';
const expected = {
  '.': {compile:'node scripts/compile.mjs', 'build:web':'node scripts/build-web.mjs', test:'npm run compile && node --test --test-concurrency=1 test/*.test.mjs'},
  landing: {build:'node build.mjs'},
};
const packages = {};
for (const [dir, scripts] of Object.entries(expected)) {
  if (fs.existsSync(`${dir}/.npmrc`)) throw new Error(`Unexpected project npm configuration: ${dir}/.npmrc`);
  const pkg = JSON.parse(fs.readFileSync(`${dir}/package.json`, 'utf8'));
  packages[dir] = pkg;
  for (const [key, value] of Object.entries(scripts)) {
    if (pkg.scripts?.[key] !== value) throw new Error(`Unreviewed command: ${dir}:${key}`);
  }
  // The historical standalone landing lock uses local links. The supported
  // full-root build resolves its exact matching dependencies from ../node_modules.
  if (dir === 'landing') continue;
  const lock = JSON.parse(fs.readFileSync(`${dir}/package-lock.json`, 'utf8'));
  if (!lock.packages || lock.lockfileVersion < 2) throw new Error(`Unsupported lockfile: ${dir}`);
  for (const [name, item] of Object.entries(lock.packages)) {
    if (item.link) throw new Error(`Linked dependency: ${dir}:${name}`);
    if (!item.resolved) continue;
    const url = new URL(item.resolved);
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port || url.username || url.password) {
      throw new Error(`Non-registry dependency: ${dir}:${name}`);
    }
  }
}
const landingPins = {react:'19.2.0', 'react-dom':'19.2.0', esbuild:'0.25.10'};
for (const [name, version] of Object.entries(landingPins)) {
  for (const dir of ['.', 'landing']) {
    const pkg = packages[dir];
    if ((pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]) !== version) {
      throw new Error(`Root/landing dependency pin mismatch: ${dir}:${name}`);
    }
  }
}
NODE

clean_env npm ci --ignore-scripts --no-audit --no-fund 2>&1 | tee "$STAGE/npm-ci.log"
clean_env npm --ignore-scripts run compile 2>&1 | tee "$STAGE/compile.log"
clean_env npm --ignore-scripts run build:web 2>&1 | tee "$STAGE/build-web.log"
(
  cd landing
  # Deliberately use the checked, exact-version root dependencies above.
  # Do not use the historical standalone landing/package-lock.json local links.
  clean_env npm --ignore-scripts run build
) 2>&1 | tee "$STAGE/build-landing.log"
clean_env npm --ignore-scripts test 2>&1 | tee "$STAGE/npm-test.log"
printf '\nReview checks finished. No production service or public-chain deployment was started.\nSource: %s/fti-protocol\nLogs: %s\n' "$STAGE" "$STAGE"
printf '%s\n' 'This remains a 5-of-7 review checkpoint; requested 7-of-7 governance/recovery changes are unfinished.'
