# Combined-candidate unsigned preparation validation

Validated 2026-10-06. This report covers the offline preparer, not contract economics, the full repository suite, a security audit, or deployment approval.

## Results

- Fresh isolated Solidity build completed successfully with solc `0.8.30+commit.73712a01.Emscripten.clang`, optimizer 200 runs, viaIR, Shanghai
- All five full artifact files matched the working candidate byte-for-byte; creation-bytecode SHA-256 and Keccak-256 evidence is in `unsigned-independent-build.json`
- Binary runtime: 21,277 bytes; retirement token runtime: 20,877 bytes
- `npm run test:retirement-deployment`: 40 tests, 40 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo
- Logs: `unsigned-independent-compile.log`, `unsigned-preparation-tests.log`

## Frozen inputs

- Binary source: `9844e9b6b14553e0eb14352d43ab65e0cefda18d7c07a87101d074959c198271`
- Binary artifact: `74c55aff04054d58d9f7ea9c9720032a0d6fe7572b248fa881dca0b9ee1cd4cb`
- Token source: `89de8c1e8babbb0b5cf8ad20b92d96f176f2d3f89e9319e7328c7c52f0676ccb`
- Token artifact: `f7821bc76f101bc010d5c61a34408f821f2867e13f53007308335036e0d8d0dd`

## Checks and changes

The preparer now verifies the current lifecycle approval ABI `approveRetirementAction(bytes4,uint256)`, lifecycle nonce, permanent buy-closure marker and immediate-auto/conversion APIs, in addition to existing constructor, compiler, governance, full-source and full-artifact pins. Its descriptor explains restartable zero supply, exact reserve/supply reference pricing, no-cap atomic auto-buy quotes, pending retries, and same-beneficiary conversion only after permanent buy closure with paused/idle Binary. Automatic use of H remains unimplemented.

All five constructor dependencies and the sixth deployer bind request are decoded and checked. The writer now re-derives the complete manifest before creating output. Mutated bytecode, evidence, dependency addresses, nonce, bind destination, omitted transactions and raised readiness/approval/network flags fail closed. Exclusive file creation and existing output/journal protections remain enforced. This is an ordered dependency-bound sequence, not an on-chain atomic batch.

Regression fixtures retain the actual old token/Binary source and artifact bytes in `test/fixtures/pre-combined-unsigned-pins.json.gz`. Tests verify all four historical hashes and individually prove that each old source/artifact is rejected. The fixture contains public code only and is not a deployment input. Tests also prove current source/artifact tampering fails, public inputs cannot be inferred or omitted, exactly seven owners and 31 genesis identities are required, and network/credential access is actively blocked during CLI preparation.

The checked-in descriptor is generated from `--describe`, with no addresses, predictions, or unsigned transaction requests. Tests compare it against the current validated description. All readiness, approval, signing, broadcasting, and network-verification flags stay false; description preparationComplete is false. Fixtures only produce temporary unsigned files removed after testing.

## Boundaries

Chain 97 and MockUSD test collateral only. No real addresses were selected, no RPC used, no wallets accessed, no signatures made, no transactions broadcast, no sample activation performed, and no publication made. No contracts or UI were changed in this work. Required public deployer, nonce, development, seven owners and 31 genesis inputs remain unresolved. Later execution requires separate authorization and live checks.

The full repository test suite was not run in this preparation task. These 40 passing checks are focused preparation/entrypoint coverage and do not replace lifecycle, immediate-auto, UI, or independent security reviews.
