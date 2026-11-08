# Official Telegram bot and verified price table

`tools/fti-official-bot.py` is self-contained Python 3 (standard library only).
It provides English, Persian, Arabic, Turkish, Spanish, Russian and Simplified
Chinese private-message commands and buttons. The public official channel stays
in formal English.

## What is implemented

- `/start`, `/language`, `/price`, `/help`, a persistent language choice and
  Telegram-language fallback.
- Localized private command menus, descriptions, official website/channel
  buttons and language/price callback buttons.
- Direct **read-only** BNB mainnet snapshots of the installed FTI token. Every
  call pins chain 56 and token `0x43755B1E813b2d41F669ea08bcf859De07195eA1`, reads
  price/reserve/supply/cycle/opening at one block, verifies reserve/share price,
  checks block hash again and rejects stale or inconsistent state.
- A channel price table with actual recorded observations, price, UTC date/time,
  block and change against the **separate cycle opening quote reference**.
  It never invents old candles or interprets zero supply as a zero-price trade.
  The first table can contain only the current verified observation; further
  explicitly published tables retain prior verified observations. Prior rows are
  checked against canonical block hashes before publication. Prices can fall.
- Private SQLite state (0700 directory/0600 file), durable update offsets, bounded
  observation/update retention, no storage of private command text, and durable
  delivery intents. An unknown/interrupted channel send is never retried
  automatically. Existing active webhooks are preserved and polling refuses to
  take them over.

This does not list FTI with wallet price providers, change contracts, request a
wallet key, sign a transaction or claim guaranteed returns.

## Preview and local checks

No arguments prints a capability preview without network or file writes:

```bash
python3 tools/fti-official-bot.py
python3 test/official-telegram-bot.test.py
```

A real price table preview makes read-only RPC calls. It needs no bot token,
Telegram call or local state:

```bash
python3 tools/fti-official-bot.py --price-preview
```

The independently checked real snapshot during implementation was block
`129737240`, hash
`0x4218d20c0f81d37f75d496fe9ec111861aba7e75cc766f1d294b16079380f65c`,
`2026-10-25 16:24:42 UTC`: cycle 1, opening quote `0.10 USDT`, observed price
`0.106288920698652181 USDT` and change `+6.2889%`. This is a dated observation,
not a current-price claim.

## Production installation

Run the reviewed, hash-checked script on the FTI VPS as root. An existing private
`/etc/fti-telegram/config.json` is reused. If absent, `--install` prompts for the
token through a hidden **local terminal** prompt and pins the official bot and
channel identity before writing a 0600 private config. The token must not be
passed on the command line, printed, committed or put in a web asset.

```bash
python3 tools/fti-official-bot.py --install
systemctl is-active fti-official-bot.service
```

`--install` validates the official bot and absence of an active webhook, installs
an immutable source under `/opt/fti-telegram/official-bot/<digest>/bot.py`, verifies
the systemd unit, configures localized menus and starts the isolated service. It
uses `DynamicUser`, `LoadCredential`, `ProtectSystem=strict` and a private state
directory. The exact systemd-owned state alias (absolute or `private/fti-official-bot`)
is accepted only when it resolves to the reviewed private state directory; other
links are refused. Runtime directories and source modes are set explicitly even
with an operator umask of 077, and existing writable source is rejected. It refuses an unfamiliar existing service or symlink and only cleans
up files owned by the failed attempt when their bytes still match.

The unit uses `Type=notify`: readiness is emitted only after the private database,
bot identity, webhook status, durable offset and first successful polling response
are verified. Installation also checks the ready status, PID and restart count
twice, one second apart; a briefly active restarting process is not reported as
ready. No real systemd production installation is implied by local tests.

The service answers **new private messages**. Its first poll initializes from
the pending-update tail without sending replies to old conversations. It never
posts channel content or installs a channel timer. Telegram bot privacy and
inbound messages are preserved; an existing webhook needs its actual operator's
migration plan before using polling.

This source was implemented and tested locally; installation and a successful
interactive reply must be verified separately on the VPS. A menu update alone
does not prove the reply service is active.

## Publish one English channel price table

One explicit publication uses a **separate** private ledger so it can run while
the bot is answering messages. Run from the reviewed source and reuse the same
post ID for retries:

```bash
python3 tools/fti-official-bot.py --publish-price --post-id price-20261025
```

The default ledger is `/var/lib/fti-official-price/state.sqlite3`. The private bot
reply ledger is `/var/lib/fti-official-bot/state.sqlite3`. Their histories are
separate; a price table only claims the rows in its own verified ledger.

Expected success is `PRICE_TABLE_PUBLISHED` with a Telegram message ID. Repeating
that same post ID returns `ALREADY_PUBLISHED` and never creates another post. An
unknown or rejected send returns a manual-review error; inspect the actual
channel before deciding on another publication. Do not invent a new post ID to
bypass an unknown delivery state.

The tool creates **no recurring channel schedule**. It leaves the existing finite
publisher's queue, receipt database and timer unchanged. A later user-approved
posting frequency can be configured separately with a bounded schedule.

To configure just Telegram's translated menus and profile copy, without starting
polling or sending messages:

```bash
python3 tools/fti-official-bot.py --configure-menu
```

## Stop and inspect

```bash
systemctl status fti-official-bot.service --no-pager
journalctl -u fti-official-bot.service -n 30 --no-pager
systemctl disable --now fti-official-bot.service
```

Stopping this service does not remove credentials, private language preferences,
price observations, delivery receipts or the separate channel publisher.

Telegram's supported localization scopes, profile-copy limits and negative-offset
initialization were checked against the official [Bot API](https://core.telegram.org/bots/api#getupdates)
and [updates FAQ](https://core.telegram.org/bots/faq#getting-updates). Initialization
confirms/discards the bot's pending update backlog; it does not delete messages
from users' Telegram chats.
