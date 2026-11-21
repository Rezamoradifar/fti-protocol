"""Read the contract quote at the start of each Tehran day on BNB Smart Chain."""
from datetime import datetime, time, timedelta
from decimal import Decimal
from functools import lru_cache
from zoneinfo import ZoneInfo

import requests

TOKEN = "0x43755b1e813b2d41f669ea08bcf859de07195ea1"
USDT = "0x55d398326f99059ff775485246999027b3197955"
TEHRAN = ZoneInfo("Asia/Tehran")
CHAIN = "https://ftiprotocol.com/rpc"
ARCHIVE = "https://56.rpc.thirdweb.com"


def rpc(session, url, method, params):
    response = session.post(url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=12)
    response.raise_for_status()
    data = response.json()
    if data.get("id") != 1 or data.get("result") is None or "error" in data:
        raise ValueError("Unavailable chain data for " + method)
    return data["result"]


def block_at(target, lower, upper, header):
    """Latest block at or before target. BSC can have several blocks in one second."""
    lo, hi = lower, upper
    if not header(lo)[0] <= target < header(hi)[0]:
        return None
    for attempt in range(48):
        if hi - lo <= 1:
            return lo
        start, end = header(lo)[0], header(hi)[0]
        estimate = lo + (target - start) * (hi - lo) // (end - start)
        # Periodic bisection also bounds progress around block interval changes.
        mid = (hi + lo) // 2 if attempt % 6 == 5 else max(lo + 1, min(hi - 1, estimate))
        if header(mid)[0] <= target:
            lo = mid
        else:
            hi = mid
    raise ValueError("Could not verify a daily block boundary")


def daily_history(config, state):
    if config["chainId"] != 56 or config["token"].lower() != TOKEN or config["usd"].lower() != USDT:
        raise ValueError("Unexpected token or collateral for the price digest")
    day = datetime.fromtimestamp(int(state["timestamp"]), TEHRAN).date()
    history = {}
    with requests.Session() as session:
        for url in (CHAIN, ARCHIVE):
            if int(rpc(session, url, "eth_chainId", []), 16) != 56:
                raise ValueError("Unexpected price source network")

        @lru_cache(maxsize=256)
        def header(number):
            data = rpc(session, CHAIN, "eth_getBlockByNumber", [hex(number), False])
            if int(data["number"], 16) != number or len(data["hash"]) != 66:
                raise ValueError("Invalid canonical block")
            return int(data["timestamp"], 16), data["hash"].lower()

        lower, upper = int(config["deployedBlock"]), int(state["block"])
        for offset in range(7, -1, -1):
            date = day - timedelta(days=offset)
            target = int(datetime.combine(date, time.min, tzinfo=TEHRAN).timestamp())
            history[date] = None
            try:
                number = block_at(target, lower, upper, header)
                if number is None:
                    continue
                lower = number
                # Verify that the archive and the official chain refer to the same block.
                tag = hex(number)
                archived = rpc(session, ARCHIVE, "eth_getBlockByNumber", [tag, False])
                if archived["hash"].lower() != header(number)[1]:
                    raise ValueError("Archive block mismatch")
                raw = rpc(session, ARCHIVE, "eth_call", [{"to": TOKEN, "data": "0xa035b1fe"}, tag])
                if not isinstance(raw, str) or not raw.startswith("0x") or len(raw) != 66:
                    raise ValueError("Invalid price() result")
                price = int(raw, 16)
                if price > 0:
                    history[date] = {"block": number, "priceWei": price}
            except (requests.RequestException, ValueError, KeyError, TypeError):
                # An unobserved price never supplies either side of a percentage change.
                print(f"Historical quote unavailable for {date}", flush=True)
    return history


def table(history):
    lines = ["Date        USDT / FTI       Δ day"]
    for day in sorted(history)[-7:]:
        sample = history[day]
        previous = history.get(day - timedelta(days=1))
        price, change = "—", "—"
        if sample:
            value = Decimal(sample["priceWei"])
            price = f"{value.scaleb(-18):.8f}"
            if previous:
                pct = (value / Decimal(previous["priceWei"]) - 1) * 100
                change = f"{pct:+.2f}%" if pct else "0.00%"
        lines.append(f"{day}  {price:>12}  {change:>8}")
    return "\n".join(lines)
