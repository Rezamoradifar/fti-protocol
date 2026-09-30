# FTI Protocol landing page

Independent, English React landing page. The existing protocol application and smart contracts are not modified. Includes responsive navigation, a unit-allocation calculator, binary point-matching lab, conceptual buy/sell curve explorer, FAQ, contract-address copy and links to the existing test application and source review.

## Build

Node 22 or later:

```sh
npm ci
npm run build
```

The complete deployable site is in `dist/`. Serve that folder with Nginx, any static host, or a static HTTP server. No database, wallet private key or backend is required. The page does not connect wallets or submit blockchain transactions. Google Fonts is optional; system fonts remain available if it is blocked.

External links are defined at the top of `src/main.jsx`. The test application URL currently points to `http://70.33.249.57:3080`; update it when an HTTPS domain is configured. This landing is not a replacement for that application.

## Linux preview on a separate port

```sh
python3 -m http.server 3090 --bind 127.0.0.1 --directory dist
```

This binds to localhost for use behind your existing reverse proxy. Do not change the running application's port. For production, configure an HTTPS domain with the static document root set to `dist/`.

## Content boundaries

Parameter values describe the existing source, not live market data. Matching results show points only; no projected earnings are presented. The curve chart is explicitly conceptual. The scheduled exit/support-budget candidate is identified as separate and not active in the current testnet deployment. Known economic limitations and independent-audit status remain visible.

The hero is a generated decorative artwork, not a token product photograph. No user keys, balances, testimonials, performance metrics or income claims have been invented.
