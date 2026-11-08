# FTI customer services: implementation and activation

This release adds guided support, optional AI intent routing, opt-in customer requests, a guardian inbox, and a verified-provider VPN handoff. It does not claim that an external AI account, social channel, email sender or VPN provider has been connected or that an independent audit/listing has been awarded.

## What works without external credentials

- `/support/` provides clearly identified automated help for membership, wallet connection, token transactions, rewards, referrals, verification evidence and VPN delivery. Links use the actual workspace routes: `/app/#network`, `/app/#support` and `/token/#trade`.
- The universal support launcher loads the support interface only when opened. The home page does not start a chat session or poll a customer API in the background.
- Contact requests require a separately checked consent control. Email/Telegram contact details are unverified, and creating a request does **not** send email, subscribe anyone to a campaign or reveal an account.
- Intake is durable and idempotent. Retrying the same request identifier and content returns the original receipt. Changed content with that identifier is rejected.
- A receipt cancellation control removes the request's name, contact and message. Only the cancellation receipt is retained in the current browser tab's session storage, so refreshing the page does not lose it. Chat transcripts and wallet support bearer tokens are not stored in the browser.
- Requests expire after 30 days. Expired files are removed on store access and by an hourly sweep while the process is running. The next access after a stopped server also prunes expired files.
- The existing guardian support area includes **Customer requests**. After signing the existing support-access message, a guardian can read incoming requests and mark them in review, replied or closed. “Replied” is a manual workflow state; the application does not claim to have sent a message.

The assistant guides the visitor to the appropriate purchase flow. Token approvals, membership transactions and token purchases/sales still require the visitor's own wallet and the existing transaction checks. The assistant has no signing key and does not move money.

## Storage and deployment

Set `FTI_CUSTOMER_DATA_DIR` to an absolute, service-owned directory outside all web roots. The default production location is:

```text
/var/lib/fti-customer-services/<chain-id>-<lowercase-binary-address>
```

The directory is `0700`; lead and lock files are `0600`. Symlinks, hard-linked files, unsafe ownership and permissive file modes fail closed. A single writer owns the directory. A second running web worker cannot silently overwrite records. An abandoned lock is recovered only when its PID no longer exists. Do not delete a lock belonging to a live process. Keep these directories when replacing application releases or rolling back.

If systemd uses `ProtectSystem=strict`, allow this directory through the service's existing `ReadWritePaths`. Use the same service account and deployment convention as the installed web service. Do not copy production contact records into a public release archive, Git, support screenshots or test fixtures.

Default rate limiting uses the peer IP. For a reverse proxy, configure it to overwrite `X-Real-IP` with the connecting visitor's address, and then set `FTI_CUSTOMER_TRUST_PROXY=loopback`. The backend accepts that header only when the socket peer is loopback. Without that setting, visitors behind a loopback proxy share the existing site-wide budgets (60 contact submissions/hour and 200 guided questions/minute), rather than incorrectly treating the whole site as one visitor with a six-submission limit. An arbitrary `X-Forwarded-For` header is never trusted. For a larger launch, configure reliable visitor IPs and tune capacity after measuring traffic; do not simply accept client-controlled forwarding headers.

```nginx
# Add to the existing proxy location that forwards /api/.
proxy_set_header X-Real-IP $remote_addr;
```

Do not replace the existing nginx configuration with this fragment.

## Optional AI routing

The guided service is usable with `FTI_ASSISTANT_PROVIDER=none`. To enable AI matching, configure a server-side OpenAI project key and an explicitly selected model supporting Responses structured outputs. Use the environment example in `config/customer-services.env.example`. A key file must be a regular, service-readable file owned by root or the service user, with no group/other permissions. Never embed it in the website, deployment config returned by `/api/config`, or the repository.

The visitor must opt in before a question is sent to OpenAI. Only the current question and approved help material are used; common email, wallet, URL, Telegram username and phone-number formats are redacted before the provider call. Redaction is best-effort; visitors should avoid including personal or secret information in AI questions. The request sets `store:false`, has a timeout and a small output-token bound. No tools, wallet permissions, URLs, custom system prompts or arbitrary remote APIs are exposed to the model. The model can return only an approved topic and a human-handoff flag. All displayed guidance and links come from the reviewed knowledge catalog. Failure, a refusal, malformed output or an exhausted cap falls back to the guided path.

`FTI_ASSISTANT_DAILY_REQUEST_LIMIT` defaults to 20 attempts per UTC day **per process**. It is an operational throttle, not a billing limit, and resets on a process restart. Set a project-level spending limit with the provider before activation. There is also a limit of two concurrent AI calls and five opted-in calls per visitor per minute. A configured key/model is not proof of a successful provider call; activation still needs an opted-in smoke test.

