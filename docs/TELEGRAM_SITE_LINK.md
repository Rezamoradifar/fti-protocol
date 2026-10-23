# Official Telegram link on the website

The only official channel URL is `https://t.me/FTIProtocol_Official`. Source config, landing links, printed contacts and the Telegram card use that address and handle. The X card keeps `@FTIProtocol`.

On 24 October 2026, public HTTP reads still found `https://t.me/FTIProtocol` in the deployed landing and public-page bundles. The code change alone does not update those installed files.

`tools/install-telegram-site-link.py` is a standalone, targeted update for the existing FTI VPS. Run it as root in an interactive terminal. It detects the active release through `fti-continuity-web.service`, previews by default, and `--apply` adds an immutable same-origin presentation module to the current panel and public HTML entry pages. The module changes only the known FTI Telegram destinations and their displayed handles, including links rendered later by React. Other Telegram channels, bot links and X links are preserved. It does not rebuild the application or restart services.

```sh
python3 tools/install-telegram-site-link.py
python3 tools/install-telegram-site-link.py --apply
```

The installer checks public and local HTML/media responses, preserves existing entry scripts, records original and changed HTML hashes, and prints a restore command before applying. Restore refuses to overwrite HTML changed by a later deployment. Keep the printed backup directory. The module source is `tools/telegram-site-link.js`; the standalone installer embeds its exact bytes.

The persistent source fix is in `frontend/global-components.jsx` and `config/social-links.json`. Normal future deployments build the correct link directly with `npm run build:web` and `npm --prefix landing run build`.

Validation: 33 existing global frontend tests, three overlay behavior tests and six installer/restore tests pass. Both production builds pass. The landing browser test expectation was updated, but its attempted browser run could not launch because the local Chromium executable was unavailable. Live installation must be confirmed from the operator's installer output; this session has no direct FTI VPS access.
