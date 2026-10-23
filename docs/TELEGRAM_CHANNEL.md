# FTI Protocol Official Telegram Channel

All channel-facing copy is in formal English, including the channel name, description and ten launch posts.

- Proposed channel name: **FTI Protocol | Official**
- Proposed public username: **FTIProtocol**
- Proposed bot name: **FTI Protocol Publisher**
- Proposed bot username: **FTIProtocol_PublisherBot**

No username has been reserved and no channel ownership has been verified by this setup. The operator must create or control the actual channel before enabling publication. The website's existing Telegram link remains unchanged until ownership is confirmed.

## Telegram setup

1. Create the public channel using your Telegram account, or use the existing channel you control. Register the proposed username only if Telegram accepts it and you control it.
2. Send `/newbot` to `@BotFather` and create the publishing bot. Telegram determines username availability.
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

Install as root on the VPS, replacing the example with a channel you control:

```bash
python3 tools/install-telegram-publisher-release.py --apply --channel @YOUR_OWNED_CHANNEL
```

The token is read through a hidden prompt. The installer verifies the bot identity, numeric channel identity and posting permission. The numeric destination is pinned so reassignment of a public username cannot redirect publication. The configuration file is readable only by root and is delivered to the restricted service through a systemd credential.

Installation adds the separate `fti-telegram-publisher.service` and timer. It does not change or restart the website, contracts or Keeper. The initial service check uses read-only `--validate` mode and sends no test message. The publisher's first run also only arms the queue.

Default schedule: the first post tomorrow at 19:00 **Asia/Tehran**, then one post per day, ten posts in total. The English channel language does not change the schedule's time zone. The queue does not generate new content or repeat previous posts. Continued publication requires additional approved content. A custom start must be explicitly in the future, using `--first-at 'YYYY-MM-DDT19:00:00+03:30'`.

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
python3 tools/install-telegram-publisher-release.py
```

Publisher tests use simulated responses; they do not contact a real bot or send live Telegram messages. Installer tests check file permissions, initial read-only validation and recovery after failed unit verification. Actual systemd installation and channel posting require the token and an operator-run VPS installation.

Official references: [BotFather](https://core.telegram.org/bots/features#botfather), [Bot API](https://core.telegram.org/bots/api), [Telegram channels](https://telegram.org/faq_channels).
