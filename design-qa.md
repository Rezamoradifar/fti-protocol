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
