# Design QA — pure-black exchange

Final result: passed

Selected source: first exchange concept, revised to pure black (exec-c4ddc22c-21aa-4339-baf8-e317bc91c6ca.png). Existing production application updated, retaining the existing FTI brand and financial rules.

Comparison: revised reference 1487×1058, browser implementation 1363×936; compared at equivalent overall width and checked individual order-panel/chart regions. Mobile checked at 390×844. Screenshots and side-by-side comparison were inspected locally.

- Layout: order entry left, chart right; stacked chart/order entry on mobile. Quick registration, wallet, genealogy and token actions remain accessible.
- Typography: existing Persian-friendly UI font retained; numeric OHLC and addresses use left-to-right layout. Source Latin copy replaced by real application translations.
- Spacing: compact exchange cards and controls; mobile navigation wraps without overlap or horizontal overflow.
- Colors: body background verified as rgb(0,0,0); panels pure black, white actions, thin neutral borders. Chart green/red indicates observed upward/downward candles.
- Assets: existing FTI logo retained. Existing landing illustration rendered in grayscale; fixed its preview route. No custom CSS logo recreation.
- Data/copy: no invented orderbook, volume, unsupported limit orders or fabricated price history. OHLC represents observed on-chain reserve price samples while the page is open, with browser cache; it is not a complete exchange trade feed. Intervals 1m/5m/15m. Preview explicitly uses captured TESTNET data and cannot transact.

Iteration history: fixed wallet/header overlap; reserved desktop navigation space; stacked mobile brand/navigation; removed remaining green landing panel; fixed preview illustration route.

Validation: nine candle, settlement-view and wallet-discovery tests passed. Web and landing production builds passed. Browser verified Buy/Sell tabs, 5m selection, pure-black background and desktop/mobile overflow. No application console errors observed. Real wallet signing and server deployment were not performed in this environment.

No unresolved visual P0/P1/P2 issues. Intentional deviations from the mock are documented above; exact mock financial numbers/history are not production data.

## Candles and volume follow-up
Added recent 300-block token trade history, execution-price OHLC, actual buy/sell USD volume bars and recent trade rows. Buy USD is usdIn; sale USD is actual usdOut (after fee). This is explicitly recent-block volume, not a fabricated 24h number. RPC batches disabled for browser reads; history requests shared and cached on server. Invalid/unavailable history shows unavailable instead of zero. Historical execution candles are separate from spot-price fallback samples. Twelve relevant tests and production web build passed. Local captured-data preview has no trade-history fixture, so live server retrieval remains to be verified after installation.

## 2026-10-10: coordinated public sites and subdomains
- Four destinations: protocol landing, member app, token public site/market, council.
- Added bilingual whitepaper and staged roadmap, with current code rules and pending validation clearly separated.
- Fixed landing acceptance of continuity upgradeable contract models.
- Desktop browser checked token public site, whitepaper and member panel. Token public mobile at 390px had body width/scroll width 375/375; menu expanded with all links.
- Fifteen focused routing, wallet discovery, candles, market and settled-points tests pass. Web and landing builds pass. Shell syntax checked for subdomain installer.
- No contracts changed or network transactions signed. Preview uses captured testnet data with a visible label.
- Production activation still requires server installation, DNS A records and TLS issuance. WalletConnect origin allowlist must include the three subdomains in the existing Reown project.

## 2026-10-10: restore original green/gold identity
- Restored source palette (#101817 / #182321 / #1e2d29, pale-green #c5e8a4, gold #d4b87b) across landing, member, token, council, whitepaper and roadmap.
- Preserved all routes, UI controls, read/write handlers and contract sources.
- Web and landing builds pass. Desktop member, council and token public screens reviewed; member mobile body width equals scroll width (375px), with no horizontal overflow.
- Preview financial responses are captured fixtures; council/market fixture limitations remain, not a live-network validation.
- Server deployment prepared only; existing HTTPS/subdomain configuration is preserved by frontend installer.

## 2026-10-10: restore the first complete landing
- Restored the original layout from 4ca08073fc9b60f8cf5081b24fce0caf6016a171: mint ring hero, architecture cards, light allocation section, point lab, conceptual funding flow, journey, development cards, FAQ and oversized footer. English presentation matches the initial landing.
- Updated obsolete economic copy to the current R/S model, retained unpaid matches, 16 USD protection trigger, funded 20 USD gross points, 500 USD steps and current rank thresholds. Removed old fixed contract address, legacy server URL and GitHub links. Token address is read from validated chain-97 configuration; unavailable data is not invented.
- Kept current member/token/council destinations and bilingual public documents. Scoped public/initial styles to avoid cross-page restyling.
- Production landing build passed. Desktop and 390px mobile hero reviewed; FAQ expansion and mobile menu verified. Token public page retains its layout. Preview uses captured testnet configuration, not live transaction evidence.
- No contract, keeper, user data or money changed. Server activation requires the existing frontend-only installer.

## 2026-10-10: genealogy contract-data clarification
- Node cards distinguish remaining branch units from lifetime units. Root detail shows purchased units, test-USD equivalent, actual contract rank, historical/remaining L/R and raw remaining matches explicitly distinct from settled paid points.
- Missing historical RPC state falls back to current reads with a visible multi-block warning; contract errors clear stale tree/details rather than displaying missing values as zero.
- Three focused data/fallback tests pass; production web build passes. No contracts or economic behavior changed. Browser visual and live server validation are pending installation.
