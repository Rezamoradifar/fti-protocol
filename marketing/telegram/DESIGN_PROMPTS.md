# FTI Telegram artwork prompts

## Current glass edition

The exact website emblem comes from the JPEG embedded in `frontend/header-mark.jsx`, cropped by its original SVG viewBox `170 170 914 914`. `site-logo-reference.jpg` preserves those exact original bytes (SHA-256 `db9ee9315d4bbc3ad6e3db4d93efd2f2b316f27d28b85d455f39aa713638290f`). `site-logo-profile.svg` preserves the website crop; Inkscape renders `site-logo-profile.png` at 1080 square.

The emblem is the metallic mint three-ribbon mark. It is composed directly onto generated backgrounds rather than redrawn. The previous favicon-based launch images (`welcome.png`, `first-steps.png`, `profile.png`) are retained as historical originals and are superseded by this edition.

### Welcome background — exact generation prompt

Create a premium square 1:1 Telegram announcement poster BACKGROUND for FTI Protocol, designed for an exact rotating brand emblem to be composited later. Use case: ads-marketing. Extremely polished restrained dark forest black and icy mint identity. A large circular recessed glass display is centered horizontally at 50% and vertically at 40%, about 44% of canvas width, with completely EMPTY solid near-black interior; absolutely no logo or symbol inside this display. Layered transparent glass orbital rims, soft mint edge lighting, a subtle asymmetric prismatic reflection, faint architectural grid, generous negative space, expensive editorial technology art direction. Top small crisp text 'FTI PROTOCOL'. Main large crisp text placed BELOW the circle in the lower third: 'THE OFFICIAL CHANNEL'. Supporting line 'Announcements. Updates. User guidance.' At bottom 'ftiprotocol.com' and '@FTIProtocol_Official'. English only, render text exactly, sensible line break in headline allowed. Elegant modern geometric sans typography, sharp readability at mobile scale. Do not add any other text, logos, icons, tokens, coins, price charts, financial promises, or illustrated buttons. No watermark. Exact symmetric empty circular space will receive the real mint logo, keep the center uncluttered.

### First steps background — exact generation prompt

Create a premium square 1:1 FTI Protocol Telegram educational poster BACKGROUND with a sophisticated frosted-glass fintech visual system, charcoal forest black, pale mint highlights, beautiful transparent layered glass panels and discreet editorial grid. Leave a SMALL completely empty near-black circular medallion area at the TOP CENTER around x50% y18%, about 20% canvas width, for compositing an existing official logo later. Do not invent or draw a logo. Text only, English exactly: small 'FTI PROTOCOL' directly below the medallion; large headline 'YOUR FIRST STEPS'; below 'Connect. Verify. Explore.' Below this, three spacious frosted glass cards in a vertical or editorial grid arrangement with the labels '01  CONNECT YOUR WALLET', '02  VERIFY THE DETAILS', '03  EXPLORE THE APP'. Cards are explanatory artwork, no clickable UI or fake controls. Bottom footer 'ftiprotocol.com/app/' and '@FTIProtocol_Official'. Crisp perfectly spelled typography, clean hierarchy, generous safe margins and legible mobile size. Exceptional restrained glass materials with subtle highlights and depth, not excessive glow. No extra text, no financial claims, no other logos, no watermark.

### Native composition and animation

`first-steps-glass.svg` references the generated background and exact original profile crop, using screen blending. Render with:

```sh
inkscape marketing/telegram/assets/first-steps-glass.svg --export-filename=marketing/telegram/assets/first-steps-glass.png --export-width=1254 --export-height=1254
```

The welcome animation keeps the background and typography still while the exact emblem completes a clockwise 16-second rotation. Its vertical compression approximates the website's fixed tilt. H.264, 960×960, 24 fps, no audio. Native composition command:

```sh
ffmpeg -hide_banner -loglevel error -y -loop 1 -framerate 24 -i marketing/telegram/assets/welcome-glass-background.png -loop 1 -framerate 24 -i marketing/telegram/assets/site-logo-profile.png -filter_complex '[0:v]scale=960:960,format=gbrp[bg];[1:v]scale=392:392,format=gbrp,rotate=2*PI*t/16:ow=556:oh=556:fillcolor=black,scale=556:536,pad=960:960:202:88:color=black[mark];[bg][mark]blend=all_mode=screen,format=yuv420p[out]' -map '[out]' -t 16 -an -c:v libx264 -preset medium -crf 24 -movflags +faststart marketing/telegram/assets/welcome-glass.mp4
```

`welcome-glass.png` is the first frame for static preview. Visual QA inspected frames at 0 and 4 seconds, as well as the final guide and profile. Telegram's actual buttons use native client styling; the glass treatment belongs to the artwork.

