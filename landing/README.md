# FTI Protocol landing page

Independent, English React landing page. The existing protocol application and smart contracts are not modified. Includes responsive navigation, a unit-allocation calculator, binary point-matching lab, a connected five-rank/protection explorer and comparison table, settlement and builder-pool explanations, conceptual buy/sell curves, fee-operation tabs, a vesting timeline, a five-step testnet guide, searchable FAQ, a five-contract directory and source/research resources.

## Build

Node 22 or later:

```sh
npm ci
npm run build
```

The complete deployable site is in `dist/`. Serve that folder with Nginx, any static host, or a static HTTP server. No database, wallet private key or backend is required. The page does not connect wallets or submit blockchain transactions. Google Fonts is optional; system fonts remain available if it is blocked.

External links are defined at the top of `src/main.jsx`. The default test application URL points to the requested new server, `http://185.114.206.44:3080`. Override it at build time with `FTI_APP_URL=https://your-app-domain npm run build`. Endpoint availability is not inferred from the configured URL. This landing is not a replacement for that application.

## Linux preview on a separate port

```sh
python3 -m http.server 3090 --bind 127.0.0.1 --directory dist
```

This binds to localhost for use behind your existing reverse proxy. Do not change the running application's port. For production, configure an HTTPS domain with the static document root set to `dist/`.

## Content boundaries

Parameter values describe the existing source, not live market data. Matching results show points only; no projected earnings are presented. The curve chart is explicitly conceptual. The owner-selected current candidate keeps buy fees in R, routes the full Binary 5% to R at positive supply and H at zero supply, and keeps H protected/inactive without automatic insurance. H can be disposed of only through permanent governed retirement after liability checks to the fixed development recipient. The former automatic-support proposal is superseded, not implemented. See [the owner decision](../docs/OWNER-SUPPORT-DECISION-2026-10-06.md). Known economic limitations and independent-audit status remain visible.

The hero is a generated decorative artwork, not a token product photograph. No user keys, balances, testimonials, performance metrics or income claims have been invented.

## Extended content

Rank, cap and contract data live in `src/protocol-data.mjs`. Extended sections are in `src/sections.jsx`. Legacy deployment addresses remain historical and are labeled accordingly; they do not identify a deployment of the selected local candidate. Current allocation copy describes the owner-selected candidate. The owner confirmed chain 97 for a future TEST ONLY MockUSD deployment, but no new public addresses, live network verification, transaction approval or deployment are claimed. No artificial return projections or claims of audit completion are used. The visual curve is conceptual.
