"""Publish one illustrated Telegram post for each PDF in the approved reader pack."""
import io
import json
import os
import re
import runpy
import subprocess
import tempfile
import time
from pathlib import Path

import requests
from PIL import Image

pack = runpy.run_path(str(Path(__file__).with_name("send-reader-pack.py")))
shared = pack["shared"]
SITE = "https://ftiprotocol.com/"
CHANNEL_URL = "https://t.me/" + shared["HANDLE"]
TAG_PREFIX = "tags/fti-reader-photo"
POSTS = (
    ("FTI-Meet-FTI.pdf", 34, "Meet FTI",
     "New to FTI? Start here. This five-page introduction shows where you fit in your group, "
     "how activity on both sides can count toward a reward, and where to look up the price of one FTI.",
     "#FTIProtocol #Membership #GettingStarted #FTIToken"),
    ("FTI-Your-First-Visit.pdf", 35, "Your First Visit",
     "Received an invitation? Check who invited you and what to review before you join. "
     "Already a member? The same guide shows how to get back to your account and find your latest activity.",
     "#FTIProtocol #FirstVisit #MemberGuide #AccountHelp"),
    ("FTI-Membership-Poster.pdf", 36, "Find Your Place in FTI",
     "Want to show someone where to start? Share this membership poster with them. "
     "They can scan the code to open the official site and explore the member area. "
     "The one-page PDF also prints in A5.",
     "#FTIProtocol #Membership #MemberCommunity #FTIPoster"),
    ("FTI-Token-Price-Poster.pdf", 37, "What’s One FTI Worth Today?",
     "Scan the poster to open the official site. In the token market, you can see the price of one FTI "
     "in Tether (USDT). Enter the amount you have in mind to see the quote and review any fees before you confirm.",
     "#FTIProtocol #FTIToken #Tether #TokenMarket"),
)


def make_post(number, post, pdf_bytes, directory):
    name, source_id, title, body, hashtags = post
    pdf = directory / name
    pdf.write_bytes(pdf_bytes)
    cover = pdf.with_suffix("")
    subprocess.run(["pdftoppm", "-f", "1", "-l", "1", "-singlefile", "-scale-to", "1700",
                    "-jpeg", "-jpegopt", "quality=91,optimize=y", str(pdf), str(cover)],
                   check=True, timeout=40)
    jpeg = cover.with_suffix(".jpg").read_bytes()
    with Image.open(io.BytesIO(jpeg)) as im:
        width, height = im.size
        if im.format != "JPEG" or height != 1700 or not (1000 < width < height) or len(jpeg) > 10_000_000:
            raise ValueError(f"Unexpected cover format for {name}")
        im.verify()

    heading = f"{number}/{len(POSTS)} · {title}"
    caption = f"{heading}\n\n{body}\n\n{hashtags}"
    # All published copy is in the basic multilingual plane, so indices are Telegram UTF-16 units.
    if len(caption.encode("utf-16-le")) != 2 * len(caption) or len(caption) > 1024:
        raise ValueError(f"Unexpected caption length for {name}")
    entities = [{"type": "bold", "offset": 0, "length": len(heading)}]
    entities.extend({"type": "hashtag", "offset": word.start(), "length": len(word.group())}
                    for word in re.finditer(r"#\w+", caption))
    if len(entities) != 5:
        raise ValueError(f"Expected four hashtags for {name}")
    button = "Open poster PDF" if "Poster" in name else "Read the PDF"
    keyboard = {"inline_keyboard": [[{"text": button, "url": f"{CHANNEL_URL}/{source_id}?single"},
                                     {"text": "Visit FTI", "url": SITE}]]}
    data = {"chat_id": shared["CHANNEL"], "caption": caption, "caption_entities": json.dumps(entities),
            "reply_markup": json.dumps(keyboard)}
    return source_id, name, data, (cover.name + "-cover.jpg", jpeg, "image/jpeg")


def create_tag(path, headers):
    return requests.post(pack["GIT"] + "/refs", headers=headers, timeout=20,
                         json={"ref": "refs/" + path, "sha": os.environ["GITHUB_SHA"]})


