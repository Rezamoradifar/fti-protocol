# Validation

Solidity 0.8.30, optimizer 200 runs, viaIR, Shanghai EVM target. BinaryPlan runtime: 14,558 bytes; FTIToken: 13,427 bytes. Both are below the EIP-170 limit.

The recorded contract/math run passed 28 tests with no failures. See test-results.txt. Coverage includes accounting, Genesis without artificial assets, placement, bounded volume propagation, cumulative settlement threshold, burns/carry, historical rank, batch-size independence, pull claims, failed transfers, allowance, holding limits, locks, transfers, authorization, funded auto-buy, monthly pools, 3-of-5 council, actual timelock delay, replay prevention, BigInt/EVM quote agreement, full exit and frozen auto-buy settings.

The 2,000-member reference simulation (seed 42) executed 687 manual buys, 48 funded auto-buys and 702 terminal sales. Real supply ended at zero after inflows stopped and locks were assumed expired. Exact accounting and the curve reserve inequality held. This does not establish profit or large-network gas capacity.

The full UI was tested on a local EVM at desktop 1440x1000 and mobile 390x844. A 10 test-USD purchase completed, token balance updated, events loaded, and no JavaScript errors or horizontal overflow were recorded. The English UI passed this same check after translation. The browser launcher also completed all six deployment transactions, encrypted backup generation, membership activation and a token purchase on an isolated local Ganache EVM configured with chain ID 97; this was not a public testnet deployment. Desktop and mobile checks found no page errors or horizontal overflow. The browser launcher is not proof that the contracts are deployed publicly; that requires owner wallet signatures.

Not established: independent audit, mainnet safety, all adversarial MEV scenarios, dependency security audit, large-network throughput, production keeper uptime, external monitoring or live mobile-wallet compatibility. Browser accounts in the launcher are for testnet only.
