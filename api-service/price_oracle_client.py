import os
import time
from typing import Optional, Tuple

import requests

_cache = {
    "xmr_usd": 165.0,
    "btc_usd": 74000.0,
    "ts": 0.0,
}


def _urls() -> list[str]:
    primary = (os.getenv("PRICE_ORACLE_URL") or "http://127.0.0.1:9000/latest").strip()
    docker_internal = "http://price-oracle:9000/latest"
    urls = [primary]
    if primary != docker_internal:
        urls.append(docker_internal)
    return urls


def get_prices(max_age_sec: int = 120) -> Optional[dict]:
    now = time.time()
    if now - float(_cache.get("ts") or 0) <= max_age_sec:
        return {
            "xmr_usd": float(_cache["xmr_usd"]),
            "btc_usd": float(_cache["btc_usd"]),
            "timestamp": int(_cache["ts"]),
            "source": "cache",
        }

    token = (os.getenv("PRICE_ORACLE_TOKEN") or "").strip()
    headers = {"X-Oracle-Token": token} if token else {}

    for url in _urls():
        try:
            resp = requests.get(url, headers=headers, timeout=2.5)
            if resp.status_code != 200:
                continue
            data = resp.json()
            xmr = float(data.get("xmr_usd"))
            btc = float(data.get("btc_usd"))
            ts = float(data.get("timestamp") or now)
            if xmr <= 0 or btc <= 0:
                continue
            _cache["xmr_usd"] = xmr
            _cache["btc_usd"] = btc
            _cache["ts"] = ts
            return {
                "xmr_usd": xmr,
                "btc_usd": btc,
                "timestamp": int(ts),
                "source": str(data.get("source") or "oracle"),
            }
        except Exception:
            continue

    if _cache.get("ts"):
        return {
            "xmr_usd": float(_cache["xmr_usd"]),
            "btc_usd": float(_cache["btc_usd"]),
            "timestamp": int(_cache["ts"]),
            "source": "stale-cache",
        }
    return None


def get_xmr_usd(default: float = 165.0, max_age_sec: int = 120) -> Tuple[float, str]:
    prices = get_prices(max_age_sec=max_age_sec)
    if not prices:
        return float(default), "fallback"
    return float(prices["xmr_usd"]), str(prices.get("source") or "oracle")
