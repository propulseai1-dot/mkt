"""
SILKGENESIS - Proof-of-Work (Hashcash style)

Verification cote serveur d'une PoW emise par le client avant les actions
sensibles non authentifiees (login, register). L'objectif est d'augmenter
le cout marginal d'une enumeration / register-spam massif sur Tor (ou la
limitation par IP n'a pas de sens : tous les clients ressemblent a 127.0.0.1).

Format challenge :
    POW1:<server_salt>:<expiry_unix>:<difficulty>:<context>

Format solution :
    <challenge>::<nonce>

Verification :
    sha256(challenge + ":" + nonce) commence par <difficulty> bits zero.

Cycle :
    1. POST /api/pow/challenge { context: "login" | "register" } -> { challenge, difficulty, expires }
    2. Le client mine un nonce qui satisfait la difficulte.
    3. Le client poste { ... , pow_solution: "<challenge>::<nonce>" } a /api/login ou /api/register.
    4. Le serveur appelle verify_pow(solution, expected_context).

Replay protection :
    Chaque solution acceptee est memorisee jusqu'a expiration.
"""

from __future__ import annotations

import hashlib
import hmac as hmac_lib
import os
import secrets
import threading
import time
from typing import Tuple

# Cle HMAC du challenge : ephemere par process si non fournie en env
_POW_KEY = (os.environ.get("SILKGENESIS_POW_HMAC_SECRET") or "").strip()
if not _POW_KEY:
    _POW_KEY = secrets.token_hex(32)
_POW_KEY_BYTES = _POW_KEY.encode()

POW_DEFAULT_DIFFICULTY = int(os.environ.get("SILKGENESIS_POW_DIFFICULTY", "18"))  # bits, ~ ~200ms desktop
POW_DIFFICULTY_BY_CONTEXT = {
    "login": int(os.environ.get("SILKGENESIS_POW_DIFFICULTY_LOGIN", str(POW_DEFAULT_DIFFICULTY))),
    "register": int(os.environ.get("SILKGENESIS_POW_DIFFICULTY_REGISTER", str(POW_DEFAULT_DIFFICULTY + 2))),
}
POW_TTL_SECONDS = int(os.environ.get("SILKGENESIS_POW_TTL", "600"))

_seen_lock = threading.Lock()
_seen: dict[str, float] = {}  # solution -> expiry
_VALID_CONTEXTS = ("login", "register")


def _bits_zero(digest: bytes, bits: int) -> bool:
    full_bytes, remainder = divmod(bits, 8)
    if any(b != 0 for b in digest[:full_bytes]):
        return False
    if remainder == 0:
        return True
    mask = 0xFF << (8 - remainder) & 0xFF
    return (digest[full_bytes] & mask) == 0


def _sign(challenge_body: str) -> str:
    sig = hmac_lib.new(_POW_KEY_BYTES, challenge_body.encode(), hashlib.sha256).hexdigest()
    return sig[:16]


def issue_challenge(context: str) -> dict:
    """Genere un challenge HMAC-signe pour un contexte donne."""
    if context not in _VALID_CONTEXTS:
        raise ValueError(f"invalid pow context: {context}")
    diff = POW_DIFFICULTY_BY_CONTEXT.get(context, POW_DEFAULT_DIFFICULTY)
    salt = secrets.token_hex(8)
    expiry = int(time.time()) + POW_TTL_SECONDS
    body = f"POW1:{salt}:{expiry}:{diff}:{context}"
    sig = _sign(body)
    challenge = f"{body}:{sig}"
    return {
        "challenge": challenge,
        "difficulty": diff,
        "expires": expiry,
        "algo": "sha256-leading-zero-bits",
    }


def _parse_challenge(challenge: str) -> Tuple[bool, int, str, int]:
    """Returns (ok, difficulty, context, expiry). ok=False si signature/format invalides."""
    parts = challenge.split(":")
    if len(parts) != 6 or parts[0] != "POW1":
        return False, 0, "", 0
    _, salt, exp_s, diff_s, context, sig = parts
    body = f"POW1:{salt}:{exp_s}:{diff_s}:{context}"
    if not hmac_lib.compare_digest(_sign(body), sig):
        return False, 0, "", 0
    try:
        expiry = int(exp_s)
        difficulty = int(diff_s)
    except ValueError:
        return False, 0, "", 0
    return True, difficulty, context, expiry


def _gc_seen(now: float) -> None:
    expired = [k for k, exp in _seen.items() if exp < now]
    for k in expired:
        _seen.pop(k, None)


def verify_pow(solution: str, expected_context: str) -> bool:
    """Verifie une solution de PoW (avec anti-replay)."""
    if not solution or not isinstance(solution, str):
        return False
    sep = "::"
    if sep not in solution:
        return False
    challenge, nonce = solution.split(sep, 1)
    if not challenge or not nonce or len(nonce) > 64:
        return False

    ok, difficulty, context, expiry = _parse_challenge(challenge)
    if not ok:
        return False
    now = time.time()
    if now > expiry:
        return False
    if context != expected_context:
        return False

    digest = hashlib.sha256(f"{challenge}:{nonce}".encode()).digest()
    if not _bits_zero(digest, difficulty):
        return False

    with _seen_lock:
        _gc_seen(now)
        if solution in _seen:
            return False  # anti-replay
        _seen[solution] = float(expiry)
    return True
