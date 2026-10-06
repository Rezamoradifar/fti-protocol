# FTI V3 Contract Candidate

Files:
- `FTIReserveTokenV3.sol`
- `SevenGuardianCouncil.sol`

Main changes:
- zero premint / zero anchor
- first binary membership injection mints no FTI
- no registration trading fee
- no 30/90-day locks or wallet-count locks
- 3% buy/sell fee:
  - 1% fully-backed FTI to two animal-welfare wallets
  - 2% retained in reserve
- standard zero-tax ERC20 transfers
- minOut + deadline slippage
- 5% max single sell vs reserve
- 20% max hourly reserve outflow
- Builder B1-B4 buy allowance doubles each 10x launch-price milestone, max 16x
- 7-wallet council, 5/7 threshold
- irreversible emergency pro-rata redemption
- no administrator reserve withdrawal

Important:
This code has not been independently audited and should not be deployed to mainnet before compile tests, unit tests, fuzz/invariant tests, whale/bank-run stress tests and public testnet validation.
