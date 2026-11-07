# FTI public chain snapshot — 7 November 2026

This read-only snapshot records the six FTI deployment contracts, both active proxy implementations, token supply getters, and selected governance getters at **BNB Chain block 132,095,224**. All requested reads succeeded. The block hash matched when queried again after the state reads; all six bytecode hashes and both implementation addresses matched the public site configuration captured during the run.

**This is project-sourced technical evidence for a listing or audit packet. It is not an independent security audit, a circulating-supply verification, a listing approval, or a guarantee about subsequent chain state.**

## Evidence and block anchor

| Field | Observed value |
| --- | --- |
| Chain | BNB Chain mainnet; `eth_chainId = 56` |
| Block | `132095224` / `0x7df9cf8` |
| Block hash | `0xe7eb102c32bdde151a58f871c5328d0734b1f8980d9333abe0803fd886c6c084` |
| Block timestamp | `2026-11-06 23:17:20 UTC` / `2026-11-07 02:47:20 +03:30` |
| Capture window | `2026-11-06 23:17:08–23:17:32 UTC` |
| Config release | `FTI_CONTINUITY_MAINNET_20261013` |
| Config source revision | `ba82373a83d63fba0643332371cfb6d62903c849` |
| Config deployment block | `127907406` — public configuration value, not independently reconstructed here |
| Result | `complete-consistent`; no RPC or decode errors |

