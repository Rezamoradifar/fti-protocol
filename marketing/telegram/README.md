# FTI Protocol Telegram editorial system

Official channel: https://t.me/FTIProtocol_Official

## Verified live launch

On 23 October 2026, the authorized channel setup completed and was verified through Telegram's API:

- Welcome announcement: https://t.me/FTIProtocol_Official/4 (pinned)
- Wallet onboarding guide: https://t.me/FTIProtocol_Official/6
- Channel title, description, profile image and official-link buttons applied

The two photo posts have matching successful receipts. Eight unpublished launch posts remain in the separate daily queue. The recurring VPS timer is not activated by this live setup.

All channel-facing copy is formal English. Use dark forest green, mint and white, the existing FTI symbol, generous spacing and a short prominent headline. The two original launch visuals are `assets/welcome.png` and `assets/first-steps.png`. The profile image faithfully renders the existing SVG logo.

## Post format

Use a short bold heading, a compact explanation, one clear action, the official channel footer, and three relevant hashtags. Always include `#FTIProtocol`; the other tags identify the actual topic. Avoid unrelated trending tags, unsupported performance claims and guaranteed-return language.

Captions retain the official website links. Inline buttons link only to the official website, member application and token application. The welcome post is pinned without a notification. The initial launch contains a welcome photo post and wallet onboarding photo post; future publication follows the daily queue.

The canonical copy is `config/telegram-launch-posts.en.json`. Confirmed publication receipts are recorded separately from the token and identify each sent post by channel, message ID, image hash and caption hash. The automated queue excludes launch posts whose successful receipts match the exact canonical copy, preventing a duplicate introduction during installation.

## Launch helper

`python3 tools/configure-telegram-channel.py` previews the approved launch without network access. `--apply --bot-profile` reads the token through a hidden interactive prompt, verifies the exact channel, bot and administrator rights, sets channel branding, publishes the two visual posts and pins the introduction. Tokens are never written to files.

The helper never retries an uncertain send. If a receipt is `sending` or `unknown`, inspect the actual channel before any recovery. Preserve `live-channel-setup.json`; do not delete it to force another attempt.

The channel setup helper does not install a recurring background service. The independent VPS installer in `docs/TELEGRAM_CHANNEL.md` enables the daily queue after operator installation. Preserve existing publisher state when updating an already installed timer.

See `DESIGN_PROMPTS.md` for the exact artwork briefs and `assets/` for the project-ready files.
