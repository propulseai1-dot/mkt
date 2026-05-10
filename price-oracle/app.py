import os
import secrets
import threading
import time
from typing import Optional

import requests
from fastapi import FastAPI, Header, HTTPException

app = FastAPI(title="SilkGenesis Price Oracle", version="1.0.0")

REFRESH_SEC = int(os.getenv("PRICE_ORACLE_REFRESH_SEC", "20"))
ALLOW_CLEARNET = str(os.getenv("PRICE_ORACLE_ALLOW_CLEARNET", "0")).strip().lower() in ("1", "true", "yes", "on")

# Token oracle obligatoire en production. En dev, on en genere un ephemere
# (les clients devront l'utiliser dans le header X-Oracle-Token; pour le service
# api il est passe via l'env PRICE_ORACLE_TOKEN partage).
_IS_PRODUCTION = os.getenv("SILKGENESIS_ENV", "development").lower() == "production"
ORACLE_TOKEN = (os.getenv("PRICE_ORACLE_TOKEN") or "").strip()
if _IS_PRODUCTION and (not ORACLE_TOKEN or len(ORACLE_TOKEN) < 24):
    raise RuntimeError(
        "PRICE_ORACLE_TOKEN is required in production (>= 24 chars). "
        "Generate with: openssl rand -hex 24"
    )
if not ORACLE_TOKEN:
    ORACLE_TOKEN = secrets.token_urlsafe(32)
    print("[oracle] No PRICE_ORACLE_TOKEN set; generated ephemeral dev token (matches the same value in api).")

# Proxy SOCKS optionnel pour acceder a Kraken/CoinGecko via Tor
# (par defaut: un onion-routed sortant pour ne pas correler le hidden service avec ces requetes).
TOR_SOCKS_PROXY = (os.getenv("PRICE_ORACLE_TOR_SOCKS") or "").strip()  # ex: socks5h://tor:9050
_REQUEST_PROXIES = (
    {"http": TOR_SOCKS_PROXY, "https": TOR_SOCKS_PROXY}
    if TOR_SOCKS_PROXY
    else None
)
if _IS_PRODUCTION and ALLOW_CLEARNET and not TOR_SOCKS_PROXY:
    raise RuntimeError(
        "In production, PRICE_ORACLE_ALLOW_CLEARNET=1 requires PRICE_ORACLE_TOR_SOCKS "
        "(e.g. socks5h://tor:9050) so external feeds do not correlate with the hidden service."
    )
# Si 0 : /latest ne renvoie jamais le message d'exception brut (evite fuite stack/chemins).
EXPOSE_ERROR_DETAIL = str(os.getenv("PRICE_ORACLE_EXPOSE_ERROR_DETAIL", "0")).strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)

cache = {
    "xmr_usd": float(os.getenv("PRICE_ORACLE_FALLBACK_XMR_USD", "165.0")),
    "btc_usd": float(os.getenv("PRICE_ORACLE_FALLBACK_BTC_USD", "74000.0")),
    "timestamp": int(time.time()),
    "source": "bootstrap-fallback",
    "ok": False,
    "error": None,
}


def _fetch_kraken() -> Optional[dict]:
    r = requests.get(
        "https://api.kraken.com/0/public/Ticker?pair=XMRUSD,XBTUSD",
        timeout=10,
        proxies=_REQUEST_PROXIES,
    )
    if r.status_code != 200:
        return None
    d = r.json().get("result") or {}
    xmr = d.get("XXMRZUSD", {}).get("c", [None])[0]
    btc = d.get("XXBTZUSD", {}).get("c", [None])[0]
    if xmr is None or btc is None:
        return None
    return {"xmr_usd": float(xmr), "btc_usd": float(btc), "source": "kraken"}


def _fetch_coingecko() -> Optional[dict]:
    r = requests.get(
        "https://api.coingecko.com/api/v3/simple/price",
        params={"ids": "monero,bitcoin", "vs_currencies": "usd"},
        timeout=10,
        proxies=_REQUEST_PROXIES,
    )
    if r.status_code != 200:
        return None
    d = r.json()
    return {
        "xmr_usd": float(d["monero"]["usd"]),
        "btc_usd": float(d["bitcoin"]["usd"]),
        "source": "coingecko",
    }


def refresh_loop():
    while True:
        try:
            if not ALLOW_CLEARNET:
                cache["ok"] = False
                cache["error"] = "PRICE_ORACLE_ALLOW_CLEARNET=0 (external feeds disabled)"
                time.sleep(REFRESH_SEC)
                continue
            data = _fetch_kraken() or _fetch_coingecko()
            if not data:
                raise RuntimeError("All upstream feeds failed")
            cache["xmr_usd"] = float(data["xmr_usd"])
            cache["btc_usd"] = float(data["btc_usd"])
            cache["timestamp"] = int(time.time())
            cache["source"] = data["source"]
            cache["ok"] = True
            cache["error"] = None
        except Exception as e:
            cache["ok"] = False
            cache["error"] = str(e)
        time.sleep(REFRESH_SEC)


@app.on_event("startup")
def _startup():
    threading.Thread(target=refresh_loop, daemon=True).start()


@app.get("/health")
def health():
    err = cache["error"]
    if err is not None and not EXPOSE_ERROR_DETAIL:
        err = "oracle_refresh_failed"
    return {"status": "ok", "oracle_ok": cache["ok"], "source": cache["source"], "timestamp": cache["timestamp"], "error": err}


@app.get("/latest")
def latest(x_oracle_token: Optional[str] = Header(default=None)):
    # Token desormais obligatoire (non-empty), meme en dev (auto-genere).
    if not ORACLE_TOKEN or not secrets.compare_digest(x_oracle_token or "", ORACLE_TOKEN):
        raise HTTPException(status_code=401, detail="UNAUTHORIZED_ORACLE_CLIENT")
    err = cache["error"]
    if err is not None and not EXPOSE_ERROR_DETAIL:
        err = "oracle_refresh_failed"
    return {
        "xmr_usd": cache["xmr_usd"],
        "btc_usd": cache["btc_usd"],
        "timestamp": cache["timestamp"],
        "source": cache["source"],
        "stale": not cache["ok"],
        "error": err,
    }
