# Approved FTI initial positions — 2026-10-16

`config/v3-wallets.json` preserves the user's exact ordered list of 31 addresses. Both role addresses are distinct and excluded from initial membership. The existing binary constructor lays positions out breadth-first: position 1 is the root; positions 2 and 3 are its children; each following pair belongs to the next parent.

The V3 testnet deployment now loads this configuration, never generates replacement wallets, and never inserts the gas-paying deployer automatically. Configuration validation rejects invalid addresses, duplicates and role overlap. No private keys for these wallets are requested or generated.

All initial positions start with zero units and no activation serial. Each wallet must approve the stablecoin and call `addUnits` with a funded purchase, through the existing `_fund` path. The existing unit limits, exact payment, fee allocation, activation-based volume eligibility, rank and settlement rules apply. There is no free purchase, rank, income or retroactive credit. Ordinary new users continue using `register`.

`owner` records the user-designated external role only. The current contracts have council/timelock governance, not an independent single-owner permission; this change does not grant a new unilateral authority or change council membership. `development` is the existing development-fee recipient.

This applies to a NEW V3 deployment. Existing immutable contracts cannot have their genesis list rewritten by a frontend update. No live deployment or migration was performed. The script remains restricted to chain 97/31337.

Checks: `npm run compile`; `node --test test/v3-wallets.test.mjs test/v3-deploy-script.test.mjs test/funded-economics.test.mjs`.
