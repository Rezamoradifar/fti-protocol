# FTI external listing, source verification and audit readiness

Reviewed: **7 November 2026, Asia/Tehran**. This is a preparation record. No external application, account creation, message, paid order or blockchain transaction was submitted by this work.

## Identified deployment

The live website/API identity was checked during this work by the project engineer. The deployment file independently contains the same chain, addresses and source revision. Website availability does not establish successful wallet transactions or financial correctness.

| Field | Evidence |
| --- | --- |
| Website / member interface | `https://ftiprotocol.com/` / `https://ftiprotocol.com/app/`; HTTP 200 observed during this work |
| Runtime configuration | `https://ftiprotocol.com/api/config` |
| Network | BNB Smart Chain mainnet, chain ID **56** |
| Token proxy | `0x43755B1E813b2d41F669ea08bcf859De07195eA1` |
| Binary-plan proxy | `0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9` |
| Deployment source revision | `ba82373a83d63fba0643332371cfb6d62903c849` |
| Runtime release | `FTI_CONTINUITY_MAINNET_20261013` |
| Deployment record | [`../../deployments/mainnet-20261016.json`](../../deployments/mainnet-20261016.json) |
| Local preparation baseline | `6f957513e3468061d5f30907d6acfef7773eec96`, the head of `fix/panel-completion-20261025` when work began |

The preparation baseline and deployed source revision serve different purposes. Do not tell an auditor that a newer web release is the code deployed at the token address without a reproducible comparison.

## What has been verified

At **2026-11-06T22:55:10Z / 7 November 2026, 02:25 Tehran**, six read-only requests to the official Sourcify v2 API returned HTTP 200 with both `creationMatch` and `runtimeMatch` equal to `exact_match`. The records' original verification times are 16 October 2026. Full responses and URLs are saved in [`20261107-sourcify-evidence.json`](20261107-sourcify-evidence.json).

| Deployment component | Address | Sourcify result |
| --- | --- | --- |
| Council | `0x85F567C2c59e766847D9dC18328C3B54cDf80DE4` | Exact creation and runtime match |
| Timelock | `0xcf3eCA1E96db99E478e81C79f2Ae03dEec80CA86` | Exact creation and runtime match |
| Token implementation in deployment record | `0x714aE4497DdA3e8BFB5440D5777a2d60f9f7b1c1` | Exact creation and runtime match |
| Token proxy | `0x43755B1E813b2d41F669ea08bcf859De07195eA1` | Exact creation and runtime match |
| Binary implementation in deployment record | `0x03c9A6CDF9bf4103C3AdA0c3E8Ea3a6F0A30D91e` | Exact creation and runtime match |
| Binary proxy | `0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9` | Exact creation and runtime match |