def claim_or_find(source_id, headers):
    base = f"{TAG_PREFIX}/{source_id}"
    claim = create_tag(base + "/intent", headers)
    if claim.status_code != 422:
        claim.raise_for_status()
        return None
    prior = requests.get(pack["GIT"] + "/matching-refs/" + base + "/sent/", headers=headers, timeout=20)
    prior.raise_for_status()
    paths = [ref["ref"] for ref in prior.json()]
    if len(paths) == 1 and re.fullmatch("refs/" + base + r"/sent/[1-9]\d*", paths[0]):
        return int(paths[0].rsplit("/", 1)[1])
    raise RuntimeError(f"Check the outstanding delivery claim for PDF {source_id} before retrying")


def release_rejected(source_id, headers):
    path = f"{TAG_PREFIX}/{source_id}/intent"
    api = pack["GIT"]
    existing = requests.get(api + "/ref/" + path, headers=headers, timeout=20)
    existing.raise_for_status()
    ref = existing.json()
    if ref.get("ref") != "refs/" + path or ref.get("object", {}).get("sha") != os.environ["GITHUB_SHA"]:
        raise RuntimeError("The delivery claim changed before cleanup")
    requests.delete(api + "/refs/" + path, headers=headers, timeout=20).raise_for_status()


def check_photo(message, data):
    if (message.get("chat", {}).get("id") != shared["CHANNEL"] or message.get("media_group_id")
            or not message.get("photo") or message.get("caption") != data["caption"]
            or sorted(message.get("caption_entities", []), key=lambda item: item["offset"])
            != json.loads(data["caption_entities"])):
        raise ValueError("Telegram returned different photo or caption details")
    expected = json.loads(data["reply_markup"])["inline_keyboard"][0]
    actual = message.get("reply_markup", {}).get("inline_keyboard", [[]])
    if len(actual) != 1 or len(actual[0]) != len(expected):
        raise ValueError("Telegram returned a different button layout")
    for wanted, received in zip(expected, actual[0]):
        url = received.get("url", "").replace("?single=", "?single")
        if wanted["text"] != received.get("text") or wanted["url"].rstrip("/") != url.rstrip("/"):
            raise ValueError("Telegram returned a different file or website destination")


def main():
    if (os.environ.get("GITHUB_REF") != pack["BRANCH"] or os.environ.get("GITHUB_REPOSITORY") != pack["REPOSITORY"]
            or os.environ.get("GITHUB_EVENT_NAME") != "push"):
        raise RuntimeError("Unexpected publication context")
    headers = {"Authorization": "Bearer " + os.environ["GITHUB_TOKEN"], "Accept": "application/vnd.github+json"}
    _, files = pack["load_documents"](headers)
    ready = []
    with tempfile.TemporaryDirectory() as folder:
        for index, post in enumerate(POSTS):
            name, pdf_bytes, _ = files[f"doc{index}"]
            if name != post[0]:
                raise ValueError("Published PDF order changed")
            ready.append(make_post(index + 1, post, pdf_bytes, Path(folder)))
    shared["verify_bot"]()
    last = 0
    for source_id, name, data, photo in ready:
        message_id = claim_or_find(source_id, headers)
        if message_id is None:
            try:
                message = shared["telegram"]("sendPhoto", data, {"photo": photo})
            except shared["TelegramRejected"]:
                release_rejected(source_id, headers)
                raise
            message_id = message["message_id"]
            if message.get("chat", {}).get("id") != shared["CHANNEL"] or type(message_id) != int or message_id <= 0:
                raise RuntimeError("Telegram did not confirm a message in the requested channel")
            print(f"TELEGRAM_RECEIPT {source_id} {name} {CHANNEL_URL}/{message_id}", flush=True)
            check_photo(message, data)
            create_tag(f"{TAG_PREFIX}/{source_id}/sent/{message_id}", headers).raise_for_status()
        if message_id <= last:
            raise ValueError("The confirmed posts are out of sequence")
        last = message_id
        print(f"VERIFIED_SINGLE {source_id} {name} {CHANNEL_URL}/{message_id}", flush=True)
        if source_id != POSTS[-1][1]:
            time.sleep(1.3)


if __name__ == "__main__":
    main()
