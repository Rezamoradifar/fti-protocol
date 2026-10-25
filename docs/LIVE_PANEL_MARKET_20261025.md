# Live panel, token chart and official bot update — 25 October 2026

This release extends the reviewed panel completion branch. It changes website presentation and wallet interactions; it does not change deployed contracts, economic rules, guardian roles, RPC credentials or the on-chain source fingerprint.

## Requested behavior and evidence

| Request | Delivered behavior | Verification |
| --- | --- | --- |
| Start the token chart at 0.10 | A separate opening reference, verified against the actual token creation receipt and initial/current-cycle quote, precedes real observed prices. It is drawn dashed and labelled as a reference. | Mainnet proof at block 129737177; initial/current first-cycle quote both 100000000000000000 base units. |
| Chart price, date and time | Mobile-visible price and UTC time labels, touch/keyboard selection and a native observation table. Explicit earlier-price loading reads at most 24 actual block samples. | Unit and browser checks cover absent archives, zero supply, cycle reset, reorganization and mobile selection. |
| Remove test-dollar copy and fix balances | Production uses the real network profile and USDT labels. BigInt formatting retains exact balances; positive dust shows below the display unit, never a false zero. Full-precision balances are available in element titles. | Direct same-block USDT/FTI getters matched API values. Unknown and failed reads remain unavailable. |
| Registered position count | Shows the actual contract memberCount, its block/time and explanation that 31 genesis positions are included. Buying more units does not create another wallet. | Independent eth_call returned 34 at block 129736252, matching the API. No count was inflated. |
| Genealogy graphics and carry values | Root/branch cards, clear current carry versus historical volume, responsive connectors, drill-down/back/up and guarded loading. | Reported wallet historical 4/4 and carry 0/0 matched the chain. |
| Glass control | Shared glass/solid preference, synchronized controls and browser tabs, visible mobile/light/dark surfaces. | Browser checks assert computed transparency; reduced-transparency preference remains respected. |
| Change wallet | Explicit wallet picker/account selection; previous identity and private panels clear before reconnecting. Pending per-wallet transaction records remain intact. | Browser checks cover account replacement at 320, 390 and 1440 pixels without signatures or transactions. |
| FTI value and import | An explicit Add FTI action imports contract/symbol/18 decimals with account/network guards and manual fallback. The site displays a fresh same-block gross spot estimate before fees. | Wrong identity, chain, metadata, stale data, unknown responses and optional WalletConnect capability are tested. |
| Multilingual official bot | English, Persian, Arabic, Turkish, Spanish, Russian and Simplified Chinese private commands and localized menus. The public channel stays English. | Dedicated simulated Telegram tests; actual private bot token is never included in source or commands. |
| Channel price table | One explicit English table publication with UTC timestamps, real observations, separate cycle opening reference, canonical-hash checks and durable anti-duplicate intent. | Read-only real price preview succeeded; publication is separate from the website installation. |

External wallets decide fiat valuations through their own price providers. Importing the token does not submit a market listing or force a wallet price. No exchange listing, liquidity spending or guaranteed future growth is represented by this update.

## Installation and rollback

The self-contained website installer publishes the new app, browser bridge, member skin and shared global stylesheet under immutable URLs. Original fingerprinted sources and vendor files remain untouched. It accepts the reviewed predecessor layouts and the exact 6f957513 completion package. A later dedicated systemd override permits guarded rollback to the previous completion service. A failed validation stops before switching; post-switch failure attempts the recorded rollback.

The official bot is a separate self-contained Python installer using the existing private server configuration, or a hidden local terminal prompt when none exists. Its service only answers newly received private commands. It does not silently create a channel posting schedule. A one-time table is published explicitly with a durable post ID.

Source checks and simulated browser tests do not prove a production installation. Verify new public asset URLs and service readiness after running the pinned operator commands. Real wallet financial transactions were not signed or broadcast during this work.

## Executed release checks

- Both production builds passed.
- 184 focused JavaScript checks passed.
- 58 Chromium browser checks passed, including mainnet copy, pairing, member/guardian support, installed-style regressions and the new chart/tree/wallet flows.
- 51 installer checks and the real frozen-canonical-source local EVM cold boot passed.
- The website installer was packaged reproducibly three times with identical bytes.
- Official-bot checks: 55 passed; one actual AF_UNIX datagram notification test was skipped because this executor prohibits that socket type. The Linux CI job executes that test where supported. Existing Telegram publisher and setup checks passed.
- Independent source reviews covered wallet authorization, installer predecessor pins/rollback and bot filesystem/service readiness.

Local WebKit binaries were unavailable. Chromium success is not represented as an iOS/WebKit run; the dedicated GitHub Actions job includes the same new browser cases on WebKit.
