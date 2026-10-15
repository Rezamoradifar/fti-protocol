# FTI landing — React redesign

Standalone React 19 landing, English/Persian, RTL, dark/light themes, responsive navigation, accessible token tabs and FAQ. No wallet transactions are performed by this page.

## Build

Node.js 22 or newer:

```sh
npm ci --prefix landing
npm run build --prefix landing
```

Serve `landing/dist` using a static HTTP server. The default workspace links are `/app/`, `/token/`, and `https://council.ftiprotocol.com/`. Set `FTI_APP_URL` at build time to override the member link.

## Install on the existing FTI server

Run `sudo bash landing/install-dist.sh` from a built checkout. The script stages the new build, backs up the current `/opt/fti-protocol/landing/dist`, checks Nginx and verifies locally served HTML/assets. It restores the previous directory on verification failure. It does not change backend services or Nginx configuration.

A release ZIP includes this landing source and prebuilt `dist`; after extracting it run `sudo bash landing/install-dist.sh`. Keep the reported backup for rollback.