Sources: live [public configuration](https://ftiprotocol.com/api/config), the project's [RPC proxy](https://ftiprotocol.com/rpc), and public ABI endpoints for [SevenGuardianCouncil](https://ftiprotocol.com/abi/SevenGuardianCouncil), [FTITimelock](https://ftiprotocol.com/abi/FTITimelock), [FTIReserveTokenUpgradeable](https://ftiprotocol.com/abi/FTIReserveTokenUpgradeable), and [FundedBinaryPlanUpgradeable](https://ftiprotocol.com/abi/FundedBinaryPlanUpgradeable).

The companion [raw evidence JSON](20261107-chain-snapshot.json) contains the relevant public configuration projection, complete fetched ABIs, timestamped JSON-RPC requests and responses, raw runtime bytecode, decoded results, and consistency checks. Its SHA-256 is:

```text
984ad13a88b93ecae3ea79e1dbcee41091616bf7c5f00ada76681fc1992a1d15
```

## Six deployment contracts

Bytecode hashes below are Keccak-256 of the raw `eth_getCode` results at the anchored block. Every address had nonempty bytecode. Every hash matched the corresponding public `codeHashes` or `implementationCodeHashes` value; this comparison does not independently establish source-code verification or contract safety.

| Contract | Address | Runtime bytes | Runtime code hash |
| --- | --- | ---: | --- |
| Council | `0x85F567C2c59e766847D9dC18328C3B54cDf80DE4` | 3,007 | `0x48badc51f5fa5efa1913c2271c908dbe4667b3355fcd2225e2fa70b8330cf3a5` |
| Timelock | `0xcf3eCA1E96db99E478e81C79f2Ae03dEec80CA86` | 5,450 | `0x23cfa4d1941f48e21ca333fe2092ae9f9e87d0d8a6a54130c7fe82490abd1892` |
| Token implementation | `0x714aE4497DdA3e8BFB5440D5777a2d60f9f7b1c1` | 17,130 | `0xa9ca4612140d49f9c247afb8887f90e6df6338d3e4675b8a64d66171d5a05d88` |
| Token proxy | `0x43755B1E813b2d41F669ea08bcf859De07195eA1` | 130 | `0xe6ef40a5eda18ff38b348e20557c824146411b23667bb6d75b39c3a1107ec627` |
| Binary implementation | `0x03c9A6CDF9bf4103C3AdA0c3E8Ea3a6F0A30D91e` | 24,549 | `0x20496d01da8355e7110b45a15c9709ba0361fcc8a473375fd682301394255b21` |
| Binary proxy | `0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9` | 130 | `0xe6ef40a5eda18ff38b348e20557c824146411b23667bb6d75b39c3a1107ec627` |

### Active proxy implementation slots

Both reads used `eth_getStorageAt` at EIP-1967 implementation slot:

```text
0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
```

| Proxy | Address decoded from implementation slot | Matches configuration |
| --- | --- | --- |
| Token | `0x714aE4497DdA3e8BFB5440D5777a2d60f9f7b1c1` | Yes |
| Binary | `0x03c9A6CDF9bf4103C3AdA0c3E8Ea3a6F0A30D91e` | Yes |

## Token getters

All token calls targeted the token **proxy** at the same block.

| Getter / interpretation | Observed value |
| --- | --- |
| `name()` | `FTI Protocol` |
| `symbol()` | `FTI` |
| `decimals()` | `18` |
| `totalSupply()` — raw integer units | `12586627149614999697347` |
| `totalSupply / 10^18` — token units | **12,586.627149614999697347 FTI** |
| Circulating supply | **Not established by this snapshot** |

The reported amount is the contract's **total supply**, not a maximum supply, circulating supply, reserve balance, token valuation, or market capitalization. Do not enter it as CoinMarketCap circulating supply without a separate allocation and exclusion analysis. Locked, treasury, reserve, team, and other potentially excluded balances were not classified in this task.

## Observed governance configuration

`token.governance()` and `binary.governance()` both returned the timelock address above. `token.guardianCouncil()` and `binary.guardian()` both returned the council. The token and binary getters reference each other's configured proxies. Both `usd()` getters returned `0x55d398326f99059fF775485246999027B3197955`.

`council.THRESHOLD()` returned **5**. The seven `guardians(index)` entries were read and each corresponding `isGuardian(address)` returned `true`:

| Index | Guardian address |
| --- | --- |
| 0 | `0x66Bccec30D27d780A23b2cBe467f20D4a1FC56F8` |
| 1 | `0xe7efd5bfBa19cC1c6D50b5ddfBC972Fa5524851f` |
| 2 | `0xF2637A6Ab93b13DEF1F46E49A1F39d1B9Ec1fC16` |
| 3 | `0x1c8E8FFF893aFa573e0F616DDA333B1f0c7A8740` |
| 4 | `0x3d6282594649f2E023209346779977293cFD481a` |
| 5 | `0x202cA4f915E6dA048fb44d20c5FE852eb00FE3fe` |
| 6 | `0x25D88f0B8ac6e1495112F3EB17DBC57271A92fa7` |

`timelock.getMinDelay()` returned **259,200 seconds / 72 hours**. The role identifiers were fetched from the timelock getters, then passed to `hasRole(role,address)` for the five specific candidates below.

| Candidate | Proposer | Executor | Canceller | Default admin |
| --- | --- | --- | --- | --- |
| Council | Yes | No | Yes | No |
| Timelock itself | No | No | No | Yes |
| Zero address | No | Yes | No | No |
| Configured owner | No | No | No | No |
| Configured deployer | No | No | No | No |

Configured owner: `0x4B92747764E58C1F1Ad22E10a3D880fDD8Fc9d76`. Configured deployer: `0x7c637226510E0998624adf3ad1743199eb38A45d`. These labels come from the public config; their queried role values are on-chain observations. The zero-address executor result is reported literally; it must not be confused with unrestricted proposal or cancellation rights.

This is a candidate-specific role check, **not an exhaustive enumeration of role holders**. It does not establish guardian key ownership, independence of signers, historical changes, queued operations, or every privileged code path.

## Method and limits

The capture made 64 read RPC calls in three batches. The first batch selected the current block and chain ID. Every subsequent `eth_call`, `eth_getCode`, and `eth_getStorageAt` used the explicit block tag `0x7df9cf8`; no state read used a moving `latest` tag. The final batch re-read that block's header and the chain ID, confirming the same hash and chain. Requests were bounded by timeouts and no retry loop was used.

Only `eth_chainId`, `eth_getBlockByNumber`, `eth_getCode`, `eth_getStorageAt`, and `eth_call` were requested. No transaction, signature, payment, order, customer record, deployment, contract state, or production setting was created or changed.

All network evidence came through the project's public domain. The capture did not compare an independent node, prove finality, verify explorer source-code publication, reproduce builds, assess vulnerabilities, validate reserve solvency, or determine circulating supply. The observed block consistency and configuration matches are useful supporting facts; independent audit and listing review remain separate work.
