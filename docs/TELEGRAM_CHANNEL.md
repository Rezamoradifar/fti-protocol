# FTI Protocol Official Telegram Channel

All channel-facing copy is in formal English, including the channel name, description and ten launch posts.

- Proposed channel name: **FTI Protocol | Official**
- Public channel: **FTIProtocol_Official** — https://t.me/FTIProtocol_Official
- Proposed bot name: **FTI Protocol Publisher**
- Verified bot username: **FTIProtocol_OfficialBot**

The operator supplied this channel, and the Telegram API confirmed its existence with numeric ID `-1003941034086`. The bot identity and administrator rights have now been verified, including **Post Messages**. The public website sources use the supplied channel URL; a source update alone does not deploy the website or install a recurring publisher.

The professional launch assets and editorial format are documented in `marketing/telegram/README.md`. The setup helper uses the official logo, formal English copy, three relevant hashtags per post and fixed official-link buttons. Successful photo publications are recorded in the token-free `marketing/telegram/live-channel-setup.json` receipt. The initial welcome and wallet-guide posts are excluded from the future queue only after successful receipts are verified against the exact canonical copy.

The live launch was verified on 23 October 2026: [welcome post](https://t.me/FTIProtocol_Official/4), pinned, and [wallet guide](https://t.me/FTIProtocol_Official/6). Channel branding and both photo-message receipts were confirmed by Telegram. Eight launch posts remain for the VPS queue; its recurring timer still requires operator installation.

## Telegram setup

1. Open the existing `@FTIProtocol_Official` channel in the Telegram account that manages it.
2. Use the verified `@FTIProtocol_OfficialBot` publishing bot.
3. Add the bot as a channel administrator with **Post Messages** permission. This publisher does not require deletion, administrator-management or wallet permissions.
4. Enter the bot token only through the installer's hidden prompt on the VPS. Do not place it in chat, source control, command-line arguments or public files.

The channel and its public username are created through the owner's Telegram account. The bot publishes to the channel after the owner grants access.

## VPS installation

Requirements: Python 3.10 or later, the `Asia/Tehran` time zone database, systemd with `LoadCredential` support, and HTTPS access to `api.telegram.org`.

`tools/install-telegram-publisher-release.py` is self-contained and includes the publisher and ten English launch posts. Verify the downloaded file's SHA-256 against the supplied release digest before execution.

Preview the schedule without requesting a token, changing services or sending messages:

```bash
python3 tools/install-telegram-publisher-release.py
```

Install as root on the VPS for the operator-designated channel:

```bash
python3 tools/install-telegram-publisher-release.py --apply --channel @FTIProtocol_Official
```

The token is read through a hidden prompt. The installer verifies the bot identity, numeric channel identity and posting permission. The numeric destination is pinned so reassignment of a public username cannot redirect publication. The configuration file is readable only by root and is delivered to the restricted service through a systemd credential.

Installation adds the separate `fti-telegram-publisher.service` and timer. It does not change or restart the website, contracts or Keeper. The initial service check uses read-only `--validate` mode and sends no test message. The publisher's first run also only arms the queue.

Default schedule: the first unpublished post tomorrow at 19:00 **Asia/Tehran**, then one post per day. There are ten approved launch posts in total; after two successful visual launch posts, eight remain for the daily queue. The English channel language does not change the schedule's time zone. Titles are rendered in bold with official application buttons. The queue does not generate new content or repeat posts with matching successful receipts. Continued publication requires additional approved content. A custom start must be explicitly in the future, using `--first-at 'YYYY-MM-DDT19:00:00+03:30'`.

## Status and pause

```bash
systemctl status fti-telegram-publisher.timer --no-pager
journalctl -u fti-telegram-publisher.service -n 30 --no-pager
```

Installation prints the queue path as `QUEUE=`. The durable publication ledger is stored under `/var/lib/fti-telegram/`. Preserve this ledger during pauses, credential changes and updates; duplicate protection depends on it.

Pause publication while preserving the queue and ledger:

```bash
systemctl disable --now fti-telegram-publisher.timer
systemctl stop fti-telegram-publisher.service
```

Resume:

```bash
systemctl enable --now fti-telegram-publisher.timer
```

The installer refuses to overwrite an existing configuration, service or ledger. Existing installations require review before an update.

## Outage behavior

- Post identity and content are recorded durably. A lock prevents concurrent publishers.
- An uncertain delivery or interruption during sending holds that post for review instead of automatically retrying. This may leave an undelivered post on hold, but prevents an accidental duplicate after a lost response.
- Only an explicit Telegram 429 rejection is retried after its waiting period.
- A post more than two hours overdue is held for review. A long outage does not produce a burst of missed posts.
- The daily limit uses the actual attempt date in Tehran.

## Verification

```bash
python3 test/telegram-publisher.test.py -v
python3 test/telegram-installer.test.py -v
python3 test/telegram-channel-setup.test.py -v
python3 tools/install-telegram-publisher-release.py
```

Automated tests use simulated responses and do not send live Telegram messages. Installer tests check file permissions, initial read-only validation, recovery after failed unit verification and exact-copy publication receipts. The channel setup helper separately verifies real channel identity, administrator rights and the result of authorized live publications. The recurring systemd service requires a separate operator-run VPS installation; channel setup does not activate it.

Official references: [BotFather](https://core.telegram.org/bots/features#botfather), [Bot API](https://core.telegram.org/bots/api), [Telegram channels](https://telegram.org/faq_channels).
