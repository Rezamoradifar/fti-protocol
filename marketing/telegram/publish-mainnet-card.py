"""Publish block-stamped photo and GIF editions in the official FTI channel."""
import argparse
import hashlib
import io
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from PIL import Image, ImageDraw, ImageFont, ImageOps

# Verification also loads this entry point using runpy from the repository root.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from channel_languages import translations
from price_digest import daily_history, table

SITE = "https://ftiprotocol.com"
ART_ROOT = "https://raw.githubusercontent.com/Rezamoradifar/fti-protocol/1d3e831f01a0ae4bf14722864361ca85626b86a1/landing/src/assets"
ARTWORK = {
    9: ("fti-emerald-orbit.webp", "81e5d3c955dc67dcaf0b45bddd25c15270ed8aeb307334f8ba0cf694a8937903"),
    13: ("token.webp", "10a1e690dd26afe2b23d4e5e557183d2695b72e3ca29e61ff73abfc033fa56bb"),
    17: ("orbital-hero.webp", "7a5368c9dff3b349bc4ffbeeac39233a17eb988781477ac3461fd93bf84a5cc8"),
    21: ("network.webp", "5aa9b022684ca02b464e949c8d11b5f8aee268f4af9e0c58e03ab70935394a6e"),
}
CHANNEL = -1003941034086
HANDLE = "FTIProtocol_Official"
SLOTS = {"30 5 * * *": 9, "30 9 * * *": 13, "30 13 * * *": 17, "30 17 * * *": 21}
TEHRAN = ZoneInfo("Asia/Tehran")
FIRST_EDITION = date(2026, 11, 21)
COPY = json.loads(Path(__file__).with_name("editions.en.json").read_text(encoding="utf-8"))


def get(url, *, headers=None):
    response = requests.get(url, headers=headers, timeout=35)
    response.raise_for_status()
    return response


def amount(value, places):
    return f"{Decimal(int(value)).scaleb(-18):,.{places}f}"


def edition(hour, day, state, config, observed, history=None):
    genesis = {address.lower() for address in config["genesis"]}
    count = int(state["count"])
    if config["chainId"] != 56 or len(genesis) != 31 or count < len(genesis):
        raise ValueError("Unexpected mainnet membership configuration")
    if not all(re.fullmatch(r"0x[0-9a-f]{40}", address) for address in genesis):
        raise ValueError("Invalid genesis address")
    variants = COPY[str(hour)]
    title, note, topic = variants[(day - FIRST_EDITION).days % len(variants)]
    block = int(state["block"])
    if hour == 9:
        added = count - len(genesis)
        panels = [("Registered wallets", f"{count:,}"), ("Wallets in the starting tree", str(len(genesis))),
                  ("Wallets added since launch", f"{added:,}")]
        reading = (f"FTI’s membership contract records {count:,} wallet addresses. "
                   f"The initial tree contained {len(genesis)} wallets. Another {added:,} joined after launch.")
        localized = translations(hour, count=count, added=added)
        category, button, path = "Membership", "Open member workspace", "/app/"
    elif hour == 13:
        price = amount(state["price"], 6)
        panels = [("Protocol quote per 1 FTI", f"{price} USDT"), ("Source block", f"{block:,}"),
                  ("Observed on chain", observed.strftime("%H:%M UTC"))]
        reading = (f"At block {block:,}, the FTI protocol reported {price} USDT per FTI. "
                   "The token workspace displays the latest protocol quote.")
        localized = translations(hour, price=price)
        category, button, path = "TokenMarket", "Open token workspace", "/token/"
    elif hour == 17:
        reserve = amount(state["reserve"], 2)
        supply = amount(state["supply"], 2)
        panels = [("Contract reserve", f"{reserve} USDT"), ("Token supply", f"{supply} FTI"),
                  ("Source block", f"{block:,}")]
        reading = f"The contract reported {reserve} USDT in reserve and {supply} FTI in token supply at the same block."
        localized = translations(hour)
        if history is not None:
            title = "FTI daily contract price"
            reading = table(history)
            note = "00:00 Tehran · USDT per FTI · Δ vs previous day · — unavailable"
            panels = [("Protocol quote per 1 FTI", amount(state["price"], 8) + " USDT"), *panels[:2]]
        category, button, path = "Reserve", "Open token workspace", "/token/"
        if history is not None:
            category, topic = "TokenPrice", "DailyPrices"
    else:
        if type(state["tokenPaused"]) is not bool or type(state["paused"]) is not bool:
            raise ValueError("Unknown contract pause flag")
        token = "paused" if state["tokenPaused"] else "unpaused"
        membership = "paused" if state["paused"] else "unpaused"
        panels = [("BNB Smart Chain", "Chain ID 56"), ("Token contract", token.title()),
                  ("Membership contract", membership.title())]
        reading = (f"On BNB Smart Chain, the token contract was {token} and the membership contract was "
                   f"{membership} at block {block:,}.")
        localized = translations(hour, token=state["tokenPaused"], member=state["paused"])
        category, button, path = "NetworkUpdate", "Open FTI workspace", "/app/"
    stamp = observed.strftime("%d %b %Y · %H:%M UTC")
    caption = f"{title}\n\n{reading}\n\n{localized}\n\n{note}\n\nBlock {block:,} · {stamp}\n\n#FTIProtocol #BNBChain #{category} #{topic}"
    if len(caption.encode("utf-16-le")) // 2 > 1024:
        raise ValueError("Telegram caption is too long")
    buttons = {"inline_keyboard": [[{"text": button, "url": SITE + path},
                                    {"text": "View source block", "url": f"https://bscscan.com/block/{block}"}]]}
    if history:
        latest = history[max(history)]
        if latest:
            buttons["inline_keyboard"].append([{"text": "00:00 Tehran · price source",
                "url": f"https://bscscan.com/block/{latest['block']}"}])
    return title, panels, caption, buttons


