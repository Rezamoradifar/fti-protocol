# ftiprotocol.com: main website, member panel, token site and administration

All four sections run on the existing server `185.114.206.44`, with one HTTPS origin and distinct entry points:

| Section | URL | Purpose |
| --- | --- | --- |
| Main website | https://ftiprotocol.com/ | Protocol information, plan, rules, resources and links |
| Member workspace | https://ftiprotocol.com/app/ | Membership, balances, branch information, invitations and rewards |
| Token site | https://ftiprotocol.com/token/ | Token introduction, live price/reserve/supply, trading, transfers and unlock schedules |
| Administration | https://ftiprotocol.com/admin/ | Council proposals, timelock execution and permissionless settlement |

The application, token and administration screens have separate navigation and entry pages. They reuse the same wallet integration and deployed testnet contracts. A member's invitation always links to `/app/?sponsor=…#network`.

## DNS

Set **A** records for both `@` and `www` to `185.114.206.44`. Remove conflicting old A records and any AAAA record unless the origin has separately been configured for IPv6. Use DNS-only mode during this installation if a reverse-proxy DNS provider is involved. The installer checks the server's resolver before changing public routes.

Open TCP ports **80** and **443** in the VPS provider firewall. The script opens these ports in UFW only when UFW is already active. Ports 3080 and 3090 remain available for compatibility.

## Install on the existing migrated server

```bash
(
set -e
cd /opt/fti-protocol
runuser -u fti -- git pull --ff-only
bash scripts/setup-domain.sh
)
```

The script is specific to the installation made by `install-new-server.sh`. It:

1. Validates DNS and refuses conflicting domain virtual hosts.
2. Builds the latest landing page and application using the existing Node runtime.
3. Installs a dedicated FTI Nginx virtual host without deleting unrelated sites.
4. Runs Certbot's interactive registration and terms prompts. Enter an email address you control; review and respond to the certificate authority's terms yourself.
5. Obtains certificates for the apex and `www`, redirects HTTP and `www` to the HTTPS apex, enables certificate renewal and an Nginx reload hook.
6. Checks all four HTTPS entry points, API configuration and health through local HTTPS with certificate validation.

No wallet private key is required. No contracts are deployed or changed. If certificate issuance fails, the script restores the previous domain virtual host; the existing port 3090 remains available. A DNS or cloud-firewall problem must be corrected before retrying. A successful local HTTPS check does not independently confirm access through a provider firewall.

The script defaults to `FTI_DOMAIN=ftiprotocol.com` and `FTI_ORIGIN_IP=185.114.206.44`. These can be exported for another domain/server. It does not change records at the registrar.

## Administration access

There is no email/password administrator service in this release. The connected wallet is checked against `Council.isOwner(address)` on-chain. Only council owners can create or approve proposals. Three approvals are required for proposal execution; sensitive scheduled operations still obey the timelock. Settlement processing and execution of already-authorized, ready operations remain permissionless as required by the contracts.

The admin URL is publicly readable. Hiding a screen is not an authorization boundary; the contracts enforce every role. The server does not receive wallet signing keys. Wallet access already granted in the same browser session is reused across sections when available; a new wallet authorization is never requested silently.

The current deployment remains BNB testnet, chain ID 97, with test USD. Connecting a domain does not turn the deployment into mainnet or resolve economic/security review findings.

## Checks and troubleshooting

```bash
curl -f https://ftiprotocol.com/health
curl -f https://ftiprotocol.com/token/ -o /dev/null
curl -f https://ftiprotocol.com/admin/ -o /dev/null
systemctl status fti-testnet-web nginx certbot.timer --no-pager
```

For renewal testing, run `certbot renew --dry-run`. Use a browser wallet or its in-app browser for signing; WalletConnect is not part of this release.
