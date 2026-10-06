# Review checkpoint, 2026-10-06

This publication preserves the tested immediate-auto/exact-price/restart baseline, the 447-test migration, and the later owner-resolved H-scope documentation/UI copy. It is a review snapshot, not the final newly requested 7-of-7/recovery version.

## Included evidence

- Full local repository run: 447/447, 49 files, 18 suites, Node 24.19.0, exit 0; original input manifests and failure/final logs are preserved under `docs/full-suite-review/`.
- Later H-scope copy changes: 29 UI tests, 40 preparation tests, workspace and landing builds; these overlap the full run and are not added to 447. See `docs/owner-support-decision/VALIDATION.md`.
- Complete current contract sources and pinned compiled artifacts, UI, tests, preparation tools and reports are included. Generated dependencies, local runtime deployment/wallet state, environment secrets and the redundant UI overlay archive are excluded.
- Historical reports retain their execution-time scope. The earlier three-hour soak is not evidence of this source revision.

## Subsequent requested changes are pending

The current implementation and its original checklist still encode **5-of-7** governance. The owner has subsequently requested **7-of-7 governance and emergency recovery**. Those changes are under separate implementation/testing and are not included. No test count here certifies them. Their eventual publication requires their own reviewed source and results.

The retained H policy keeps buy fees in live R, directs Binary 5% to R while supply exists or protected H at zero supply, and leaves H inactive outside price until governed retirement disposal to the fixed development recipient. This is not automatic insurance/loss recovery. The provisional fee coefficient and true zero-output/dust boundaries remain disclosed in the original documents.

## Installation means isolated review checks

`scripts/install-github-review.sh` requires an exact Git commit and exact Git tree SHA supplied together from the verified publication result. It fetches the fixed GitHub repository into a newly-created directory and verifies both before running checks. The pins are arguments, not a self-referential hash embedded in its own commit.

It uses the pinned official Node 24.19.0 runtime, then compiles/builds/tests. Tests can use temporary local Ganache fixtures and simulated signatures. It does not start a production service/keeper or deploy/sign/broadcast live-chain transactions. No public signer, development, Council or genesis addresses have been supplied. Chain 97 test-only targeting is not deployment authorization. The original preparation command remains unsigned and offline.

GitHub CI for this exact published commit is separate from the preserved local test evidence and must be checked separately. Passing CI is not a security audit or production approval.
