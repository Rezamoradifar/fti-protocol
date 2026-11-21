"""Store one block-stamped FTI protocol quote per Tehran date and display seven days."""
import json
import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

TOKEN = "0x43755b1e813b2d41f669ea08bcf859de07195ea1"
USDT = "0x55d398326f99059ff775485246999027b3197955"
GIT = "https://api.github.com/repos/Rezamoradifar/fti-protocol/git"
PREFIX = "fti-daily-quote/56/" + TOKEN
TEHRAN = ZoneInfo("Asia/Tehran")
# Each initial observation was read from price() at a block checked against the official RPC.
INITIAL = json.loads(Path(__file__).with_name("price-observations-20261114-20.json").read_text())


def checked(sample, day):
    if (sample["token"] != TOKEN or sample["quote"] != USDT or sample["chainId"] != 56
            or type(sample["block"]) is not int or sample["block"] < 1
            or type(sample["timestamp"]) is not int
            or datetime.fromtimestamp(sample["timestamp"], TEHRAN).date() != day
            or not re.fullmatch(r"[1-9][0-9]{0,77}", sample["priceWei"])
            or int(sample["priceWei"]) >= 2**256):
        raise ValueError("Invalid FTI daily observation")
    return sample


def current_sample(config, state):
    if config["chainId"] != 56 or config["token"].lower() != TOKEN or config["usd"].lower() != USDT:
        raise ValueError("Unexpected token or collateral for the price digest")
    supply, reserve, price = (int(state[k]) for k in ("supply", "reserve", "price"))
    if supply <= 0 or price <= 0 or price != reserve * 10**18 // supply:
        raise ValueError("Missing or inconsistent FTI reserve quote")
    day = datetime.fromtimestamp(int(state["timestamp"]), TEHRAN).date()
    return checked(dict(chainId=56, token=TOKEN, quote=USDT, block=int(state["block"]),
                        timestamp=int(state["timestamp"]), priceWei=str(price)), day)


def read_day(session, day):
    tag = f"{PREFIX}/{day}"
    ref = session.get(f"{GIT}/ref/tags/{tag}", timeout=12)
    if ref.status_code == 404:
        return None
    ref.raise_for_status()
    target = ref.json()
    if target["ref"] != "refs/tags/" + tag or target["object"]["type"] != "tag":
        raise ValueError("Unexpected daily quote reference")
    obj = session.get(f"{GIT}/tags/{target['object']['sha']}", timeout=12)
    obj.raise_for_status()
    record = obj.json()
    if record["tag"] != tag:
        raise ValueError("Unexpected daily quote tag")
    return checked(json.loads(record["message"]), day)


def record_day(session, day, sample, commit):
    tag = f"{PREFIX}/{day}"
    obj = session.post(f"{GIT}/tags", timeout=12, json={
        "tag": tag, "message": json.dumps(sample, sort_keys=True), "object": commit, "type": "commit"})
    obj.raise_for_status()
    ref = session.post(f"{GIT}/refs", timeout=12, json={
        "ref": "refs/tags/" + tag, "sha": obj.json()["sha"]})
    if ref.status_code in (409, 422):
        # A concurrent or retried publisher keeps the original observation.
        existing = read_day(session, day)
        if existing is not None:
            return existing
    ref.raise_for_status()
    return sample


def daily_history(config, state, headers=None, commit=None):
    sample = current_sample(config, state)
    day = datetime.fromtimestamp(sample["timestamp"], TEHRAN).date()
    rows = {}
    with requests.Session() as session:
        session.headers.update(headers or {})
        for offset in range(7, -1, -1):
            d = day - timedelta(days=offset)
            seed = INITIAL.get(d.isoformat())
            rows[d] = checked(seed, d) if seed else read_day(session, d)
        if rows[day] is None:
            rows[day] = record_day(session, day, sample, commit) if commit else sample
    return rows


def table(history):
    lines = ["Date · Tehran        USDT/FTI      Δ day"]
    for day in sorted(history)[-7:]:
        sample = history[day]
        previous = history.get(day - timedelta(days=1))
        stamp, price, change = "  —  ", "—", "—"
        if sample:
            stamp = datetime.fromtimestamp(sample["timestamp"], TEHRAN).strftime("%H:%M")
            value = Decimal(sample["priceWei"])
            price = f"{value.scaleb(-18):.8f}"
            if previous:
                pct = (value / Decimal(previous["priceWei"]) - 1) * 100
                change = f"{pct:+.2f}%" if pct else "0.00%"
        lines.append(f"{day} {stamp}  {price:>10}  {change:>7}")
    return "\n".join(lines)
