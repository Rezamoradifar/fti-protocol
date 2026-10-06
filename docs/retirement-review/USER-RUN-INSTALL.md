# User-run installation of the reviewed source

These instructions install source in a **new directory**. They do not upgrade an existing contract, overwrite a running service, connect a signer or deploy to a blockchain. Use the exact commit supplied with the draft review PR, not a moving branch tip. The assistant has not connected to or changed your server.

## 1. Preserve existing state first

- Identify the current FTI directory, running services and occupied ports before changing anything
- Keep a private backup of existing deployment JSONs, transaction journals, chain data and configuration. Keep secrets in their existing protected location; do not paste, email or commit their contents
- Do not remove pending transaction journals or reuse a deployment nonce just because a prior command was interrupted
- Leave the existing installation and service running until the new review copy has passed your checks

## 2. Create a separate pinned checkout

Use a fresh directory name. Replace COMMIT with the exact verified commit in the review message.

```sh
umask 077
COMMIT=FULL_REVIEW_COMMIT_SHA
NEW_DIR="$HOME/fti-retirement-review-$COMMIT"
test ! -e "$NEW_DIR" || { echo 'Directory already exists; inspect it first'; exit 1; }
git clone --no-checkout https://github.com/Rezamoradifar/fti-protocol.git "$NEW_DIR"
cd "$NEW_DIR"
git checkout --detach "$COMMIT"
test "$(git rev-parse HEAD)" = "$COMMIT" || exit 1
```

Do not copy a private key into this checkout. Do not copy or overwrite the old deployment configuration until you have checked which token generation it describes.

## 3. Install and validate locally

Use the supported Node version in the repository workflow (Node 22), with the committed lockfile.

```sh
npm ci
npm run compile
npm run build:web
npm --prefix landing run build
npm test
node scripts/verify-retirement-review.mjs
```

Compilation and verification are local. They do not sign or submit transactions. Check the current validation document for the exact source and expected test coverage; earlier fee-floor results are labeled separately from lifecycle tests.

## 4. Optional private local demo

Inspect ports before starting another service. The retirement demo uses RPC 8548 and web 3084; keep both on loopback. Use an SSH tunnel from your own computer if you need to see the page remotely.

```sh
HOST=127.0.0.1 npm run demo:retirement
```

This is an ephemeral Ganache demo with publicly reproducible test identities. Never expose its unlocked RPC or local developer endpoints to the internet, and never put real funds into its accounts. Do not replace the existing service or proxy configuration as part of this check.

## 5. Prepare, but do not broadcast, testnet deployment

Read `DEPLOYMENT-PREPARATION.md` and the command's help/description. The new preparer targets chain 97 only and produces unsigned instructions/transactions. It does not use a private key, connect a signer or broadcast. Actual public addresses, a fresh nonce and gas limits still need your verification. Five contracts are deployed; binding is a sixth transaction, not a sixth contract.

Do not run the historical browser launcher or the old direct deployment scripts for this new token. Do not overwrite an old deployment record. The previously recorded three-of-five Council is not the new five-of-seven configuration.

## 6. Return review evidence safely

Share the exact commit, Node/npm versions, command exit codes and sanitized test logs. If you later deploy yourself, provide public transaction hashes, chain ID and the resulting non-secret deployment JSON so the addresses, bytecode and bindings can be checked. Never send seed phrases, private keys, passwords, RPC tokens or environment-file contents.

Pending-auto conversion, microscopic terminal dust, the provisional 7% curve coefficient and operation of the binary after token retirement remain documented boundaries. A passing review is not an audit or a production-value approval.
