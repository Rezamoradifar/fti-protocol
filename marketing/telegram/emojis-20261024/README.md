# FTI custom emoji artwork

Six static native emoji assets, each exported at exactly 100 × 100 pixels with transparency outside the composition. The SVG sources link to `../assets/site-logo-profile.png`: the website's three-ribbon mark is reused unchanged, preserving its geometry and colors. Surrounding badges and symbols are vector elements.

| Asset | Theme | Unicode fallback |
| --- | --- | --- |
| `01-core-emblem` | Core emblem | 🟢 |
| `02-glass-check` | Glass badge with check | 💎 |
| `03-shield-emblem` | Shield emblem | 🛡️ |
| `04-orbital-emblem` | Orbital ring emblem | 🔗 |
| `05-network-emblem` | Network nodes emblem | 🧭 |
| `06-document-emblem` | Document emblem | 📖 |

The real Telegram pack was created and verified for the channel's verified human creator: https://t.me/addemoji/FTIGlass20261024_by_FTIProtocol_OfficialBot. Six returned custom emoji IDs and exact source hashes are in `../live-emoji-pack-20261024.json`; the personal owner ID is not recorded. Telegram rejected the native-emoji caption edit attempt on the first series post, with zero captions edited. Standard Unicode emoji remain in the series captions; the brand mark is present in every image.

Pack creation used `createNewStickerSet`, `sticker_type="custom_emoji"` and the six static PNG inputs, then verified `getStickerSet`. Preserve the linked source image beside these SVGs when editing. Export with Inkscape, for example:

```sh
inkscape 01-core-emblem.svg --export-type=png --export-filename=01-core-emblem.png --export-width=100 --export-height=100
```

## Channel inline eligibility

Bot channel posts containing native custom emoji require the bot's additional username entitlement purchased through Fragment. An ordinary bot username or a channel creator's Premium subscription does not establish this entitlement. The Premium bot-owner exception in Telegram's documentation covers private, group and supergroup messages; it does not list channels. Do not purchase a username automatically. After a permitted pack is created, use the returned `custom_emoji_id` with a valid Unicode fallback in `<tg-emoji>` HTML.

Official requirements: [image specifications](https://core.telegram.org/stickers#static-stickers-and-emoji), [pack creation](https://core.telegram.org/bots/api#createnewstickerset), [inline eligibility](https://core.telegram.org/bots/api#html-style).

