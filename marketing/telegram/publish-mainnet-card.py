"""Publish one block-stamped FTI channel card for the scheduled Tehran slot."""
import hashlib
import io
import json
import os
import re
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from PIL import Image, ImageDraw, ImageFont

SITE = "https://ftiprotocol.com"
ART = "https://raw.githubusercontent.com/Rezamoradifar/fti-protocol/1d3e831f01a0ae4bf14722864361ca85626b86a1/landing/src/assets/fti-emerald-orbit.webp"
ART_HASH = "81e5d3c955dc67dcaf0b45bddd25c15270ed8aeb307334f8ba0cf694a8937903"
CHANNEL = -1003941034086
HANDLE = "FTIProtocol_Official"
SLOTS = {"30 5 * * *": 9, "30 9 * * *": 13, "30 13 * * *": 17, "30 17 * * *": 21}


def get(url):
    response = requests.get(url, timeout=35)
    response.raise_for_status()
    return response


def amount(value, places):
    return f"{Decimal(int(value)).scaleb(-18):,.{places}f}"


def content(hour, state, config):
    genesis = {address.lower() for address in config["genesis"]}
    count = int(state["count"])
    if config["chainId"] != 56 or len(genesis) != 31 or count < len(genesis):
        raise ValueError("Unexpected mainnet membership configuration")
    if not all(re.fullmatch(r"0x[0-9a-f]{40}", address) for address in genesis):
        raise ValueError("Invalid genesis address")
    if hour == 9:
        return ("Membership", f"{count:,} wallets", f"The membership contract records {count:,} wallets. The initial tree contains {len(genesis)} and {count-len(genesis):,} joined after launch. A person may control more than one wallet.", "Membership")
    if hour == 13:
        price = amount(state["price"], 6)
        return ("Token price", f"{price} USDT", f"The protocol reported a price of {price} USDT per FTI at the block below. Open the token market to check the latest quote before placing an order.", "TokenMarket")
    if hour == 17:
        reserve = amount(state["reserve"], 2)
        supply = amount(state["supply"], 2)
        return ("Reserve update", f"{reserve} USDT", f"The contract reported a reserve of {reserve} USDT and a token supply of {supply} FTI. Both figures are taken from the same block.", "Reserve")
    def status(key):
        if type(state[key]) is not bool:
            raise ValueError("Unknown contract pause flag")
        return "paused" if state[key] else "unpaused"
    return ("Network check", "BNB Smart Chain", f"The token contract was {status('tokenPaused')} and the membership contract was {status('paused')} at the block below. The workspace uses BNB Smart Chain (chain ID 56).", "NetworkUpdate")


def card(art, title, value, stamp):
    if hashlib.sha256(art).hexdigest() != ART_HASH:
        raise ValueError("Editorial artwork checksum mismatch")
    image = Image.open(io.BytesIO(art)).convert("RGB").resize((1600, 900), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(image)
    def label(y, text, size, color, bold=False):
        face = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
        while size > 16:
            font = ImageFont.truetype(face, size)
            if draw.textlength(text, font=font) <= 645:
                break
            size -= 1
        draw.text((72, y), text, font=font, fill=color)
    label(175, "FTI PROTOCOL", 32, "#e8cc8b", True)
    label(311, title, 73, "#f5f5ef", True)
    label(421, value, 56, "#9ef2cd")
    label(551, stamp, 25, "#d3ddd6")
    output = io.BytesIO()
    image.save(output, "JPEG", quality=90)
    return output.getvalue()


def telegram(method, data=None, files=None):
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    try:
        response = requests.post(f"https://api.telegram.org/bot{token}/{method}", data=data or {}, files=files, timeout=40)
        result = response.json()
    except (requests.RequestException, ValueError):
        raise RuntimeError(f"Telegram {method} did not return a confirmed result") from None
    if not response.ok or result.get("ok") is not True:
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


def claim_slot(day, hour):
    repo = os.environ["GITHUB_REPOSITORY"]
    if repo.lower() != "rezamoradifar/fti-protocol":
        raise RuntimeError("Unexpected repository")
    name = f"refs/tags/fti-channel/{day}/{hour:02d}"
    base = f"https://api.github.com/repos/{repo}/git"
    headers = {"Authorization": "Bearer " + os.environ["GITHUB_TOKEN"]}
    result = requests.post(base + "/refs", headers=headers, json={"ref": name, "sha": os.environ["GITHUB_SHA"]}, timeout=20)
    if result.status_code == 422:
        existing = requests.get(base + "/ref/" + name.removeprefix("refs/"), headers=headers, timeout=20)
        if existing.ok and existing.json().get("ref") == name:
            return False
    result.raise_for_status()
    return True


def main():
    preview = sys.argv[1:2] == ["--preview"]
    now = datetime.now(ZoneInfo("Asia/Tehran"))
    hour = int(sys.argv[2]) if preview else SLOTS[os.environ["SCHEDULE"]]
    if not preview:
        if not hour <= now.hour < hour + 4:
            raise RuntimeError("Stale schedule slot")
        if not os.environ.get("TELEGRAM_BOT_TOKEN"):
            raise RuntimeError("Set the TELEGRAM_BOT_TOKEN Actions secret for the official channel bot")
        verify_bot()
    state = get(SITE + "/api/state").json()
    config = get(SITE + "/api/config").json()
    observed = datetime.fromtimestamp(int(state["timestamp"]), timezone.utc)
    if not -60 <= (now - observed).total_seconds() <= 3600:
        raise RuntimeError("Current FTI snapshot is unavailable")
    stamp = observed.strftime("%d %b %Y  ·  %H:%M UTC")
    title, value, copy, tag = content(hour, state, config)
    caption = f"{title}\n\n{copy}\n\nBlock {int(state['block']):,} · {stamp}\n\n#FTIProtocol #BNBChain #{tag}"
    photo = card(get(ART).content, title, value, stamp)
    if preview:
        Path(sys.argv[3]).write_bytes(photo)
        print(caption)
        return
    if not claim_slot(now.date(), hour):
        print("Slot already claimed. No duplicate send.")
        return
    buttons = {"inline_keyboard": [[{"text": "Open FTI workspace", "url": SITE + "/app/"}]]}
    sent = telegram("sendPhoto", {"chat_id": CHANNEL, "caption": caption, "reply_markup": json.dumps(buttons)}, {"photo": ("FTI.jpg", photo, "image/jpeg")})
    if sent["chat"]["id"] != CHANNEL or not sent.get("photo") or not sent.get("message_id"):
        raise RuntimeError("Could not confirm the photo post")
    print(f"https://t.me/{HANDLE}/{sent['message_id']}")


if __name__ == "__main__":
    main()
