"""Send the four reviewed English PDFs as one album in FTI's official channel."""
import base64
import hashlib
import json
import os
import re
import runpy
from pathlib import Path

import requests

BASE = Path(__file__).resolve().parent
shared = runpy.run_path(str(BASE / "publish-mainnet-card.py"))
REPOSITORY = "Rezamoradifar/fti-protocol"
BRANCH = "refs/heads/delivery/fti-user-pdfs-20261121"
CLAIM = "tags/fti-channel-documents/reader-pack-20261121"
GIT = f"https://api.github.com/repos/{REPOSITORY}/git"
DOCS = (
    ("FTI-Meet-FTI.pdf", 884495, "3758f39d7ee4db703bf6cf6f20fe46cf33f293c116a8785c6d6d5eed2b1f6a63", "f3cc07a55fdcb98cf94a37a93d8ad28a9142e818"),
    ("FTI-Your-First-Visit.pdf", 325465, "c0ed5608b0fa2a5ce61a7a5348a85caef1874e2a371794ee1e23467a3a433a9c", "713fea9aa0c49998ae5c862402213a6686953511"),
    ("FTI-Membership-Poster.pdf", 353888, "777a855ba7973ed5277acc4dada042ca403f26e7132bda0a7616c4f1e1a4bdca", "97b89b7632db6783a190287d35a1f0c3dbba634e"),
    ("FTI-Token-Price-Poster.pdf", 303987, "9abff42829e0fa85f6328e915c6d8be5a1691d08238a6fedd99ccc2bd1e87063", "49d3c958a26ca6df26d4b2e6b738c102d039938d"),
)
CAPTION = (
    "New to FTI? Start with Meet FTI for an introduction to membership, rewards and the FTI token. "
    "Keep Your First Visit handy the next time you open the site. The two one-page posters are ready to share."
    "\n\nhttps://ftiprotocol.com/\n\n#FTIProtocol #Membership #UserGuide"
)


def load_documents(headers):
    media, files = [], {}
    for index, (name, size, digest, object_id) in enumerate(DOCS):
        response = requests.get(f"{GIT}/blobs/{object_id}", headers=headers, timeout=35)
        response.raise_for_status()
        blob = response.json()
        if blob.get("sha") != object_id or blob.get("encoding") != "base64":
            raise RuntimeError(f"Unexpected source object for {name}")
        data = base64.b64decode("".join(blob["content"].splitlines()), validate=True)
        if (len(data) != size or hashlib.sha256(data).hexdigest() != digest
                or not data.startswith(b"%PDF-") or not data.rstrip().endswith(b"%%EOF")):
            raise RuntimeError(f"Unreviewed PDF bytes for {name}")
        key = f"doc{index}"
        files[key] = (name, data, "application/pdf")
        entry = {"type": "document", "media": f"attach://{key}"}
        if index == 0:
            entry["caption"] = CAPTION
        media.append(entry)
    return media, files


def claim(headers):
    ref = "refs/" + CLAIM
    r = requests.post(GIT + "/refs", headers=headers, json={"ref": ref, "sha": os.environ["GITHUB_SHA"]}, timeout=20)
    if r.status_code == 422:
        old = requests.get(GIT + "/ref/" + CLAIM, headers=headers, timeout=20)
        if old.ok and old.json().get("ref") == ref:
            print("This pack has an existing delivery claim. No second album will be sent.", flush=True)
            return False
    r.raise_for_status()
    return True


def release_definite_rejection(headers):
    previous = requests.get(GIT + "/ref/" + CLAIM, headers=headers, timeout=20)
    previous.raise_for_status()
    ref = previous.json()
    if ref.get("ref") != "refs/" + CLAIM or ref.get("object", {}).get("sha") != os.environ["GITHUB_SHA"]:
        raise RuntimeError("The pack claim changed after rejection")
    requests.delete(GIT + "/refs/" + CLAIM, headers=headers, timeout=20).raise_for_status()


def verify_download(file_id, expected_size, digest):
    item = shared["telegram"]("getFile", {"file_id": file_id})
    path = item.get("file_path", "")
    if not re.fullmatch(r"documents/[A-Za-z0-9_.-]+", path):
        raise RuntimeError("Telegram did not supply the expected document path")
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    try:
        r = requests.get(f"https://api.telegram.org/file/bot{token}/{path}", timeout=35, allow_redirects=False)
    except requests.RequestException:
        raise RuntimeError("Telegram document download failed") from None
    if r.status_code != 200 or len(r.content) != expected_size or hashlib.sha256(r.content).hexdigest() != digest:
        raise RuntimeError("Telegram document bytes did not match the approved PDF")


def main():
    if (os.environ.get("GITHUB_REF") != BRANCH or os.environ.get("GITHUB_REPOSITORY") != REPOSITORY
            or os.environ.get("GITHUB_EVENT_NAME") != "push"):
        raise RuntimeError("Unexpected publication context")
    headers = {"Authorization": "Bearer " + os.environ["GITHUB_TOKEN"], "Accept": "application/vnd.github+json"}
    media, files = load_documents(headers)
    shared["verify_bot"]()
    if not claim(headers):
        return
    try:
        messages = shared["telegram"]("sendMediaGroup", {
            "chat_id": shared["CHANNEL"], "media": json.dumps(media, ensure_ascii=False),
        }, files)
    except shared["TelegramRejected"]:
        release_definite_rejection(headers)
        raise
    if not isinstance(messages, list) or len(messages) != len(DOCS):
        raise RuntimeError("Telegram did not confirm all four album messages")
    groups = {message.get("media_group_id") for message in messages}
    ids = {message.get("message_id") for message in messages}
    if len(groups) != 1 or not all(groups) or len(ids) != len(DOCS) or not all(ids):
        raise RuntimeError("Telegram returned inconsistent album identifiers")
    for index, (message, (name, size, digest, _)) in enumerate(zip(messages, DOCS)):
        doc = message.get("document") or {}
        if (message.get("chat", {}).get("id") != shared["CHANNEL"] or doc.get("file_name") != name
                or doc.get("file_size", size) != size or doc.get("mime_type", "application/pdf") != "application/pdf"
                or not doc.get("file_id") or (index == 0 and message.get("caption") != CAPTION)):
            raise RuntimeError(f"Telegram returned unexpected document details for {name}")
        link = f"https://t.me/{shared['HANDLE']}/{message['message_id']}"
        print(f"DELIVERED {name} {link}", flush=True)
    for message, (name, size, digest, _) in zip(messages, DOCS):
        verify_download(message["document"]["file_id"], size, digest)
        print(f"VERIFIED_PDF {name} {digest}", flush=True)


if __name__ == "__main__":
    main()