This establishes accessible source-verification records. It does not establish the current proxy implementation slots, current authority holders, solvency or independent audit status. Those require separate evidence. [Sourcify explains source matching here](https://docs.sourcify.dev/blog/technical-verification-walkthrough/).

The historical BscScan status in `mainnet-20261016-sourcify.json` remains explicitly unconfirmed. BscScan address pages were unavailable to the web retrieval tool during this review. Do not turn Sourcify's external-submission metadata into a BscScan success claim.

## External routes and remaining gates

| Route | Applicable requirement | FTI evidence / next gate |
| --- | --- | --- |
| CoinMarketCap tracked listing | Functional website and explorer, project representative, active public trading with material volume on a CMC-tracked exchange. Acceptance remains discretionary. [Criteria](https://support.coinmarketcap.com/hc/en-us/articles/360043659351-Listings-Criteria) | Domain and contract identity are available. No qualifying exchange pair or organic market-volume evidence was verified in this work. Gather that evidence before requesting a tracked price page. |
| CoinMarketCap preview/untracked listing | CMC may consider projects that do not yet meet its tracked-market criteria. Use the correct official request route and describe actual status. [Request form](https://support.coinmarketcap.com/hc/en-us/requests/new?ticket_form_id=360000493112) | Prepare the factual packet; representative identity, ownership proof, complete supply documentation and logo URLs remain required inputs. Do not fill unknown values with zero. |
| CoinGecko | Active listing requires tradability on a supported exchange; preview has its own requirements. [Active guide](https://support.coingecko.com/articles/9489827481-how-to-list-a-new-cryptocurrency-on-coingecko) / [Preview guide](https://support.coingecko.com/articles/8781880141-how-to-preview-list-tokens-on-coingecko) | No supported market was established. An already deployed asset should not be described as an upcoming TGE merely to obtain a preview. |
| BscScan token information | Verified source and account-linked contract ownership precede a token-information request. [Submission guidance](https://info.bscscan.com/how-to-update-token-info/) / [Ownership process](https://info.bscscan.com/verifyaddress/) | Verify BscScan's actual state, then use the legitimate owner/deployer signing flow. No private key is needed in the application packet. |
| Independent security audit | Scope, frozen code, intended behavior, tests and findings must be reviewed by an external auditor. [OpenZeppelin readiness guide](https://www.openzeppelin.com/readiness-guide) | Internal tests and dependency scans exist; no independent audit report covering this deployed identity was established. Prepare scope below and obtain an agreed engagement before making audit claims. |
| CMC audit badge | The asset must appear in a supported audit partner's API feed. Examples listed by CMC include Hacken, Quantstamp, CertiK and Cyberscope. [Audit badge policy](https://support.coinmarketcap.com/hc/en-us/articles/360045595471-Category-Specific-Listings-Criteria) | A self-written report or uploaded logo cannot create this badge. Ask the chosen auditor whether its completed FTI assessment will appear in its supported feed. |
| CMC Community project verification | Existing CMC project listing, official-domain email, matching profile, 400×400 PNG and a short bio. [Official guide](https://coinmarketcap.com/academy/article/get-verified-on-cmc-community-start-building-your-community) | Prepare account details. Listing and mailbox control are not yet established; do not create an account or submit verification on an assumed identity. |
| CMC news / publicity | Coin-detail news uses integrated publishing partners. Community articles are authored content. Sponsored content is a separate commercial route. [News policy](https://support.coinmarketcap.com/hc/en-us/articles/360045595471-Category-Specific-Listings-Criteria) / [Advertising](https://coinmarketcap.com/ads/) | A neutral project update is drafted separately. Publication, editorial acceptance and syndication are unconfirmed. No advertising budget is approved. |

CMC has both free review and an official paid Priority service; expedited processing is not permission to invent market or supply data. Use its [official Priority terms](https://support.coinmarketcap.com/hc/en-us/articles/16945563933723-CMC-Priority-CMCP), not unsolicited intermediaries. CMC's managed advertising FAQ currently describes a typical **$20,000** minimum upfront commitment, with possible exceptions; that is not a quotation for an individual article or a listing fee. No payment is authorized by this document.

## Application identity and market status

Exact-address searches restricted to `coinmarketcap.com` did not return a corroborating FTI listing in this review. The interactive CMC search URL was not retrievable, so the correct status is **listing not confirmed**, not proof of absence. The symbol FTI also appears for FansTime; a symbol match is insufficient to identify this token. Match chain **56** and the full token contract address.

The repository's current social configuration names `https://t.me/FTIProtocol_Official`, `https://x.com/FTIProtocol` and `Support@FTIProtocol.com`. This identifies intended contacts; ownership of every account and successful mail delivery still need evidence. Do not use the earlier `t.me/FTIProtocol` link as the official channel.

## Audit and supply packet to finish

1. **Freeze the scope:** deployed source commit, compiler and optimizer settings, complete standard JSON, six contracts, dependencies, initialization transactions and code hashes. Include a fresh block-numbered read of both proxy implementation slots and governance roles. Include the actual keeper and server release where their behavior affects settlement or signatures.
2. **Describe intended economics:** approved allocation and rounding rules, reward eligibility, funding sources, reserve obligations, mint/burn behavior, selling limits, upgrade/pause authority and operational dependencies. Reconcile old testnet descriptions with mainnet before submission.
3. **Attach meaningful evidence:** reproducible local/fork checks for insufficient reserves, unauthorized actions, duplicate payouts, timing boundaries, failed/retried settlement, buying/selling and recovery. Keep unresolved findings visible, with remediation and retest links.
4. **Build a dated supply record:** block height, total supply, excluded treasury/team/locked addresses with evidence, holder distribution, mint/burn powers and vesting/unlock rules. State whether a finite maximum exists only after code and governance review. An internally calculated price is not evidence of an exchange market or independently verified market cap.
5. **Complete the issuer details:** authorized representative and role, project launch evidence, official-domain inbox, verified public accounts, square PNG assets and public documentation URLs. Do not invent a registered entity, jurisdiction, partners, an auditor or a price forecast.
6. **Record the external result:** actual ticket number and receipt for submission; then the accepted page/report and its exact scope. An unsent draft, HTTP 200 website or successful internal test is not an external approval.

No auditor, CMC, CoinGecko or BscScan endorsement is asserted here. Website wording should describe only the specific verification or publication evidence that is actually available.
