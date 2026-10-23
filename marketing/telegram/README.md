# FTI Protocol Telegram editorial system

Official channel: https://t.me/FTIProtocol_Official

## Verified live launch

On 23 October 2026, the authorized channel setup completed and was verified through Telegram's API:

- Welcome announcement: https://t.me/FTIProtocol_Official/4 (pinned)
- Wallet onboarding guide: https://t.me/FTIProtocol_Official/6
- Channel title, description, profile image and official-link buttons applied

The initial posts have matching successful send receipts. Eight unpublished launch posts remain in the separate daily queue. The recurring VPS timer is not activated by this live setup.

All channel-facing copy is formal English. Use dark forest green, mint and white, glass materials, generous spacing and a short prominent headline.

## Verified glass design refresh

On 23 October 2026 at 21:40 UTC, Telegram confirmed edits to the same existing messages, preserving IDs 4 and 6 and the welcome pin. `live-channel-glass-edit.json` records the separate successful edit receipts; the original send history in `live-channel-setup.json` is preserved.

- Message 4 now contains `assets/welcome-glass.mp4`: a silent 16-second H.264 loop with the exact original website emblem rotating above fixed English typography.
- Message 6 now contains `assets/first-steps-glass.png`: a glass three-step wallet guide with the same emblem.
- The channel profile uses `assets/site-logo-profile.png`, rendered from the image and crop in `frontend/header-mark.jsx`.
- Both edited responses verified the unchanged English captions and five buttons: Launch App, Token Market, Whitepaper, Website and Official Channel. The welcome was verified again through the channel's pinned message.

The metallic mint three-ribbon emblem is the actual spinning website logo. The older favicon-based `welcome.png`, `first-steps.png` and `profile.png` are historical launch originals. Glass styling is part of the artwork; Telegram buttons use native green/blue/default client styles. The future publisher uses the same five-button layout.

## Post format

Use a short bold heading, a compact explanation, one clear action, the official channel footer, and three relevant hashtags. Always include `#FTIProtocol`; the other tags identify the actual topic. Avoid unrelated trending tags, unsupported performance claims and guaranteed-return language.

Captions retain the official website links. Inline buttons link only to the official website, member application, token application, whitepaper and channel. The welcome post is pinned without a notification. Future publication follows the daily queue.

The canonical copy is `config/telegram-launch-posts.en.json`. Confirmed publication receipts are recorded separately from the token and identify each sent post by channel, message ID, image hash and caption hash. The automated queue excludes launch posts whose successful receipts match the exact canonical copy, preventing a duplicate introduction during installation.

## Launch helper

`python3 tools/configure-telegram-channel.py` previews the approved launch without network access. `--apply --bot-profile` reads the token through a hidden interactive prompt, verifies the exact channel, bot and administrator rights, sets channel branding, publishes the two visual posts and pins the introduction. Tokens are never written to files.

The helper never retries an uncertain send. If a receipt is `sending` or `unknown`, inspect the actual channel before any recovery. Preserve `live-channel-setup.json`; do not delete it to force another attempt.

`python3 tools/refresh-telegram-channel-design.py` previews the fixed design edit plan. `--apply` uses a hidden token prompt, verifies the exact bot/channel and edit rights, updates the profile and edits only messages 4 and 6. It has no send operation. Successful steps are skipped on rerun; uncertain steps block further writes for review. Preserve `live-channel-glass-edit.json` as well.

The channel setup helper does not install a recurring background service. The independent VPS installer in `docs/TELEGRAM_CHANNEL.md` enables the daily queue after operator installation. Preserve existing publisher state when updating an already installed timer.

See `DESIGN_PROMPTS.md` for the exact artwork briefs and `assets/` for the project-ready files.