Official API reference used for the adapter: [Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

## VPN handoff

The prior NodeShield work belongs to the separate Smart Contract Platform service. This repository has not verified that service's domain, payment provider, deployed revision or delivery. `/vpn/` therefore starts with ordering unavailable and offers help for an existing order or an opted-in availability request. It presents no invented plans, prices, locations or successful purchase receipt.

To open checkout:

1. Establish the real provider domain and inspect its deployed payment/delivery implementation.
2. Complete a controlled acceptance test covering `paid-order-delivered`, `owner-authorized-retrieval`, `retry-after-provisioning-failure`, `reopen-order-recovery` and `expiry-enforcement`. Retain the actual receipt/run evidence privately.
3. Install a root/service-owned manifest using `config/nodeshield-acceptance.example.json`. Fill in the real provider URLs, release ID, verification timestamp and non-secret evidence reference. Populate `deliveryChecks` only from observed successful checks. The empty example intentionally fails validation.
4. Configure the exact provider hostname in `FTI_VPN_ALLOWED_HOSTS` and the manifest file path in `FTI_VPN_MANIFEST_FILE`. HTTPS is required; URLs with credentials, query secrets, fragments, nonstandard ports, IP literals or different portal/health origins are rejected.
5. The provider's health endpoint must return JSON like the following from the accepted release. It must report actual checkout and delivery availability.

```json
{
  "service": "nodeshield",
  "status": "ok",
  "checkoutReady": true,
  "deliveryReady": true,
  "releaseId": "the-accepted-provider-release"
}
```

The adapter pins a public DNS result for its HTTPS request, verifies TLS using the original hostname, blocks private/link-local/mapped addresses, follows no redirects and caps response size/time. A stale acceptance record (over 90 days), changed provider release, failed health check or delivery outage closes the checkout link. The result is cached for at most 30 seconds. The adapter does not collect payment or return a VPN configuration; those operations remain in the verified provider portal. The user rechecks availability before leaving for that portal.

## HTTP surface

| Method and path | Behavior |
| --- | --- |
| `GET /api/customer-services/config` | Version, automated identity, optional AI configuration state, intake availability and cached VPN state. No secrets or lead data. |
| `POST /api/customer-services/chat` | Guided reply; optional opted-in AI topic routing. No chat-history persistence. |
| `POST /api/customer-services/leads` | Consent-bound, idempotent intake. Returns a reference, state and expiry; no contact echo. |
| `POST /api/customer-services/leads/:id/withdraw` | Requires the matching 256-bit receipt token; erases personal contact/message fields. |
| `GET /api/customer-services/leads` | Existing support bearer session plus a fresh on-chain guardian check on every call. |
| `POST /api/customer-services/leads/:id/status` | Same guardian authentication; manual review workflow only. |
| `GET /api/customer-services/vpn` | Checks the configured acceptance manifest and live provider health. No arbitrary target parameter. |

JSON mutation requests are limited to 8,000 bytes and require the allowed site origin. Ordinary public queries and writes are rate-limited. Intake is not a proof of email, Telegram or wallet ownership. It must not be used to authorize recovery, disclose wallet data, or trigger unsolicited messages.

## Verification scope

`node --test test/customer-services.test.mjs test/static-response.test.mjs test/support-tickets.test.mjs test/support-ticket-ui.test.mjs` covers real HTTP consent/idempotency, private durable storage, concurrent retry behavior, real support-message signature sessions, guardian revocation, cross-origin denial, withdrawal/expiry, secret rejection, AI opt-in and invalid output, VPN delivery/readiness gating, DNS private-address rejection and precompressed static responses.

These checks do not establish a live OpenAI connection, VPN payment/delivery, social account ownership, email delivery, independent audit or market listing. The remaining activation evidence must come from the actual configured services.

The isolated browser fixture is `landing/tests/customer-services-server.mjs`; it uses temporary contact records and has no signing, payment or provider credentials. Run from `landing/`:

```bash
FTI_CHROMIUM_PATH=/usr/bin/chromium node node_modules/@playwright/test/cli.js test --config=playwright.customer.config.mjs
```

In the implementation workspace this browser run was blocked before page startup by the environment's Chromium socket policy (`socket() failed: Operation not permitted`). The browser scenarios are provided for rerun, and must not be reported as passing or as visual production verification. The independent HTTP and module tests ran successfully.
