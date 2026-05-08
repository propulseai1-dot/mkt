"""
SILKGENESIS - Rate Limiter
Protege contre le brute-force sur les endpoints sensibles.
Fonctionne par session token (pas par IP, car sur Tor toutes les IPs sont identiques).
"""
import time
import threading
from collections import defaultdict

_lock = threading.Lock()

# Structure: {key: {"count": int, "window_start": float, "blocked_until": float}}
_buckets = defaultdict(lambda: {"count": 0, "window_start": 0.0, "blocked_until": 0.0})

# Configuration par endpoint
RATE_LIMITS = {
    "login":        {"max": 5,  "window": 60,   "block": 300},   # 5/min → 5min block
    "register":     {"max": 3,  "window": 60,   "block": 600},   # 3/min → 10min block
    "2fa":          {"max": 5,  "window": 60,   "block": 900},   # 5/min → 15min block
    "withdraw":     {"max": 3,  "window": 300,  "block": 1800},  # 3/5min → 30min block
    "order":        {"max": 10, "window": 60,   "block": 120},   # 10/min → 2min block
    "chat":         {"max": 40, "window": 60,   "block": 60},    # 40/min → 1min block
    "chat_order":   {"max": 60, "window": 60,   "block": 60},    # 60/min → 1min block
    "pgp_set":      {"max": 10, "window": 300,  "block": 300},   # 10/5min → 5min block
    "antiphishing": {"max": 8,  "window": 300,  "block": 600},   # anti énumération comptes
    "check_user":   {"max": 8,  "window": 300,  "block": 600},
    "pgp_encrypt":  {"max": 25, "window": 60,   "block": 120},   # charge CPU
    "qr_monero":    {"max": 45, "window": 60,   "block": 120},   # génération PNG
    # Admin probing: repeated forbidden/invalid session hits on /api/admin/*
    "admin_abuse":  {"max": 20, "window": 60,   "block": 900},   # 20/min → 15min block
    "default":      {"max": 30, "window": 60,   "block": 60},    # 30/min → 1min block
}


def _get_key(endpoint: str, identifier: str) -> str:
    """Build a unique key for rate limiting"""
    return f"{endpoint}:{identifier}"


def check_rate_limit(endpoint: str, identifier: str) -> dict:
    """
    Check if a request should be allowed.
    
    Args:
        endpoint: One of the keys in RATE_LIMITS (e.g. "login", "register")
        identifier: Unique identifier (session token, username, or "anonymous")
    
    Returns:
        {"allowed": bool, "remaining": int, "retry_after": int, "message": str}
    """
    config = RATE_LIMITS.get(endpoint, RATE_LIMITS["default"])
    key = _get_key(endpoint, identifier)
    now = time.time()

    with _lock:
        bucket = _buckets[key]

        # Check if currently blocked
        if bucket["blocked_until"] > now:
            retry_after = int(bucket["blocked_until"] - now)
            return {
                "allowed": False,
                "remaining": 0,
                "retry_after": retry_after,
                "message": f"Too many requests. Try again in {retry_after}s."
            }

        # Reset window if expired
        if now - bucket["window_start"] > config["window"]:
            bucket["count"] = 0
            bucket["window_start"] = now

        # Check limit
        if bucket["count"] >= config["max"]:
            bucket["blocked_until"] = now + config["block"]
            return {
                "allowed": False,
                "remaining": 0,
                "retry_after": config["block"],
                "message": f"Rate limit exceeded. Blocked for {config['block']}s."
            }

        # Allow and increment
        bucket["count"] += 1
        remaining = config["max"] - bucket["count"]
        return {
            "allowed": True,
            "remaining": remaining,
            "retry_after": 0,
            "message": "OK"
        }


def reset_rate_limit(endpoint: str, identifier: str):
    """Reset rate limit for a specific key (e.g. after successful login)"""
    key = _get_key(endpoint, identifier)
    with _lock:
        _buckets.pop(key, None)


def cleanup_old_buckets():
    """Remove expired buckets to prevent memory leak"""
    now = time.time()
    with _lock:
        expired = [
            k for k, v in _buckets.items()
            if v["blocked_until"] < now and (now - v["window_start"]) > 3600
        ]
        for k in expired:
            del _buckets[k]


# Auto-cleanup every 10 minutes
def _start_cleanup_thread():
    def _cleanup_loop():
        while True:
            time.sleep(600)
            cleanup_old_buckets()
    t = threading.Thread(target=_cleanup_loop, daemon=True)
    t.start()

_start_cleanup_thread()


# ============================================================
# COMPAT WRAPPERS - market_server.py uses these signatures:
#   if not check_rate_limit(endpoint, id): ...
#   retry = get_rate_limit_retry_after(endpoint, id)
# ============================================================

def _check_rate_limit_bool(endpoint: str, identifier: str) -> bool:
    """Returns True if allowed, False if rate-limited (bool wrapper)"""
    result = check_rate_limit.__wrapped__(endpoint, identifier)
    return result["allowed"]


# Monkey-patch: keep original as __wrapped__, replace with bool version
_original_check = check_rate_limit
check_rate_limit.__wrapped__ = _original_check

# Override check_rate_limit to return bool (backward compat)
def check_rate_limit(endpoint: str, identifier: str) -> bool:
    """
    Returns True if the request is allowed, False if rate-limited.
    Compatible with: if not check_rate_limit(endpoint, id): ...
    """
    config = RATE_LIMITS.get(endpoint, RATE_LIMITS["default"])
    key = _get_key(endpoint, identifier)
    now = time.time()
    with _lock:
        bucket = _buckets[key]
        if bucket["blocked_until"] > now:
            return False
        if now - bucket["window_start"] > config["window"]:
            bucket["count"] = 0
            bucket["window_start"] = now
        if bucket["count"] >= config["max"]:
            bucket["blocked_until"] = now + config["block"]
            return False
        bucket["count"] += 1
        return True


def get_rate_limit_retry_after(endpoint: str, identifier: str) -> int:
    """Returns seconds to wait before retrying (0 if not rate-limited)"""
    key = _get_key(endpoint, identifier)
    now = time.time()
    with _lock:
        bucket = _buckets[key]
        if bucket["blocked_until"] > now:
            return int(bucket["blocked_until"] - now)
    config = RATE_LIMITS.get(endpoint, RATE_LIMITS["default"])
    return config["block"]