def render_media(art, title, panels, block, stamp, animated):
    width = 800
    background = Image.new("RGB", (width, width), "#091310")
    source = Image.open(io.BytesIO(art)).convert("RGB")
    hero = ImageOps.contain(source, (width, 403), method=Image.Resampling.LANCZOS)
    background.paste("#020604", (0, 66, width, 469))
    background.paste(hero, ((width - hero.width) // 2, 66 + (403 - hero.height) // 2))

    def label(draw, x, y, text, size, color, bold=False, limit=716):
        face = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
        while True:
            font = ImageFont.truetype(face, size)
            if draw.textlength(text, font=font) <= limit or size <= 14:
                break
            size -= 1
        draw.text((x, y), text, font=font, fill=color)

    draw = ImageDraw.Draw(background)
    label(draw, 40, 16, "FTI PROTOCOL", 23, "#e7cb8d", True)
    label(draw, 535, 19, "ON-CHAIN EDITION", 19, "#b1c8bb", limit=225)
    draw.rectangle((0, 466, width, 469), fill="#9c8752")
    label(draw, 40, 486, title, 44, "#eff5ee", True)
    draw.line((40, 716, 760, 716), fill="#34483d", width=2)
    label(draw, 40, 736, f"Block {block:,}", 21, "#c1d4c6", limit=300)
    label(draw, 442, 736, stamp, 20, "#c1d4c6", limit=318)
    frames = []
    for index, (field, value) in enumerate(panels if animated else panels[:1]):
        frame = background.copy()
        draw = ImageDraw.Draw(frame)
        label(draw, 40, 560, field, 26, "#adcbba")
        label(draw, 37, 600, value, 76, "#9ff1ca", True)
        if animated:
            for step in range(len(panels)):
                x = 672 + step * 31
                draw.rectangle((x, 579, x + 21, 583), fill="#d9bc77" if step == index else "#3d4f44")
        frames.append(frame)
    output = io.BytesIO()
    if animated:
        frames[0].save(output, "GIF", save_all=True, append_images=frames[1:], duration=2200, loop=0)
    else:
        frames[0].save(output, "JPEG", quality=90)
    return output.getvalue()


class TelegramRejected(RuntimeError):
    """Telegram confirmed that the request was rejected before delivery."""


def telegram(method, data=None, files=None):
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    try:
        response = requests.post(f"https://api.telegram.org/bot{token}/{method}", data=data or {}, files=files, timeout=40)
        result = response.json()
    except (requests.RequestException, ValueError):
        raise RuntimeError(f"Telegram {method} did not return a confirmed result") from None
    if not response.ok or result.get("ok") is not True:
        if 400 <= response.status_code < 500 and result.get("ok") is False:
            raise TelegramRejected(f"Telegram rejected {method} (HTTP {response.status_code})")
        raise RuntimeError(f"Telegram rejected {method} (HTTP {response.status_code})")
    return result["result"]


def verify_bot():
    bot = telegram("getMe")
    chat = telegram("getChat", {"chat_id": CHANNEL})
    member = telegram("getChatMember", {"chat_id": CHANNEL, "user_id": bot["id"]})
    if (bot["username"] != "FTIProtocol_OfficialBot" or chat["id"] != CHANNEL
        or chat.get("username") != HANDLE or chat["type"] != "channel"
        or member.get("can_post_messages") is not True):
        raise RuntimeError("Channel identity or publishing permission mismatch")


def scheduled_day(hour, run_created_at, now):
    # GitHub may start an evening run after midnight. Anchor retries to the original run.
    created = run_created_at.astimezone(TEHRAN)
    slot = created.replace(hour=hour, minute=0, second=0, microsecond=0)
    if slot > created:
        slot -= timedelta(days=1)
    if timedelta(0) <= now - slot < timedelta(days=1):
        return slot.date()
    return None


def slot_api(day, hour):
    repo = os.environ["GITHUB_REPOSITORY"]
    if repo.lower() != "rezamoradifar/fti-protocol":
        raise RuntimeError("Unexpected repository")
    name = f"refs/tags/fti-channel/{day}/{hour:02d}"
    base = f"https://api.github.com/repos/{repo}/git"
    headers = {"Authorization": "Bearer " + os.environ["GITHUB_TOKEN"]}
    return base, name, headers


def claim_slot(day, hour):
    base, name, headers = slot_api(day, hour)
    result = requests.post(base + "/refs", headers=headers, json={"ref": name, "sha": os.environ["GITHUB_SHA"]}, timeout=20)
    if result.status_code == 422:
        existing = requests.get(base + "/ref/" + name.removeprefix("refs/"), headers=headers, timeout=20)
        if existing.ok and existing.json().get("ref") == name:
            return False
    result.raise_for_status()
    return True


def release_rejected_slot(day, hour):
    base, name, headers = slot_api(day, hour)
    path = name.removeprefix("refs/")
    existing = get(base + "/ref/" + path, headers=headers).json()
    if existing.get("ref") != name or existing["object"]["sha"] != os.environ["GITHUB_SHA"]:
        raise RuntimeError("The slot claim changed before cleanup")
    requests.delete(base + "/refs/" + path, headers=headers, timeout=20).raise_for_status()


def requested_slots(specification, today):
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}) ((?:09|13|17|21)(?:,(?:09|13|17|21))*)", specification)
    if not match:
        raise ValueError("Use a Tehran date and comma-separated slots, for example YYYY-MM-DD 09,13")
    day = date.fromisoformat(match[1])
    hours = [int(hour) for hour in match[2].split(",")]
    if len(hours) != len(set(hours)):
        raise ValueError("An early request contains a repeated slot")
    if day > today:
        raise ValueError("Early publication must be requested on the intended Tehran date")
    return sorted(hours) if day == today else []


