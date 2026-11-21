"""Restore the four original Telegram documents and relink the four reader photos."""
import io
import json
import os
import runpy
import tempfile
import time
from pathlib import Path

import requests
from PIL import Image

photos = runpy.run_path(str(Path(__file__).with_name("send-reader-photo-posts.py")))
pack = photos["pack"]
shared = photos["shared"]
CHANNEL = shared["CHANNEL"]
CHANNEL_URL = photos["CHANNEL_URL"]
BATCH = "pdf-repost-20261121"
# Each picture was confirmed in the previous sendPhoto delivery.
READERS = (
    (38, "A five-page introduction to FTI. See how invitations work, where to find the two sides of "
         "your group and how to check the price of one FTI in Tether (USDT)."),
    (39, "Keep this guide handy for your first visit. It walks you through checking your invitation, "
         "returning with the same wallet and finding your recent activity."),
    (40, "Sharing an invitation? Send this one-page membership poster with it. Scan the code to "
         "visit FTI and explore the member area, or print a copy in A5."),
    (41, "Use this one-page poster to find the token market. Scan the code to visit FTI, check the "
         "price in Tether (USDT), then enter an amount to see the quote for it."),
)


def prepare(headers):
    _, files = pack["load_documents"](headers)
    ready = []
    with tempfile.TemporaryDirectory() as folder:
        for i, ((name, old_id, title, _, hashtags), (photo_id, text)) in enumerate(zip(photos["POSTS"], READERS)):
            original = files[f"doc{i}"]
            if original[0] != name or name != pack["DOCS"][i][0]:
                raise ValueError("The approved PDF order changed")
            _, _, fields, cover = photos["make_post"](i + 1, (name, old_id, title, text, hashtags),
                                                       original[1], Path(folder))
            thumb = io.BytesIO()
            with Image.open(io.BytesIO(cover[1])) as image:
                image.thumbnail((320, 320), Image.Resampling.LANCZOS)
                image.save(thumb, format="JPEG", quality=89, optimize=True)
            if thumb.tell() >= 200_000:
                raise ValueError("PDF preview is too large")
            photo_keyboard = json.loads(fields["reply_markup"])
            website = photo_keyboard["inline_keyboard"][0][1]
            fields["reply_markup"] = json.dumps({"inline_keyboard": [[website]]})
            fields["thumbnail"] = "attach://cover"
            upload = {"document": original, "cover": (Path(name).stem + "-cover.jpg", thumb.getvalue(), "image/jpeg")}
            ready.append((old_id, photo_id, fields, photo_keyboard, upload))
    return ready


def restore_one(index, old_id, fields, upload, headers):
    name, size, digest, _ = pack["DOCS"][index]
    key = f"{BATCH}/{old_id}"
    existing_id = photos["claim_or_find"](key, headers)
    if existing_id is not None:
        # A receipt is saved only after the copy downloaded from Telegram matched the original.
        return existing_id
    try:
        message = shared["telegram"]("sendDocument", fields, upload)
    except shared["TelegramRejected"]:
        photos["release_rejected"](key, headers)
        raise
    new_id = message.get("message_id")
    if message.get("chat", {}).get("id") != CHANNEL or type(new_id) != int or new_id <= 0:
        raise RuntimeError("Telegram did not return a channel message ID")
    print(f"PDF_RECEIPT {name} {CHANNEL_URL}/{new_id}", flush=True)
    document = message.get("document", {})
    if (message.get("media_group_id") or document.get("file_name") != name or document.get("file_size") != size
            or document.get("mime_type") != "application/pdf" or not document.get("file_id")
            or message.get("caption") != fields["caption"]
            or sorted(message.get("caption_entities", []), key=lambda item: item["offset"])
            != json.loads(fields["caption_entities"])):
        raise RuntimeError(f"Unexpected Telegram document details for {name}")
    pack["verify_download"](document["file_id"], size, digest)
    photos["create_tag"](f"{photos['TAG_PREFIX']}/{key}/sent/{new_id}", headers).raise_for_status()
    print(f"VERIFIED_BYTES {name} {digest}", flush=True)
    return new_id


def relink(photo_id, keyboard):
    target = f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}/editMessageReplyMarkup"
    fields = {"chat_id": CHANNEL, "message_id": photo_id, "reply_markup": json.dumps(keyboard)}
    try:
        response = requests.post(target, data=fields, timeout=35, allow_redirects=False)
        reply = response.json()
    except (requests.RequestException, ValueError):
        raise RuntimeError(f"Telegram did not confirm the button update for photo {photo_id}") from None
    if reply.get("ok") is True:
        message = reply["result"]
        actual = message.get("reply_markup", {}).get("inline_keyboard", [])
        expected = keyboard["inline_keyboard"]
        def button_links(rows):
            return [[(item.get("text"), item.get("url", "").rstrip("/")) for item in row] for row in rows]
        if (message.get("message_id") != photo_id or message.get("chat", {}).get("id") != CHANNEL
                or not message.get("photo") or button_links(actual) != button_links(expected)):
            raise RuntimeError(f"Unexpected Telegram button receipt for photo {photo_id}")
        return True
    description = reply.get("description", "").lower()
    if response.status_code == 400 and "message is not modified" in description:
        return True
    if response.status_code == 400 and "message to edit not found" in description:
        return False
    raise RuntimeError(f"Telegram could not update photo {photo_id} (HTTP {response.status_code})")


def main():
    if (os.environ.get("GITHUB_REF") != pack["BRANCH"] or os.environ.get("GITHUB_REPOSITORY") != pack["REPOSITORY"]
            or os.environ.get("GITHUB_EVENT_NAME") != "push"):
        raise RuntimeError("Unexpected publication context")
    headers = {"Authorization": "Bearer " + os.environ["GITHUB_TOKEN"], "Accept": "application/vnd.github+json"}
    ready = prepare(headers)
    shared["verify_bot"]()
    links = []
    previous = 0
    for i, (old_id, photo_id, fields, keyboard, upload) in enumerate(ready):
        restored = restore_one(i, old_id, fields, upload, headers)
        if restored <= previous:
            raise RuntimeError("Restored PDFs are out of order")
        previous = restored
        url = f"{CHANNEL_URL}/{restored}"
        print(f"RESTORED_PDF {upload['document'][0]} {url}", flush=True)
        keyboard["inline_keyboard"][0][0]["url"] = url
        links.append((photo_id, keyboard, url))
        time.sleep(1.25)
    failed = []
    for photo_id, keyboard, url in links:
        try:
            found = relink(photo_id, keyboard)
        except RuntimeError as error:
            failed.append(str(error))
        else:
            print(f"{'RELINKED_PHOTO' if found else 'PHOTO_NOT_FOUND'} {photo_id} {url}", flush=True)
        time.sleep(1.25)
    if failed:
        raise RuntimeError(" | ".join(failed))


if __name__ == "__main__":
    main()
