# Local lifecycle validation

This is a separate candidate, not the previously delivered 250-test fee/gate result and not a deployment record. The older 759,963-operation price-transition sample also remains attributed to that earlier model; it has not been relabeled as a simulation of the new development-claim/retirement lifecycle.

## Frozen new-token source

- Contract: `FTIRetirementReviewToken`
- Source SHA-256: `0ad9664006aadb83ba5141ec0b43982e3dd444356922974a2fb1d6593d34aba3`
- Artifact SHA-256: `052ca59dd7f550d8656c9f43f7c5d56c0b90479c8bebe4e2dd976f9ecbfe4b3a`
- Solidity 0.8.30, optimizer 200, viaIR, Shanghai
- Runtime: 18,937 bytes, below EIP-170
- Production compilation passed
- Standalone local verification recompiles and matches all five candidate creation bytecodes

## Completed checks

- Expanded lifecycle guards, callback rollback and organic BinaryPlan integration: **43/43 passed**, zero failures/skips/cancellations, against frozen source (226.3 seconds)
- The organic path uses 21 funded epochs: 20 to reach Builder 1, then an eligible epoch that creates a real 108 USD pending-auto claim, proves it blocks retirement, releases it owner-only to the same beneficiary's cash claim, then retires and proves later membership funding rolls back atomically
- Preserved fee-floor plus owner-rotation regression: 37/37 passed
- The preserved original candidate's 82 input hashes and 11 artifacts remain unchanged; the same original 11 artifact hashes are also unchanged in this separate copy
- Static review found no concrete fund-loss or reopening defect in the inspected new token, but this is not an independent security audit

Five callback tests are included in the final 43-case pass. They confirm the exact ReentrancyGuard error on nested payout entry and full rollback when callback failure propagates, across seller payout, development claim, retirement and donation recovery. Together with the separate 37-case baseline/rotation run, 80 distinct cases were freshly executed for this closeout. This is not a claim that the earlier 250 cases were rerun for the new lifecycle contract.

## Scope and open boundaries

Read `../RETIREMENT-REVIEW.md` for the reserved-terminal-claim variant, Council approval/revocation and delay, separate donation recovery, pending-auto liveness, token-only retirement, blocked future membership funding, unresolved precision/dust and actual deployment configuration.

No pending-auto conversion was implemented. No real recipient, private key or signer was invented. No GitHub publication, deployment, real-fund transfer or explorer verification submission occurred. `UNSIGNED-DEPLOYMENT-PLAN.json` is preparation only and is missing required public configuration.

## Integrated publication checkpoint

Recent local selections total **177 distinct cases across 12 files**: lifecycle 43, fee/rotation 37, current-token integration/load 21, helper regression 24, application 16, unsigned-deployment/entrypoint 36. Each credited selection has zero failures, skips and cancellations. Exact file/log hashes are in `INTEGRATED-VALIDATION.json`. Full current-repository CI must be checked on the exact published commit; the older 250-case result is not reused for it.

The current retirement-token 100-user load exercised 104 buys, four live support top-ups, 20 transfers and 100 normal exits. It reconciled 4,385 USD in purchases plus 20 USD live support to 4,404.204476886716515088 USD holder proceeds plus 0.795523113283484912 USD paid terminal development fee. Real Council/72-hour retirement then paid the protected 500 USD. Token cash and supply reached zero while Binary's 9,880 USD remained untouched; a 104 USD Binary cash claim succeeded afterward.

Current API/UI tests cover the new ABI and development-claim/retired fields, fee-net ordinary terminal sales, fee-free emergency exits, historical zero-supply references, binary cash claims and rejected post-retirement funding. The localhost retirement demo starts and shuts down successfully. Both builds passed. Browser rendering remains unverified.

The default `npm run deploy` is an offline, pinned-artifact description/preparation command with no credential, RPC, signing or broadcast path. It prepares five contracts plus one binding call for chain 97. See `DEPLOYMENT-PREPARATION.md` and `USER-RUN-INSTALL.md`. Public addresses, nonce and signer readiness remain user-supplied inputs, not publication blockers.

Six artifacts are recorded in `INTEGRATED-SOURCE-MANIFEST.json`: the five deployment contracts plus the preserved FTIReserveToken baseline. No sixth deployment or invented development-treasury contract has been added.