def deliver(day, hour, media, animated, caption, buttons):
    if not claim_slot(day, hour):
        print(f"Slot {day} {hour:02d}:00 already claimed. Skipping duplicate.")
        return
    kind, method, file_name, mime = (("animation", "sendAnimation", "FTI.gif", "image/gif") if animated
                                     else ("photo", "sendPhoto", "FTI.jpg", "image/jpeg"))
    payload = {"chat_id": CHANNEL, "caption": caption, "reply_markup": json.dumps(buttons)}
    if "Date        USDT / FTI" in caption:
        start = caption.index("Date        USDT / FTI")
        end = caption.index("\n\n", start)
        utf16 = lambda text: len(text.encode("utf-16-le")) // 2
        payload["caption_entities"] = json.dumps([{
            "type": "pre", "offset": utf16(caption[:start]), "length": utf16(caption[start:end])
        }])
    try:
        sent = telegram(method, payload, {kind: (file_name, media, mime)})
    except TelegramRejected:
        release_rejected_slot(day, hour)
        raise
    if (sent.get("chat", {}).get("id") != CHANNEL or not sent.get(kind)
            or not sent.get("message_id") or sent.get("caption") != caption):
        raise RuntimeError(f"Could not confirm the {kind} post")
    print(f"PUBLISHED {kind} {day} {hour:02d}:00 https://t.me/{HANDLE}/{sent['message_id']}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--preview", nargs=2, metavar=("HOUR", "FILE"))
    mode.add_argument("--publish-request", metavar="DATE_AND_SLOTS")
    args = parser.parse_args()
    now = datetime.now(TEHRAN)
    day = now.date()
    if args.preview:
        hours = [int(args.preview[0])]
        if hours[0] not in ARTWORK:
            parser.error("Unknown channel slot")
    elif args.publish_request is not None:
        if os.environ.get("GITHUB_REF") != "refs/heads/main":
            raise RuntimeError("Early publication requires the default branch")
        hours = requested_slots(args.publish_request, day)
        if not hours:
            print("The dated publication request has expired.")
            return
    else:
        hour = SLOTS[os.environ["SCHEDULE"]]
        run_url = f"https://api.github.com/repos/Rezamoradifar/fti-protocol/actions/runs/{int(os.environ['GITHUB_RUN_ID'])}"
        headers = {"Authorization": "Bearer " + os.environ["GITHUB_TOKEN"]}
        created_at = get(run_url, headers=headers).json()["created_at"]
        day = scheduled_day(hour, datetime.fromisoformat(created_at.replace("Z", "+00:00")), now)
        if day is None:
            print("The next daily occurrence has arrived. Skipping the expired slot.")
            return
        hours = [hour]
    if not args.preview:
        if not os.environ.get("TELEGRAM_BOT_TOKEN"):
            raise RuntimeError("Set the TELEGRAM_BOT_TOKEN Actions secret for the official channel bot")
        verify_bot()
    state = get(SITE + "/api/state").json()
    config = get(SITE + "/api/config").json()
    observed = datetime.fromtimestamp(int(state["timestamp"]), timezone.utc)
    if not -60 <= (now - observed).total_seconds() <= 3600:
        raise RuntimeError("Current FTI snapshot is unavailable")
    block = int(state["block"])
    if block <= 0:
        raise ValueError("Invalid source block")
    stamp = observed.strftime("%d %b %Y · %H:%M UTC")
    for hour in hours:
        history = None
        if hour == 17:
            history = daily_history(config, state)
        title, panels, caption, buttons = edition(hour, day, state, config, observed, history)
        art_name, digest = ARTWORK[hour]
        art = get(f"{ART_ROOT}/{art_name}").content
        if hashlib.sha256(art).hexdigest() != digest:
            raise ValueError("Editorial artwork checksum mismatch")
        animated = hour in (13, 21)
        if args.preview:
            output = Path(args.preview[1])
            if output.suffix.lower() in (".jpg", ".jpeg", ".gif"):
                animated = output.suffix.lower() == ".gif"
        media = render_media(art, title, panels, block, stamp, animated)
        if args.preview:
            output.write_bytes(media)
            print(caption)
        else:
            deliver(day, hour, media, animated, caption, buttons)


if __name__ == "__main__":
    main()
