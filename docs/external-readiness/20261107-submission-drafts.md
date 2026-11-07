# FTI listing facts and publication drafts

Prepared **7 November 2026, Asia/Tehran**. Status: **drafts for review; not submitted or published**. The readiness gates and verification evidence are in [`20261107-readiness.md`](20261107-readiness.md).

## Listing form fact sheet

| Field | Proposed value / unresolved input |
| --- | --- |
| Project name | FTI Protocol |
| Symbol | FTI; matches the checked-in token implementation's `symbol()` |
| Platform | BNB Smart Chain, chain ID 56 |
| Token address | `0x43755B1E813b2d41F669ea08bcf859De07195eA1` |
| Token explorer URL | `https://bscscan.com/token/0x43755B1E813b2d41F669ea08bcf859De07195eA1` |
| Website | `https://ftiprotocol.com/` |
| Application | `https://ftiprotocol.com/app/` |
| Public repository | `https://github.com/Rezamoradifar/fti-protocol` |
| Deployed-source commit | `ba82373a83d63fba0643332371cfb6d62903c849` |
| Project contact candidate | `Support@FTIProtocol.com`; confirm receipt and authorized representative before use |
| Telegram candidate | `https://t.me/FTIProtocol_Official`; verify current control |
| X candidate | `https://x.com/FTIProtocol`; verify current control |
| Representative / relationship | **Required: real name and authorized project role** |
| Launch date and evidence | **Unconfirmed**. The source-verification date is not automatically the public launch date. |
| Legal entity / jurisdiction / team | **Unconfirmed**. Supply only true, relevant information. |
| Total / circulating / maximum supply | **Pending a dated on-chain and distribution reconciliation**; do not use placeholder zeros |
| Exchanges and market-pair URLs | **No qualifying public market verified in this review** |
| Independent audit | **No completed independent report established** |
| Public logo URLs | **Prepare and verify**: 200×200 transparent PNG for the CMC listing form; 400×400 PNG for Community verification |
| CMC UCID / existing listing URL | **Not confirmed**; do not use the unrelated FansTime page |

The CMC [listing form](https://support.coinmarketcap.com/hc/en-us/requests/new?ticket_form_id=360000493112) asks for factual project details and supporting links. Its indexed form recommends a longer 450–600 word project description. The short accurate description below is a starting point; expand it only after the economics, launch, team and market fields above are resolved. Do not pad it with unverifiable partnerships or performance claims.

### Proposed listing subject

`FTI Protocol - FTI - Add cryptoasset`

### Proposed one-line description

FTI Protocol is a BNB Smart Chain project providing a wallet-connected interface to its token and membership smart contracts.

### Factual short description

FTI Protocol is a smart-contract project on BNB Smart Chain, using chain ID 56. Its public website is ftiprotocol.com, and its member interface is available at ftiprotocol.com/app/. The project publishes source code in the Rezamoradifar/fti-protocol GitHub repository.

The deployment identified by the public configuration uses the FTI token contract at 0x43755B1E813b2d41F669ea08bcf859De07195eA1 and a separate binary-plan contract at 0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9. The deployment record identifies source revision ba82373a83d63fba0643332371cfb6d62903c849. The source includes token, membership, governance and timelock components; a listing review should evaluate the deployed implementation and its current permissions.

On 7 November 2026, a read-only check of Sourcify's official API returned exact creation and runtime source matches for the six addresses recorded in that deployment. Those records were originally verified on 16 October 2026. Source matching establishes a relationship between published code and contract bytecode; it is separate from an independent security audit.

No supported exchange pair, independently verified circulating supply or completed independent audit report is asserted in this description. These fields will be supplied with supporting evidence when available.

## CMC news and Community package

Use a project-authored Community update for direct communication. An editorial story, a sponsored article and a token listing have different review processes. CMC [describes partner-based news and audit feeds here](https://support.coinmarketcap.com/hc/en-us/articles/360045595471-Category-Specific-Listings-Criteria). Its [Community verification guide](https://coinmarketcap.com/academy/article/get-verified-on-cmc-community-start-building-your-community) requires an existing project listing before the project badge application.

### Proposed Community bio

FTI Protocol on BNB Smart Chain. Official updates, contract references and development progress. Website: ftiprotocol.com.

### Project update / news pitch draft

**FTI Protocol documents its BNB Chain deployment and source-verification records**

**7 November 2026** — FTI Protocol has prepared a public-reference package covering its BNB Smart Chain deployment, contract addresses and source-verification evidence. The website is available at ftiprotocol.com, with the member interface at ftiprotocol.com/app/.

The token is identified by contract address **0x43755B1E813b2d41F669ea08bcf859De07195eA1** on chain **56**. The associated binary-plan contract is **0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9**. Readers should use the full chain and address to distinguish the project from other assets using the same ticker.

A read-only check of Sourcify's official API on 7 November returned exact creation and runtime source matches for the token and plan proxies, their recorded implementations, the council and the timelock. The records' original verification dates are 16 October 2026. The deployment source reference is **ba82373a83d63fba0643332371cfb6d62903c849** in the public GitHub repository.

The package separates source verification from independent security review and market-data listing. It does not announce an independent audit, exchange listing, CMC approval or investment return. Any future audit or market integration will be described with its actual report or market link and the scope it covers.

**References:** [Website](https://ftiprotocol.com/), [repository](https://github.com/Rezamoradifar/fti-protocol), [token source-verification record](https://sourcify.dev/server/v2/contract/56/0x43755B1E813b2d41F669ea08bcf859De07195eA1), [plan source-verification record](https://sourcify.dev/server/v2/contract/56/0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9).

**Before publication:** ensure this package has a durable public URL; confirm the authorized publisher and contact address; recheck the live contract references. Do not add a founder quote without that person's actual approved words.

## Independent audit inquiry draft

**Subject:** FTI Protocol — scope and quotation request for BNB Smart Chain deployment review

Hello,

We would like to request a proposed scope, schedule and quotation for an independent review of FTI Protocol on BNB Smart Chain. The public repository is https://github.com/Rezamoradifar/fti-protocol. Our deployment record identifies source commit ba82373a83d63fba0643332371cfb6d62903c849, with token 0x43755B1E813b2d41F669ea08bcf859De07195eA1 and binary plan 0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9.

We propose including the token and plan implementations, proxies, governance, timelock, initialization and upgrade controls, reserve accounting, reward eligibility and settlement, rounding, and the off-chain keeper where it affects liveness. We will supply reproducible builds, compiler settings, deployment transactions, a dated role/implementation snapshot, approved economic specifications, tests and known findings before scope is frozen.

Please specify the reviewer team, deliverables, retest policy, public-report policy, exclusions, price and payment milestones. If your organization supplies an audit feed to CoinMarketCap, please explain the conditions for a completed report to appear there. We are not requesting a certification of token price, returns or solvency beyond the evidence and scope of the review.

Project representative and contact: **to be completed by the authorized sender**.

This draft has not been sent and does not appoint an auditor or accept commercial terms.
