import builtins
import os
import sys
import json
import time
import secrets
import hashlib
import re
import threading
import logging
import requests
import io
from datetime import datetime
from typing import Optional, List
from urllib.parse import quote, urlparse

from funds_lock import funds_rlock

from silk_paths import ensure_silk_data_layout, persist_base_dir

ensure_silk_data_layout()

from affiliate_program import (
    apply_affiliate_payouts,
    program_static_payload,
    stats_for_user,
    payments_for_user,
    leaderboard_current_month,
)

from fastapi import FastAPI, HTTPException, Request, Response, Depends, Header
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# DB persistence
from db_persist import (
    init_db, get_db_path, save_all_users, load_all_users,
    save_all_listings, load_all_listings, save_listing,
    save_all_categories, load_all_categories,
    save_order, load_all_orders,
    save_all_order_messages, load_all_order_messages,
    save_all_general_messages, load_all_general_messages,
    save_review, load_all_reviews, save_all_reviews,
    save_all_disputes, load_all_disputes,
    save_vendor_bond, load_all_vendor_bonds,
    start_auto_backup, backup_now, list_backups,
)

# Security
from security import (
    hash_password, verify_password, needs_rehash, migrate_users_passwords,
    generate_totp_secret, verify_totp, get_totp_uri,
    check_pin_lockout, record_pin_failure, record_pin_success,
    generate_secure_password, create_session, validate_session, invalidate_session, set_admin_unlock,
    hash_pin, verify_pin,
    list_user_sessions, invalidate_other_sessions
)

# Rate limiter
from rate_limiter import check_rate_limit, get_rate_limit_retry_after

# Proof-of-Work
from pow import issue_challenge as pow_issue_challenge, verify_pow

# Audit log
from audit_log import AuditEvent, log, log_security, log_admin, get_recent_logs

# Monero RPC
from monero_rpc import MoneroRPC as MoneroWallet, get_rpc, MARKETPLACE_FEE_PERCENT, MIN_CONFIRMATIONS
from monero_integration import init_escrow
from price_oracle_client import get_prices

# PGP
from pgp_utils import generate_pgp_keypair, validate_pgp_public_key, encrypt_message


def _looks_like_pgp_armor(s: str) -> bool:
    """Quick sanity check: refuses plaintext from a malicious or buggy client.
    The full cryptographic validity is the recipient's responsibility (E2E)."""
    if not isinstance(s, str):
        return False
    s2 = s.strip()
    if len(s2) < 64 or len(s2) > 64_000:
        return False
    return s2.startswith("-----BEGIN PGP MESSAGE-----") and s2.rstrip().endswith("-----END PGP MESSAGE-----")

# Withdrawal limits
MIN_WITHDRAWAL_XMR = 0.01
MAX_WITHDRAWAL_XMR = 100.0
WITHDRAWAL_NETWORK_FEE_XMR = 0.0001
WITHDRAWAL_COOLDOWN_SECONDS = 300

# FastAPI app
app = FastAPI(title="SilkGenesis Market API", version="2.0")
IS_PRODUCTION = os.environ.get("SILKGENESIS_ENV", "development").lower() == "production"

_VERBOSE_LOGS = (not IS_PRODUCTION) or (
    os.environ.get("SILKGENESIS_VERBOSE_LOGS", "").strip().lower() in ("1", "true", "yes", "on")
)


def _dev_print(*args, **kwargs) -> None:
    """Diagnostics stdout : off en production sauf si SILKGENESIS_VERBOSE_LOGS=1."""
    if not _VERBOSE_LOGS:
        return
    builtins.print(*args, **kwargs, flush=True)


_log = logging.getLogger("silkgenesis.api")
if not _log.handlers:
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
    _log.addHandler(_h)
_log.setLevel(logging.WARNING if IS_PRODUCTION else logging.INFO)


def _ops_warning(msg: str) -> None:
    """Message operationnel minimal (stderr), sans donnees utilisateur."""
    _log.warning(msg)


MONERO_RPC_URL = os.environ.get("MONERO_RPC_URL", "http://127.0.0.1:18082/json_rpc")
TEST_GODMODE_ENABLED = (
    (os.environ.get("SILKGENESIS_ENABLE_TEST_GODMODE", "1").strip().lower() in ("1", "true", "yes", "on"))
    and (not IS_PRODUCTION)
)
TEST_GODMODE_USERNAME = (os.environ.get("SILKGENESIS_TEST_GODMODE_USERNAME", "godmode") or "").strip().lower()
TEST_GODMODE_PASSWORD = os.environ.get("SILKGENESIS_TEST_GODMODE_PASSWORD", "godmode123!")
FOUNDER_VENDOR_BADGE_LIMIT = 20
# Noms reserves a l'inscription (pas de squatting si le compte n'existe pas encore)
REGISTER_RESERVED_USERNAMES = frozenset({
    "admin", "administrator", "root", "rootadmin", "system", "support", "moderator",
    "silksupport", "silkgenesis", "null", "api", "www", "mail", "postmaster",
})


def _register_username_reserved(username: str) -> bool:
    """True si le pseudo est reserve (liste fixe + compte root admin configurable)."""
    u = (username or "").strip().lower()
    if u in REGISTER_RESERVED_USERNAMES:
        return True
    root = (os.environ.get("SILKGENESIS_ROOT_ADMIN_USERNAME") or "rootadmin").strip().lower()
    return bool(root) and u == root
DEMO_VENDOR_USERNAMES = [
    "DarkPharmacy",
    "CryptoKing",
    "SilkMaster",
    "GreenLeaf",
    "PsychedelicPro",
    "PharmaDirect",
    "DigitalGoods",
    "SecureServices",
]
ACTIVE_DEMO_FOUNDER_VENDORS = DEMO_VENDOR_USERNAMES[:5]

# Demo listing images : SVG inline uniquement (pas de fetch clearnet type Unsplash pour les utilisateurs Tor).
_DEMO_LISTING_IMG_SVG = (
    "data:image/svg+xml;charset=utf-8,"
    + quote(
        "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400'>"
        "<rect fill='#18181b' width='100%' height='100%'/>"
        "<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' "
        "fill='#a16207' font-family='system-ui,sans-serif' font-size='18'>Demo</text>"
        "</svg>"
    )
)

# Security scheme for Bearer Token
security_scheme = HTTPBearer(auto_error=False)


def _is_test_godmode_username(username: str) -> bool:
    return bool(
        TEST_GODMODE_ENABLED
        and TEST_GODMODE_USERNAME
        and username
        and username.lower() == TEST_GODMODE_USERNAME
    )

# ============================================================
# Session cookie + CSRF helpers
# ============================================================
SESSION_COOKIE_NAME = "sg_session"
CSRF_COOKIE_NAME = "sg_csrf"          # readable by JS, used in double-submit pattern
CSRF_HEADER_NAME = "X-CSRF-Token"
SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 jours
_COOKIE_SECURE = os.environ.get("SILKGENESIS_ENV", "development").lower() == "production"

# Methodes mutantes qui DOIVENT presenter le double-submit token CSRF.
_CSRF_PROTECTED_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# Endpoints publics exemptes (login, register, pow): pas de cookie deja pose.
_CSRF_EXEMPT_PATHS = {
    "/api/login",
    "/api/register",
    "/api/pow/challenge",
    "/api/auth/check-user",
    "/api/2fa/setup",
    "/api/2fa/enable",
}


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_COOKIE_MAX_AGE,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite="strict",
        path="/",
    )
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=secrets.token_urlsafe(24),
        max_age=SESSION_COOKIE_MAX_AGE,
        httponly=False,  # lisible par JS (pattern double-submit)
        secure=_COOKIE_SECURE,
        samesite="strict",
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    for name in (SESSION_COOKIE_NAME, CSRF_COOKIE_NAME):
        response.delete_cookie(key=name, path="/", samesite="strict")


def _check_csrf(request: Request) -> None:
    """Double-submit CSRF check on state-changing methods."""
    if request.method.upper() not in _CSRF_PROTECTED_METHODS:
        return
    # Exempt only when the request has no session cookie (anonymous bootstrap calls).
    cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
    has_session_cookie = bool(request.cookies.get(SESSION_COOKIE_NAME))
    if not has_session_cookie:
        return  # Bearer-based / anonymous: no cookie, no CSRF.
    header_token = request.headers.get(CSRF_HEADER_NAME, "")
    if not cookie_token or not header_token or not secrets.compare_digest(cookie_token, header_token):
        raise HTTPException(status_code=403, detail="CSRF_TOKEN_INVALID")


def get_current_session(
    request: Request,
    auth: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
):
    """
    Resolve the active session from EITHER:
      1) Authorization: Bearer <token>  (legacy clients / SDK / SSE)
      2) sg_session HttpOnly cookie     (browser clients, set at /api/login)
    A CSRF double-submit token is required for cookie-based mutating requests.
    """
    token: str = ""
    via_cookie = False
    if auth and (auth.credentials or "").strip():
        token = auth.credentials.strip()
    else:
        cookie_token = (request.cookies.get(SESSION_COOKIE_NAME) or "").strip()
        if cookie_token:
            token = cookie_token
            via_cookie = True

    if not token:
        raise HTTPException(status_code=401, detail="SESSION_TOKEN_REQUIRED")

    session = validate_session(token)
    if not session:
        raise HTTPException(status_code=401, detail="INVALID_SESSION")

    if via_cookie and request.url.path not in _CSRF_EXEMPT_PATHS:
        _check_csrf(request)

    session["token"] = token
    session["via_cookie"] = via_cookie
    return session


def require_admin(session: dict = Depends(get_current_session)) -> dict:
    """Dépendance FastAPI : session valide + rôle admin (défense en profondeur au-delà du middleware)."""
    if session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ADMIN_ONLY")
    return session

def require_self_or_admin(username: str, session: dict):
    """Authorize only account owner or admin for user-scoped security actions."""
    if not username:
        raise HTTPException(status_code=400, detail="USERNAME_REQUIRED")
    if username != session.get("username") and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    return True

def _resolve_session_from_auth(auth: Optional[HTTPAuthorizationCredentials]) -> Optional[dict]:
    """Resolve optional bearer auth to session dict."""
    if not auth:
        return None
    token = (auth.credentials or "").strip()
    if not token:
        return None
    session = validate_session(token)
    if not session:
        return None
    session["token"] = token
    return session


def require_self_admin_or_password_bootstrap(
    username: str,
    session: Optional[dict],
    password: str,
    allow_password_bootstrap: bool = False,
):
    """
    Authorize user-scoped action with either:
    - valid owner/admin session, or
    - password bootstrap for the same account (only when explicitly allowed).
    """
    if session:
        return require_self_or_admin(username, session)
    if allow_password_bootstrap:
        user = users_db.get(username)
        if user and verify_password(password or "", user.get("password", "")):
            return True
    raise HTTPException(status_code=401, detail="SESSION_TOKEN_REQUIRED")


def _require_session_actor(token: str, expected_username: str):
    """Validate session token and ensure it belongs to expected user (Legacy wrapper)."""
    if not token:
        raise HTTPException(status_code=401, detail="SESSION_TOKEN_REQUIRED")
    session = validate_session(token)
    if not session:
        raise HTTPException(status_code=401, detail="INVALID_SESSION")
    session_user = session.get("username")
    if expected_username and session_user != expected_username:
        raise HTTPException(status_code=403, detail="SESSION_USER_MISMATCH")
    return session


def _pgp_setup_completed(user: dict) -> bool:
    """
    PGP setup status with backward compatibility:
    - explicit flag (new flow)
    - OR private key already viewed once (legacy/onboarding flow)
    - OR key material already present (older accounts)
    """
    if not user:
        return False
    has_key_material = bool(user.get("pgp_public_key") or user.get("pgp_key"))
    return bool(
        user.get("pgp_setup_completed", False)
        or user.get("pgp_private_key_viewed", False)
        or has_key_material
    )

def _count_founder_vendors() -> int:
    return sum(1 for u in users_db.values() if u.get("founder_vendor_badge") is True)

def _assign_founder_vendor_badge(user: dict) -> bool:
    """Assign Founder Vendor badge to first 20 vendors."""
    if not user or user.get("role") != "vendor":
        return False
    if user.get("founder_vendor_badge"):
        return False
    claimed = _count_founder_vendors()
    if claimed >= FOUNDER_VENDOR_BADGE_LIMIT:
        return False
    user["founder_vendor_badge"] = True
    user["founder_vendor_serial"] = claimed + 1
    user["founder_vendor_granted_at"] = datetime.utcnow().isoformat()
    return True

def _cleanup_demo_vendors_keep_five_founders() -> None:
    """
    Remove extra demo vendors and keep only 5 premium demo vendors
    with active founder badges #1..#5.
    """
    keep_set = set(ACTIVE_DEMO_FOUNDER_VENDORS)
    demo_set = set(DEMO_VENDOR_USERNAMES)

    removed_users = []
    for username in list(users_db.keys()):
        if username in demo_set and username not in keep_set:
            user = users_db.get(username, {})
            if user.get("role") == "vendor":
                removed_users.append(username)
                del users_db[username]

    if removed_users:
        for lid in list(listings_db.keys()):
            if listings_db[lid].get("vendor") in removed_users:
                del listings_db[lid]

    # Keep only requests that are not from removed demo vendors.
    global seller_requests
    seller_requests = [r for r in seller_requests if r.get("username") not in removed_users]

    # Normalize founder badges for kept demo vendors.
    for username, user in users_db.items():
        if user.get("role") == "vendor" and username not in keep_set and username in demo_set:
            user["founder_vendor_badge"] = False
            user["founder_vendor_serial"] = None
            user["founder_vendor_granted_at"] = None

    for idx, username in enumerate(ACTIVE_DEMO_FOUNDER_VENDORS, start=1):
        user = users_db.get(username)
        if not user:
            continue
        user["role"] = "vendor"
        user["founder_vendor_badge"] = True
        user["founder_vendor_serial"] = idx
        user["founder_vendor_granted_at"] = user.get("founder_vendor_granted_at") or datetime.utcnow().isoformat()

# Init SQLite DB
init_db()

# ============================================================
# PHASE 2 FLAGS - Definis tot pour eviter NameError dans login
# ============================================================
TOTP_AVAILABLE = False
DMS_AVAILABLE = False
BOND_AVAILABLE = False

# INITIALISER LE WALLET MONERO RPC
try:
    monero_wallet = MoneroWallet(rpc_url=MONERO_RPC_URL)
    _dev_print("[OK] Monero RPC connecte!")
    USE_REAL_MONERO = True
except Exception as e:
    if IS_PRODUCTION:
        raise RuntimeError(f"Monero RPC unavailable in production: {e}") from e
    _dev_print(f"[WARNING] Monero RPC non disponible: {e}")
    _dev_print("[INFO] Mode simule active (development only)")
    monero_wallet = None
    USE_REAL_MONERO = False


# PERSISTANCE JSON - Listings vendors survivent aux redemarrages (SILKGENESIS_DATA_DIR en prod)
VENDOR_LISTINGS_FILE = os.path.join(persist_base_dir(), "vendor_listings.json")
USERS_PERSIST_FILE = os.path.join(persist_base_dir(), "users_persist.json")

def save_vendor_listings():
    try:
        vl = {k: v for k, v in listings_db.items() if v.get('is_vendor_listing', False)}
        from secure_storage import encrypted_json_save
        encrypted_json_save(VENDOR_LISTINGS_FILE, vl)
    except Exception as e:
        _dev_print(f'[WARNING] save_vendor_listings: {e}')

def load_vendor_listings():
    if os.path.exists(VENDOR_LISTINGS_FILE):
        try:
            from secure_storage import encrypted_json_load
            data = encrypted_json_load(VENDOR_LISTINGS_FILE, default={}) or {}
            if data:
                listings_db.update(data)
                _dev_print(f'[OK] Loaded {len(data)} vendor listings from disk')
        except Exception as e:
            _dev_print(f'[WARNING] load_vendor_listings: {e}')

def save_users_persist():
    """Sauvegarder les users sur disque (JSON legacy + SQLite)"""
    try:
        # SQLite (principal - survit aux redemarrages)
        save_all_users(users_db)
    except Exception as e:
        _dev_print(f'[WARNING] save_users_persist SQLite: {e}')
    try:
        # JSON legacy (compatibility)
        persist = {}
        for username, user in users_db.items():
            persist[username] = {
                "anti_phishing_phrase": user.get("anti_phishing_phrase"),
                "pgp_key": user.get("pgp_key"),
                "pgp_public_key": user.get("pgp_public_key"),
                "pgp_private_key_encrypted": user.get("pgp_private_key_encrypted"),
                "pgp_fingerprint": user.get("pgp_fingerprint"),
                "pgp_setup_completed": user.get("pgp_setup_completed", False),
                "pgp_private_key_viewed": user.get("pgp_private_key_viewed", False),
                "withdrawal_pin": user.get("withdrawal_pin"),
                "avatar": user.get("avatar"),
                "balance": user.get("balance", 0.0),
                "role": user.get("role", "buyer"),
                "password": user.get("password"),
                "xmr_address": user.get("xmr_address"),
                "xmr_address_index": user.get("xmr_address_index"),
                "status": user.get("status", "active"),
                "pos": user.get("pos", 0),
                "total_sales": user.get("total_sales", 0),
                "total_volume_xmr": user.get("total_volume_xmr", 0.0),
                "referred_by": user.get("referred_by"),
                "founder_vendor_badge": user.get("founder_vendor_badge", False),
                "founder_vendor_serial": user.get("founder_vendor_serial"),
                "founder_vendor_granted_at": user.get("founder_vendor_granted_at"),
            }
        from secure_storage import encrypted_json_save
        encrypted_json_save(USERS_PERSIST_FILE, persist)
    except Exception as e:
        _dev_print(f'[WARNING] save_users_persist JSON: {e}')

def load_users_persist():
    """Load les data persistantes des users au demarrage"""
    if os.path.exists(USERS_PERSIST_FILE):
        try:
            from secure_storage import encrypted_json_load
            data = encrypted_json_load(USERS_PERSIST_FILE, default={}) or {}
            for username, saved in data.items():
                if username in users_db:
                    # Mettre a jour les champs persistants
                    for field in ["anti_phishing_phrase", "pgp_key", "pgp_public_key",
                                  "pgp_private_key_encrypted", "pgp_fingerprint",
                                  "pgp_setup_completed", "pgp_private_key_viewed",
                                  "withdrawal_pin", "avatar", "balance", "role",
                                  "password", "xmr_address", "xmr_address_index", "status", "pos",
                                  "total_sales", "total_volume_xmr", "referred_by",
                                  "founder_vendor_badge", "founder_vendor_serial", "founder_vendor_granted_at"]:
                        if saved.get(field) is not None:
                            users_db[username][field] = saved[field]
                else:
                    # User existait avant mais pas dans la demo data - le recreer
                    users_db[username] = {
                        "username": username,
                        "password": saved.get("password", ""),
                        "role": saved.get("role", "buyer"),
                        "status": saved.get("status", "active"),
                        "balance": saved.get("balance", 0.0),
                        "xmr_address": saved.get("xmr_address") or generate_xmr_address(),
                        "xmr_address_index": saved.get("xmr_address_index"),
                        "avatar": saved.get("avatar"),
                        "pos": saved.get("pos", 0),
                        "anti_phishing_phrase": saved.get("anti_phishing_phrase"),
                        "pgp_key": saved.get("pgp_key"),
                        "pgp_setup_completed": saved.get("pgp_setup_completed", False),
                        "pgp_private_key_viewed": saved.get("pgp_private_key_viewed", False),
                        "withdrawal_pin": saved.get("withdrawal_pin"),
                        "total_sales": saved.get("total_sales", 0),
                        "total_volume_xmr": saved.get("total_volume_xmr", 0.0),
                        "referred_by": saved.get("referred_by"),
                        "founder_vendor_badge": saved.get("founder_vendor_badge", False),
                        "founder_vendor_serial": saved.get("founder_vendor_serial"),
                        "founder_vendor_granted_at": saved.get("founder_vendor_granted_at"),
                    }
            _dev_print(f'[OK] Loaded persistent data for {len(data)} users')
        except Exception as e:
            _dev_print(f'[WARNING] load_users_persist: {e}')

# GZIP COMPRESSION - Reduit la taille des reponses JSON de ~70% pour Tor
app.add_middleware(GZipMiddleware, minimum_size=500)

# CORS
# Pour les cookies HttpOnly, allow_credentials=True est indispensable, ce qui IMPOSE
# une whitelist d'origines explicite (pas de wildcard). On rejette toute origine vide
# ou contenant "*" pour eviter une mauvaise config.
_allowed_origins_raw = os.environ.get(
    "SILKGENESIS_ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,http://0.0.0.0:3000,http://localhost:8080,http://127.0.0.1:8080,http://0.0.0.0:8080",
)
if IS_PRODUCTION and not os.environ.get("SILKGENESIS_ALLOWED_ORIGINS"):
    raise RuntimeError("SILKGENESIS_ALLOWED_ORIGINS must be set in production.")
ALLOWED_ORIGINS = [o.strip() for o in _allowed_origins_raw.split(",") if o.strip() and "*" not in o]
if not ALLOWED_ORIGINS:
    raise RuntimeError("SILKGENESIS_ALLOWED_ORIGINS must list at least one explicit origin.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "X-CSRF-Token"],
)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    """En production : pas de stack trace ni message brut dans la reponse JSON."""
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    try:
        from fastapi.exceptions import RequestValidationError

        if isinstance(exc, RequestValidationError):
            return JSONResponse(status_code=422, content={"detail": exc.errors()})
    except Exception:
        pass
    if IS_PRODUCTION:
        _log.warning(
            "unhandled_exception path=%s type=%s",
            getattr(request.url, "path", ""),
            type(exc).__name__,
        )
        return JSONResponse(status_code=500, content={"detail": "INTERNAL_ERROR"})
    _log.exception("unhandled_exception path=%s", getattr(request.url, "path", ""))
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.middleware("http")
async def enforce_admin_session(request: Request, call_next):
    """
    Enforce real bearer session auth for all /api/admin/* routes.
    This closes authorization gaps on endpoints that forgot Depends(get_current_session).
    """
    path = request.url.path or ""
    if path.startswith("/api/admin/"):
        if request.method == "OPTIONS":
            return await call_next(request)

        def _token_fingerprint(raw: str) -> str:
            if not raw:
                return "none"
            return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()[:16]

        def _rl_identity_for_abuse(auth_header: str, token: str) -> str:
            # Prefer stable per-token key when present; fall back to Tor/nginx client identity.
            if token:
                return f"tok:{_token_fingerprint(token)}"
            peer = request.client
            if peer and peer.host:
                return f"peer:{peer.host}:{peer.port}"
            return "peer:unknown"

        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            rl_id = _rl_identity_for_abuse(auth_header, "")
            if not check_rate_limit("admin_abuse", rl_id):
                retry = get_rate_limit_retry_after("admin_abuse", rl_id)
                log_security(
                    AuditEvent.ADMIN_ACCESS_RATE_LIMITED,
                    rl_id,
                    {"path": path, "method": request.method, "reason": "missing_bearer"},
                )
                return JSONResponse(
                    status_code=429,
                    headers={"Retry-After": str(retry)},
                    content={"detail": "RATE_LIMITED", "retry_after": retry},
                )
            log_security(
                AuditEvent.ADMIN_ACCESS_DENIED,
                rl_id,
                {"path": path, "method": request.method, "reason": "missing_bearer"},
            )
            return JSONResponse(status_code=401, content={"detail": "SESSION_TOKEN_REQUIRED"})

        token = auth_header.split(" ", 1)[1].strip()
        rl_id = _rl_identity_for_abuse(auth_header, token)

        session = validate_session(token)
        if not session:
            if not check_rate_limit("admin_abuse", rl_id):
                retry = get_rate_limit_retry_after("admin_abuse", rl_id)
                log_security(
                    AuditEvent.ADMIN_ACCESS_RATE_LIMITED,
                    rl_id,
                    {
                        "path": path,
                        "method": request.method,
                        "reason": "invalid_session",
                        "session_fp": _token_fingerprint(token),
                    },
                )
                return JSONResponse(
                    status_code=429,
                    headers={"Retry-After": str(retry)},
                    content={"detail": "RATE_LIMITED", "retry_after": retry},
                )
            log_security(
                AuditEvent.ADMIN_ACCESS_DENIED,
                rl_id,
                {
                    "path": path,
                    "method": request.method,
                    "reason": "invalid_session",
                    "session_fp": _token_fingerprint(token),
                },
            )
            return JSONResponse(status_code=401, content={"detail": "INVALID_SESSION"})

        if session.get("role") != "admin":
            if not check_rate_limit("admin_abuse", rl_id):
                retry = get_rate_limit_retry_after("admin_abuse", rl_id)
                log_security(
                    AuditEvent.ADMIN_ACCESS_RATE_LIMITED,
                    session.get("username") or rl_id,
                    {
                        "path": path,
                        "method": request.method,
                        "reason": "forbidden_non_admin",
                        "role": session.get("role"),
                    },
                )
                return JSONResponse(
                    status_code=429,
                    headers={"Retry-After": str(retry)},
                    content={"detail": "RATE_LIMITED", "retry_after": retry},
                )
            log_security(
                AuditEvent.ADMIN_ACCESS_DENIED,
                session.get("username") or "unknown",
                {
                    "path": path,
                    "method": request.method,
                    "reason": "forbidden_non_admin",
                    "role": session.get("role"),
                },
            )
            return JSONResponse(status_code=403, content={"detail": "ADMIN_ONLY"})

        def _exempt_admin_2fa(p: str) -> bool:
            p = (p or "").rstrip("/") or "/"
            if p in ("/api/admin/panel-unlock", "/api/admin/unlock-status"):
                return True
            # Category CRUD: protected by admin session only; Control panel keeps TOTP step-up.
            if p.startswith("/api/admin/categories"):
                return True
            return False

        if not _exempt_admin_2fa(path):
            uname = session.get("username")
            if _is_test_godmode_username(uname):
                return await call_next(request)
            uadmin = users_db.get(uname) or {}
            if not uadmin.get("totp_enabled"):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "ADMIN_2FA_SETUP_REQUIRED"},
                )
            until = float(session.get("admin_unlock_until") or 0)
            if until <= time.time():
                return JSONResponse(
                    status_code=403,
                    content={"detail": "ADMIN_2FA_STEP_UP_REQUIRED"},
                )
    return await call_next(request)

# ============================================================
# CACHE EN MEMOIRE - Evite les recalculs couteux
# ============================================================
_cache = {}
_cache_ttl = {}

def cache_get(key: str):
    """Recuperer une valeur du cache si elle n'est pas expiree"""
    if key in _cache and time.time() < _cache_ttl.get(key, 0):
        return _cache[key]
    return None

def cache_set(key: str, value, ttl_seconds: int = 30):
    """Stocker une valeur dans le cache"""
    _cache[key] = value
    _cache_ttl[key] = time.time() + ttl_seconds

def cache_invalidate(key: str):
    """Invalider une entree du cache"""
    _cache.pop(key, None)
    _cache_ttl.pop(key, None)

# STOCKAGE EN MEMOIRE (simple pour commencer)
users_db = {}
listings_db = {}
categories_db = [
    # DRUGS
    {"id": "drugs", "name": "Drugs", "parent": None, "icon": "💊"},
    {"id": "cannabis", "name": "Cannabis", "parent": "Drugs", "icon": "🌿"},
    {"id": "stimulants", "name": "Stimulants", "parent": "Drugs", "icon": "⚡"},
    {"id": "psychedelics", "name": "Psychedelics", "parent": "Drugs", "icon": "🍄"},
    {"id": "opioids", "name": "Opioids", "parent": "Drugs", "icon": "💉"},
    {"id": "benzos", "name": "Benzos", "parent": "Drugs", "icon": "💊"},
    {"id": "dissociatives", "name": "Dissociatives", "parent": "Drugs", "icon": "🌀"},
    {"id": "empathogens", "name": "Empathogens", "parent": "Drugs", "icon": "❤️"},
    {"id": "steroids", "name": "Steroids", "parent": "Drugs", "icon": "💪"},
    {"id": "prescription", "name": "Prescription", "parent": "Drugs", "icon": "🏥"},
    # FRAUD
    {"id": "fraud", "name": "Fraud", "parent": None, "icon": "💳"},
    {"id": "carding", "name": "Carding", "parent": "Fraud", "icon": "💳"},
    {"id": "bank_accounts", "name": "Bank Accounts", "parent": "Fraud", "icon": "🏦"},
    {"id": "paypal", "name": "PayPal / Cashapp", "parent": "Fraud", "icon": "💰"},
    {"id": "identity", "name": "Identity Docs", "parent": "Fraud", "icon": "🪪"},
    {"id": "counterfeit", "name": "Counterfeit", "parent": "Fraud", "icon": "🖨️"},
    # DIGITAL
    {"id": "digital", "name": "Digital Goods", "parent": None, "icon": "💻"},
    {"id": "accounts", "name": "Accounts", "parent": "Digital Goods", "icon": "🔑"},
    {"id": "malware", "name": "Malware / RATs", "parent": "Digital Goods", "icon": "🦠"},
    {"id": "exploits", "name": "Exploits / 0day", "parent": "Digital Goods", "icon": "🔓"},
    {"id": "ebooks", "name": "eBooks / Guides", "parent": "Digital Goods", "icon": "📚"},
    {"id": "software", "name": "Software / Keys", "parent": "Digital Goods", "icon": "🔐"},
    # SERVICES
    {"id": "services", "name": "Services", "parent": None, "icon": "🛠️"},
    {"id": "hacking", "name": "Hacking", "parent": "Services", "icon": "💻"},
    {"id": "ddos", "name": "DDoS", "parent": "Services", "icon": "⚡"},
    {"id": "money_laundering", "name": "Money Laundering", "parent": "Services", "icon": "🧹"},
    {"id": "mixing", "name": "Crypto Mixing", "parent": "Services", "icon": "🔄"},
    {"id": "escrow_service", "name": "Escrow Service", "parent": "Services", "icon": "🔒"},
    # WEAPONS
    # OTHER
    {"id": "other", "name": "Other", "parent": None, "icon": "📦"},
    {"id": "jewelry", "name": "Jewelry / Luxury", "parent": "Other", "icon": "💎"},
    {"id": "electronics", "name": "Electronics", "parent": "Other", "icon": "📱"},
]

FORBIDDEN_CATEGORY_NAMES = {"weapons", "firearms", "ammunition", "knives / blades"}

def _cleanup_forbidden_categories_and_listings():
    """Remove forbidden categories/listings from runtime state and persist."""
    global categories_db
    categories_db = [
        c for c in categories_db
        if str(c.get("name") or "").strip().lower() not in FORBIDDEN_CATEGORY_NAMES
        and str(c.get("parent") or "").strip().lower() not in FORBIDDEN_CATEGORY_NAMES
    ]

    to_delete = []
    for lid, listing in listings_db.items():
        cat_name = str(listing.get("category", "")).strip().lower()
        if cat_name in FORBIDDEN_CATEGORY_NAMES:
            to_delete.append(lid)
    for lid in to_delete:
        del listings_db[lid]

    save_all_categories(categories_db)
    save_all_listings(listings_db)
orders_db = {}
chat_db = {}  # {order_id: [messages]} - Chat escrow lie aux orders
general_chat_db = {}  # {buyer_vendor: [messages]} - Chat general buyer-vendor
seller_requests = []
reviews_db = {}  # {vendor_username: [reviews]}
disputes_db = {}  # {dispute_id: dispute_data}
referrals_db = {}  # {referral_code: {owner, uses, earnings}}

# ============================================================
# VENDOR LEVELS SYSTEM
# ============================================================
# Tiers: progression par nombre de ventes (settlement). min_xmr=0 : le palier ne bloque pas sur le volume.
VENDOR_LEVELS = [
    {"name": "Newcomer",  "icon": "🆕", "min_sales": 0,    "min_xmr": 0,    "commission": 0.08,  "color": "#888"},
    {"name": "Bronze",    "icon": "🥉", "min_sales": 50,   "min_xmr": 0,    "commission": 0.07,  "color": "#cd7f32"},
    {"name": "Silver",    "icon": "🥈", "min_sales": 100,  "min_xmr": 0,    "commission": 0.06,  "color": "#c0c0c0"},
    {"name": "Gold",      "icon": "🥇", "min_sales": 300,  "min_xmr": 0,    "commission": 0.05,  "color": "#ffd700"},
    {"name": "Platinum",  "icon": "💎", "min_sales": 600,  "min_xmr": 0,    "commission": 0.035, "color": "#e5e4e2"},
    {"name": "Elite",     "icon": "👑", "min_sales": 1200, "min_xmr": 0,    "commission": 0.02,  "color": "#ff6b35"},
]

def get_vendor_level(username):
    """Calcule le niveau d'un vendor base sur ses ventes et volume"""
    user = users_db.get(username, {})
    total_sales = user.get("total_sales", 0)
    total_volume_xmr = user.get("total_volume_xmr", 0.0)
    level = VENDOR_LEVELS[0]
    for lvl in VENDOR_LEVELS:
        if total_sales >= lvl["min_sales"] and total_volume_xmr >= lvl["min_xmr"]:
            level = lvl
    return level

def update_vendor_stats(vendor_username, amount_xmr):
    """Update les stats du vendor apres une vente"""
    if vendor_username in users_db:
        users_db[vendor_username]["total_sales"] = users_db[vendor_username].get("total_sales", 0) + 1
        users_db[vendor_username]["total_volume_xmr"] = users_db[vendor_username].get("total_volume_xmr", 0.0) + amount_xmr


def _platform_liquidity_account() -> Optional[str]:
    """Compte interne XMR = liquidite site (commissions, bonds, etc.). Prefere l'utilisateur 'admin'."""
    u = users_db.get("admin")
    if u and u.get("role") == "admin":
        return "admin"
    for uname, u in users_db.items():
        if u.get("role") == "admin":
            return uname
    return None


def _credit_platform_liquidity_xmr(amount: float) -> None:
    with funds_rlock:
        key = _platform_liquidity_account()
        if not key:
            raise RuntimeError("NO_PLATFORM_ACCOUNT")
        users_db[key]["balance"] = round(float(users_db[key].get("balance", 0)) + float(amount), 8)


def _debit_platform_liquidity_xmr(amount: float) -> None:
    with funds_rlock:
        key = _platform_liquidity_account()
        if not key:
            raise RuntimeError("NO_PLATFORM_ACCOUNT")
        users_db[key]["balance"] = round(float(users_db[key].get("balance", 0)) - float(amount), 8)


def _settle_order_funds_to_vendor(
    vendor: str,
    amount_xmr: float,
    buyer: Optional[str] = None,
    order_id: Optional[str] = None,
) -> dict:
    """
    Escrow settlement: marketplace fee by vendor tier; 55% of fee to affiliate tree + vendor referrer,
    45% of fee to platform liquidity. Net sale proceeds -> vendor balance.
    """
    with funds_rlock:
        level = get_vendor_level(vendor)
        rate = float(level.get("commission", 0.08))
        commission_xmr = round(float(amount_xmr) * rate, 8)
        net_xmr = round(float(amount_xmr) - commission_xmr, 8)
        if net_xmr < 0:
            net_xmr = 0.0
        key = _platform_liquidity_account()
        if not key:
            raise RuntimeError("NO_PLATFORM_ACCOUNT")

        aff = apply_affiliate_payouts(
            users_db,
            buyer,
            vendor,
            commission_xmr,
            float(amount_xmr),
            order_id or "",
        )
        platform_slice = float(aff.get("platform_net_commission_xmr") or 0)
        users_db[key]["balance"] = round(
            float(users_db[key].get("balance", 0)) + platform_slice, 8
        )
        if vendor in users_db:
            users_db[vendor]["balance"] = round(
                float(users_db[vendor].get("balance", 0)) + net_xmr, 8
            )
            update_vendor_stats(vendor, float(amount_xmr))
        save_users_persist()
        return {
            "level_name": level.get("name", ""),
            "commission_rate": rate,
            "commission_pct": round(rate * 100, 2),
            "commission_xmr": commission_xmr,
            "net_xmr": net_xmr,
            "affiliate": aff,
            "platform_commission_kept_xmr": platform_slice,
        }


# ============================================================
# AUTO-FINALIZE SYSTEM
# ============================================================
AUTO_FINALIZE_DAYS = 7  # Nombre de jours avant auto-finalisation

def auto_finalize_orders():
    """Thread qui checks et finalise automatiquement les orders expirees"""
    while True:
        try:
            now = datetime.utcnow()
            for order_id, order in list(orders_db.items()):
                if order["status"] == "shipped":
                    shipped_at_str = order.get("shipped_at")
                    if shipped_at_str:
                        shipped_at = datetime.fromisoformat(shipped_at_str)
                        days_elapsed = (now - shipped_at).total_seconds() / 86400
                        if days_elapsed >= AUTO_FINALIZE_DAYS:
                            s = None
                            with funds_rlock:
                                cur = orders_db.get(order_id)
                                if not cur or cur.get("status") != "shipped":
                                    continue
                                vendor = cur.get("vendor")
                                amount = float(cur.get("amount_xmr", 0))
                                try:
                                    s = _settle_order_funds_to_vendor(
                                        vendor,
                                        amount,
                                        buyer=cur.get("buyer"),
                                        order_id=order_id,
                                    )
                                except RuntimeError:
                                    _dev_print(f"[AUTO-FINALIZE] Skip {order_id}: no platform liquidity account")
                                    continue
                                except Exception as e:
                                    _dev_print(f"[AUTO-FINALIZE] Error settling {order_id}: {e}")
                                    continue
                                cur["status"] = "completed"
                                cur["auto_finalized"] = True
                                cur["completed_at"] = now.isoformat()
                                cur["settlement"] = s
                                save_order(order_id, cur)
                            if not s:
                                continue
                            if order_id not in chat_db:
                                chat_db[order_id] = []
                            chat_db[order_id].append({
                                "id": len(chat_db[order_id]) + 1,
                                "sender": "SYSTEM",
                                "message": (
                                    f"⏰ AUTO-FINALIZED after {AUTO_FINALIZE_DAYS} d. "
                                    f"Net {s.get('net_xmr', 0):.6f} XMR -> vendor, "
                                    f"commission {s.get('commission_xmr', 0):.6f} XMR -> site liquidity "
                                    f"({s.get('commission_pct', 0):.1f}%, {s.get('level_name', '')})."
                                ),
                                "timestamp": now.isoformat(),
                                "is_system": True
                            })
                            _dev_print(
                                f"[AUTO-FINALIZE] {order_id} -> vendor net {s.get('net_xmr')} XMR, "
                                f"liquidity +{s.get('commission_xmr')} XMR"
                            )
        except Exception as e:
            _dev_print(f"[AUTO-FINALIZE ERROR] {e}")
        time.sleep(3600)  # Check toutes les heures

# Start le thread auto-finalize
auto_finalize_thread = threading.Thread(target=auto_finalize_orders, daemon=True)
auto_finalize_thread.start()
_dev_print("[OK] Auto-finalize thread started (7 days)")

# ============================================================
# AUTO-WIPE - Deletion data ephemeres apres 7 jours
# Messages et adresses de livraison lies aux orders
# completed/cancelled sont supprimes apres 168h
# ============================================================
AUTO_WIPE_HOURS = 168  # 7 jours

def auto_wipe_ephemeral_data():
    """Thread that removes sensitive data from completed orders"""
    while True:
        try:
            now = datetime.utcnow()
            wiped_count = 0
            for order_id, order in list(orders_db.items()):
                if order.get("status") in ("completed", "cancelled"):
                    end_date_str = order.get("completed_at") or order.get("cancelled_at")
                    if not end_date_str:
                        continue
                    try:
                        end_date = datetime.fromisoformat(end_date_str)
                    except Exception:
                        continue
                    hours_elapsed = (now - end_date).total_seconds() / 3600
                    if hours_elapsed >= AUTO_WIPE_HOURS:
                        # WIPE: Delete messages du chat de cette order
                        if order_id in chat_db:
                            del chat_db[order_id]
                            wiped_count += 1
                        # WIPE: Delete the delivery address
                        if "delivery_address" in orders_db[order_id]:
                            orders_db[order_id]["delivery_address"] = "[WIPED]"
                        # WIPE: Delete les data personnelles
                        for field in ["buyer_address", "shipping_info", "personal_info"]:
                            if field in orders_db[order_id]:
                                orders_db[order_id][field] = "[WIPED]"
                        orders_db[order_id]["data_wiped"] = True
                        orders_db[order_id]["wiped_at"] = now.isoformat()
            if wiped_count > 0:
                _dev_print(f"[AUTO-WIPE] {wiped_count} orders nettoyees (data ephemeres supprimees)")
        except Exception as e:
            _dev_print(f"[AUTO-WIPE ERROR] {e}")
        time.sleep(3600)  # Verifier toutes les heures

# Demarrer le thread auto-wipe
auto_wipe_thread = threading.Thread(target=auto_wipe_ephemeral_data, daemon=True)
auto_wipe_thread.start()
_dev_print("[OK] Auto-wipe thread started (168h / 7 days)")


# ============================================================
# REFERRAL SYSTEM
# ============================================================
REFERRAL_BONUS_REFEREE = 0.01   # XMR bonus pour le nouveau (0.01 XMR)
REFERRAL_BONUS_REFERRER = 0.005  # XMR bonus pour le parrain (0.005 XMR)

# Volume mini (XMR) qu'un filleul doit avoir reellement achete avant
# que le bonus referral soit credite (anti-sybil).
REFERRAL_QUALIFY_MIN_VOLUME = float(
    os.environ.get("SILKGENESIS_REFERRAL_MIN_VOLUME_XMR", "0.05")
)


def _credit_referral_on_purchase(buyer_username: str, order_total_xmr: float) -> None:
    """
    A appeler lors qu'une commande passe en 'completed'. Credite le bonus
    referral UNE SEULE FOIS, et seulement si le filleul a depasse le seuil
    REFERRAL_QUALIFY_MIN_VOLUME en achats finalises.
    """
    try:
        if not buyer_username or buyer_username not in users_db:
            return
        buyer = users_db[buyer_username]
        owner = buyer.get("referred_by")
        if not owner or owner not in users_db:
            return
        if buyer.get("referral_bonus_credited"):
            return

        # Met a jour le volume "qualifie"
        new_vol = float(buyer.get("referral_qualified_volume_xmr", 0.0)) + float(order_total_xmr or 0.0)
        buyer["referral_qualified_volume_xmr"] = new_vol
        if new_vol < REFERRAL_QUALIFY_MIN_VOLUME:
            return

        with funds_rlock:
            users_db[buyer_username]["balance"] = float(buyer.get("balance", 0.0)) + REFERRAL_BONUS_REFEREE
            users_db[owner]["balance"] = float(users_db[owner].get("balance", 0.0)) + REFERRAL_BONUS_REFERRER
            buyer["referral_bonus_credited"] = True

            # Met a jour la table des referrals : marquer comme credite
            for code, info in referrals_db.items():
                if info.get("owner") == owner:
                    info["uses"] = int(info.get("uses", 0)) + 1
                    info["earnings_xmr"] = float(info.get("earnings_xmr", 0.0)) + REFERRAL_BONUS_REFERRER
                    for r in info.get("referrals", []):
                        if r.get("username") == buyer_username:
                            r["credited"] = True
                            r["credited_at"] = datetime.utcnow().isoformat()
                    break
        save_users_persist()
        log("REFERRAL_CREDITED", buyer_username, {"owner": owner, "volume_xmr": new_vol})
    except Exception as e:
        try:
            _log.error("referral credit failed: %s", type(e).__name__)
        except Exception:
            pass
REFERRAL_COMMISSION_RATE = 0.02  # 2% des achats du filleul pendant 30 jours

def generate_referral_code(username):
    """Genere un code de parrainage unique"""
    code = f"SG-{username[:4].upper()}-{secrets.token_hex(3).upper()}"
    if code not in referrals_db:
        referrals_db[code] = {
            "code": code,
            "owner": username,
            "uses": 0,
            "earnings_xmr": 0.0,
            "referrals": [],
            "created_at": datetime.utcnow().isoformat()
        }
    return code

def generate_xmr_address():
    return f"4{secrets.token_hex(47)}"

def generate_escrow_address():
    return f"ESCROW_{secrets.token_hex(32)}"

def get_or_create_order_subaddress(order_id: str):
    """
    Return a deterministic on-chain subaddress for an order.
    - Reuses existing xmr_subaddress when present.
    - Creates one via Monero RPC when available.
    - In production, never falls back to simulated addresses.
    """
    order = orders_db.get(order_id)
    if not order:
        return None

    existing = order.get("xmr_subaddress")
    if isinstance(existing, str) and existing.startswith("8") and len(existing) > 90:
        return {
            "address": existing,
            "rpc_online": True,
            "reused": True,
        }

    try:
        from monero_rpc import MoneroRPC
        rpc = MoneroRPC()
        result = rpc.create_subaddress(account_index=0, label=f"order_{order_id}")
        if result and result.get("address"):
            addr = result["address"]
            if isinstance(addr, str) and addr.startswith("8"):
                return {
                    "address": addr,
                    "address_index": result.get("address_index", 0),
                    "rpc_online": True,
                    "reused": False,
                }
    except Exception as e:
        _dev_print(f"[WALLET] Order subaddress RPC failed for {order_id}: {e}")

    if IS_PRODUCTION:
        return None

    return {
        "address": generate_xmr_address(),
        "address_index": None,
        "rpc_online": False,
        "reused": False,
        "simulated": True,
    }

# INITIALISER LES TOP VENDORS ET PRODUITS
def init_demo_data():
    """Create 8 top vendors avec des produits"""
    
    # CREER UN COMPTE ADMIN BOOTSTRAP (sans credentials hardcodes)
    if "admin" not in users_db:
        bootstrap_admin_password = os.environ.get("SILKGENESIS_BOOTSTRAP_ADMIN_PASSWORD")
        if not bootstrap_admin_password:
            if IS_PRODUCTION:
                raise RuntimeError(
                    "Missing SILKGENESIS_BOOTSTRAP_ADMIN_PASSWORD in production."
                )
            bootstrap_admin_password = generate_secure_password(24)
            _dev_print(
                "[SECURITY] Generated temporary admin bootstrap password for development. "
                "Set SILKGENESIS_BOOTSTRAP_ADMIN_PASSWORD explicitly."
            )
        users_db["admin"] = {
            "username": "admin",
            "password": bootstrap_admin_password,  # hashed at startup by migrate_users_passwords()
            "role": "admin",
            "status": "active",
            "balance": 0.0,
            "xmr_address": generate_xmr_address(),
            "avatar": None,
            "pos": 0,
            "rating": 5.0
        }
        _dev_print("[INFO] Admin bootstrap account created.")
    
    top_vendors = [
        {"username": "DarkPharmacy",   "sales": 18, "rating": 4.8, "volume": 12.4},
        {"username": "CryptoKing",     "sales": 14, "rating": 4.6, "volume": 8.7},
        {"username": "SilkMaster",     "sales": 20, "rating": 4.9, "volume": 15.2},
        {"username": "GreenLeaf",      "sales": 11, "rating": 4.7, "volume": 5.3},
        {"username": "PsychedelicPro", "sales": 9,  "rating": 4.5, "volume": 4.1},
        {"username": "PharmaDirect",   "sales": 16, "rating": 4.8, "volume": 9.8},
        {"username": "DigitalGoods",   "sales": 13, "rating": 4.4, "volume": 3.6},
        {"username": "SecureServices", "sales": 7,  "rating": 4.6, "volume": 6.2},
    ]
    
    for vendor in top_vendors:
        if vendor["username"] not in users_db:
            users_db[vendor["username"]] = {
                "username": vendor["username"],
                "password": "demo123",
                "role": "vendor",
                "status": "active",
                "balance": 0.0,
                "xmr_address": generate_xmr_address(),
                "avatar": None,
                "pos": vendor["sales"],
                "rating": vendor["rating"]
            }
    
    # Create des produits pour chaque vendor avec images - TOUTES LES CATEGORIES
    products = [
        # ===== CANNABIS =====
        {"vendor": "GreenLeaf", "title": "OG Kush Premium 28g", "price": 0.35, "cat": "Cannabis", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Top-shelf OG Kush, dense buds with heavy trichome coverage. Earthy pine aroma. Vacuum sealed, stealth shipping worldwide."},
        {"vendor": "GreenLeaf", "title": "Girl Scout Cookies 14g", "price": 0.2, "cat": "Cannabis", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "GSC hybrid strain, sweet and earthy flavor profile. Perfect for relaxation. Discreet packaging guaranteed."},
        {"vendor": "GreenLeaf", "title": "Blue Dream Sativa 7g", "price": 0.12, "cat": "Cannabis", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Blue Dream sativa dominant hybrid. Uplifting cerebral high. Great for daytime use. Lab tested 22% THC."},
        {"vendor": "GreenLeaf", "title": "Hash Moroccan Prestige 10g", "price": 0.15, "cat": "Cannabis", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Authentic Moroccan hash, hand-pressed. Rich and smooth smoke. Imported directly from source."},

        # ===== STIMULANTS =====
        {"vendor": "DarkPharmacy", "title": "Cocaine HCl 99% Pure 1g", "price": 0.85, "cat": "Stimulants", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Laboratory grade cocaine hydrochloride, 99% purity verified by reagent test. Fishscale quality. Stealth shipping."},
        {"vendor": "DarkPharmacy", "title": "MDMA Crystal 0.5g", "price": 0.32, "cat": "Stimulants", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Premium MDMA crystals, 85%+ purity. Tested with Marquis reagent. Strong and clean roll. EU origin."},
        {"vendor": "DarkPharmacy", "title": "Speed Paste 5g", "price": 0.18, "cat": "Stimulants", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "High quality amphetamine paste, 60%+ purity. Vacuum sealed for freshness. Discreet EU shipping."},
        {"vendor": "CryptoKing", "title": "Meth Crystal 1g", "price": 0.55, "cat": "Stimulants", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "High purity crystal methamphetamine. Ice quality, clear shards. Tested and verified. Stealth packaging."},

        # ===== PSYCHEDELICS =====
        {"vendor": "PsychedelicPro", "title": "LSD Blotter 100ug x10", "price": 0.25, "cat": "Psychedelics", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "High quality LSD blotters, 100ug each. Tested with Ehrlich reagent. Artwork printed tabs. 10 tabs per order."},
        {"vendor": "PsychedelicPro", "title": "Magic Mushrooms Cubensis 7g", "price": 0.18, "cat": "Psychedelics", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Psilocybe cubensis, dried and vacuum sealed. Golden Teacher strain. Potent and reliable. 7g = 1 oz."},
        {"vendor": "PsychedelicPro", "title": "DMT Freebase 0.5g", "price": 0.45, "cat": "Psychedelics", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "N,N-DMT freebase, high purity. White/yellow crystals. Tested with Ehrlich. Breakthrough doses included."},
        {"vendor": "PsychedelicPro", "title": "2C-B 20mg x5 pills", "price": 0.38, "cat": "Psychedelics", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "2C-B pressed pills, 20mg each. Tested and verified. Euphoric psychedelic experience. 5 pills per order."},

        # ===== OPIOIDS =====
        {"vendor": "SilkMaster", "title": "Heroin #4 White 1g", "price": 0.95, "cat": "Opioids", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Afghan heroin #4, white powder, high purity. Tested with Mecke reagent. Stealth international shipping."},
        {"vendor": "SilkMaster", "title": "Oxycodone 80mg x20", "price": 0.72, "cat": "Opioids", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Oxycodone HCl 80mg tablets. Pharmaceutical grade. 20 pills per order. Discreet packaging."},
        {"vendor": "PharmaDirect", "title": "Fentanyl Patches 50mcg x5", "price": 0.65, "cat": "Opioids", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Fentanyl transdermal patches 50mcg/h. Pharmaceutical brand. 5 patches per order. Sealed in original packaging."},

        # ===== BENZOS =====
        {"vendor": "PharmaDirect", "title": "Xanax 2mg x100 bars", "price": 0.55, "cat": "Benzos", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Alprazolam 2mg bars (Xanax). Pharmaceutical grade. 100 pills per order. Pressed with correct markings."},
        {"vendor": "PharmaDirect", "title": "Diazepam 10mg x50", "price": 0.22, "cat": "Benzos", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Valium 10mg tablets. Pharmaceutical quality. 50 pills per order. Anxiety and sleep aid."},
        {"vendor": "PharmaDirect", "title": "Clonazepam 2mg x50", "price": 0.28, "cat": "Benzos", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Klonopin 2mg tablets. High quality pharmaceutical. 50 pills. Long-acting benzo, smooth effect."},

        # ===== PRESCRIPTION =====
        {"vendor": "PharmaDirect", "title": "Adderall XR 30mg x30", "price": 0.42, "cat": "Prescription", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Adderall XR 30mg capsules. Pharmaceutical grade amphetamine salts. 30 capsules. Focus and productivity."},
        {"vendor": "PharmaDirect", "title": "Modafinil 200mg x30", "price": 0.15, "cat": "Prescription", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Modafinil 200mg tablets. Wakefulness agent. 30 tabs. No prescription needed. Worldwide shipping."},
        {"vendor": "DarkPharmacy", "title": "Tramadol 100mg x50", "price": 0.18, "cat": "Prescription", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Tramadol HCl 100mg tablets. Pain management. 50 pills per order. Discreet packaging."},

        # ===== DISSOCIATIVES =====
        {"vendor": "PsychedelicPro", "title": "Ketamine HCl 1g", "price": 0.65, "cat": "Dissociatives", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Pharmaceutical grade ketamine HCl. White crystalline powder. Tested for purity. Anesthetic quality."},
        {"vendor": "PsychedelicPro", "title": "PCP 0.5g", "price": 0.48, "cat": "Dissociatives", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Phencyclidine 0.5g. High purity. Tested with reagent. Powerful dissociative experience."},

        # ===== EMPATHOGENS =====
        {"vendor": "DarkPharmacy", "title": "MDMA Powder 1g", "price": 0.45, "cat": "Empathogens", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Pure MDMA powder, 85%+ purity. Tested with Marquis reagent. Euphoric and empathogenic effects."},
        {"vendor": "PsychedelicPro", "title": "MDA 100mg x5 caps", "price": 0.35, "cat": "Empathogens", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "MDA capsules 100mg each. Tested and verified. More psychedelic than MDMA. 5 caps per order."},

        # ===== STEROIDS =====
        {"vendor": "SecureServices", "title": "Testosterone Enanthate 250mg/ml 10ml", "price": 0.25, "cat": "Steroids", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Pharmaceutical grade Testosterone Enanthate 250mg/ml. 10ml vial. Lab tested. Bodybuilding grade."},
        {"vendor": "SecureServices", "title": "Anavar 50mg x100 tabs", "price": 0.38, "cat": "Steroids", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Oxandrolone 50mg tablets. 100 tabs per order. Lean muscle gains, minimal side effects. Lab verified."},
        {"vendor": "SecureServices", "title": "HGH Somatropin 100IU kit", "price": 1.85, "cat": "Steroids", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Human Growth Hormone 100IU kit. Pharmaceutical grade. Anti-aging and muscle building. Cold chain shipping."},

        # ===== CARDING =====
        {"vendor": "CryptoKing", "title": "CC Fullz USA x10 Fresh", "price": 0.12, "cat": "Carding", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "10x USA credit card fullz. Includes: CC#, CVV, expiry, name, address, SSN, DOB. Fresh and valid. High balance."},
        {"vendor": "CryptoKing", "title": "EU Visa/MC Dumps x5", "price": 0.18, "cat": "Carding", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "5x European Visa/Mastercard dumps with PIN. Track 1+2. High balance cards. Germany, France, UK."},
        {"vendor": "CryptoKing", "title": "Skimmer Device Pro", "price": 0.95, "cat": "Carding", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Professional ATM skimmer device. Bluetooth enabled. Includes pinhole camera. Easy installation guide."},

        # ===== BANK ACCOUNTS =====
        {"vendor": "CryptoKing", "title": "Chase Bank Account $15k balance", "price": 0.35, "cat": "Bank Accounts", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Verified Chase bank account with $15,000+ balance. Full access credentials. Online banking enabled. USA."},
        {"vendor": "CryptoKing", "title": "Wells Fargo Business Account", "price": 0.55, "cat": "Bank Accounts", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Wells Fargo business account, $50k+ balance. Full access. Wire transfer enabled. Aged account."},

        # ===== PAYPAL / CASHAPP =====
        {"vendor": "DigitalGoods", "title": "PayPal Account $5000 Verified", "price": 0.15, "cat": "PayPal / Cashapp", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Verified PayPal account with $5000 balance. Full access. Email and password included. Instant delivery."},
        {"vendor": "DigitalGoods", "title": "CashApp $2000 Flip", "price": 0.08, "cat": "PayPal / Cashapp", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "CashApp account with $2000 balance. Verified identity. Instant transfer available. USA accounts only."},

        # ===== IDENTITY DOCS =====
        {"vendor": "SilkMaster", "title": "USA Passport Scan + Template", "price": 0.45, "cat": "Identity Docs", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "High quality USA passport scan template. Editable PSD file. Perfect for KYC bypass. Photoshop included."},
        {"vendor": "SilkMaster", "title": "EU Driver License Template", "price": 0.28, "cat": "Identity Docs", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "European driver license editable template. Multiple countries available. High resolution PSD. KYC ready."},
        {"vendor": "SilkMaster", "title": "SSN + DOB Fullz x5", "price": 0.22, "cat": "Identity Docs", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "5x USA Social Security Numbers with full identity. Name, DOB, address, SSN. Fresh and valid. Credit check ready."},

        # ===== COUNTERFEIT =====
        {"vendor": "SilkMaster", "title": "USD $100 Bills x20 (Prop)", "price": 0.65, "cat": "Counterfeit", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "High quality prop USD $100 bills. 20 bills = $2000 face value. Passes UV and pen test. Discreet shipping."},
        {"vendor": "SilkMaster", "title": "EUR €50 Bills x30 (Prop)", "price": 0.55, "cat": "Counterfeit", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Prop Euro bills €50 denomination. 30 bills. High quality print. Watermark and security thread included."},

        # ===== ACCOUNTS =====
        {"vendor": "DigitalGoods", "title": "Netflix Premium 4K x1 Year", "price": 0.02, "cat": "Accounts", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Netflix Premium 4K UHD account. 1 year subscription. 4 screens simultaneously. Instant delivery."},
        {"vendor": "DigitalGoods", "title": "Spotify Premium Lifetime", "price": 0.015, "cat": "Accounts", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Spotify Premium lifetime account. No ads, offline mode, unlimited skips. Instant delivery."},
        {"vendor": "DigitalGoods", "title": "OnlyFans Creator Account Verified", "price": 0.08, "cat": "Accounts", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Verified OnlyFans creator account. ID verified, payout enabled. Ready to monetize. Full access."},
        {"vendor": "DigitalGoods", "title": "Amazon Prime + AWS Credits $500", "price": 0.12, "cat": "Accounts", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Amazon Prime account with $500 AWS credits. Full access. Prime Video, Music, Delivery included."},

        # ===== MALWARE / RATS =====
        {"vendor": "CryptoKing", "title": "AsyncRAT Builder + Crypter", "price": 0.35, "cat": "Malware / RATs", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "AsyncRAT with custom crypter. FUD (Fully Undetectable). Remote access, keylogger, screenshot. Full source code."},
        {"vendor": "CryptoKing", "title": "Ransomware Kit LockBit Style", "price": 1.25, "cat": "Malware / RATs", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Custom ransomware kit. AES-256 encryption. Decryptor included. C2 panel. Affiliate program available."},
        {"vendor": "CryptoKing", "title": "Stealer Log x1000 Fresh", "price": 0.18, "cat": "Malware / RATs", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "1000 fresh stealer logs. Includes: passwords, cookies, crypto wallets, CC data. Sorted by country."},

        # ===== EXPLOITS / 0DAY =====
        {"vendor": "SecureServices", "title": "Windows 11 LPE 0day", "price": 2.5, "cat": "Exploits / 0day", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Local Privilege Escalation 0day for Windows 11. Unpatched. Full PoC code included. Escrow only."},
        {"vendor": "SecureServices", "title": "WordPress RCE Plugin Exploit", "price": 0.45, "cat": "Exploits / 0day", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Remote Code Execution exploit for popular WordPress plugin. Affects 500k+ sites. Full exploit code + tutorial."},

        # ===== EBOOKS / GUIDES =====
        {"vendor": "DigitalGoods", "title": "Carding Bible 2026 Edition", "price": 0.008, "cat": "eBooks / Guides", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Complete carding guide 2026. 300+ pages. CC fraud, cashout methods, money laundering. Updated monthly."},
        {"vendor": "DigitalGoods", "title": "OSINT Masterclass PDF", "price": 0.005, "cat": "eBooks / Guides", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Open Source Intelligence complete guide. Doxing, tracking, social engineering. 200+ pages with tools."},
        {"vendor": "DigitalGoods", "title": "Darknet Vendor Setup Guide", "price": 0.012, "cat": "eBooks / Guides", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Complete guide to becoming a darknet vendor. Stealth shipping, PGP, Monero, opsec. 150 pages."},

        # ===== SOFTWARE / KEYS =====
        {"vendor": "DigitalGoods", "title": "Windows 11 Pro OEM Key", "price": 0.008, "cat": "Software / Keys", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Genuine Windows 11 Pro OEM license key. Instant delivery. Lifetime activation. 1 PC."},
        {"vendor": "DigitalGoods", "title": "Adobe CC 2026 All Apps Crack", "price": 0.005, "cat": "Software / Keys", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Adobe Creative Cloud 2026 full crack. All apps included. Photoshop, Premiere, After Effects. No subscription."},
        {"vendor": "DigitalGoods", "title": "Office 365 Business Key x5", "price": 0.015, "cat": "Software / Keys", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Microsoft Office 365 Business keys. 5 licenses. 1TB OneDrive each. Teams, Word, Excel, Outlook."},

        # ===== HACKING =====
        {"vendor": "SecureServices", "title": "Instagram Account Hack Service", "price": 0.12, "cat": "Hacking", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Professional Instagram account takeover service. Any account. 24-48h delivery. Escrow protected."},
        {"vendor": "SecureServices", "title": "Email Account Recovery/Hack", "price": 0.08, "cat": "Hacking", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Gmail, Outlook, Yahoo account recovery. Any email provider. 12-24h. Full access delivered securely."},
        {"vendor": "SecureServices", "title": "Phone Number Spoof Service", "price": 0.05, "cat": "Hacking", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Caller ID spoofing service. Call from any number. 100 calls included. Worldwide. Instant setup."},

        # ===== DDOS =====
        {"vendor": "SecureServices", "title": "DDoS Attack 100Gbps 1 Hour", "price": 0.15, "cat": "DDoS", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Layer 4/7 DDoS attack service. 100Gbps power. 1 hour duration. Any target. Bypass Cloudflare."},
        {"vendor": "SecureServices", "title": "Stresser Panel 30 Days Access", "price": 0.22, "cat": "DDoS", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Premium stresser/booter panel. 30 days access. Unlimited attacks. 500Gbps capacity. API access included."},

        # ===== MONEY LAUNDERING =====
        {"vendor": "CryptoKing", "title": "BTC Tumbling Service 1 BTC", "price": 0.025, "cat": "Money Laundering", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Bitcoin tumbling/mixing service. 1 BTC capacity. 3 output addresses. 0.5% fee. No logs policy."},
        {"vendor": "CryptoKing", "title": "Cash to Crypto Conversion $10k", "price": 0.08, "cat": "Money Laundering", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Convert $10,000 cash to clean cryptocurrency. Multiple methods. 5% fee. Escrow protected service."},

        # ===== CRYPTO MIXING =====
        {"vendor": "CryptoKing", "title": "XMR Mixer Premium Service", "price": 0.018, "cat": "Crypto Mixing", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Monero mixing service. Untraceable XMR. Multiple output addresses. Time delay option. Zero logs."},
        {"vendor": "CryptoKing", "title": "ETH Tornado Cash Alternative", "price": 0.022, "cat": "Crypto Mixing", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Ethereum mixing service. Smart contract based. Fully decentralized. Up to 100 ETH per transaction."},

        # ===== ESCROW SERVICE =====
        {"vendor": "SecureServices", "title": "Escrow Service 1-10 XMR", "price": 0.005, "cat": "Escrow Service", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Third-party escrow service for darknet deals. 1-10 XMR range. 1% fee. Dispute resolution included."},

        # ===== FIREARMS =====
        {"vendor": "SilkMaster", "title": "Glock 19 Gen5 9mm", "price": 3.5, "cat": "Firearms", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Glock 19 Gen5 9mm pistol. Serialized, clean. Includes 2 magazines. Ships disassembled in parts."},
        {"vendor": "SilkMaster", "title": "AK-47 Parts Kit", "price": 2.8, "cat": "Firearms", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "AK-47 complete parts kit. All components. Ships in multiple packages. Assembly guide included."},

        # ===== AMMUNITION =====
        {"vendor": "SilkMaster", "title": "9mm FMJ 500 rounds", "price": 0.45, "cat": "Ammunition", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "9mm Full Metal Jacket 500 rounds. Factory sealed. Multiple brands available. Discreet shipping."},
        {"vendor": "SilkMaster", "title": ".223 Rem 200 rounds", "price": 0.38, "cat": "Ammunition", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": ".223 Remington 200 rounds. Brass cased. Suitable for AR-15. Factory ammo, sealed boxes."},

        # ===== KNIVES / BLADES =====
        {"vendor": "SilkMaster", "title": "Microtech OTF Automatic Knife", "price": 0.35, "cat": "Knives / Blades", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Microtech OTF automatic knife. 3.5\" blade. Aircraft aluminum handle. Restricted in many states."},
        {"vendor": "SilkMaster", "title": "Karambit Trainer + Live Blade Set", "price": 0.18, "cat": "Knives / Blades", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Karambit set: trainer + live blade. Stainless steel. Ring handle. Includes sheath. Worldwide shipping."},

        # ===== JEWELRY / LUXURY =====
        {"vendor": "DigitalGoods", "title": "Rolex Submariner Replica AAA+", "price": 0.85, "cat": "Jewelry / Luxury", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "Rolex Submariner 1:1 replica. Swiss movement. Sapphire crystal. Waterproof 100m. Comes with box and papers."},
        {"vendor": "DigitalGoods", "title": "Louis Vuitton Bag Replica Grade A", "price": 0.45, "cat": "Jewelry / Luxury", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "LV Neverfull MM replica. Grade A quality. Real leather. Correct hardware. Includes dust bag and receipt."},
        {"vendor": "DigitalGoods", "title": "Diamond Ring 2ct Lab Grown", "price": 1.2, "cat": "Jewelry / Luxury", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "2 carat lab grown diamond ring. GIA certified. 18k white gold setting. Comes with certificate."},

        # ===== ELECTRONICS =====
        {"vendor": "DigitalGoods", "title": "iPhone 16 Pro Unlocked", "price": 2.2, "cat": "Electronics", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "iPhone 16 Pro 256GB unlocked. All carriers. Sealed box. IMEI clean. Worldwide shipping available."},
        {"vendor": "DigitalGoods", "title": "MacBook Pro M4 16\" Sealed", "price": 5.5, "cat": "Electronics", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "MacBook Pro M4 16\" 32GB RAM 1TB SSD. Factory sealed. Space Black. Includes load and accessories."},
        {"vendor": "DigitalGoods", "title": "RTX 5090 GPU Sealed", "price": 3.8, "cat": "Electronics", "sales": 0,
         "img": _DEMO_LISTING_IMG_SVG,
         "desc": "NVIDIA RTX 5090 24GB GDDR7. Factory sealed. ASUS ROG Strix edition. Includes warranty card."},
    ]

    for prod in products:
        listing_id = f"LST_{secrets.token_hex(8)}"
        listings_db[listing_id] = {
            "id": listing_id,
            "title": prod["title"],
            "price_xmr": prod["price"],
            "category": prod["cat"],
            "vendor": prod["vendor"],
            "description": f"High quality product from trusted vendor {prod['vendor']}",
            "image": prod.get("img"),
            "status": "active",
            "sales": prod["sales"],
            "ship_from": "Worldwide",
            "stock": 999,
            "featured": False
        }

    # Reviews: vides au demarrage - seules les vraies reviews des buyers seront ajoutees


def _ensure_root_admin_account():
    """
    Compte administrateur racine du site : cree au premier boot si absent.
    Non supprime par le cleanup legacy (admin / admin1).
    Mot de passe : SILKGENESIS_ROOT_ADMIN_PASSWORD ou SILKGENESIS_BOOTSTRAP_ADMIN_PASSWORD.
    """
    uname = (os.environ.get("SILKGENESIS_ROOT_ADMIN_USERNAME") or "rootadmin").strip().lower()
    if not re.fullmatch(r"[a-z0-9_\-]+", uname) or len(uname) < 3 or len(uname) > 64:
        uname = "rootadmin"
    if uname in ("admin", "admin1"):
        uname = "rootadmin"
    pw = (
        os.environ.get("SILKGENESIS_ROOT_ADMIN_PASSWORD")
        or os.environ.get("SILKGENESIS_BOOTSTRAP_ADMIN_PASSWORD")
        or ""
    ).strip()
    if uname in users_db:
        if users_db[uname].get("role") != "admin":
            users_db[uname]["role"] = "admin"
        return
    if not pw:
        if IS_PRODUCTION:
            raise RuntimeError(
                "Compte root admin requis en production: definir SILKGENESIS_ROOT_ADMIN_PASSWORD "
                "ou SILKGENESIS_BOOTSTRAP_ADMIN_PASSWORD."
            )
        _dev_print("[WARNING] Compte root admin non cree (aucun mot de passe dans l'environnement).")
        return
    users_db[uname] = {
        "username": uname,
        "password": hash_password(pw),
        "role": "admin",
        "status": "active",
        "balance": 0.0,
        "xmr_address": generate_xmr_address(),
        "avatar": None,
        "pos": 0,
        "rating": 5.0,
    }
    _dev_print(f"[INFO] Compte root admin '{uname}' cree (premier demarrage).")


# ============================================================
# STARTUP: Load toutes les data depuis SQLite
# ============================================================

# 1. Load les users depuis SQLite (priorite sur init_demo_data)
_db_users = load_all_users()
if _db_users:
    users_db.update(_db_users)
    _dev_print(f"[DB] Restored {len(_db_users)} users from SQLite")
else:
    # Premiere fois: initialiser les data de demo et les sauvegarder
    init_demo_data()
    load_users_persist()  # Compatibility with the old JSON file
    save_all_users(users_db)
    _dev_print(f"[DB] Initialized {len(users_db)} users and saved to SQLite")

# 2. Load les listings depuis SQLite
_db_listings = load_all_listings()
if _db_listings:
    listings_db.update(_db_listings)
    _dev_print(f"[DB] Restored {len(_db_listings)} listings from SQLite")
else:
    # Premiere fois: initialiser les produits de demo
    if not _db_users:
        pass  # init_demo_data() deja appele ci-dessus
    else:
        init_demo_data()  # Create les produits demo
    save_all_listings(listings_db)
    _dev_print(f"[DB] Initialized {len(listings_db)} listings and saved to SQLite")

# 3. Load les categories depuis SQLite
_db_cats = load_all_categories()
if _db_cats:
    categories_db.clear()
    categories_db.extend(_db_cats)
    _dev_print(f"[DB] Restored {len(_db_cats)} categories from SQLite")
else:
    # Premiere fois: sauvegarder les categories par defaut
    save_all_categories(categories_db)
    _dev_print(f"[DB] Initialized {len(categories_db)} categories and saved to SQLite")

# 4. Demarrer le backup automatique SQLite (toutes les heures)
start_auto_backup()

# 5. MIGRATE PLAINTEXT PASSWORDS TO PBKDF2
_migrated = migrate_users_passwords(users_db)
if _migrated > 0:
    save_all_users(users_db)
    _dev_print(f'[SECURITY] Migrated {_migrated} passwords to PBKDF2-SHA256')

# 6. Load les listings vendors (JSON legacy - compatibility)
load_vendor_listings()

# 6.1 Nettoyage des vendors de demo:
# garder 5 vendors premium (badges founders actifs), delete les autres vendors fake.
_cleanup_demo_vendors_keep_five_founders()
# 6.1.b Deletion definitive des categories/listings interdits
_cleanup_forbidden_categories_and_listings()
save_all_users(users_db)
save_all_listings(listings_db)
save_users_persist()

# 6.2 Hard cleanup requested: remove default legacy admin accounts.
for _legacy_admin in ("admin", "admin1"):
    if _legacy_admin in users_db:
        del users_db[_legacy_admin]

# 6.2b Compte root admin (stable, configure via .env)
_ensure_root_admin_account()

# 6.3 Normalize legacy PGP setup flags to avoid false chat blocks.
for _u in users_db.values():
    if _u.get("pgp_setup_completed"):
        continue
    if _u.get("pgp_private_key_viewed") or _u.get("pgp_public_key") or _u.get("pgp_key"):
        _u["pgp_setup_completed"] = True

save_all_users(users_db)
save_users_persist()

if TEST_GODMODE_ENABLED and TEST_GODMODE_USERNAME and TEST_GODMODE_PASSWORD:
    _gm_existing = users_db.get(TEST_GODMODE_USERNAME)
    if not _gm_existing:
        users_db[TEST_GODMODE_USERNAME] = {
            "username": TEST_GODMODE_USERNAME,
            "password": hash_password(TEST_GODMODE_PASSWORD),
            "role": "admin",
            "status": "active",
            "balance": 0.0,
            "xmr_address": generate_xmr_address(),
            "avatar": None,
            "pos": 0,
            "totp_enabled": False,
            "totp_secret": "",
            "totp_backup_codes": [],
        }
        _dev_print(f"[SECURITY] Created TEST godmode account '{TEST_GODMODE_USERNAME}' (non-production only).")
    else:
        _gm_existing["role"] = "admin"
        _gm_existing["totp_enabled"] = False
        _gm_existing["totp_secret"] = ""
        _gm_existing["totp_backup_codes"] = []
        if not _gm_existing.get("password"):
            _gm_existing["password"] = hash_password(TEST_GODMODE_PASSWORD)
        _dev_print(f"[SECURITY] Normalized TEST godmode account '{TEST_GODMODE_USERNAME}' (non-production only).")
    save_all_users(users_db)
    save_users_persist()

# 7. LOAD PERSISTED DATA FROM SQLITE
_loaded_orders = load_all_orders()
if _loaded_orders:
    orders_db.update(_loaded_orders)
    _dev_print(f"[DB] Restored {len(_loaded_orders)} orders from SQLite")
_loaded_msgs = load_all_order_messages()
if _loaded_msgs:
    chat_db.update(_loaded_msgs)
    _dev_print(f"[DB] Restored order messages from SQLite")
_loaded_gen = load_all_general_messages()
if _loaded_gen:
    general_chat_db.update(_loaded_gen)
    _dev_print(f"[DB] Restored general messages from SQLite")
_loaded_reviews = load_all_reviews()
if _loaded_reviews:
    reviews_db.update(_loaded_reviews)
    _dev_print(f"[DB] Restored reviews from SQLite")
_loaded_disputes = load_all_disputes()
if _loaded_disputes:
    disputes_db.update(_loaded_disputes)
    _dev_print(f"[DB] Restored disputes from SQLite")

# Initialiser le systeme escrow Monero (scanner de transactions in the background)
escrow = init_escrow(orders_db, users_db)
_dev_print("[*] Monero escrow system initialized")

# ============================================================
# WALLET DEPOSIT SCANNER
# Scan toutes les adresses XMR des users in the background
# Credite automatiquement le balance quand un deposit est detecte
# Fonctionne meme si l'user a ferme la fenetre
# ============================================================
_credited_txids = set()  # Evite de crediter deux fois la meme tx

def _normalize_user_wallet_fields():
    """Compat legacy: unify wallet index key + restore credited tx cache."""
    migrated = 0
    for username, user in users_db.items():
        if user.get("xmr_address_index") is None and user.get("address_index") is not None:
            user["xmr_address_index"] = user.get("address_index")
            migrated += 1

        credited = user.get("credited_deposit_txids", [])
        if isinstance(credited, list):
            for txid in credited:
                if txid:
                    _credited_txids.add(txid)
    if migrated:
        save_users_persist()
        _dev_print(f"[WALLET] Migrated xmr_address_index for {migrated} users")

_normalize_user_wallet_fields()

def wallet_deposit_scanner():
    """
    Thread qui scanne toutes les transactions entrantes du wallet Monero
    et credite automatiquement le balance des users correspondants.
    Tourne toutes les 60 secondes in the background.
    """
    _dev_print("[WALLET SCANNER] Started - scanning user deposits every 60s")
    while True:
        try:
            rpc = get_rpc()
            if not rpc.is_connected():
                time.sleep(60)
                continue

            # Build address -> username index
            addr_to_user = {}
            for username, user in users_db.items():
                addr = user.get("xmr_address", "")
                if addr and len(addr) >= 90:  # Address XMR valide (95 chars)
                    addr_to_user[addr] = username

            if not addr_to_user:
                time.sleep(60)
                continue

            # Fetch toutes les transactions entrantes via client RPC (avec auth si configuree)
            try:
                result = rpc.get_transfers(account_index=0, min_height=0) or {}
                transfers = result.get("in", []) + result.get("pool", [])

                for tx in transfers:
                    txid = tx.get("txid") or tx.get("tx_hash", "")
                    address = tx.get("address", "")
                    amount_atomic = tx.get("amount", 0)
                    amount_xmr = amount_atomic / 1e12
                    confirmations = tx.get("confirmations", 0)

                    # Ignorer si deja credite
                    if txid in _credited_txids:
                        continue

                    # Check if address belongs to a user
                    if address not in addr_to_user:
                        continue

                    username = addr_to_user[address]

                    # Crediter seulement si confirmed (10 confirmations)
                    if confirmations >= 10:
                        with funds_rlock:
                            if txid in _credited_txids:
                                continue
                            users_db[username]["balance"] = users_db[username].get("balance", 0.0) + amount_xmr
                            _credited_txids.add(txid)
                            users_db[username].setdefault("credited_deposit_txids", [])
                            if txid not in users_db[username]["credited_deposit_txids"]:
                                users_db[username]["credited_deposit_txids"].append(txid)
                            save_users_persist()
                        _dev_print(f"[WALLET SCANNER] ✅ Credited {amount_xmr:.6f} XMR to {username} (tx: {txid[:16]}...)")
                    else:
                        _dev_print(f"[WALLET SCANNER] ⏳ Pending deposit for {username}: {amount_xmr:.6f} XMR ({confirmations}/10 confirmations)")

            except Exception as e:
                _dev_print(f"[WALLET SCANNER] RPC error: {e}")

        except Exception as e:
            _dev_print(f"[WALLET SCANNER ERROR] {e}")

        time.sleep(60)  # Scanner toutes les 60 secondes

# Start le thread de scan des deposits wallet
_wallet_scanner_thread = threading.Thread(target=wallet_deposit_scanner, daemon=True)
_wallet_scanner_thread.start()
_dev_print("[OK] Wallet deposit scanner started (60s interval)")

# --- AUTH ---


# NOTE: ensure_categories_tables() et ensure_internal_balance_column() sont des
# fonctions legacy SQLite non utilisees (le serveur utilise la memoire + SQLite via db_persist).
# Elles sont conservees pour reference mais ne sont pas appelees au demarrage.

@app.get("/")
def root():
    return {"status": "OK", "message": "SilkGenesis Marketplace API"}

# EMERGENCY ROLE CHANGE - Set any user's role directly (admin only)
@app.post("/api/emergency/set-role")
async def emergency_set_role(request: Request):
    raise HTTPException(status_code=404, detail="NOT_FOUND")

# EMERGENCY ADMIN RESET - Remove after use
@app.post("/api/emergency/reset-admin")
async def emergency_reset_admin(request: Request):
    raise HTTPException(status_code=404, detail="NOT_FOUND")


def _resolve_user_db_key(raw_username: str):
    """Cle dans users_db (casse mixte possible) a partir du nom saisi."""
    raw = (raw_username or "").strip()
    if not raw:
        return None
    if raw in users_db:
        return raw
    low = raw.lower()
    for k in users_db:
        if k.lower() == low:
            return k
    return None


@app.get("/api/pow/challenge")
def get_pow_challenge(context: str = "login"):
    """Issue a PoW challenge for the requested context (login | register)."""
    ctx = (context or "login").strip().lower()
    if ctx not in ("login", "register"):
        raise HTTPException(status_code=400, detail="INVALID_CONTEXT")
    return pow_issue_challenge(ctx)


@app.post("/api/register")
def register(data: dict):
    raw = (data.get("username") or "").strip()
    if len(raw) < 3 or len(raw) > 64:
        return {"detail": "INVALID_USERNAME"}, 400
    if not re.fullmatch(r"[A-Za-z0-9_\-]+", raw):
        return {"detail": "INVALID_USERNAME"}, 400
    username = raw.lower()

    # Proof-of-Work obligatoire pour limiter le register-spam (Tor masque l'IP).
    if not verify_pow(data.get("pow_solution") or "", expected_context="register"):
        raise HTTPException(status_code=400, detail="POW_REQUIRED")

    # Rate limiting global anonyme (en plus du username) — Tor → tout vient de 127.0.0.1,
    # mais on conserve un compteur pour eviter qu'un seul attaquant nous noie.
    if not check_rate_limit("register", "global"):
        retry = get_rate_limit_retry_after("register", "global")
        return {"detail": "RATE_LIMITED", "retry_after": retry, "message": f"Too many registrations. Wait {retry}s."}, 429
    if not check_rate_limit("register", username):
        retry = get_rate_limit_retry_after("register", username)
        return {"detail": "RATE_LIMITED", "retry_after": retry, "message": f"Too many registrations. Wait {retry}s."}, 429
    if _register_username_reserved(username):
        return {"detail": "IDENTITY_ALREADY_CLAIMED"}, 400
    if any(existing.lower() == username for existing in users_db):
        return {"detail": "IDENTITY_ALREADY_CLAIMED"}, 400
    
    # Create a REAL Monero address via RPC (Digest Auth)
    xmr_addr = None
    addr_index = None
    
    if monero_wallet:
        try:
            addr_data = monero_wallet.create_address(account_index=0, label=f"user_{username}")
            if addr_data and addr_data.get("address"):
                xmr_addr = addr_data["address"]
                addr_index = addr_data["address_index"]
                _dev_print(f"[OK] Address Monero REELLE creee pour {username}: {xmr_addr[:20]}...")
            else:
                _dev_print(f"[ERROR] RPC create_address retourne None pour {username} - RPC non connecte ou auth echouee")
        except Exception as e:
            _dev_print(f"[ERROR] RPC address creation error pour {username}: {e}")
    
    # If RPC fails, generate a temporary address (replaced when RPC is available)
    if not xmr_addr:
        # Address temporaire prefixee pour identification facile
        xmr_addr = f"PENDING_{secrets.token_hex(20)}"
        _dev_print(f"[WARNING] RPC offline - temporary address for {username}: {xmr_addr[:20]}...")
    
    # ========================================================
    # PGP — generation client-side desormais (openpgp.js navigateur).
    # Le client envoie sa cle publique armored au registration.
    # Le serveur ne voit JAMAIS la cle privee ni la passphrase.
    # ========================================================
    client_pub_key = (data.get("pgp_public_key") or "").strip()
    if not client_pub_key:
        raise HTTPException(
            status_code=400,
            detail="PGP_PUBLIC_KEY_REQUIRED: generate a key in your browser before registering",
        )
    if len(client_pub_key) > 32_000:
        raise HTTPException(status_code=400, detail="PGP_PUBLIC_KEY_TOO_LARGE")
    pgp_validation = validate_pgp_public_key(client_pub_key)
    if not pgp_validation.get("valid"):
        raise HTTPException(
            status_code=400,
            detail=f"PGP_PUBLIC_KEY_INVALID: {pgp_validation.get('error', 'unparseable')}",
        )
    pgp_public_key = client_pub_key
    pgp_fingerprint = pgp_validation.get("fingerprint")

    users_db[username] = {
        "username": username,
        "password": hash_password(data["password"]),
        "role": "buyer",
        "status": "active",
        "balance": 0.0,
        "xmr_address": xmr_addr,
        "xmr_address_index": addr_index,
        "avatar": None,
        "pos": 0,
        "pgp_public_key": pgp_public_key,
        # Le serveur ne stocke plus de cle privee, meme chiffree par mot de passe.
        "pgp_private_key_encrypted": None,
        "pgp_fingerprint": pgp_fingerprint,
        "pgp_setup_completed": True,  # cle valide presente, plus de wizard server-side
        "pgp_private_key_viewed": True,
        "anti_phishing_phrase": data.get("anti_phishing_phrase", None),
        "founder_vendor_badge": False,
        "founder_vendor_serial": None,
        "founder_vendor_granted_at": None
    }
    referral_code = data.get("referral_code", "").strip().upper()
    if referral_code and referral_code in referrals_db:
        ref_data = referrals_db[referral_code]
        if ref_data["owner"] != username:
            # Lien only — pas de credit. Le bonus referral n'est attribue
            # que lors d'une vraie commande finalisee (voir _credit_referral_on_purchase),
            # pour bloquer le farming d'inscriptions sybil.
            users_db[username]["referred_by"] = ref_data["owner"]
            referrals_db[referral_code]["referrals"].append({
                "username": username,
                "joined_at": datetime.utcnow().isoformat(),
                "credited": False,
            })
    save_users_persist()  # Sauvegarder le nouvel user sur disque
    log(AuditEvent.REGISTER, username, {"role": "buyer"})
    return {
        "status": "success",
        "address": xmr_addr,
        "pgp_public_key": pgp_public_key,
        "pgp_fingerprint": pgp_fingerprint,
        "pgp_generated": True,
        "pgp_warning": (
            "Your PGP private key is stored ONLY in your browser. "
            "Download a backup .asc file now — losing it means losing access to encrypted chats."
        ),
    }

@app.post("/api/login")
def login(data: dict):
    try:
        username_input = (data.get("username") or "").strip()
        password = data.get("password", "")

        # Proof-of-Work obligatoire (anti credential stuffing). On ne re-exige
        # pas une nouvelle PoW pour la 2eme etape (TOTP) si la session est presque ouverte:
        # on accepte si la PoW est presente OU si un totp_code est fourni (deuxieme passe).
        if not (data.get("totp_code") or "").strip():
            if not verify_pow(data.get("pow_solution") or "", expected_context="login"):
                raise HTTPException(status_code=400, detail="POW_REQUIRED")

        # Rate limiting global (Tor: toutes IPs egales) + par username.
        if not check_rate_limit("login", "global"):
            retry = get_rate_limit_retry_after("login", "global")
            return JSONResponse(status_code=429, content={"detail": "RATE_LIMITED", "retry_after": retry, "message": f"Too many attempts. Wait {retry}s."})
        if not check_rate_limit("login", username_input):
            retry = get_rate_limit_retry_after("login", username_input)
            return JSONResponse(status_code=429, content={"detail": "RATE_LIMITED", "retry_after": retry, "message": f"Too many attempts. Wait {retry}s."})
        username = _resolve_user_db_key(username_input)
        if username is None:
            log_security(AuditEvent.LOGIN_FAIL, username_input)
            return JSONResponse(status_code=401, content={"detail": "INVALID_CREDENTIALS"})
        user = users_db[username]
        stored_hash = user.get("password", "")
        if not stored_hash or not verify_password(password, stored_hash):
            log_security(AuditEvent.LOGIN_FAIL, username_input)
            return JSONResponse(status_code=401, content={"detail": "INVALID_CREDENTIALS"})

        role = user.get("role", "buyer")
        is_test_godmode = _is_test_godmode_username(username)
        if role in ("admin", "vendor") and not user.get("totp_enabled") and not is_test_godmode:
            # Ne pas reveler le role exact: tout client legitime sait deja s'il est admin/vendor.
            # Pas non plus de username canonique (anti-enumeration de casse / collision).
            return JSONResponse(status_code=200, content={
                "status": "2fa_setup_required",
                "detail": "2FA_SETUP_REQUIRED",
                "message": "Two-factor setup is required before login on this account.",
            })

        # ============================================================
        # 2FA TOTP CHECK - Si active, exiger le code TOTP
        # ============================================================
        if user.get("totp_enabled") and not is_test_godmode:
            totp_code = data.get("totp_code", "").strip()
            if not totp_code:
                return JSONResponse(status_code=200, content={
                    "status": "2fa_required",
                    "detail": "2FA_REQUIRED",
                    "message": "This account has 2FA enabled. Please provide your TOTP code.",
                })
            # Check le code TOTP
            secret = user.get("totp_secret", "")
            totp_valid = False
            # Check code TOTP normal
            if TOTP_AVAILABLE and secret:
                totp_valid = verify_totp(secret, totp_code)
            # Check backup codes if TOTP fails
            if not totp_valid:
                backup_codes = user.get("totp_backup_codes", [])
                if totp_code.upper() in backup_codes:
                    backup_codes.remove(totp_code.upper())
                    user["totp_backup_codes"] = backup_codes
                    save_users_persist()
                    totp_valid = True
            if not totp_valid:
                log_security(AuditEvent.LOGIN_FAIL, username)
                return JSONResponse(status_code=401, content={"detail": "INVALID_2FA_CODE", "message": "Invalid TOTP code. Try again."})

        # Record admin login for Dead Man Switch
        if user.get("role") == "admin" and DMS_AVAILABLE:
            try:
                dms.record_admin_login(username)
            except Exception:
                pass

        # Creer une session et retourner le token
        session_token = create_session(username, user.get("role", "buyer"))
        log(AuditEvent.LOGIN_SUCCESS, username)
        ap_phrase = user.get("anti_phishing_phrase")
        # Reponse classique JSON + Set-Cookie HttpOnly. Les nouveaux clients
        # n'ont plus besoin de stocker le token (cookie auto), les anciens
        # peuvent continuer a utiliser session_token (Bearer).
        resp = JSONResponse(status_code=200, content={
            "status": "success",
            "session_token": session_token,
            "anti_phishing_phrase": ap_phrase if ap_phrase else None,
            "user": {
                "username": user.get("username", username),
                "role": user.get("role", "buyer"),
                "balance": float(user.get("balance", 0.0)),
                "xmr_address": user.get("xmr_address", ""),
                "avatar": user.get("avatar"),
                "pos": user.get("pos", 0),
                "totp_enabled": user.get("totp_enabled", False),
                "pgp_fingerprint": user.get("pgp_fingerprint"),
                "has_pgp": bool(user.get("pgp_public_key") or user.get("pgp_key")),
                "pgp_setup_completed": _pgp_setup_completed(user),
                "founder_vendor_badge": bool(user.get("founder_vendor_badge")),
                "founder_vendor_serial": user.get("founder_vendor_serial"),
                "founder_vendor_badge_label": (
                    "Founder Vendor"
                    if user.get("founder_vendor_badge")
                    else None
                )
            }
        })
        _set_session_cookie(resp, session_token)
        return resp
    except Exception as e:
        _dev_print(f"[LOGIN ERROR] {e}")
        import traceback; traceback.print_exc()
        return JSONResponse(status_code=500, content={"detail": "SERVER_ERROR", "message": str(e)})


# ============================================================
# Cookie-based session helpers
# ============================================================
@app.get("/api/auth/whoami")
def auth_whoami(session: dict = Depends(get_current_session)):
    """Rehydrate the React app from the HttpOnly session cookie on page reload."""
    user = users_db.get(session["username"]) or {}
    return {
        "status": "ok",
        "username": session["username"],
        "role": session.get("role"),
        "user": {
            "username": user.get("username", session["username"]),
            "role": user.get("role", "buyer"),
            "balance": float(user.get("balance", 0.0)),
            "xmr_address": user.get("xmr_address", ""),
            "avatar": user.get("avatar"),
            "pos": user.get("pos", 0),
            "totp_enabled": user.get("totp_enabled", False),
            "pgp_fingerprint": user.get("pgp_fingerprint"),
            "has_pgp": bool(user.get("pgp_public_key") or user.get("pgp_key")),
            "pgp_setup_completed": _pgp_setup_completed(user),
        },
    }


@app.post("/api/auth/logout")
def auth_logout(request: Request):
    """Server-side logout: invalidate session AND clear cookies."""
    token = ""
    auth = request.headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        token = auth.split(" ", 1)[1].strip()
    if not token:
        token = (request.cookies.get(SESSION_COOKIE_NAME) or "").strip()
    if token:
        try:
            invalidate_session(token)
        except Exception:
            pass
    resp = JSONResponse({"status": "ok"})
    _clear_session_cookie(resp)
    return resp

# --- MARKETPLACE ---

@app.delete("/api/listings/{listing_id}")
def delete_listing(listing_id: str, session: dict = Depends(get_current_session)):
    """Delete un listing (vendor proprietaire ou admin)"""
    if listing_id not in listings_db:
        return {"detail": "LISTING_NOT_FOUND"}, 404
    listing = listings_db[listing_id]
    owner = listing.get("vendor")
    if owner != session["username"] and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    del listings_db[listing_id]
    save_vendor_listings()
    return {"status": "success", "message": "Listing deleted"}

@app.get("/api/vendor/{username}/listings")
def get_vendor_listings(username: str):
    """Fetch tous les listings d'un vendor"""
    vendor_listings = [
        {**v, "id": k}
        for k, v in listings_db.items()
        if v.get("vendor") == username
    ]
    vendor_listings.sort(key=lambda x: x.get("sales", 0), reverse=True)
    return {"listings": vendor_listings, "total": len(vendor_listings)}

@app.get("/api/top-vendors")
def get_top_vendors():
    """Retourner les 8 top vendors"""
    vendors = [u for u in users_db.values() if u["role"] == "vendor"]
    # Trier par nombre de ventes
    vendors_sorted = sorted(vendors, key=lambda x: x.get("pos", 0), reverse=True)[:8]
    return {"vendors": [
        {
            "username": v["username"],
            "sales": v.get("pos", 0),
            "rating": v.get("rating", 4.5),
            "avatar": v.get("avatar"),
            "founder_vendor_badge": bool(v.get("founder_vendor_badge")),
            "founder_vendor_serial": v.get("founder_vendor_serial")
        } for v in vendors_sorted
    ]}

@app.get("/api/founders/stats")
def get_founders_stats():
    claimed = _count_founder_vendors()
    return {
        "limit": FOUNDER_VENDOR_BADGE_LIMIT,
        "claimed": claimed,
        "remaining": max(0, FOUNDER_VENDOR_BADGE_LIMIT - claimed)
    }

@app.get("/api/vendor/{username}/badge")
def get_vendor_badge(username: str):
    user = users_db.get(username)
    if not user or user.get("role") != "vendor":
        raise HTTPException(status_code=404, detail="VENDOR_NOT_FOUND")
    badge = bool(user.get("founder_vendor_badge"))
    serial = user.get("founder_vendor_serial")
    return {
        "username": username,
        "founder_vendor_badge": badge,
        "founder_vendor_serial": serial,
        "founder_vendor_badge_label": "Founder Vendor" if badge else None
    }

@app.post("/api/admin/vendor/{username}/founder-badge")
def admin_set_founder_badge(username: str, data: dict, _admin: dict = Depends(require_admin)):
    """Admin toggle for founder badge on a vendor profile."""
    key = _resolve_user_db_key(username)
    if key is None or users_db.get(key, {}).get("role") != "vendor":
        raise HTTPException(status_code=404, detail="VENDOR_NOT_FOUND")

    enabled = bool(data.get("enabled", True))
    user = users_db[key]

    if enabled:
        if not user.get("founder_vendor_badge"):
            user["founder_vendor_badge"] = True
            user["founder_vendor_granted_at"] = datetime.utcnow().isoformat()
    else:
        user["founder_vendor_badge"] = False
        user["founder_vendor_serial"] = None
        user["founder_vendor_granted_at"] = None

    # Keep serials contiguous across all founder vendors.
    founders = [(k, u) for k, u in users_db.items() if u.get("role") == "vendor" and u.get("founder_vendor_badge")]
    founders.sort(key=lambda pair: ((pair[1].get("founder_vendor_serial") or 10**9), pair[0].lower()))
    for idx, (_, vuser) in enumerate(founders, start=1):
        vuser["founder_vendor_serial"] = idx

    save_all_users(users_db)
    save_users_persist()

    return {
        "status": "success",
        "username": key,
        "founder_vendor_badge": bool(user.get("founder_vendor_badge")),
        "founder_vendor_serial": user.get("founder_vendor_serial"),
        "claimed": len(founders),
        "limit": FOUNDER_VENDOR_BADGE_LIMIT,
    }

@app.get("/api/top-products")
def get_top_products():
    """Retourner les produits les plus vendus"""
    items = [v for v in listings_db.values() if v["status"] == "active"]
    # Trier par ventes
    items_sorted = sorted(items, key=lambda x: x.get("sales", 0), reverse=True)[:12]
    return {"items": [_sanitize_listing_for_client(v) for v in items_sorted]}

# Cache des prix crypto (mis a jour toutes les 60 secondes)
_price_cache = {
    "xmr": {"usd": 352.00, "change_24h": 0.0},
    "btc": {"usd": 74000.00, "change_24h": 0.0},
    "last_update": 0.0,
    "source": "bootstrap",
}

def _bool_env(name: str, default: str = "0") -> bool:
    return str(os.getenv(name, default)).strip().lower() in ("1", "true", "yes", "on")

def _is_clearnet_media_url(value: str) -> bool:
    if not value or not isinstance(value, str):
        return False
    raw = value.strip()
    if not raw.lower().startswith(("http://", "https://")):
        return False
    host = (urlparse(raw).hostname or "").lower()
    if not host:
        return False
    if host in ("localhost", "127.0.0.1", "0.0.0.0") or host.endswith(".onion"):
        return False
    return True

def _sanitize_listing_for_client(listing: dict) -> dict:
    out = dict(listing or {})
    for key in ("img", "image"):
        val = out.get(key)
        if isinstance(val, str) and _is_clearnet_media_url(val):
            out[key] = None
    return out

def _apply_price_cache(xmr: float, btc: float, src: str) -> None:
    global _price_cache
    prev_xmr = float((_price_cache.get("xmr") or {}).get("usd") or 0)
    prev_btc = float((_price_cache.get("btc") or {}).get("usd") or 0)
    xmr_delta = round(((xmr - prev_xmr) / prev_xmr) * 100, 2) if prev_xmr > 0 else 0.0
    btc_delta = round(((btc - prev_btc) / prev_btc) * 100, 2) if prev_btc > 0 else 0.0
    _price_cache = {
        "xmr": {"usd": round(float(xmr), 2), "change_24h": xmr_delta},
        "btc": {"usd": round(float(btc), 2), "change_24h": btc_delta},
        "last_update": time.time(),
        "source": src,
    }


def fetch_real_prices():
    global _price_cache
    try:
        from withdrawal_queue import PlatformControlManager as PCM
        if PCM._get(PCM.KEY_MANUAL_CRYPTO_ENABLED) == "1":
            xmr = float(PCM._get(PCM.KEY_MANUAL_XMR_USD) or 0)
            btc = float(PCM._get(PCM.KEY_MANUAL_BTC_USD) or 0)
            if xmr > 0 and btc > 0:
                _apply_price_cache(xmr, btc, "manual_admin")
                return
    except Exception:
        pass

    oracle = get_prices(max_age_sec=55)
    if oracle:
        _apply_price_cache(
            float(oracle["xmr_usd"]),
            float(oracle["btc_usd"]),
            str(oracle.get("source") or "oracle"),
        )
        return
    if not _bool_env("SILKGENESIS_ENABLE_CLEARNET_PRICES", "0"):
        return
    try:
        url = "https://api.coingecko.com/api/v3/simple/price"
        params = {"ids": "monero,bitcoin", "vs_currencies": "usd", "include_24hr_change": "true"}
        resp = requests.get(url, params=params, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            _price_cache = {
                "xmr": {"usd": round(data["monero"]["usd"], 2), "change_24h": round(data["monero"].get("usd_24h_change", 0), 2)},
                "btc": {"usd": round(data["bitcoin"]["usd"], 2), "change_24h": round(data["bitcoin"].get("usd_24h_change", 0), 2)},
                "last_update": time.time(),
                "source": "coingecko",
            }
            _dev_print(f"[OK] Prices updated: XMR=${_price_cache['xmr']['usd']} BTC=${_price_cache['btc']['usd']}")
    except Exception as e:
        _dev_print(f"[WARNING] CoinGecko fetch failed: {e} - using cached prices")

def price_updater():
    while True:
        fetch_real_prices()
        time.sleep(60)

_price_thread = threading.Thread(target=price_updater, daemon=True)
_price_thread.start()

@app.get("/api/crypto-prices")
def get_crypto_prices():
    """Prix XMR/BTC USD (oracle, manuel admin, ou fallback)."""
    return {
        "xmr": _price_cache["xmr"],
        "btc": _price_cache["btc"],
        "source": _price_cache.get("source", "unknown"),
        "last_update": _price_cache.get("last_update"),
    }


@app.get("/api/admin/crypto-prices-config")
def admin_get_crypto_prices_config(_admin: dict = Depends(require_admin)):
    from withdrawal_queue import PlatformControlManager as PCM
    st = PCM.get_manual_crypto_settings()
    return {
        "enabled": st["enabled"],
        "xmr_usd": st["xmr_usd"],
        "btc_usd": st["btc_usd"],
        "effective_source": _price_cache.get("source", "unknown"),
        "last_update": _price_cache.get("last_update"),
    }


@app.post("/api/admin/crypto-prices-config")
def admin_set_crypto_prices_config(data: dict, _admin: dict = Depends(require_admin)):
    from withdrawal_queue import PlatformControlManager as PCM
    enabled = bool(data.get("enabled", False))
    try:
        xmr = float(data.get("xmr_usd", 0))
        btc = float(data.get("btc_usd", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="INVALID_PRICES")
    out = PCM.set_manual_crypto_prices(enabled, xmr, btc, _admin.get("username") or "admin")
    if not out.get("success"):
        raise HTTPException(status_code=400, detail=out.get("error", "UPDATE_FAILED"))
    log_admin(
        AuditEvent.ADMIN_ACTION,
        _admin.get("username") or "admin",
        {"action": "CRYPTO_MANUAL_PRICES", **{k: v for k, v in out.items() if k != "success"}},
    )
    fetch_real_prices()
    return out

@app.get("/api/listings")
def get_listings():
    # Toujours exposer `id` = cle SQLite / listings_db (evite 404 admin si le JSON interne est desynchronise).
    items = []
    for lid, v in listings_db.items():
        if v.get("status") != "active":
            continue
        item = _sanitize_listing_for_client(v)
        item["id"] = lid
        items.append(item)
    return {"items": items, "rate": _price_cache["xmr"]["usd"]}

@app.post("/api/listings")
def create_listing(data: dict, session: dict = Depends(get_current_session)):
    # Verification d'identite
    vendor = data.get("vendor")
    if vendor != session["username"] and session["role"] != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
        
    # Check que l'user est bien un vendor
    if users_db.get(vendor, {}).get("role") != "vendor" and session["role"] != "admin":
        raise HTTPException(status_code=403, detail="NOT_A_VENDOR")

    listing_id = f"LST_{secrets.token_hex(8)}"
    new_listing = {
        "id": listing_id,
        "title": data["title"],
        "price_xmr": data["price_xmr"],
        "category": data["category"],
        "vendor": data["vendor"],
        "description": data["description"],
        "image": data.get("image"),
        "status": "active",
        "ship_from": data.get("ship_from", "Worldwide"),
        "stock": int(data.get("stock", 999)),
        "featured": False,
        "is_vendor_listing": True,
        "created_at": datetime.utcnow().isoformat()
    }
    listings_db[listing_id] = new_listing
    save_listing(listing_id, new_listing)  # Persist to SQLite
    save_vendor_listings()  # JSON legacy
    return {"status": "success", "id": listing_id}

# --- ORDERS & ESCROW ---
@app.post("/api/orders")
def create_order(data: dict, session: dict = Depends(get_current_session)):
    listing_id = data.get("listing_id")
    buyer = data.get("buyer")
    requested_mode = (data.get("escrow_mode") or "auto").lower()
    token = session["token"]
    
    if not listing_id or not buyer:
        raise HTTPException(status_code=400, detail="MISSING_PARAMETERS")
    
    # Verification d'identite: le buyer doit etre celui de la session
    if buyer != session["username"]:
        raise HTTPException(status_code=403, detail="IDENTITY_MISMATCH")

    if not check_rate_limit("order", token):
        retry = get_rate_limit_retry_after("order", token)
        raise HTTPException(status_code=429, detail=f"RATE_LIMITED_ORDER_{retry}s")
    
    listing = listings_db[listing_id]
    buyer_user = users_db[buyer]
    vendor_user = users_db.get(listing["vendor"], {})

    # PGP is mandatory for orders: buyer and vendor must both have a public key.
    buyer_has_pgp = bool(buyer_user.get("pgp_public_key") or buyer_user.get("pgp_key"))
    vendor_has_pgp = bool(vendor_user.get("pgp_public_key") or vendor_user.get("pgp_key"))
    if not buyer_has_pgp or not vendor_has_pgp:
        raise HTTPException(
            status_code=400,
            detail="PGP_REQUIRED_FOR_ORDER"
        )

    # Escrow mode selection (standard / multisig / auto)
    default_mode = "multisig" if float(listing["price_xmr"]) >= 0.5 else "standard"
    if requested_mode not in ("standard", "multisig", "auto"):
        requested_mode = "auto"
    escrow_mode = default_mode if requested_mode == "auto" else requested_mode
    if escrow_mode == "multisig" and not MULTISIG_AVAILABLE:
        escrow_mode = "standard"

    with funds_rlock:
        bu = users_db[buyer]
        li = listings_db[listing_id]
        if bu["balance"] < li["price_xmr"]:
            raise HTTPException(status_code=400, detail="INSUFFICIENT_FUNDS")
        order_id = f"ORD_{secrets.token_hex(8)}"
        escrow_addr = generate_escrow_address()
        bu["balance"] -= li["price_xmr"]
        save_users_persist()
        orders_db[order_id] = {
            "id": order_id,
            "listing_id": listing_id,
            "buyer": buyer,
            "vendor": li["vendor"],
            "amount_xmr": li["price_xmr"],
            "status": "escrow",
            "escrow_address": escrow_addr,
            "escrow_balance": li["price_xmr"],
            "payment_status": "confirmed",
            "payment_amount_xmr": li["price_xmr"],
            "payment_confirmations": MIN_CONFIRMATIONS,
            "funding_mode": "internal_balance",
            "escrow_mode": escrow_mode,
            "created_at": datetime.utcnow().isoformat(),
        }
        save_order(order_id, orders_db[order_id])

    # Initialiser le chat avec message de bienvenue automatique
    chat_db[order_id] = [{
        "id": 1,
        "sender": "SYSTEM",
        "message": f"ORDER #{order_id[-8:]} CREATED - {listing['price_xmr']} XMR locked in {escrow_mode} escrow. Product: {listing.get('title','Unknown')}. BUYER: Please send your delivery address to the vendor. VENDOR: Please confirm and ship ASAP.",
        "timestamp": datetime.utcnow().isoformat(),
        "is_system": True
    }]

    # Auto-provision multisig wallet when selected
    multisig_address = None
    if escrow_mode == "multisig" and MULTISIG_AVAILABLE:
        try:
            wallet = _ms.create_multisig_wallet(order_id, buyer, listing["vendor"], float(listing["price_xmr"]))
            multisig_address = wallet.get("multisig_address")
            with funds_rlock:
                if order_id in orders_db:
                    orders_db[order_id]["multisig_enabled"] = True
                    orders_db[order_id]["multisig_address"] = multisig_address
        except Exception as e:
            _dev_print(f"[MULTISIG] Provision failed for {order_id}: {e}")
            with funds_rlock:
                if order_id in orders_db:
                    orders_db[order_id]["escrow_mode"] = "standard"
                    orders_db[order_id]["multisig_enabled"] = False

    order_subaddress = get_or_create_order_subaddress(order_id)
    with funds_rlock:
        if order_id in orders_db and order_subaddress and order_subaddress.get("address"):
            orders_db[order_id]["xmr_subaddress"] = order_subaddress["address"]
            if order_subaddress.get("address_index") is not None:
                orders_db[order_id]["xmr_subaddress_index"] = order_subaddress.get("address_index")
            orders_db[order_id]["xmr_subaddress_rpc_online"] = bool(order_subaddress.get("rpc_online"))
            orders_db[order_id]["xmr_subaddress_simulated"] = bool(order_subaddress.get("simulated"))
        if order_id in orders_db:
            save_order(order_id, orders_db[order_id])

    return {
        "status": "success",
        "order_id": order_id,
        "message": f"{listing['price_xmr']} XMR locked in {orders_db[order_id].get('escrow_mode', 'standard')} escrow",
        "amount_xmr": listing["price_xmr"],
        "funding_mode": "internal_balance",
        "escrow_mode": orders_db[order_id].get("escrow_mode", "standard"),
        "multisig_enabled": bool(orders_db[order_id].get("multisig_enabled")),
        "multisig_address": orders_db[order_id].get("multisig_address"),
        "order_subaddress": orders_db[order_id].get("xmr_subaddress"),
        "payment_instructions": "Paid from your internal balance. Funds are now locked in escrow until order completion."
    }

@app.get("/api/orders/{username}")
def get_user_orders(username: str, session: dict = Depends(get_current_session)):
    # Verification d'identite
    if username != session["username"] and session["role"] != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
        
    user_orders = [
        o for o in orders_db.values()
        if o["buyer"] == username or o["vendor"] == username
    ]
    return {"orders": user_orders}

@app.post("/api/orders/{order_id}/confirm-payment")
def confirm_payment(order_id: str, session: dict = Depends(get_current_session)):
    if session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ADMIN_REQUIRED")
    if order_id in orders_db:
        orders_db[order_id]["status"] = "escrow"
        save_order(order_id, orders_db[order_id])
        return {"status": "success"}
    return {"detail": "ORDER_NOT_FOUND"}, 404

@app.post("/api/orders/{order_id}/mark-shipped")
def mark_shipped(order_id: str, session: dict = Depends(get_current_session)):
    if order_id in orders_db:
        order = orders_db[order_id]
        if order.get("vendor") != session["username"] and session.get("role") != "admin":
            raise HTTPException(status_code=403, detail="ACCESS_DENIED")
        orders_db[order_id]["status"] = "shipped"
        orders_db[order_id]["shipped_at"] = datetime.utcnow().isoformat()
        save_order(order_id, orders_db[order_id])
        if order_id in chat_db:
            chat_db[order_id].append({
                "id": len(chat_db[order_id]) + 1,
                "sender": "SYSTEM",
                "message": f"📦 ORDER SHIPPED by vendor. Auto-finalize in {AUTO_FINALIZE_DAYS} days if buyer does not release funds.",
                "timestamp": datetime.utcnow().isoformat(),
                "is_system": True
            })
        return {"status": "success"}
    return {"detail": "ORDER_NOT_FOUND"}, 404


@app.post("/api/orders/{order_id}/complete")
def complete_order(order_id: str, session: dict = Depends(get_current_session)):
    """Legacy alias: route to the secured release flow."""
    return release_order_funds(order_id=order_id, data={}, session=session)

# --- CHAT ---

# CHAT GENERAL (buyer-vendor) - Pour discuter AVANT d'acheter
@app.get("/api/chat/general/{buyer}/{vendor}")
def get_general_chat(buyer: str, vendor: str, session: dict = Depends(get_current_session)):
    """Fetch les messages entre un buyer et un vendor"""
    u = session["username"]
    if u != buyer and u != vendor and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    chat_key = f"{buyer}_{vendor}"
    messages = general_chat_db.get(chat_key, [])
    return {"messages": messages}

@app.post("/api/chat/general")
def send_general_message(data: dict, session: dict = Depends(get_current_session)):
    """Envoyer un message dans le chat general buyer-vendor (encrypted PGP si possible)"""
    buyer = data["buyer"]
    vendor = data["vendor"]
    sender = data["sender"]
    raw_message = data["message"]
    token = session["token"]
    chat_key = f"{buyer}_{vendor}"
    
    # Verification d'identite
    if sender != session["username"]:
        raise HTTPException(status_code=403, detail="IDENTITY_MISMATCH")
    if session["username"] not in (buyer, vendor):
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")

    if not check_rate_limit("chat", token):
        retry = get_rate_limit_retry_after("chat", token)
        raise HTTPException(status_code=429, detail=f"RATE_LIMITED_CHAT_{retry}s")
    
    if chat_key not in general_chat_db:
        general_chat_db[chat_key] = []
    
    # Determiner le destinataire (l'autre personne)
    recipient = vendor if sender == buyer else buyer
    
    # Tenter le encryption PGP avec la cle publique du destinataire
    recipient_user = users_db.get(recipient, {})
    recipient_pub_key = recipient_user.get("pgp_public_key") or recipient_user.get("pgp_key")
    sender_user = users_db.get(sender, {})
    sender_has_pgp = bool(sender_user.get("pgp_public_key") or sender_user.get("pgp_key"))
    recipient_has_pgp = bool(recipient_pub_key)
    sender_setup_ok = _pgp_setup_completed(sender_user)
    recipient_setup_ok = _pgp_setup_completed(recipient_user)

    if not sender_setup_ok or not recipient_setup_ok:
        raise HTTPException(status_code=400, detail="PGP_SETUP_REQUIRED")
    if not sender_has_pgp or not recipient_has_pgp:
        raise HTTPException(status_code=400, detail="PGP_REQUIRED_FOR_CHAT")
    
    if not recipient_pub_key:
        raise HTTPException(status_code=400, detail="RECIPIENT_HAS_NO_PGP_KEY")

    # E2E-only: le client envoie deja un blob PGP armored (genere via openpgp.js).
    # Le serveur refuse tout payload qui n'est pas un PGP MESSAGE.
    if not _looks_like_pgp_armor(raw_message):
        log_security(
            "CHAT_REJECT_PLAINTEXT",
            sender,
            {"recipient": recipient, "len": len(raw_message)},
        )
        raise HTTPException(status_code=400, detail="MESSAGE_MUST_BE_PGP_ARMORED")

    msg = {
        "id": len(general_chat_db[chat_key]) + 1,
        "sender": sender,
        "message": raw_message,
        "encrypted": True,
        "pgp_warning": None,
        "timestamp": datetime.utcnow().isoformat()
    }
    general_chat_db[chat_key].append(msg)
    return {"status": "success", "message": msg, "encrypted": True}

# CHAT ESCROW (order-specific) - Pour discuter pendant une transaction
@app.get("/api/chat/order/{order_id}")
def get_order_chat(order_id: str, session: dict = Depends(get_current_session)):
    """Fetch les messages lies a une order specifique"""
    order = orders_db.get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="ORDER_NOT_FOUND")
    u = session["username"]
    if u not in (order.get("buyer"), order.get("vendor")) and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    messages = chat_db.get(order_id, [])
    return {"messages": messages}

@app.post("/api/chat/order")
def send_order_message(data: dict, session: dict = Depends(get_current_session)):
    """Envoyer un message dans le chat d'une order (encrypted PGP si possible)"""
    order_id = data["order_id"]
    sender = data["sender"]
    raw_message = data["message"]
    token = session["token"]

    # Verification d'identite
    if sender != session["username"]:
        raise HTTPException(status_code=403, detail="IDENTITY_MISMATCH")

    if not check_rate_limit("chat_order", token):
        retry = get_rate_limit_retry_after("chat_order", token)
        raise HTTPException(status_code=429, detail=f"RATE_LIMITED_CHAT_{retry}s")
    
    order = orders_db.get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="ORDER_NOT_FOUND")
    if sender not in (order.get("buyer"), order.get("vendor")) and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")

    if order_id not in chat_db:
        chat_db[order_id] = []

    # Trouver le destinataire via la order et exiger PGP.
    recipient = order["vendor"] if sender == order["buyer"] else order["buyer"]
    recipient_user = users_db.get(recipient, {})
    recipient_pub_key = recipient_user.get("pgp_public_key") or recipient_user.get("pgp_key")
    sender_user = users_db.get(sender, {})
    sender_has_pgp = bool(sender_user.get("pgp_public_key") or sender_user.get("pgp_key"))
    sender_setup_ok = _pgp_setup_completed(sender_user)
    recipient_setup_ok = _pgp_setup_completed(recipient_user)
    if not sender_setup_ok or not recipient_setup_ok:
        raise HTTPException(status_code=400, detail="PGP_SETUP_REQUIRED")
    if not sender_has_pgp or not recipient_pub_key:
        raise HTTPException(status_code=400, detail="PGP_REQUIRED_FOR_CHAT")

    if not _looks_like_pgp_armor(raw_message):
        log_security(
            "CHAT_REJECT_PLAINTEXT",
            sender,
            {"order_id": order_id, "len": len(raw_message)},
        )
        raise HTTPException(status_code=400, detail="MESSAGE_MUST_BE_PGP_ARMORED")

    msg = {
        "id": len(chat_db[order_id]) + 1,
        "sender": sender,
        "message": raw_message,
        "encrypted": True,
        "pgp_warning": None,
        "timestamp": datetime.utcnow().isoformat()
    }
    chat_db[order_id].append(msg)
    return {"status": "success", "message": msg, "encrypted": True}


@app.get("/api/chat/conversations/{username}")
def get_conversations(username: str, session: dict = Depends(get_current_session)):
    """Retourner toutes les conversations d un user"""
    if username != session["username"] and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    conversations = []
    for chat_key, messages in general_chat_db.items():
        if not messages:
            continue
        # chat_key format: "buyer_vendor"
        parts = chat_key.split('_', 1)
        if len(parts) != 2:
            continue
        buyer, vendor = parts[0], parts[1]
        if buyer != username and vendor != username:
            continue
        last_msg = messages[-1] if messages else None
        conversations.append({
            "chat_key": chat_key,
            "buyer": buyer,
            "vendor": vendor,
            "last_message": last_msg,
            "message_count": len(messages),
            "unread": 0
        })
    # Trier par dernier message (plus recent en premier)
    conversations.sort(key=lambda x: x["last_message"]["timestamp"] if x["last_message"] else "", reverse=True)
    return {"conversations": conversations}

# --- ADMIN 2FA STEP-UP (déblocage panel) — routes exemptés du check middleware ---
def _admin_unlock_status_payload(_admin: dict) -> dict:
    """Indique si le 2FA TOTP est actif et si le step-up panel est encore valide (sans exiger le step-up)."""
    u = users_db.get(_admin["username"], {})
    until = float(_admin.get("admin_unlock_until") or 0)
    return {
        "totp_enabled": bool(u.get("totp_enabled")),
        "step_up_valid": bool(until > time.time()),
        "expires_in_seconds": max(0, int(until - time.time())) if until > 0 else 0,
    }


async def _admin_panel_unlock_impl(request: Request, _admin: dict) -> dict:
    """Valide le TOTP (ou un code de secours) et déverrouille les routes /api/admin/* pour cette session."""
    data = await request.json()
    code = (data.get("totp_code") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="TOTP_CODE_REQUIRED")
    uname = _admin["username"]
    u = users_db.get(uname)
    if not u or not u.get("totp_enabled") or not u.get("totp_secret"):
        raise HTTPException(status_code=403, detail="ADMIN_2FA_SETUP_REQUIRED")
    totp_ok = verify_totp(u.get("totp_secret") or "", code)
    if not totp_ok:
        codes = u.get("totp_backup_codes") or []
        up = code.upper()
        if up in codes:
            u["totp_backup_codes"] = [c for c in codes if c != up]
            from db_persist import save_user
            with funds_rlock:
                save_user(uname, u)
            totp_ok = True
    if not totp_ok:
        raise HTTPException(status_code=400, detail="TOTP_INVALID")
    token = _admin.get("token", "")
    if not set_admin_unlock(token):
        raise HTTPException(status_code=500, detail="SESSION_ERROR")
    log_admin(AuditEvent.ADMIN_ACTION, uname, {"action": "admin_panel_2fa_unlock"})

    from security import ADMIN_STEP_UP_TTL
    return {"ok": True, "expires_in_seconds": ADMIN_STEP_UP_TTL}


@app.get("/api/admin/unlock-status")
def admin_unlock_status(_admin: dict = Depends(require_admin)):
    return _admin_unlock_status_payload(_admin)


@app.get("/api/session/admin-unlock-status")
def admin_unlock_status_session_alias(_admin: dict = Depends(require_admin)):
    """Same payload as /api/admin/unlock-status; not under /api/admin/ (some proxies break only that prefix)."""
    return _admin_unlock_status_payload(_admin)


@app.post("/api/admin/panel-unlock")
async def admin_panel_unlock(request: Request, _admin: dict = Depends(require_admin)):
    return await _admin_panel_unlock_impl(request, _admin)


@app.post("/api/session/admin-panel-unlock")
async def admin_panel_unlock_session_alias(request: Request, _admin: dict = Depends(require_admin)):
    """Same as POST /api/admin/panel-unlock; avoids /api/admin/ prefix issues on some setups."""
    return await _admin_panel_unlock_impl(request, _admin)


@app.post("/api/auth/admin-panel-unlock")
async def admin_panel_unlock_auth_prefix(request: Request, _admin: dict = Depends(require_admin)):
    """Same as POST /api/admin/panel-unlock; under /api/auth/ for proxies that block /api/admin/ POST."""
    return await _admin_panel_unlock_impl(request, _admin)


# --- CATEGORIES ---
@app.get("/api/categories")
def get_categories():
    return categories_db

@app.post("/api/admin/add-category")
def add_category(data: dict, _admin: dict = Depends(require_admin)):
    name = data.get("name", "").strip()
    if not name:
        return {"detail": "NAME_REQUIRED"}, 400
    if name.lower() in FORBIDDEN_CATEGORY_NAMES:
        return {"detail": "CATEGORY_FORBIDDEN"}, 400
    parent = (data.get("parent") or "").strip().lower()
    if parent and parent in FORBIDDEN_CATEGORY_NAMES:
        return {"detail": "PARENT_CATEGORY_FORBIDDEN"}, 400
    # Check si la categorie existe deja
    if any(c["name"] == name for c in categories_db):
        return {"detail": "CATEGORY_EXISTS"}, 400
    cat_id = name.lower().replace(" ", "_").replace("/", "_")
    categories_db.append({
        "id": cat_id,
        "name": name,
        "parent": data.get("parent") or None,
        "icon": data.get("icon", "📦")
    })
    return {"status": "success"}

@app.post("/api/admin/delete-category")
def delete_category(data: dict, _admin: dict = Depends(require_admin)):
    name = data.get("name")
    global categories_db
    categories_db = [c for c in categories_db if c["name"] != name]
    return {"status": "success"}


# ============================================================
# ANTI-PHISHING - Phrase personnalisee pour verifier le site
# Flux: 1) User entre son ID -> 2) Voit sa phrase -> 3) Entre son password
# ============================================================

@app.post("/api/auth/check-user")
def check_user_antiphishing(data: dict):
    """
    Etape A du login : ne FAIT PAS d'enumeration (meme reponse pour user inconnu / connu).
    La phrase anti-phishing n'est dans tous les cas jamais retournee avant authentification.
    Le client doit toujours afficher l'ecran "phrase shown after successful login".
    """
    username = (data.get("username") or "").strip()
    # Rate limit applique meme pour des usernames inconnus (anti-bruteforce d'enumeration).
    if not check_rate_limit("check_user", username or "anonymous"):
        retry = get_rate_limit_retry_after("check_user", username or "anonymous")
        return {"detail": "RATE_LIMITED", "retry_after": retry}, 429

    # Reponse generique constante pour ne pas distinguer existant / inexistant.
    return {
        "exists": True,
        "has_phrase": False,
        "message": "Phrase is shown only after successful login.",
    }

@app.post("/api/user/anti-phishing-phrase")
def set_anti_phishing_phrase(data: dict, session: dict = Depends(get_current_session)):
    """Configurer ou modifier la phrase anti-phishing d'un user"""
    username = data.get("username")
    phrase = data.get("phrase", "").strip()
    password = data.get("password")

    if not username or username not in users_db:
        return {"detail": "USER_NOT_FOUND"}, 404

    if username != session["username"]:
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")

    if not password:
        return {"detail": "PASSWORD_REQUIRED"}, 401

    # Stored password is hashed in current builds, but keep legacy plaintext compatibility.
    stored = users_db[username].get("password", "")
    is_valid = False
    try:
        is_valid = verify_password(password, stored)
    except Exception:
        is_valid = False
    if not is_valid and stored == password:
        is_valid = True
    if not is_valid:
        return {"detail": "INVALID_PASSWORD"}, 401

    if not phrase:
        return {"detail": "PHRASE_REQUIRED", "message": "Anti-phishing phrase cannot be empty"}, 400

    if len(phrase) < 3 or len(phrase) > 100:
        return {"detail": "PHRASE_LENGTH_INVALID", "message": "Phrase must be 3-100 characters"}, 400

    users_db[username]["anti_phishing_phrase"] = phrase
    save_users_persist()  # Sauvegarder immediatement sur disque
    return {"status": "success", "message": "Anti-phishing phrase set successfully"}

@app.post("/api/user/update-avatar")
def update_user_avatar(data: dict, session: dict = Depends(get_current_session)):
    """Update user avatar (data URL or empty to clear)."""
    username = data.get("username")
    avatar = data.get("avatar")

    if not username or username not in users_db:
        return {"detail": "USER_NOT_FOUND"}, 404

    if username != session["username"]:
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")

    # Allow clearing avatar
    if avatar in (None, ""):
        users_db[username]["avatar"] = None
        save_users_persist()
        return {"status": "success", "avatar": None}

    if not isinstance(avatar, str):
        return {"detail": "INVALID_AVATAR_FORMAT"}, 400

    # Prevent oversized payloads (roughly <= 2MB base64 string).
    if len(avatar) > 2_000_000:
        return {"detail": "AVATAR_TOO_LARGE"}, 413

    users_db[username]["avatar"] = avatar
    save_users_persist()
    return {"status": "success", "avatar": avatar}

@app.get("/api/security/sessions")
def get_security_sessions(session: dict = Depends(get_current_session)):
    """Return active sessions for the authenticated user. Requires Bearer auth."""
    username = session.get("username")
    sessions = list_user_sessions(username)
    return {
        "status": "success",
        "username": username,
        "session_count": len(sessions),
        "sessions": sessions
    }

@app.post("/api/security/sessions/logout-all")
def logout_all_other_sessions(session: dict = Depends(get_current_session)):
    """Invalidate all sessions except the current one. Token comes from Bearer header (never query/body)."""
    username = session.get("username")
    current_token = session.get("token", "")
    closed = invalidate_other_sessions(username, current_token)
    return {
        "status": "success",
        "message": "Other sessions terminated",
        "closed_sessions": closed
    }

# --- WALLET: DEPOSIT & WITHDRAW ---
@app.get("/api/wallet/deposit-address/{username}")
def get_deposit_address(username: str, session: dict = Depends(get_current_session)):
    """
    Returns the user Monero deposit address.
    Creates a real subaddress via RPC when available.
    """
    if username not in users_db:
        raise HTTPException(status_code=404, detail="User not found")
        
    # Verification d'identite
    if username != session["username"] and session["role"] != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")

    user = users_db[username]
    existing_addr = user.get("xmr_address", "")
    existing_idx = user.get("xmr_address_index", None)

    rpc_address = None
    rpc_index = None
    rpc_online = False

    try:
        from monero_integration import MoneroWallet
        rpc = MoneroWallet()
        balance_check = rpc.get_balance(account_index=0)
        if balance_check is not None:
            rpc_online = True
            # Reuse the already assigned user subaddress if present.
            if existing_addr and existing_addr.startswith("8") and len(existing_addr) > 90:
                rpc_address = existing_addr
                rpc_index = existing_idx
            if existing_idx is not None:
                addrs = rpc.get_address(account_index=0, address_indices=[existing_idx])
                if addrs:
                    candidate = addrs[0].get("address", "")
                    # Safety: index 0 may be primary wallet address (starts with 4), not a subaddress.
                    if candidate and candidate.startswith("8"):
                        rpc_address = candidate
                        rpc_index = existing_idx
            if not rpc_address:
                result = rpc.create_address(account_index=0, label=f"user_{username}")
                if result and result.get("address"):
                    candidate = result["address"]
                    # Enforce subaddress format for user deposit addresses.
                    if candidate.startswith("8"):
                        rpc_address = candidate
                        rpc_index = result.get("address_index", 0)
                        users_db[username]["xmr_address"] = rpc_address
                        users_db[username]["xmr_address_index"] = rpc_index
                        save_users_persist()
    except Exception as e:
        _dev_print(f"[WALLET] RPC unavailable: {e}")

    if rpc_online and rpc_address:
        return {
            "username": username,
            "address": rpc_address,
            "address_index": rpc_index,
            "blockchain": "mainnet",
            "rpc_online": True,
            "note": "Real Monero subaddress on mainnet blockchain"
        }

    if existing_addr and len(existing_addr) > 90 and existing_addr.startswith("8"):
        return {
            "username": username,
            "address": existing_addr,
            "address_index": existing_idx,
            "blockchain": "mainnet",
            "rpc_online": False,
            "note": "Stored address - RPC offline"
        }

    raise HTTPException(
        status_code=503,
        detail="No valid user subaddress available. Ensure monero-wallet-rpc is online to generate an address starting with 8."
    )

@app.post("/api/wallet/deposit")
def deposit_funds(data: dict, session: dict = Depends(get_current_session)):
    """Admin-only dev helper to simulate a deposit."""
    if session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ADMIN_REQUIRED")
    if IS_PRODUCTION:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    username = data["username"]
    amount = float(data["amount"])
    
    if username not in users_db:
        return {"detail": "USER_NOT_FOUND"}, 404
    
    # En production, check la transaction blockchain ici
    # Pour l'instant, on simule
    with funds_rlock:
        users_db[username]["balance"] += amount
        new_bal = users_db[username]["balance"]
        save_users_persist()
    return {
        "status": "success",
        "message": f"{amount} XMR deposited",
        "new_balance": new_bal
    }

@app.post("/api/wallet/set-pin")
def set_withdrawal_pin(data: dict, session: dict = Depends(get_current_session)):
    username = data.get("username")
    pin = data.get("pin")
    if not username or not pin:
        return {"detail": "MISSING_PARAMETERS"}, 400
    if len(str(pin)) != 6 or not str(pin).isdigit():
        return {"detail": "PIN_MUST_BE_6_DIGITS"}, 400
    if username not in users_db:
        return {"detail": "USER_NOT_FOUND"}, 404
    if username != session["username"] and session["role"] != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    users_db[username]["withdrawal_pin"] = hash_pin(str(pin))
    save_users_persist()
    return {"status": "success", "message": "PIN set successfully"}

@app.post("/api/wallet/verify-pin")
def verify_withdrawal_pin(data: dict, session: dict = Depends(get_current_session)):
    username = data.get("username")
    pin = data.get("pin")
    if username not in users_db:
        return {"detail": "USER_NOT_FOUND"}, 404
    if username != session["username"] and session["role"] != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    # Check lockout first
    lockout = check_pin_lockout(username)
    if lockout["locked"]:
        secs = lockout["remaining_seconds"]
        return {"detail": "PIN_LOCKED", "remaining_seconds": secs, "message": f"Account locked. Try again in {secs}s."}, 429
    user = users_db[username]
    stored_pin = user.get("withdrawal_pin")
    if not stored_pin:
        return {"detail": "NO_PIN_SET"}, 400
    pin_ok = verify_pin(str(pin), str(stored_pin))
    if not pin_ok:
        result = record_pin_failure(username)
        return {"detail": "INVALID_PIN", "attempts_left": result["attempts_left"], "locked": result["locked"], "message": result["message"]}, 401
    # Migrate legacy plaintext PINs to hash after first successful check.
    if not str(stored_pin).startswith("$"):
        users_db[username]["withdrawal_pin"] = hash_pin(str(pin))
        save_users_persist()
    record_pin_success(username)
    return {"status": "success", "attempts_left": 5}

@app.post("/api/wallet/withdraw")
def withdraw_funds(data: dict, session: dict = Depends(get_current_session)):
    """
    DEPRECATED — cet endpoint legacy debitait le solde sans appeler le RPC Monero
    (retrait factice). Toute la logique de retrait passe maintenant par
    /api/withdrawal/submit (file de validation + appel rpc.transfer reel).
    """
    raise HTTPException(
        status_code=410,
        detail="ENDPOINT_REMOVED: use POST /api/withdrawal/submit",
    )

@app.get("/api/wallet/{username}")
def get_wallet_info(username: str, session: dict = Depends(get_current_session)):
    """
    Retourne les infos du wallet.
    Admin: balance = vraie balance RPC du hot wallet.
    Users: balance = credits internes de la plateforme.
    """
    if username not in users_db:
        raise HTTPException(status_code=404, detail="User not found")

    # Verification d'identite: un user ne peut voir que son propre wallet (sauf admin)
    if username != session["username"] and session["role"] != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")

    user = users_db[username]
    internal_balance = float(user.get("balance", 0.0))
    xmr_address = user.get("xmr_address", "")
    xmr_address_index = user.get("xmr_address_index", None)

    # Keep wallet info aligned with deposit endpoint: always prefer user subaddress (8...).
    try:
        dep = get_deposit_address(username)
        xmr_address = dep.get("address", xmr_address)
        xmr_address_index = dep.get("address_index", xmr_address_index)
    except Exception:
        pass

    rpc_balance = None
    rpc_unlocked = None
    rpc_online = False

    try:
        from monero_integration import MoneroWallet
        rpc = MoneroWallet()
        bal = rpc.get_balance(account_index=0)
        if bal is not None:
            rpc_online = True
            rpc_balance = round(bal.get("balance", 0.0), 8)
            rpc_unlocked = round(bal.get("unlocked_balance", 0.0), 8)
            if user.get("role") == "admin":
                internal_balance = rpc_balance
    except Exception as e:
        _dev_print(f"[WALLET] RPC balance check failed: {e}")

    return {
        "username": username,
        "balance": internal_balance,
        "xmr_address": xmr_address,
        "xmr_address_index": xmr_address_index,
        "role": user.get("role", "buyer"),
        "rpc_online": rpc_online,
        "rpc_balance": rpc_balance,
        "rpc_unlocked_balance": rpc_unlocked,
        "blockchain": "mainnet",
        "currency": "XMR"
    }

@app.get("/api/reviews/{vendor}")
def get_vendor_reviews(vendor: str):
    """Fetch toutes les reviews d'un vendor"""
    reviews = reviews_db.get(vendor, [])
    
    # Calculer le rating moyen
    if reviews:
        avg_rating = sum(r["rating"] for r in reviews) / len(reviews)
    else:
        avg_rating = 0
    
    return {
        "vendor": vendor,
        "reviews": reviews,
        "total_reviews": len(reviews),
        "average_rating": round(avg_rating, 1)
    }

@app.post("/api/reviews")
def submit_review(data: dict, session: dict = Depends(get_current_session)):
    """Soumettre une review apres avoir complete une order"""
    order_id = data.get("order_id")
    buyer = data.get("buyer")
    vendor = data.get("vendor")
    rating = data.get("rating")
    comment = data.get("comment", "")
    
    if not all([order_id, buyer, vendor, rating]):
        return {"detail": "MISSING_PARAMETERS"}, 400

    if buyer != session["username"]:
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    
    # Check que la order existe et est completee
    if order_id not in orders_db:
        return {"detail": "ORDER_NOT_FOUND"}, 404
    
    order = orders_db[order_id]
    if order["status"] != "completed":
        return {"detail": "ORDER_NOT_COMPLETED"}, 400
    
    if order["buyer"] != buyer or order["vendor"] != vendor:
        return {"detail": "INVALID_ORDER"}, 400
    
    # Check que l'buyer n'a pas deja laisse une review pour cette order
    if vendor in reviews_db:
        existing = [r for r in reviews_db[vendor] if r.get("order_id") == order_id]
        if existing:
            return {"detail": "REVIEW_ALREADY_EXISTS"}, 400
    
    # Create la review
    review = {
        "id": f"REV_{secrets.token_hex(6)}",
        "buyer": buyer,
        "rating": int(rating),
        "comment": comment,
        "date": datetime.utcnow().strftime("%Y-%m-%d"),
        "order_id": order_id
    }
    
    # Ajouter a la base de data
    if vendor not in reviews_db:
        reviews_db[vendor] = []
    reviews_db[vendor].append(review)
    save_review(vendor, review)  # Persist to SQLite
    
    # Mettre a jour le rating moyen du vendor
    if vendor in users_db:
        all_reviews = reviews_db[vendor]
        avg_rating = sum(r["rating"] for r in all_reviews) / len(all_reviews)
        users_db[vendor]["rating"] = round(avg_rating, 1)
    
    return {"status": "success", "review": review}

# --- ADMIN ---
@app.post("/api/admin/create-user")
async def admin_create_user(request: Request, session: dict = Depends(require_admin)):
    """
    Creates a new user account from the admin panel.
    Supporte deux formats d'appel :
      Format A (frontend App.js): { username: newUser, password: newPass, role: role }
        -> username = le nouveau compte a create (l'admin est identifie via session/header)
      Format B (API directe):     { username: admin, new_username: newUser, password: newPass, role: role }
        -> username = l'admin qui fait l'action, new_username = le nouveau compte
    """
    data = await request.json()
    raw_username = data.get("username", "").strip().lower()
    new_username_explicit = data.get("new_username", data.get("newUsername", "")).strip().lower()
    new_password = data.get("new_password", data.get("newPassword", data.get("password", ""))).strip()
    new_role = data.get("role", "buyer").strip().lower()

    admin_username = session.get("username")

    # Detecter le format d'appel
    # Format B: new_username explicitement fourni -> username = admin
    if new_username_explicit:
        if raw_username and raw_username != admin_username:
            raise HTTPException(status_code=403, detail="SESSION_USER_MISMATCH")
        new_username = new_username_explicit
    else:
        # Format A (frontend): username = le nouveau compte a create
        new_username = raw_username

    # Validation du nouveau compte
    if not new_username or len(new_username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
    if not new_password or len(new_password) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters")
    if not re.fullmatch(r"[A-Za-z0-9_\-]+", new_username):
        raise HTTPException(status_code=400, detail="Username contains invalid characters")
    if new_role not in ("buyer", "vendor"):
        raise HTTPException(status_code=400, detail="Role must be buyer or vendor")
    if new_username in users_db:
        raise HTTPException(status_code=409, detail=f"Username '{new_username}' already exists")

    # Hash du password — JAMAIS de fallback SHA-256 (sinon mots de passe en clair effectifs).
    # Si Argon2id/PBKDF2 echoue, on refuse plutot que de degrader la securite.
    try:
        from security import hash_password
        hashed = hash_password(new_password)
    except Exception as e:
        _log.error("hash_password failed in admin_create_user: %s", type(e).__name__)
        raise HTTPException(
            status_code=503,
            detail="PASSWORD_HASHING_UNAVAILABLE: install argon2-cffi (or check security.py).",
        )

    # Create le compte
    users_db[new_username] = {
        "username": new_username,
        "password": hashed,
        "role": new_role,
        "balance": 0.0,
        "created_at": datetime.utcnow().isoformat(),
        "created_by": admin_username,
        "status": "active",
        "xmr_address": "",
        "xmr_address_index": None,
        "founder_vendor_badge": False,
        "founder_vendor_serial": None,
        "founder_vendor_granted_at": None,
    }
    if new_role == "vendor":
        _assign_founder_vendor_badge(users_db[new_username])

# Generate a deposit address via the fixed RPC
    try:
        # Switch import to point to the correct file
        from monero_rpc import MoneroRPC
        rpc = MoneroRPC()
        
        # On utilise la fonction create_subaddress qu'on a validee
        result = rpc.create_subaddress(account_index=0, label=f"user_{new_username}")
        
        if result and result.get("address"):
            users_db[new_username]["xmr_address"] = result["address"]
            users_db[new_username]["xmr_address_index"] = result.get("address_index", 0)
            _dev_print(f"[WALLET] Success: 8-prefix address generated for {new_username}")
    except Exception as e:
        _dev_print(f"[WALLET] RPC error for {new_username}: {e}")
        
    # Persister
    save_users_persist()

    try:
        from audit_log import log_admin, AuditEvent
        log_admin(AuditEvent.ADMIN_ACCESS, admin_username, {
            "action": "create_user",
            "new_username": new_username,
            "role": new_role
        })
    except Exception:
        pass

    _dev_print(f"[ADMIN] User '{new_username}' (role={new_role}) created by {admin_username}")
    return {
        "success": True,
        "username": new_username,
        "role": new_role,
        "xmr_address": users_db[new_username].get("xmr_address", ""),
        "message": f"User '{new_username}' created successfully"
    }


@app.get("/api/admin/users")
def get_users(_admin: dict = Depends(require_admin)):
    return [
        {
            "username": u["username"],
            "role": u["role"],
            "status": u["status"],
            "balance": u["balance"],
            "founder_vendor_badge": bool(u.get("founder_vendor_badge")),
            "founder_vendor_serial": u.get("founder_vendor_serial"),
        }
        for u in users_db.values()
    ]

@app.get("/api/admin/seller-requests")
def get_seller_reqs(_admin: dict = Depends(require_admin)):
    return seller_requests

@app.get("/api/admin/disputes")
def get_disputes(_admin: dict = Depends(require_admin)):
    return list(disputes_db.values())

@app.get("/api/admin/dispute/{dispute_id}/chat")
def get_dispute_chat(dispute_id: str, _admin: dict = Depends(require_admin)):
    if dispute_id not in disputes_db:
        return {"detail": "DISPUTE_NOT_FOUND"}, 404
    dispute = disputes_db[dispute_id]
    order_id = dispute["order_id"]
    messages = chat_db.get(order_id, [])
    return {"dispute": dispute, "messages": messages}

@app.post("/api/orders/{order_id}/dispute")
def open_dispute(order_id: str, data: dict, session: dict = Depends(get_current_session)):
    if order_id not in orders_db:
        return {"detail": "ORDER_NOT_FOUND"}, 404
    order = orders_db[order_id]
    u = session["username"]
    if u not in (order.get("buyer"), order.get("vendor")) and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    existing = [d for d in disputes_db.values() if d["order_id"] == order_id]
    if existing:
        return {"detail": "DISPUTE_ALREADY_EXISTS"}, 400
    dispute_id = f"DIS_{secrets.token_hex(8)}"
    disputes_db[dispute_id] = {
        "id": dispute_id,
        "order_id": order_id,
        "buyer": order["buyer"],
        "vendor": order["vendor"],
        "amount_xmr": order["amount_xmr"],
        "reason": data.get("reason", "No reason provided"),
        "status": "open",
        "created_at": datetime.utcnow().isoformat()
    }
    orders_db[order_id]["status"] = "dispute"
    if order_id not in chat_db:
        chat_db[order_id] = []
    chat_db[order_id].append({
        "id": len(chat_db[order_id]) + 1,
        "sender": "SYSTEM",
        "message": f"DISPUTE OPENED by {u}. Reason: {data.get('reason', 'Not specified')}. Admin notified.",
        "timestamp": datetime.utcnow().isoformat(),
        "is_system": True
    })
    return {"status": "success", "dispute_id": dispute_id}

@app.post("/api/admin/resolve-dispute")
def resolve_dispute(data: dict, _admin: dict = Depends(require_admin)):
    dispute_id = data.get("id")
    winner = data.get("winner")
    if dispute_id not in disputes_db:
        return {"detail": "DISPUTE_NOT_FOUND"}, 404
    dispute = disputes_db[dispute_id]
    order_id = dispute["order_id"]
    order = orders_db.get(order_id)
    if not order:
        return {"detail": "ORDER_NOT_FOUND"}, 404
    amount = order["amount_xmr"]
    with funds_rlock:
        if winner == "buyer":
            if dispute["buyer"] in users_db:
                users_db[dispute["buyer"]]["balance"] = float(
                    users_db[dispute["buyer"]].get("balance", 0)
                ) + float(amount)
            resolution = f"Resolved for BUYER. {amount} XMR refunded."
        else:
            if dispute["vendor"] in users_db:
                try:
                    s = _settle_order_funds_to_vendor(
                        dispute["vendor"],
                        float(amount),
                        buyer=order.get("buyer"),
                        order_id=order_id,
                    )
                    orders_db[order_id]["settlement"] = s
                    resolution = (
                        f"Resolved for VENDOR. Net {s.get('net_xmr', 0):.6f} XMR, "
                        f"commission {s.get('commission_xmr', 0):.6f} XMR -> liquidite site."
                    )
                except RuntimeError:
                    users_db[dispute["vendor"]]["balance"] = float(
                        users_db[dispute["vendor"]].get("balance", 0)
                    ) + float(amount)
                    resolution = f"Resolved for VENDOR (fallback, pas de compte plateforme): {amount} XMR au vendeur."
            else:
                resolution = "Resolved for VENDOR but user not found"
        disputes_db[dispute_id]["status"] = "resolved"
        disputes_db[dispute_id]["winner"] = winner
        disputes_db[dispute_id]["resolved_at"] = datetime.utcnow().isoformat()
        orders_db[order_id]["status"] = "completed"
        try:
            if winner == "vendor":
                _credit_referral_on_purchase(orders_db[order_id].get("buyer"), float(amount))
        except Exception:
            pass
        save_users_persist()
    save_order(order_id, orders_db[order_id])
    if order_id in chat_db:
        chat_db[order_id].append({
            "id": len(chat_db[order_id]) + 1,
            "sender": "ADMIN",
            "message": f"RESOLVED: {resolution}",
            "timestamp": datetime.utcnow().isoformat(),
            "is_system": True
        })
    return {"status": "success", "resolution": resolution}

@app.post("/api/upgrade-vendor")
def upgrade_vendor(data: dict, session: dict = Depends(get_current_session)):
    username = data["username"]
    if username != session["username"]:
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    if username not in users_db:
        return {"detail": "USER_NOT_FOUND"}, 404
    
    # Calculer le cout en XMR (400$ / prix XMR): manuel admin > oracle > cache > defaut.
    xmr_rate = 0.0
    try:
        from withdrawal_queue import PlatformControlManager as PCM
        if PCM._get(PCM.KEY_MANUAL_CRYPTO_ENABLED) == "1":
            xmr_rate = float(PCM._get(PCM.KEY_MANUAL_XMR_USD) or 0)
    except Exception:
        pass
    if xmr_rate <= 0:
        oracle = get_prices(max_age_sec=120) or {}
        xmr_rate = float(oracle.get("xmr_usd") or 0)
    if xmr_rate <= 0:
        xmr_rate = float((_price_cache.get("xmr") or {}).get("usd") or 0)
    if xmr_rate <= 0:
        xmr_rate = 165.0
    cost_xmr = 400.0 / xmr_rate

    with funds_rlock:
        u = users_db[username]
        if u["balance"] < cost_xmr:
            return {"detail": "INSUFFICIENT_FUNDS"}, 400
        if any(req["username"] == username for req in seller_requests):
            return {"detail": "REQUEST_ALREADY_PENDING"}, 400
        # Debit, append, persist sont effectues atomiquement.
        # Si l'append ou la persistence echoue : rollback du debit pour
        # ne pas voler le solde du buyer.
        original_balance = u["balance"]
        u["balance"] = original_balance - cost_xmr
        try:
            seller_requests.append({
                "username": username,
                "paid": cost_xmr,
                "status": "pending",
            })
            save_users_persist()
        except Exception as e:
            u["balance"] = original_balance
            seller_requests[:] = [r for r in seller_requests if r.get("username") != username]
            try:
                save_users_persist()
            except Exception:
                pass
            _log.error("upgrade_vendor rollback after persist failure: %s", type(e).__name__)
            raise HTTPException(status_code=503, detail="UPGRADE_PERSIST_FAILED")
        new_bal = u["balance"]
    return {
        "status": "success",
        "message": f"Vendor upgrade request submitted. {cost_xmr:.4f} XMR deducted.",
        "cost_xmr": cost_xmr,
        "new_balance": new_bal,
    }

@app.post("/api/admin/ban-user")
def ban_user(data: dict, _admin: dict = Depends(require_admin)):
    username = data.get("username", "").strip()
    if not username:
        return {"error": "username required"}
    if username not in users_db:
        return {"error": "User not found"}
    if users_db[username].get("role") == "admin":
        return {"error": "Cannot ban admin"}
    users_db[username]["status"] = "banned"
    save_users_persist()
    return {"success": True, "message": f"{username} banned"}

@app.post("/api/admin/unban-user")
def unban_user(data: dict, _admin: dict = Depends(require_admin)):
    username = data.get("username", "").strip()
    if not username or username not in users_db:
        return {"error": "User not found"}
    users_db[username]["status"] = "active"
    save_users_persist()
    return {"success": True, "message": f"{username} unbanned"}

@app.post("/api/admin/delete-user")
def delete_user(data: dict, _admin: dict = Depends(require_admin)):
    username = data.get("username", "").strip()
    if not username:
        return {"error": "username required"}
    if username not in users_db:
        return {"error": "User not found"}
    if users_db[username].get("role") == "admin":
        return {"error": "Cannot delete admin"}
    del users_db[username]
    save_users_persist()
    to_del = [lid for lid, l in listings_db.items() if l.get("vendor") == username]
    for lid in to_del:
        del listings_db[lid]
    if to_del:
        save_all_listings(listings_db)
    return {"success": True, "message": f"{username} deleted ({len(to_del)} listings removed)"}

@app.post("/api/admin/purge-vendors-data")
def purge_vendors_data(data: dict, _admin: dict = Depends(require_admin)):
    """
    Removes all vendor accounts, all vendor listings, and all reviews.
    Requires explicit confirmation string: {"confirm":"PURGE_VENDORS"}.
    """
    if (data or {}).get("confirm") != "PURGE_VENDORS":
        raise HTTPException(status_code=400, detail="CONFIRMATION_REQUIRED")

    vendors = [uname for uname, u in users_db.items() if u.get("role") == "vendor"]
    removed_vendor_count = 0
    for uname in vendors:
        if uname in users_db:
            del users_db[uname]
            removed_vendor_count += 1

    removed_listing_count = 0
    for lid in list(listings_db.keys()):
        l = listings_db.get(lid, {})
        if l.get("vendor") in vendors:
            del listings_db[lid]
            removed_listing_count += 1

    removed_review_count = sum(len(items or []) for items in reviews_db.values())
    reviews_db.clear()

    # Remove pending vendor requests from now deleted accounts.
    if seller_requests:
        seller_requests[:] = [r for r in seller_requests if r.get("username") not in vendors]

    # Recompute founder serials if needed.
    founders = [(k, u) for k, u in users_db.items() if u.get("role") == "vendor" and u.get("founder_vendor_badge")]
    founders.sort(key=lambda pair: ((pair[1].get("founder_vendor_serial") or 10**9), pair[0].lower()))
    for idx, (_, vuser) in enumerate(founders, start=1):
        vuser["founder_vendor_serial"] = idx

    save_all_users(users_db)
    save_users_persist()
    save_all_listings(listings_db)
    save_all_reviews(reviews_db)

    return {
        "status": "success",
        "vendors_removed": removed_vendor_count,
        "listings_removed": removed_listing_count,
        "reviews_removed": removed_review_count,
    }

def _find_listing_db_key(listing_id: str):
    """Cle dans listings_db, ou None si introuvable."""
    if listing_id in listings_db:
        return listing_id
    for k, v in listings_db.items():
        if str(v.get("id", "")) == str(listing_id):
            return k
    return None


def _resolve_listing_db_key(listing_id: str) -> str:
    k = _find_listing_db_key(listing_id)
    if k is None:
        raise HTTPException(status_code=404, detail="LISTING_NOT_FOUND")
    return k


@app.delete("/api/admin/listing/{listing_id}")
def admin_delete_listing(listing_id: str, _admin: dict = Depends(require_admin)):
    key = _find_listing_db_key(listing_id)
    if not key:
        return {"error": "Listing not found"}
    del listings_db[key]
    save_all_listings(listings_db)
    return {"success": True, "message": f"Listing {key} deleted"}


def _admin_apply_listing_image(key: str, image, admin_username: str) -> dict:
    """Met a jour le champ image en memoire + SQLite (+ JSON vendor si besoin).

    Securite : seules les data URLs sont acceptees. Les URL http(s) sont refusees
    car le navigateur les fetcherait depuis le service Tor — fuites
    (DNS, IP destinataire, fingerprint TLS) cote operateur de l'image et des
    visiteurs. Les images doivent etre integrees en base64 (data:image/...).
    """
    if image is None or (isinstance(image, str) and not str(image).strip()):
        listings_db[key]["image"] = None
    else:
        if not isinstance(image, str):
            raise HTTPException(status_code=400, detail="INVALID_IMAGE")
        image = image.strip()
        if len(image) > 2_500_000:
            raise HTTPException(status_code=400, detail="IMAGE_TOO_LARGE")
        head = image[:32].lower()
        if not head.startswith("data:image/"):
            raise HTTPException(status_code=400, detail="IMAGE_MUST_BE_DATA_URL")
        # Whitelist stricte des MIME types (anti SVG/XSS).
        allowed_mimes = ("data:image/png;", "data:image/jpeg;", "data:image/webp;", "data:image/gif;")
        if not any(image.lower().startswith(m) for m in allowed_mimes):
            raise HTTPException(status_code=400, detail="IMAGE_MIME_NOT_ALLOWED")
        listings_db[key]["image"] = image
    listings_db[key]["id"] = key
    save_listing(key, listings_db[key])
    if listings_db[key].get("is_vendor_listing"):
        save_vendor_listings()
    try:
        log_admin(
            AuditEvent.ADMIN_ACTION,
            admin_username,
            {"action": "listing_image_update", "listing_id": key},
        )
    except Exception:
        pass
    return {"success": True, "message": "Listing image updated", "id": key}


@app.post("/api/admin/listing-image")
async def admin_update_listing_image_post(request: Request, _admin: dict = Depends(require_admin)):
    """
    Admin: changer la photo d'un listing (POST JSON — prefere en dev car certains proxies bloquent PUT).
    Body: { \"listing_id\": \"LST_...\", \"image\": \"data:image/...\" | \"https://...\" | null }
    """
    data = await request.json()
    listing_id = str(data.get("listing_id", "")).strip()
    if not listing_id:
        raise HTTPException(status_code=400, detail="MISSING_LISTING_ID")
    if "image" not in data:
        raise HTTPException(status_code=400, detail="MISSING_IMAGE")
    key = _resolve_listing_db_key(listing_id)
    return _admin_apply_listing_image(key, data.get("image"), _admin.get("username", "admin"))


@app.put("/api/admin/listing/{listing_id}/image")
async def admin_update_listing_image(listing_id: str, request: Request, _admin: dict = Depends(require_admin)):
    """Admin: meme effet que POST /api/admin/listing-image (data URL ou URL http(s))."""
    key = _resolve_listing_db_key(str(listing_id).strip())
    data = await request.json()
    if "image" not in data:
        raise HTTPException(status_code=400, detail="MISSING_IMAGE")
    return _admin_apply_listing_image(key, data.get("image"), _admin.get("username", "admin"))

@app.post("/api/admin/approve-seller")
def approve_seller(data: dict, _admin: dict = Depends(require_admin)):
    username = data["username"]
    if username in users_db:
        users_db[username]["role"] = "vendor"
        _assign_founder_vendor_badge(users_db[username])
        global seller_requests
        seller_requests = [r for r in seller_requests if r["username"] != username]
        save_users_persist()
    return {"status": "success"}

# ============================================================
# PGP KEY MANAGEMENT
# ============================================================

@app.get("/api/antiphish")
def get_antiphish_phrase(username: str, session: dict = Depends(get_current_session)):
    """Phrase anti-phishing : uniquement pour le compte connecte (jamais en pre-auth)."""
    uname = (username or "").strip()
    if uname != session["username"] and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    if uname not in users_db:
        return {"phrase": None, "exists": False, "has_phrase": False}
    phrase = users_db[uname].get("anti_phishing_phrase")
    return {"phrase": phrase, "exists": True, "has_phrase": phrase is not None}

@app.get("/api/pgp/{username}")
def get_pgp_key(username: str, session: dict = Depends(get_current_session)):
    """
    Retourne la cle publique PGP d'un user. Necessite une session authentifiee
    (anti-enumeration). Ne distingue pas user inconnu / existant: meme shape de reponse.
    """
    user = users_db.get(username) or {}
    pub = user.get("pgp_public_key") or user.get("pgp_key")
    return {
        "username": username,
        "pgp_key": pub,
        "pgp_public_key": pub,
        "pgp_fingerprint": user.get("pgp_fingerprint"),
        "has_pgp": bool(pub),
        "pgp_setup_completed": _pgp_setup_completed(user) if user else False,
    }

@app.get("/api/pgp/{username}/private")
def get_pgp_private_key(username: str, session: dict = Depends(get_current_session)):
    """
    DEPRECATED — la cle privee est generee et detenue UNIQUEMENT par le client
    (openpgp.js, voir frontend/src/pgpClient.js). Le serveur ne la voit jamais.
    Cet endpoint reste pour compatibilite frontend mais retourne 410.
    """
    raise HTTPException(
        status_code=410,
        detail="ENDPOINT_REMOVED: PGP private keys are stored client-side only. "
               "Generate a key in your browser via the on-boarding flow.",
    )


@app.post("/api/pgp/setup")
def setup_mandatory_pgp(data: dict, session: dict = Depends(get_current_session)):
    """
    DEPRECATED — la generation de paire est faite cote client (openpgp.js).
    Pour migrer un compte legacy depuis le navigateur, le client envoie sa
    nouvelle cle publique via POST /api/pgp/set.
    """
    raise HTTPException(
        status_code=410,
        detail="ENDPOINT_REMOVED: generate the keypair in your browser, "
               "then submit only the public key via POST /api/pgp/set.",
    )

@app.post("/api/pgp/validate")
def validate_pgp_key(data: dict):
    """Valide une cle publique PGP et retourne son empreinte"""
    key_str = data.get("pgp_key", "")
    result = validate_pgp_public_key(key_str)
    return result

@app.post("/api/pgp/set")
def set_pgp_key(data: dict, session: dict = Depends(get_current_session)):
    username = data.get("username")
    pgp_key = data.get("pgp_key", "").strip()
    token = session["token"]
    
    if not username or username not in users_db:
        raise HTTPException(status_code=404, detail="USER_NOT_FOUND")
    
    # Verification d'identite
    if username != session["username"]:
        raise HTTPException(status_code=403, detail="IDENTITY_MISMATCH")
    if not check_rate_limit("pgp_set", token):
        retry = get_rate_limit_retry_after("pgp_set", token)
        raise HTTPException(status_code=429, detail=f"RATE_LIMITED_PGP_SET_{retry}s")
    if pgp_key:
        # Valider la cle
        validation = validate_pgp_public_key(pgp_key)
        if not validation["valid"]:
            return {"detail": "INVALID_PGP_KEY", "error": validation["error"]}, 400
        users_db[username]["pgp_public_key"] = pgp_key
        users_db[username]["pgp_key"] = pgp_key  # Compatibility
        users_db[username]["pgp_fingerprint"] = validation["fingerprint"]
        users_db[username]["pgp_setup_completed"] = True
    else:
        users_db[username]["pgp_public_key"] = None
        users_db[username]["pgp_key"] = None
        users_db[username]["pgp_fingerprint"] = None
        users_db[username]["pgp_setup_completed"] = False
    save_users_persist()
    return {"status": "success", "message": "PGP key saved", "fingerprint": users_db[username].get("pgp_fingerprint")}

@app.post("/api/pgp/encrypt")
def encrypt_message_endpoint(data: dict, session: dict = Depends(get_current_session)):
    """
    DEPRECATED — le serveur ne chiffre plus de message a la place du client
    (cela exigeait que le serveur voie le plaintext, ce qui annule l'E2E).
    Le client doit encrypter localement avec openpgp.js (voir frontend/src/pgpClient.js).
    """
    raise HTTPException(
        status_code=410,
        detail="ENDPOINT_REMOVED: encrypt messages client-side with openpgp.js. "
               "Fetch /api/pgp/<recipient> for the public key, then send the armored ciphertext.",
    )


def _legacy_pgp_encrypt_disabled(*args, **kwargs):
    raise HTTPException(status_code=410, detail="ENDPOINT_REMOVED")


# Le code ci-dessous correspond a l'ancienne implementation interne ; conservee
# pour eviter de casser des callers Python internes mais inerte.
def __unused_old_encrypt_message_endpoint(data: dict, session: dict):
    token = session.get("token") or session["username"]
    if not check_rate_limit("pgp_encrypt", token):
        retry = get_rate_limit_retry_after("pgp_encrypt", token)
        raise HTTPException(status_code=429, detail=f"RATE_LIMITED_PGP_ENCRYPT_{retry}s")
    recipient = data.get("recipient")
    message = data.get("message", "")
    if not isinstance(message, str):
        raise HTTPException(status_code=400, detail="INVALID_MESSAGE")
    if len(message) > 48_000:
        raise HTTPException(status_code=413, detail="MESSAGE_TOO_LARGE")
    if not recipient or recipient not in users_db:
        raise HTTPException(status_code=400, detail="RECIPIENT_INVALID_OR_NO_PGP")
    user = users_db[recipient]
    pub_key = user.get("pgp_public_key") or user.get("pgp_key")
    if not pub_key:
        raise HTTPException(status_code=400, detail="RECIPIENT_INVALID_OR_NO_PGP")
    result = encrypt_message(pub_key, message)
    if not result.get("encrypted"):
        raise HTTPException(status_code=503, detail="ENCRYPTION_FAILED")
    return result

# ============================================================
# WARRANT CANARY
# ============================================================
WARRANT_CANARY_TEXT = """-----BEGIN PGP SIGNED MESSAGE-----
Hash: SHA256

SILKGENESIS WARRANT CANARY
Date: {date}

As of the date above, SilkGenesis has:

[✓] Received ZERO subpoenas, warrants, or legal demands
[✓] Received ZERO National Security Letters (NSLs)
[✓] Received ZERO gag orders or court orders
[✓] NOT been compromised, seized, or infiltrated
[✓] NOT been forced to install backdoors or surveillance
[✓] Infrastructure remains UNCOMPROMISED
[✓] No user data has been disclosed to any third party

This canary is updated monthly. If this message disappears
or is not updated, assume the worst and act accordingly.

SilkGenesis Admin Team
-----BEGIN PGP SIGNATURE-----
[Admin PGP Signature Placeholder - Replace with real signature]
-----END PGP SIGNATURE-----"""
WARRANT_CANARY_LAST_UPDATED = datetime.utcnow()
WARRANT_CANARY_STATE_FILE = os.path.join(persist_base_dir(), "warrant_canary.json")


def _load_warrant_canary_date() -> None:
    """Restore last canary date from disk so /api/canary survives restarts."""
    global WARRANT_CANARY_LAST_UPDATED
    try:
        if os.path.isfile(WARRANT_CANARY_STATE_FILE):
            with open(WARRANT_CANARY_STATE_FILE, encoding="utf-8") as f:
                data = json.load(f)
            s = (data.get("last_updated") or "").strip()
            if s:
                if s.endswith("Z"):
                    s = s[:-1]
                dt = datetime.fromisoformat(s)
                if dt.tzinfo is not None:
                    dt = dt.replace(tzinfo=None)
                WARRANT_CANARY_LAST_UPDATED = dt
    except Exception:
        pass


def _save_warrant_canary_date(dt: datetime) -> None:
    try:
        with open(WARRANT_CANARY_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump({"last_updated": dt.isoformat()}, f, indent=2)
    except Exception:
        pass


_load_warrant_canary_date()

@app.get("/api/canary")
def get_warrant_canary():
    """Warrant canary - updated monthly"""
    updated = WARRANT_CANARY_LAST_UPDATED
    return {
        "canary_text": WARRANT_CANARY_TEXT.format(date=updated.strftime("%Y-%m-%d")),
        "last_updated": updated.strftime("%Y-%m-%d"),
        "status": "ACTIVE",
        "pgp_fingerprint": "PLACEHOLDER - Admin must set real PGP key"
    }


@app.post("/api/admin/canary/update")
async def update_warrant_canary(_admin: dict = Depends(require_admin)):
    """Force canary date update to now (admin-only)."""
    global WARRANT_CANARY_LAST_UPDATED
    WARRANT_CANARY_LAST_UPDATED = datetime.utcnow()
    _save_warrant_canary_date(WARRANT_CANARY_LAST_UPDATED)
    log_admin(
        AuditEvent.ADMIN_ACTION,
        _admin.get("username", "admin"),
        {"action": "canary_update", "last_updated": WARRANT_CANARY_LAST_UPDATED.strftime("%Y-%m-%d")},
    )
    return {
        "status": "ok",
        "last_updated": WARRANT_CANARY_LAST_UPDATED.strftime("%Y-%m-%d"),
        "message": "Canary updated",
    }

# ============================================================
# PGP ENCRYPTION HELPER (server-side)
# ============================================================
def encrypt_message_pgp(message: str, recipient_pgp_key: str) -> dict:
    """
    Tente de chiffrer un message avec la cle PGP du destinataire.
    Utilise pgpy si disponible, sinon retourne le message non chiffre avec warning.
    """
    try:
        import pgpy
        key, _ = pgpy.PGPKey.from_blob(recipient_pgp_key)
        msg = pgpy.PGPMessage.new(message)
        encrypted = key.encrypt(msg)
        return {
            "encrypted": True,
            "content": str(encrypted),
            "warning": None
        }
    except ImportError:
        # pgpy non installe - message non chiffre avec avertissement
        return {
            "encrypted": False,
            "content": message,
            "warning": "PGP_LIB_NOT_AVAILABLE"
        }
    except Exception as e:
        return {
            "encrypted": False,
            "content": message,
            "warning": f"ENCRYPTION_FAILED: {str(e)[:100]}"
        }

# ============================================================
# SYSTEM BANNER
# ============================================================
system_banner = {
    "active": True,
    "message": "🚀 LAUNCH SPECIAL: Become a Vendor for only $200 - Reduced commission rates for early vendors! Limited time offer.",
    "type": "promo",  # promo | warning | info | maintenance
    "color": "amber"
}

@app.get("/api/system/banner")
def get_banner():
    return system_banner

@app.post("/api/admin/set-banner")
def set_banner(data: dict, _admin: dict = Depends(require_admin)):
    global system_banner
    system_banner = {
        "active": data.get("active", True),
        "message": data.get("message", ""),
        "type": data.get("type", "info"),
        "color": data.get("color", "amber")
    }
    return {"status": "success"}

# ============================================================
# FEATURED PRODUCTS (Admin)
# ============================================================
featured_listings = set()  # Set of listing IDs that are featured

@app.post("/api/admin/feature-listing")
def feature_listing(data: dict, _admin: dict = Depends(require_admin)):
    listing_id = data.get("listing_id")
    featured = data.get("featured", True)
    if listing_id not in listings_db:
        return {"detail": "LISTING_NOT_FOUND"}, 404
    if featured:
        featured_listings.add(listing_id)
        listings_db[listing_id]["featured"] = True
    else:
        featured_listings.discard(listing_id)
        listings_db[listing_id]["featured"] = False
    return {"status": "success"}

@app.get("/api/listings/featured")
def get_featured_listings():
    items = [
        _sanitize_listing_for_client(listings_db[lid])
        for lid in featured_listings
        if lid in listings_db and listings_db[lid]["status"] == "active"
    ]
    return {"items": items}

# ============================================================
# VENDOR LEVEL ROUTES
# ============================================================
@app.get("/api/vendor/{username}/level")
def get_vendor_level_route(username: str):
    level = get_vendor_level(username)
    user = users_db.get(username, {})
    return {
        "username": username,
        "level": level,
        "total_sales": user.get("total_sales", 0),
        "total_volume_xmr": user.get("total_volume_xmr", 0.0),
        "levels": VENDOR_LEVELS
    }

@app.get("/api/vendor-levels")
def get_all_levels():
    return {"levels": VENDOR_LEVELS}


@app.get("/api/affiliate/program")
def affiliate_program_endpoint():
    """Public: vendor tier examples + affiliate split rules for the Affiliation page."""
    return program_static_payload(VENDOR_LEVELS)


@app.get("/api/affiliate/leaderboard")
def affiliate_leaderboard_endpoint():
    return {
        "month": datetime.utcnow().strftime("%Y-%m"),
        "top": leaderboard_current_month(10),
    }


@app.get("/api/affiliate/overview")
def affiliate_overview_endpoint(session: dict = Depends(get_current_session)):
    """Authenticated: earnings, attributed volume, referral code, payout history."""
    raw = (session.get("username") or "").strip()
    uname = _resolve_user_db_key(raw) or raw
    if not uname or uname not in users_db:
        raise HTTPException(status_code=404, detail="USER_NOT_FOUND")
    st = stats_for_user(uname)
    hist = payments_for_user(uname)
    existing = None
    for _, data in referrals_db.items():
        if data.get("owner") == uname:
            existing = data
            break
    if not existing:
        rc = generate_referral_code(uname)
        existing = referrals_db[rc]
    ref_code = existing.get("code")
    ref_signups = len(existing.get("referrals") or [])
    return {
        "stats": {
            **st,
            "referral_signups": ref_signups,
        },
        "payments": hist[:50],
        "referral_code": ref_code,
    }


# ============================================================
# REFERRAL ROUTES
# ============================================================
@app.get("/api/referral/{username}")
def get_referral_info(username: str, session: dict = Depends(get_current_session)):
    """Obtenir ou create le code de parrainage d'un user"""
    if username != session["username"] and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    if username not in users_db:
        return {"detail": "USER_NOT_FOUND"}, 404
    # Chercher si l'user a deja un code
    existing = None
    for code, data in referrals_db.items():
        if data["owner"] == username:
            existing = data
            break
    if not existing:
        code = generate_referral_code(username)
        existing = referrals_db[code]
    # Compter les filleuls
    referrer_of = users_db[username].get("referred_by", None)
    return {
        "code": existing["code"],
        "uses": existing["uses"],
        "earnings_xmr": existing["earnings_xmr"],
        "referrals": existing["referrals"],
        "referred_by": referrer_of,
        "bonus_per_referral": REFERRAL_BONUS_REFERRER
    }

@app.post("/api/referral/apply")
def apply_referral(data: dict, session: dict = Depends(get_current_session)):
    """Appliquer un code de parrainage (compte connecte uniquement)."""
    code = data.get("code", "").strip().upper()
    username = data.get("username")
    if not code or not username:
        return {"detail": "MISSING_DATA"}, 400
    if username != session["username"]:
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    if username not in users_db:
        return {"detail": "USER_NOT_FOUND"}, 404
    if code not in referrals_db:
        return {"detail": "INVALID_CODE"}, 400
    ref_data = referrals_db[code]
    if ref_data["owner"] == username:
        return {"detail": "CANNOT_REFER_YOURSELF"}, 400
    if users_db[username].get("referred_by"):
        return {"detail": "ALREADY_REFERRED"}, 400
    with funds_rlock:
        users_db[username]["referred_by"] = ref_data["owner"]
        users_db[username]["referred_by_code"] = code
        users_db[username]["referral_joined_at"] = datetime.utcnow().isoformat()
        users_db[username]["balance"] = users_db[username].get("balance", 0) + REFERRAL_BONUS_REFEREE
        owner = ref_data["owner"]
        if owner in users_db:
            users_db[owner]["balance"] = users_db[owner].get("balance", 0) + REFERRAL_BONUS_REFERRER
        referrals_db[code]["uses"] += 1
        referrals_db[code]["earnings_xmr"] += REFERRAL_BONUS_REFERRER
        referrals_db[code]["referrals"].append({
            "username": username,
            "joined_at": datetime.utcnow().isoformat()
        })
        new_bal = users_db[username]["balance"]
        save_users_persist()
    return {
        "status": "success",
        "message": f"Referral applied! You received {REFERRAL_BONUS_REFEREE} XMR bonus.",
        "bonus_received": REFERRAL_BONUS_REFEREE,
        "new_balance": new_bal
    }

# ============================================================
# MONERO / ESCROW ENDPOINTS
# ============================================================

@app.get("/api/xmr/status")
def get_xmr_status(request: Request):
    """En production, les soldes du wallet marchand ne sont visibles que pour un admin authentifie."""
    rpc = get_rpc()
    connected = rpc.is_connected()
    result = {
        "connected": connected,
        "fee_percent": MARKETPLACE_FEE_PERCENT,
        "min_confirmations": MIN_CONFIRMATIONS,
        "mode": "live" if connected else "offline"
    }
    auth = request.headers.get("Authorization", "")
    token = ""
    if auth.startswith("Bearer "):
        token = auth.split(" ", 1)[1].strip()
    sess = validate_session(token) if token else None
    show_sensitive = (not IS_PRODUCTION) or (sess and sess.get("role") == "admin")
    if connected and show_sensitive:
        balance = rpc.get_balance()
        if balance:
            result["master_wallet_balance_xmr"] = round(balance["balance_xmr"], 6)
            result["master_wallet_unlocked_xmr"] = round(balance["unlocked_xmr"], 6)
        height = rpc.get_height()
        if height:
            result["blockchain_height"] = height
    return result

@app.get("/api/order/{order_id}/payment")
def get_order_payment_status(order_id: str, session: dict = Depends(get_current_session)):
    order = orders_db.get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="ORDER_NOT_FOUND")
    u = session["username"]
    if u not in (order.get("buyer"), order.get("vendor")) and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    status = escrow.get_order_payment_status(order_id)
    return status

@app.post("/api/order/{order_id}/release")
def release_order_funds(order_id: str, data: dict = {}, session: dict = Depends(get_current_session)):
    if order_id not in orders_db:
        raise HTTPException(status_code=404, detail="ORDER_NOT_FOUND")
    o0 = orders_db[order_id]
    # Verification d'identite: seul le buyer de la order peut release (ou admin)
    if o0["buyer"] != session["username"] and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    with funds_rlock:
        order = orders_db[order_id]
        if order.get("status") in ("completed", "cancelled", "refunded"):
            raise HTTPException(status_code=400, detail="ORDER_ALREADY_SETTLED")
        if order.get("status") == "dispute":
            raise HTTPException(status_code=400, detail="ORDER_IN_DISPUTE")

        vendor = order.get("vendor")
        if not vendor or vendor not in users_db:
            raise HTTPException(status_code=404, detail="VENDOR_NOT_FOUND")
        amount = float(order.get("amount_xmr", 0) or 0)
        if amount <= 0:
            raise HTTPException(status_code=400, detail="INVALID_ORDER_AMOUNT")
        if order.get("funding_mode") and order.get("funding_mode") != "internal_balance":
            raise HTTPException(
                status_code=501, detail="Mode de funding non pris en charge (utiliser multisig on-chain).",
            )
        try:
            s = _settle_order_funds_to_vendor(
                vendor,
                amount,
                buyer=order.get("buyer"),
                order_id=order_id,
            )
        except RuntimeError:
            raise HTTPException(
                status_code=503,
                detail="Compte plateforme (admin) introuvable pour la liquidite (commission).",
            )
        orders_db[order_id]["status"] = "completed"
        orders_db[order_id]["escrow_status"] = "released"
        orders_db[order_id]["escrow_balance"] = 0
        orders_db[order_id]["completed_at"] = datetime.utcnow().isoformat()
        orders_db[order_id]["settlement"] = s
        try:
            _credit_referral_on_purchase(order.get("buyer"), float(amount))
        except Exception:
            pass
    save_order(order_id, orders_db[order_id])
    if order_id in chat_db:
        chat_db[order_id].append({
            "id": len(chat_db[order_id]) + 1,
            "sender": "SYSTEM",
            "message": (
                f"FUNDS RELEASED (escrow interne). Net {s.get('net_xmr', 0):.6f} XMR -> vendeur, "
                f"commission {s.get('commission_xmr', 0):.6f} XMR -> liquidite site "
                f"({s.get('commission_pct', 0):.1f} %, niveau {s.get('level_name', '')})."
            ),
            "timestamp": datetime.utcnow().isoformat(),
            "is_system": True
        })
    return {
        "status": "success",
        "message": "Escrow regle: net credite au vendeur, commission a la liquidite site.",
        "vendor_amount_xmr": s.get("net_xmr"),
        "marketplace_fee_xmr": s.get("commission_xmr"),
        "commission_pct": s.get("commission_pct"),
        "vendor_level": s.get("level_name"),
        "settlement": s,
    }

@app.get("/api/deposit/status/{address}")
def get_deposit_status(address: str, session: dict = Depends(get_current_session)):
    """Ne divulgue le statut que pour l'adresse de depot du compte connecte (ou admin)."""
    addr = (address or "").strip()
    user = users_db.get(session["username"], {})
    own = (user.get("xmr_address") or "").strip()
    if session.get("role") != "admin" and addr != own:
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    status = escrow.get_deposit_status(addr)
    if status:
        return status
    return {"status": "not_found", "address": addr}

@app.get("/api/qr/monero")
def generate_monero_qr(
    uri: Optional[str] = None,
    address: Optional[str] = None,
    amount: Optional[float] = None,
    size: int = 240,
    session: dict = Depends(get_current_session),
):
    """
    Generate Monero QR server-side (offline, no third-party API).
    Use either `uri=monero:...` or `address=...` (+ optional amount).
    Session obligatoire (anti abus CPU / scraping).
    """
    token = session.get("token") or session["username"]
    if not check_rate_limit("qr_monero", token):
        retry = get_rate_limit_retry_after("qr_monero", token)
        raise HTTPException(status_code=429, detail=f"RATE_LIMITED_QR_{retry}s")
    payload = (uri or "").strip()
    if not payload:
        addr = (address or "").strip()
        if not addr:
            raise HTTPException(status_code=400, detail="MISSING_QR_DATA")
        payload = f"monero:{addr}"
        if amount is not None and float(amount) > 0:
            payload += f"?tx_amount={float(amount):.12f}"

    qr_size = max(128, min(int(size or 240), 512))
    try:
        import qrcode
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=2,
        )
        qr.add_data(payload)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
        img = img.resize((qr_size, qr_size))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return Response(
            content=buf.getvalue(),
            media_type="image/png",
            headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"QR_GENERATION_FAILED: {e}")

@app.get("/api/xmr/deposit-diagnostics/{username}")
def get_user_deposit_diagnostics(username: str, session: dict = Depends(get_current_session)):
    """
    Debug/ops endpoint: inspect user deposit address health and recent inbound txs.
    Useful to validate real on-chain credit workflow.
    """
    if session["username"] != username and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    if username not in users_db:
        raise HTTPException(status_code=404, detail="USER_NOT_FOUND")

    user = users_db[username]
    address = user.get("xmr_address", "")
    credited_txids = user.get("credited_deposit_txids", [])

    rpc = get_rpc()
    rpc_online = rpc.is_connected()

    recent_matches = []
    pending_matches = []
    confirmed_matches = []

    if rpc_online and address:
        try:
            result = rpc.get_transfers(account_index=0, min_height=0) or {}
            transfers = result.get("in", []) + result.get("pool", [])
            for tx in transfers:
                tx_address = tx.get("address", "")
                if tx_address != address:
                    continue
                txid = tx.get("txid") or tx.get("tx_hash", "")
                amount_atomic = tx.get("amount", 0)
                confirmations = int(tx.get("confirmations", 0) or 0)
                row = {
                    "txid": txid,
                    "amount_xmr": amount_atomic / 1e12,
                    "confirmations": confirmations,
                    "credited": txid in credited_txids
                }
                recent_matches.append(row)
                if confirmations >= MIN_CONFIRMATIONS:
                    confirmed_matches.append(row)
                else:
                    pending_matches.append(row)
        except Exception as e:
            return {
                "status": "error",
                "detail": "RPC_READ_FAILED",
                "error": str(e),
                "username": username,
                "address": address,
                "rpc_online": rpc_online
            }

    return {
        "status": "success",
        "username": username,
        "address": address,
        "address_index": user.get("xmr_address_index"),
        "rpc_online": rpc_online,
        "min_confirmations": MIN_CONFIRMATIONS,
        "internal_balance_xmr": float(user.get("balance", 0.0)),
        "credited_txids_count": len(credited_txids) if isinstance(credited_txids, list) else 0,
        "recent_incoming_for_address": recent_matches[:30],
        "pending_incoming": pending_matches[:30],
        "confirmed_incoming": confirmed_matches[:30]
    }

@app.post("/api/xmr/scan")
def manual_scan(session: dict = Depends(get_current_session)):
    if session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ADMIN_REQUIRED")
    confirmed = escrow.scan_incoming_transactions()
    return {"status": "success", "newly_confirmed": len(confirmed), "transactions": confirmed}

# ============================================================
# MNEMONIC SEED PHRASE - Recuperation securisee
# ============================================================

@app.post("/api/wallet/mnemonic")
async def get_wallet_mnemonic(request: Request, session: dict = Depends(get_current_session)):
    """
    Retourne la seed phrase mnemonic du Master Wallet Monero.
    SECURITY:
    - Accessible uniquement par l'admin
    - Necessite le password admin
    - Appelle monero-wallet-rpc query_key
    - Ne stocke JAMAIS la seed en memoire
    """
    data = await request.json()
    username = data.get("username", "")
    password = data.get("password", "")

    # Session identity and role enforcement
    if session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if username != session.get("username"):
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")

    # Validate user exists
    if username not in users_db:
        raise HTTPException(status_code=404, detail="User not found")

    user = users_db[username]
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    if not verify_password(password, user.get("password", "")):
        raise HTTPException(status_code=401, detail="Invalid password")

    # Appeler le RPC pour obtenir la seed
    rpc = get_rpc()
    if not rpc.is_connected():
        return {
            "success": False,
            "error": "Monero RPC not connected. Start monero-wallet-rpc first.",
            "mnemonic": None,
            "offline": True
        }

    try:
        import requests as _req
        payload = {
            "jsonrpc": "2.0", "id": "0",
            "method": "query_key",
            "params": {"key_type": "mnemonic"}
        }
        # Use RPC credentials from .rpc_credentials when available
        auth = None
        _rpc_creds_file = os.path.join(os.path.dirname(__file__), '.rpc_credentials')
        if os.path.exists(_rpc_creds_file):
            try:
                with open(_rpc_creds_file, 'r') as _f:
                    _lines = _f.read().strip().split('\n')
                    _rpc_user = next((l.split('=',1)[1] for l in _lines if l.startswith('RPC_USER=')), None)
                    _rpc_pass = next((l.split('=',1)[1] for l in _lines if l.startswith('RPC_PASS=')), None)
                    if _rpc_user and _rpc_pass:
                        auth = (_rpc_user, _rpc_pass)
            except Exception:
                pass

        resp = _req.post(MONERO_RPC_URL, json=payload, timeout=30, auth=auth)
        if resp.status_code == 200:
            result = resp.json()
            if "result" in result:
                mnemonic = result["result"].get("key", "")
                if mnemonic:
                    # Log l'acces (sans la seed elle-meme)
                    _dev_print(f"[SECURITY] Admin {username} accessed wallet mnemonic at {datetime.utcnow().isoformat()}")
                    log_admin(AuditEvent.ADMIN_MNEMONIC, username)
                    return {
                        "success": True,
                        "mnemonic": mnemonic,
                        "word_count": len(mnemonic.split()),
                        "warning": "WRITE THIS DOWN OFFLINE. Never share it. Anyone with this phrase controls all funds.",
                        "offline": False
                    }
            if "error" in result:
                return {
                    "success": False,
                    "error": result["error"].get("message", "RPC error"),
                    "mnemonic": None
                }
    except Exception as e:
        return {
            "success": False,
            "error": f"RPC call failed: {str(e)}",
            "mnemonic": None
        }

    return {"success": False, "error": "Unknown error", "mnemonic": None}


@app.get("/api/auto-finalize/status")
def get_auto_finalize_status():
    """Voir les orders qui seront bientot auto-finalisees"""
    now = datetime.utcnow()
    pending = []
    for order_id, order in orders_db.items():
        if order["status"] == "shipped":
            shipped_at_str = order.get("shipped_at")
            if shipped_at_str:
                shipped_at = datetime.fromisoformat(shipped_at_str)
                days_elapsed = (now - shipped_at).total_seconds() / 86400
                days_remaining = max(0, AUTO_FINALIZE_DAYS - days_elapsed)
                pending.append({
                    "order_id": order_id,
                    "buyer": order["buyer"],
                    "vendor": order["vendor"],
                    "amount_xmr": order["amount_xmr"],
                    "days_elapsed": round(days_elapsed, 1),
                    "days_remaining": round(days_remaining, 1),
                    "auto_finalize_at": (shipped_at.replace(microsecond=0).isoformat())
                })
    return {"auto_finalize_days": AUTO_FINALIZE_DAYS, "pending": pending}


# Release funds endpoint added via patch


# ============================================================
# ADMIN CATEGORIES MANAGEMENT (in-memory)
# ============================================================

@app.post("/api/admin/categories")
async def admin_add_category(request: Request, _admin: dict = Depends(require_admin)):
    """Admin: Add parent or child category"""
    data = await request.json()
    name = data.get("name", "").strip()
    icon = data.get("icon", "📦")
    parent = data.get("parent", None)  # parent category name

    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if name.lower() in FORBIDDEN_CATEGORY_NAMES:
        raise HTTPException(status_code=400, detail="CATEGORY_FORBIDDEN")
    if parent and parent.strip().lower() in FORBIDDEN_CATEGORY_NAMES:
        raise HTTPException(status_code=400, detail="PARENT_CATEGORY_FORBIDDEN")

    # Check duplicate
    if any(c["name"] == name for c in categories_db):
        raise HTTPException(status_code=400, detail="Category already exists")

    # Validate parent exists if provided
    if parent and not any(c["name"] == parent for c in categories_db):
        raise HTTPException(status_code=404, detail="Parent category not found")

    cat_id = name.lower().replace(" ", "_").replace("/", "_").replace("&", "and")
    new_cat = {"id": cat_id, "name": name, "parent": parent, "icon": icon}
    categories_db.append(new_cat)

    return {"status": "success", "category": new_cat}


@app.put("/api/admin/categories/{cat_name}")
async def admin_update_category(cat_name: str, request: Request, _admin: dict = Depends(require_admin)):
    """Admin: Update category"""
    data = await request.json()
    for cat in categories_db:
        if cat["name"] == cat_name:
            if "icon" in data:
                cat["icon"] = data["icon"]
            if "name" in data:
                cat["name"] = data["name"]
            return {"status": "success"}
    raise HTTPException(status_code=404, detail="Category not found")


@app.delete("/api/admin/categories/{cat_name}")
async def admin_delete_category_by_name(cat_name: str, _admin: dict = Depends(require_admin)):
    """Admin: Delete category"""
    global categories_db
    before = len(categories_db)
    categories_db = [c for c in categories_db if c["name"] != cat_name and c.get("parent") != cat_name]
    deleted = before - len(categories_db)
    return {"status": "success", "deleted": deleted}


# ============================================================
# CATEGORIES FLAT LIST (for frontend selects)
# ============================================================

@app.get("/api/categories/flat")
def get_categories_flat():
    """Return flat list of categories with parent_id for frontend selects"""
    result = []
    for cat in categories_db:
        parent_name = cat.get("parent")
        parent_id = None
        if parent_name:
            parent_obj = next((c for c in categories_db if c["name"] == parent_name), None)
            if parent_obj:
                parent_id = parent_obj["id"]
        result.append({
            "id": cat["id"],
            "name": cat["name"],
            "icon": cat.get("icon", "📦"),
            "parent_id": parent_id,
            "parent_name": parent_name
        })
    return {"categories": result}


# ============================================================
# PRODUCTS BY CATEGORY (in-memory)
# ============================================================

@app.get("/api/products/by-category/{category_name}")
async def get_products_by_category(category_name: str, page: int = 1, limit: int = 20):
    """Get products filtered by category name (includes sub-categories)"""
    # Find the category
    cat = next((c for c in categories_db if c["name"] == category_name or c["id"] == category_name), None)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    # Get sub-category names
    sub_names = [c["name"] for c in categories_db if c.get("parent") == cat["name"]]
    all_names = [cat["name"]] + sub_names

    # Filter products
    filtered = [v for v in listings_db.values() if v.get("category") in all_names and v.get("status") == "active"]
    total = len(filtered)
    offset = (page - 1) * limit
    page_items = [_sanitize_listing_for_client(v) for v in filtered[offset:offset + limit]]

    return {"products": page_items, "total": total, "page": page, "pages": max(1, (total + limit - 1) // limit)}




# ============================================================
# HEALTH CHECK + ADMIN AUDIT LOGS
# ============================================================

# ============================================================
# DEAD MAN SWITCH ENDPOINTS
# ============================================================
@app.post("/api/admin/dms/checkin")
async def dms_checkin_endpoint(request: Request, _admin: dict = Depends(require_admin)):
    """Admin checks in to prevent dead man switch trigger"""
    from security import dms_checkin, dms_status
    data = await request.json()
    username = data.get("username", "")
    if username not in users_db or users_db[username].get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    result = dms_checkin()
    return result

@app.get("/api/admin/dms/status")
async def dms_status_endpoint(request: Request, _admin: dict = Depends(require_admin)):
    """Get dead man switch status"""
    from security import dms_status
    username = request.query_params.get("username", "")
    if username not in users_db or users_db[username].get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return dms_status()

@app.post("/api/admin/dms/configure")
async def dms_configure_endpoint(request: Request, _admin: dict = Depends(require_admin)):
    """Configure dead man switch"""
    from security import dms_configure
    data = await request.json()
    username = data.get("username", "")
    if username not in users_db or users_db[username].get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    dms_configure(
        enabled=data.get("enabled", False),
        interval_hours=data.get("interval_hours", 72),
        action=data.get("action", "shutdown")
    )
    log_admin(
        AuditEvent.ADMIN_ACTION,
        username,
        {
            "action": "dms_configure",
            "enabled": bool(data.get("enabled", False)),
            "interval_hours": data.get("interval_hours", 72),
            "action_type": data.get("action", "shutdown"),
        },
    )
    return {"status": "success"}

# ============================================================
# EMERGENCY SHUTDOWN
# ============================================================
@app.post("/api/admin/emergency-shutdown")
async def emergency_shutdown(request: Request, _admin: dict = Depends(require_admin)):
    """Emergency shutdown - stops the server immediately"""
    data = await request.json()
    username = data.get("username", "")
    if username not in users_db or users_db[username].get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    _dev_print(f"[EMERGENCY] Shutdown initiated by {username}")
    log_admin(AuditEvent.ADMIN_ACCESS, username, {"action": "emergency_shutdown"})
    # Schedule shutdown after response is sent
    import threading
    def _shutdown():
        import time as _t
        _t.sleep(1)
        os._exit(0)
    threading.Thread(target=_shutdown, daemon=True).start()
    return {"status": "shutdown_initiated", "message": "Server shutting down in 1 second"}

# ============================================================
# VENDOR TRUST SCORE
# ============================================================
@app.get("/api/vendor/{username}/trust-score")
def get_vendor_trust_score(username: str):
    """Calculate algorithmic trust score for a vendor"""
    if username not in users_db:
        raise HTTPException(status_code=404, detail="Vendor not found")
    user = users_db[username]
    reviews = reviews_db.get(username, [])
    
    # Base score components
    total_sales = user.get("total_sales", 0)
    total_volume = user.get("total_volume_xmr", 0.0)
    avg_rating = sum(r["rating"] for r in reviews) / len(reviews) if reviews else 0
    review_count = len(reviews)
    
    # Calculate trust score (0-100)
    sales_score = min(30, total_sales * 0.3)  # Max 30 pts from sales
    volume_score = min(20, total_volume * 2)   # Max 20 pts from volume
    rating_score = (avg_rating / 5) * 30       # Max 30 pts from rating
    review_score = min(20, review_count * 2)   # Max 20 pts from review count
    
    trust_score = round(sales_score + volume_score + rating_score + review_score, 1)
    
    # Trust level
    if trust_score >= 80:
        trust_level = "Elite"
        trust_color = "#9b59b6"
    elif trust_score >= 60:
        trust_level = "Trusted"
        trust_color = "#27ae60"
    elif trust_score >= 40:
        trust_level = "Established"
        trust_color = "#f39c12"
    elif trust_score >= 20:
        trust_level = "New"
        trust_color = "#3498db"
    else:
        trust_level = "Unverified"
        trust_color = "#555"
    
    return {
        "username": username,
        "trust_score": trust_score,
        "trust_level": trust_level,
        "trust_color": trust_color,
        "components": {
            "sales_score": round(sales_score, 1),
            "volume_score": round(volume_score, 1),
            "rating_score": round(rating_score, 1),
            "review_score": round(review_score, 1),
        },
        "stats": {
            "total_sales": total_sales,
            "total_volume_xmr": round(total_volume, 4),
            "avg_rating": round(avg_rating, 1),
            "review_count": review_count,
        }
    }



# ============================================================
# MULTISIG 2/3 ENDPOINTS
# ============================================================
try:
    import multisig as _ms
    MULTISIG_AVAILABLE = True
    _dev_print("[MULTISIG] Module loaded - 2/3 escrow available")
except ImportError as e:
    MULTISIG_AVAILABLE = False
    _dev_print(f"[MULTISIG] Not available: {e}")

@app.post("/api/multisig/create")
async def create_multisig(request: Request, session: dict = Depends(get_current_session)):
    """Create a 2/3 multisig wallet for an order"""
    data = await request.json()
    order_id = data.get("order_id", "")
    buyer = data.get("buyer", "")
    vendor = data.get("vendor", "")
    amount_xmr = float(data.get("amount_xmr", 0))
    if not all([order_id, buyer, vendor, amount_xmr]):
        raise HTTPException(status_code=400, detail="Missing parameters")
    if not MULTISIG_AVAILABLE:
        raise HTTPException(status_code=503, detail="Multisig module not available")
    order = orders_db.get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="ORDER_NOT_FOUND")
    if session.get("role") != "admin" and session.get("username") not in (order.get("buyer"), order.get("vendor")):
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    wallet = _ms.create_multisig_wallet(order_id, buyer, vendor, amount_xmr)
    # Also link to order
    if order_id in orders_db:
        orders_db[order_id]["multisig_address"] = wallet["multisig_address"]
        orders_db[order_id]["multisig_enabled"] = True
    return wallet

@app.get("/api/multisig/{order_id}")
async def get_multisig(order_id: str, session: dict = Depends(get_current_session)):
    """Get multisig wallet info for an order"""
    if not MULTISIG_AVAILABLE:
        raise HTTPException(status_code=503, detail="Multisig not available")
    order = orders_db.get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="ORDER_NOT_FOUND")
    if session.get("role") != "admin" and session.get("username") not in (order.get("buyer"), order.get("vendor")):
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    wallet = _ms.get_multisig_wallet(order_id)
    if not wallet:
        raise HTTPException(status_code=404, detail="Multisig wallet not found")
    return wallet

@app.post("/api/multisig/{order_id}/sign")
async def sign_multisig_endpoint(order_id: str, request: Request, session: dict = Depends(get_current_session)):
    """Sign the multisig release transaction"""
    order = orders_db.get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="ORDER_NOT_FOUND")
    signer = session.get("username", "")
    if session.get("role") == "admin":
        role = "admin"
    elif signer == order.get("buyer"):
        role = "buyer"
    elif signer == order.get("vendor"):
        role = "vendor"
    else:
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    if not MULTISIG_AVAILABLE:
        raise HTTPException(status_code=503, detail="Multisig not available")
    result = _ms.sign_multisig(order_id, signer, role)
    if result.get("release", {}).get("success") and order_id in orders_db:
        with funds_rlock:
            cur = orders_db[order_id]
            cur["status"] = "completed"
            cur["completed_at"] = datetime.utcnow().isoformat()
            cur["multisig_tx"] = result["release"].get("tx_hash")
            vendor = cur.get("vendor")
            amount = float(cur.get("amount_xmr", 0) or 0)
            if vendor and amount > 0 and not cur.get("settlement"):
                try:
                    s = _settle_order_funds_to_vendor(
                        vendor,
                        amount,
                        buyer=cur.get("buyer"),
                        order_id=order_id,
                    )
                    cur["settlement"] = s
                except RuntimeError:
                    pass
            save_order(order_id, cur)
    return result

@app.post("/api/multisig/{order_id}/dispute")
async def open_multisig_dispute(order_id: str, request: Request, session: dict = Depends(get_current_session)):
    """Open a dispute on a multisig order"""
    data = await request.json()
    order = orders_db.get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="ORDER_NOT_FOUND")
    opener = session.get("username", "")
    if session.get("role") != "admin" and opener not in (order.get("buyer"), order.get("vendor")):
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    reason = data.get("reason", "No reason provided")
    if not MULTISIG_AVAILABLE:
        raise HTTPException(status_code=503, detail="Multisig not available")
    result = _ms.open_dispute(order_id, opener, reason)
    if result.get("success") and order_id in orders_db:
        orders_db[order_id]["status"] = "dispute"
    return result

@app.get("/api/admin/multisig")
async def admin_get_multisig(_admin: dict = Depends(require_admin)):
    """Admin: Get all multisig wallets"""
    if not MULTISIG_AVAILABLE:
        return []
    return _ms.get_all_multisig()

@app.get("/api/admin/multisig/summary")
async def admin_multisig_summary(_admin: dict = Depends(require_admin)):
    """Admin: Get multisig summary stats"""
    if not MULTISIG_AVAILABLE:
        return {"total": 0, "error": "Multisig not available"}
    return _ms.get_multisig_status_summary()

@app.post("/api/admin/multisig/{order_id}/resolve")
async def admin_resolve_multisig(order_id: str, request: Request, session: dict = Depends(require_admin)):
    """Admin: Resolve a multisig dispute"""
    data = await request.json()
    admin = session.get("username", "")
    winner = data.get("winner", "")
    if not MULTISIG_AVAILABLE:
        raise HTTPException(status_code=503, detail="Multisig not available")
    result = _ms.resolve_dispute(order_id, admin, winner)
    if result.get("success") and order_id in orders_db:
        with funds_rlock:
            o = orders_db[order_id]
            if result.get("resolution") == "buyer_refunded":
                o["status"] = "refunded"
                buyer = o.get("buyer")
                amount = o.get("amount_xmr", 0)
                if buyer and buyer in users_db:
                    users_db[buyer]["balance"] = float(users_db[buyer].get("balance", 0)) + float(amount)
                    save_users_persist()
            else:
                o["status"] = "completed"
                if not o.get("settlement") and o.get("vendor") and o.get("amount_xmr"):
                    try:
                        s = _settle_order_funds_to_vendor(
                            o["vendor"],
                            float(o["amount_xmr"]),
                            buyer=o.get("buyer"),
                            order_id=order_id,
                        )
                        o["settlement"] = s
                    except RuntimeError:
                        pass
            save_order(order_id, o)
    return result




# ============================================================
# VENDOR BOND SYSTEM - VERSION FINALE
# ============================================================
try:
    from vendor_bond import (
        get_all_bond_config, get_bond_amount_xmr, get_bond_config_for_category,
        admin_update_bond_config, admin_add_category_bond,
        create_bond, can_request_refund, request_refund,
        admin_approve_refund, admin_reject_refund, admin_seize_bond,
        record_dispute_result, get_public_bond_info,
        get_vendor_history, get_all_history, get_pending_refunds, get_bond_stats,
        get_bond_amount
    )
    BOND_V2_AVAILABLE = True
    _dev_print("[BOND V2] Vendor Bond system loaded")
except ImportError as e:
    BOND_V2_AVAILABLE = False
    _dev_print(f"[BOND V2] Not available: {e}")


@app.get("/api/bonds/config")
async def get_bonds_config():
    """Retourner la configuration publique des bonds par categorie"""
    if not BOND_V2_AVAILABLE:
        return {"config": {}}
    return {"config": get_all_bond_config()}

@app.get("/api/bonds/config/{category_name}")
async def get_bond_config_cat(category_name: str):
    """Retourner la config du bond pour une categorie specifique"""
    if not BOND_V2_AVAILABLE:
        return {"xmr": 2.0, "risk": "medium"}
    return get_bond_config_for_category(category_name)

@app.post("/api/admin/bonds/config")
async def admin_set_bond_config(request: Request, _admin: dict = Depends(require_admin)):
    """Admin: Modifier le montant du bond pour une categorie"""
    data = await request.json()
    admin = data.get("username", "") or _admin.get("username")
    if admin != _admin.get("username"):
        raise HTTPException(status_code=403, detail="SESSION_USER_MISMATCH")
    if not BOND_V2_AVAILABLE:
        raise HTTPException(status_code=503, detail="Bond system not available")
    category = data.get("category", "")
    xmr = float(data.get("xmr", 0))
    if not category or xmr <= 0:
        raise HTTPException(status_code=400, detail="category and xmr required")
    result = admin_update_bond_config(
        category_name=category,
        xmr=xmr,
        usd_equiv=data.get("usd_equiv"),
        risk=data.get("risk"),
        color=data.get("color"),
        admin=admin
    )
    return {"status": "success", "config": result}

@app.post("/api/vendor/bond/pay-v2")
async def pay_vendor_bond_v2(request: Request, session: dict = Depends(get_current_session)):
    """Vendor paie son bond (version finale avec config par categorie)"""
    data = await request.json()
    username = data.get("username", "")
    if username != session.get("username") and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    category = data.get("category", "default")
    user = users_db.get(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not BOND_V2_AVAILABLE:
        raise HTTPException(status_code=503, detail="Bond system not available")
    # Obtenir le montant XMR pour cette categorie
    amount_xmr = get_bond_amount_xmr(category)
    cfg = get_bond_config_for_category(category)
    # Verifier le balance
    with funds_rlock:
        user = users_db.get(username) or user
        if user.get("balance", 0) < amount_xmr:
            raise HTTPException(status_code=400, detail=f"Insufficient balance. Need {amount_xmr} XMR for {category} bond")
        bal_before = float(user.get("balance", 0))
        user["balance"] = round(bal_before - amount_xmr, 8)
        try:
            _credit_platform_liquidity_xmr(amount_xmr)
        except RuntimeError:
            user["balance"] = bal_before
            raise HTTPException(
                status_code=503,
                detail="Compte plateforme (admin) introuvable pour crediter la liquidite du bond.",
            )
        bond = create_bond(username, category, amount_xmr, cfg.get("usd_equiv", 0))
        vendor_bonds_db[username] = bond
        save_vendor_bond(username, bond)
        save_users_persist()
    return {
        "success": True,
        "bond": bond,
        "amount_xmr": amount_xmr,
        "category": category,
        "risk_level": cfg.get("risk", "medium"),
        "refund_eligible_after_days": 90,
        "message": f"Bond of {amount_xmr} XMR paid for {category} (credited to site liquidity)",
    }

@app.get("/api/vendor/bond/v2/{username}")
async def get_vendor_bond_v2(username: str):
    """Retourner les infos du bond d'un vendor (avec historique)"""
    bond = vendor_bonds_db.get(username)
    if not bond:
        return {"has_bond": False, "username": username}
    refund_info = can_request_refund(bond) if BOND_V2_AVAILABLE else {}
    public_info = get_public_bond_info(bond) if BOND_V2_AVAILABLE else {}
    history = get_vendor_history(username) if BOND_V2_AVAILABLE else []
    return {
        **bond,
        "has_bond": True,
        "refund_eligible": refund_info.get("eligible", False),
        "days_remaining": refund_info.get("days_remaining", 0),
        "eligible_date": refund_info.get("eligible_date"),
        "required_days": refund_info.get("required_days", 90),
        "public_info": public_info,
        "history": history[:20]  # Derniers 20 evenements
    }

@app.get("/api/vendor/bond/public/{username}")
async def get_vendor_bond_public(username: str):
    """Profil public: infos bond visibles par tous"""
    bond = vendor_bonds_db.get(username)
    if not BOND_V2_AVAILABLE:
        return {"has_bond": False}
    return get_public_bond_info(bond)

@app.post("/api/vendor/bond/request-refund")
async def vendor_request_bond_refund(request: Request, session: dict = Depends(get_current_session)):
    """Vendor demande le remboursement de son bond"""
    data = await request.json()
    username = data.get("username", "")
    if username != session.get("username") and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")
    bond = vendor_bonds_db.get(username)
    if not bond:
        raise HTTPException(status_code=404, detail="No bond found")
    if not BOND_V2_AVAILABLE:
        raise HTTPException(status_code=503, detail="Bond system not available")
    result = request_refund(bond, username)
    if result.get("success"):
        vendor_bonds_db[username] = bond
        save_vendor_bond(username, bond)
    return result

@app.post("/api/admin/bonds/approve-refund")
async def admin_approve_bond_refund(request: Request, _admin: dict = Depends(require_admin)):
    """Admin: Approuver le remboursement d'un bond"""
    data = await request.json()
    admin = data.get("admin", "") or _admin.get("username")
    vendor = data.get("vendor", "")
    if admin != _admin.get("username"):
        raise HTTPException(status_code=403, detail="SESSION_USER_MISMATCH")
    bond = vendor_bonds_db.get(vendor)
    if not bond:
        raise HTTPException(status_code=404, detail="Bond not found")
    if not BOND_V2_AVAILABLE:
        raise HTTPException(status_code=503, detail="Bond system not available")
    if bond.get("status") != "refund_pending":
        return admin_approve_refund(bond, vendor, admin)
    amount = float(bond.get("amount_xmr", 0) or 0)
    with funds_rlock:
        try:
            _debit_platform_liquidity_xmr(amount)
        except RuntimeError:
            raise HTTPException(
                status_code=503,
                detail="Compte plateforme (admin) introuvable pour debiter la liquidite du remboursement.",
            )
        result = admin_approve_refund(bond, vendor, admin)
        if not result.get("success"):
            try:
                _credit_platform_liquidity_xmr(amount)
            except RuntimeError:
                pass
            return result
        if vendor in users_db:
            users_db[vendor]["balance"] = round(users_db[vendor].get("balance", 0) + amount, 8)
            save_users_persist()
        vendor_bonds_db[vendor] = bond
        save_vendor_bond(vendor, bond)
    return result

@app.post("/api/admin/bonds/reject-refund")
async def admin_reject_bond_refund(request: Request, _admin: dict = Depends(require_admin)):
    """Admin: Rejeter la demande de remboursement"""
    data = await request.json()
    admin = data.get("admin", "") or _admin.get("username")
    vendor = data.get("vendor", "")
    reason = data.get("reason", "")
    if admin != _admin.get("username"):
        raise HTTPException(status_code=403, detail="SESSION_USER_MISMATCH")
    bond = vendor_bonds_db.get(vendor)
    if not bond:
        raise HTTPException(status_code=404, detail="Bond not found")
    if not BOND_V2_AVAILABLE:
        raise HTTPException(status_code=503, detail="Bond system not available")
    result = admin_reject_refund(bond, vendor, admin, reason)
    if result.get("success"):
        vendor_bonds_db[vendor] = bond
        save_vendor_bond(vendor, bond)
    return result

@app.post("/api/admin/bonds/seize")
async def admin_seize_vendor_bond(request: Request, _admin: dict = Depends(require_admin)):
    """Admin: Confisquer le bond d'un vendor"""
    data = await request.json()
    admin = data.get("admin", "") or _admin.get("username")
    vendor = data.get("vendor", "")
    reason = data.get("reason", "Rule violation")
    if admin != _admin.get("username"):
        raise HTTPException(status_code=403, detail="SESSION_USER_MISMATCH")
    bond = vendor_bonds_db.get(vendor)
    if not bond:
        raise HTTPException(status_code=404, detail="Bond not found")
    if not BOND_V2_AVAILABLE:
        raise HTTPException(status_code=503, detail="Bond system not available")
    result = admin_seize_bond(bond, vendor, admin, reason)
    if result.get("success"):
        # Pas de credit admin ici: le bond avait deja ete credite dans la liquidite site au paiement (pay-v2).
        vendor_bonds_db[vendor] = bond
        save_vendor_bond(vendor, bond)
    return result

@app.get("/api/admin/bonds/pending-refunds")
async def admin_get_pending_refunds(_admin: dict = Depends(require_admin)):
    """Admin: View all bonds pending refund"""
    if not BOND_V2_AVAILABLE:
        return []
    return get_pending_refunds(vendor_bonds_db)

@app.get("/api/admin/bonds/stats")
async def admin_get_bond_stats(_admin: dict = Depends(require_admin)):
    """Admin: Stats globales des bonds"""
    if not BOND_V2_AVAILABLE:
        return {"total": 0}
    return get_bond_stats(vendor_bonds_db)

@app.get("/api/admin/bonds/history")
async def admin_get_bond_history(request: Request, _admin: dict = Depends(require_admin)):
    """Admin: Historique complet de tous les bonds"""
    if not BOND_V2_AVAILABLE:
        return []
    limit = int(request.query_params.get("limit", 100))
    return get_all_history(limit=limit)

@app.get("/api/vendor/bond/history/{username}")
async def get_vendor_bond_history(username: str):
    """Historique des bonds d'un vendor (pour lui-meme)"""
    if not BOND_V2_AVAILABLE:
        return []
    return get_vendor_history(username)


@app.get("/api/health")
def health_check(request: Request):
    """Health check endpoint for monitoring. Anonymous: minimal info only.
    With Bearer + admin session: includes counts and admin_step_up (2FA panel)."""
    db_exists = os.path.exists(get_db_path())
    backups = list_backups()
    out = {
        "status": "ok",
        "version": "2.0",
        "db_exists": db_exists,
        "uptime": "running",
    }
    auth = request.headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        token = auth.split(" ", 1)[1].strip()
        sess = validate_session(token)
        if sess and sess.get("role") == "admin":
            # Donnees operationnelles seulement pour les admins.
            out["users"] = len(users_db)
            out["products"] = len(listings_db)
            out["orders"] = len(orders_db)
            out["last_backup"] = backups[0]["created_at"] if backups else None
            out["backup_count"] = len(backups)
            uname = sess.get("username")
            uadmin = users_db.get(uname) or {}
            until = float(sess.get("admin_unlock_until") or 0)
            out["admin_step_up"] = {
                "totp_enabled": bool(uadmin.get("totp_enabled")),
                "step_up_valid": bool(until > time.time()),
                "expires_in_seconds": max(0, int(until - time.time())) if until > 0 else 0,
            }
    return out


@app.post("/api/health/admin-step-up")
async def health_admin_step_up(request: Request, _admin: dict = Depends(require_admin)):
    """Same as POST /api/admin/panel-unlock; under /api/health/ so it is proxied like GET /api/health (avoids 404 on /api/admin/* in some setups)."""
    return await _admin_panel_unlock_impl(request, _admin)


_AUDIT_LOG_MAX_ROWS = 1000


@app.get("/api/admin/audit-logs")
async def get_audit_logs(request: Request, _admin: dict = Depends(require_admin)):
    """Get recent audit logs (admin only) — authentification Bearer obligatoire.
    Le parametre `n` est borne (1..1000) pour eviter qu'un admin compromis n'utilise
    cet endpoint pour exfiltrer la base d'audit en un seul appel."""
    try:
        n_raw = int(request.query_params.get("n", 100))
    except (TypeError, ValueError):
        n_raw = 100
    n = max(1, min(_AUDIT_LOG_MAX_ROWS, n_raw))
    severity = request.query_params.get("severity", None)
    if severity not in (None, "INFO", "WARNING", "ERROR", "SECURITY", "ADMIN"):
        severity = None
    logs = get_recent_logs(n=n, severity_filter=severity)
    return {"logs": logs, "count": len(logs), "max_n": _AUDIT_LOG_MAX_ROWS}

@app.post("/api/admin/backup")
async def trigger_backup(request: Request, _admin: dict = Depends(require_admin)):
    """Trigger manual backup (admin only)"""
    data = await request.json()
    username = _admin.get("username")
    password = data.get("password", "")
    user = users_db.get(username)
    if not user or not verify_password(password, user.get("password", "")):
        raise HTTPException(status_code=401, detail="Invalid password")
    backup_file = backup_now()
    log_admin(AuditEvent.ADMIN_ACCESS, username, {"action": "manual_backup", "file": backup_file})
    return {"status": "success", "backup_file": backup_file, "backups": list_backups()}
# ============================================================
# 2FA TOTP ENDPOINTS
# ============================================================


@app.post("/api/2fa/verify-setup")
async def verify_2fa_setup(request: Request, session: dict = Depends(get_current_session)):
    """Verify TOTP code to activate 2FA"""
    data = await request.json()
    username = data.get("username", "")
    code = data.get("code", "")
    require_self_or_admin(username, session)

    if username not in users_db:
        raise HTTPException(status_code=404, detail="User not found")

    pending_secret = users_db[username].get("totp_secret_pending")
    if not pending_secret:
        raise HTTPException(status_code=400, detail="No pending 2FA setup. Call /api/2fa/setup first.")

    if not verify_totp(pending_secret, code):
        raise HTTPException(status_code=401, detail="Invalid TOTP code. Check your authenticator app.")

    # Activate 2FA
    users_db[username]["totp_secret"] = pending_secret
    users_db[username]["totp_enabled"] = True
    users_db[username].pop("totp_secret_pending", None)
    save_users_persist()

    return {"status": "success", "message": "2FA activated successfully!"}




@app.post("/api/v1/vendor/withdraw")
async def vendor_withdraw(request: Request, session: dict = Depends(get_current_session)):
    """Vendor withdraws XMR from their balance to an external address (in-memory)."""
    data = await request.json()
    vendor_username = data.get("username", "").strip()
    destination_address = data.get("address", "").strip()
    amount_xmr = float(data.get("amount", 0))

    if not vendor_username:
        raise HTTPException(status_code=400, detail="Username required")

    if vendor_username not in users_db:
        raise HTTPException(status_code=404, detail="Vendor not found")
    if vendor_username != session.get("username") and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")

    vendor = users_db[vendor_username]

    if vendor.get("role") not in ("vendor", "admin"):
        raise HTTPException(status_code=403, detail="Only vendors can withdraw")

    if amount_xmr < MIN_WITHDRAWAL_XMR:
        raise HTTPException(status_code=400, detail=f"Minimum withdrawal: {MIN_WITHDRAWAL_XMR} XMR")
    if amount_xmr > MAX_WITHDRAWAL_XMR:
        raise HTTPException(status_code=400, detail=f"Maximum withdrawal: {MAX_WITHDRAWAL_XMR} XMR")
    if not (destination_address.startswith("4") or destination_address.startswith("8")) or len(destination_address) < 95:
        raise HTTPException(status_code=400, detail="INVALID_XMR_ADDRESS")

    total_needed = amount_xmr + WITHDRAWAL_NETWORK_FEE_XMR

    with funds_rlock:
        v = users_db[vendor_username]
        bal = float(v.get("balance", 0))
        if bal < total_needed:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient balance. Available: {bal:.6f} XMR, Needed: {total_needed:.6f} XMR",
            )
        last_wd = v.get("last_withdrawal")
        if last_wd:
            try:
                last_dt = datetime.fromisoformat(last_wd)
                elapsed = (datetime.utcnow() - last_dt).total_seconds()
                if elapsed < WITHDRAWAL_COOLDOWN_SECONDS:
                    wait = int(WITHDRAWAL_COOLDOWN_SECONDS - elapsed)
                    raise HTTPException(status_code=429, detail=f"Withdrawal cooldown: wait {wait}s")
            except ValueError:
                pass
        balance_before = bal
        last_wd_before = last_wd
        new_balance = round(bal - total_needed, 8)
        v["balance"] = new_balance
        v["last_withdrawal"] = datetime.utcnow().isoformat()

    tx_hash = None
    amount_sent = round(amount_xmr, 8)

    try:
        rpc = MoneroWallet()
        transfer = rpc.transfer(
            destinations=[{"amount": int(amount_xmr * 1e12), "address": destination_address}],
            account_index=0,
            priority=2,
        )
        if transfer:
            tx_hash = transfer.get("tx_hash")
    except Exception as e:
        _dev_print(f"[WITHDRAW] RPC transfer failed: {e}")

    if not tx_hash:
        with funds_rlock:
            users_db[vendor_username]["balance"] = balance_before
            users_db[vendor_username]["last_withdrawal"] = last_wd_before
        raise HTTPException(status_code=503, detail="Withdrawal failed. Balance restored. RPC unavailable.")

    with funds_rlock:
        save_users_persist()

    return {
        "status": "success",
        "message": f"Withdrawal of {amount_sent} XMR initiated",
        "amount_xmr": amount_sent,
        "network_fee_xmr": WITHDRAWAL_NETWORK_FEE_XMR,
        "destination": destination_address,
        "tx_hash": tx_hash,
        "new_balance": new_balance,
        "rpc_mode": "live"
    }


@app.get("/api/vendor/{username}/dashboard")
def vendor_dashboard(username: str, session: dict = Depends(get_current_session)):
    """Returns vendor level, commission rate, balance, and progress to next level (in-memory)."""
    require_self_or_admin(username, session)
    if username not in users_db:
        raise HTTPException(status_code=404, detail="Vendor not found")

    vendor = users_db[username]
    total_sales = vendor.get("total_sales", 0)
    total_volume = float(vendor.get("total_volume_xmr", 0.0))
    balance = float(vendor.get("balance", 0.0))

    # Get level
    level = get_vendor_level(username)
    commission_rate = level["commission"]

    # Find next level
    current_idx = next((i for i, l in enumerate(VENDOR_LEVELS) if l["name"] == level["name"]), 0)
    next_level_data = None
    progress_pct = 100
    sales_to_next = 0

    if current_idx + 1 < len(VENDOR_LEVELS):
        nl = VENDOR_LEVELS[current_idx + 1]
        next_level_data = nl
        sales_in_range = total_sales - level["min_sales"]
        range_size = nl["min_sales"] - level["min_sales"]
        progress_pct = min(99, int((sales_in_range / range_size) * 100)) if range_size > 0 else 99
        sales_to_next = nl["min_sales"] - total_sales

    return {
        "username": username,
        "total_sales": total_sales,
        "total_volume_xmr": round(total_volume, 6),
        "balance": round(balance, 8),
        "level": {
            "name": level["name"],
            "icon": level["icon"],
            "color": level["color"],
            "commission_rate": commission_rate,
            "commission_pct": round(commission_rate * 100, 1)
        },
        "next_level": {
            "name": next_level_data["name"],
            "icon": next_level_data["icon"],
            "commission_pct": round(next_level_data["commission"] * 100, 1),
            "min_sales": next_level_data["min_sales"],
            "sales_needed": sales_to_next
        } if next_level_data else None,
        "progress_to_next_pct": progress_pct,
        "all_levels": [
            {
                "name": l["name"],
                "icon": l["icon"],
                "color": l["color"],
                "commission_pct": round(l["commission"] * 100, 1),
                "min_sales": l["min_sales"],
                "unlocked": total_sales >= l["min_sales"]
            }
            for l in VENDOR_LEVELS
        ]
    }


# ============================================================
# PHASE 2 IMPORTS (lazy - ne bloque pas si absent)
# ============================================================
try:
    from totp_auth import generate_totp_secret, generate_qr_code_base64, verify_totp, generate_backup_codes
    TOTP_AVAILABLE = True
    _dev_print("[2FA] TOTP module loaded")
except ImportError as e:
    TOTP_AVAILABLE = False
    _dev_print(f"[2FA] TOTP not available: {e}")

try:
    import dead_man_switch as dms
    dms.start()
    DMS_AVAILABLE = True
except ImportError as e:
    DMS_AVAILABLE = False
    _dev_print(f"[DMS] Dead Man Switch not available: {e}")

try:
    from vendor_bond import get_bond_amount, can_request_refund, create_bond
    BOND_AVAILABLE = True
    _dev_print("[BOND] Vendor Bond module loaded")
except ImportError as e:
    BOND_AVAILABLE = False
    _dev_print(f"[BOND] Vendor Bond not available: {e}")

# Storage Phase 2
totp_pending = {}       # {username: secret}
# Load les vendor bonds depuis SQLite au demarrage
vendor_bonds_db = load_all_vendor_bonds()
_dev_print(f"[DB] Vendor bonds loaded: {len(vendor_bonds_db)}")

# ============================================================
# 2FA TOTP ENDPOINTS
# ============================================================

def _authorize_2fa_bootstrap(username: str, password: str, session: Optional[dict]) -> dict:
    """
    Authorize a 2FA setup/enable request.

    - If a valid session is provided (and matches the user / is admin), accept it.
    - Otherwise, accept the request only when:
        * password is correct for the account, AND
        * the account currently has NO 2FA enabled (bootstrap path),
        * AND rate limit "2fa" is not exceeded for that username.
      This blocks an attacker who knows the password from rotating an existing
      victim's 2FA secret to one they control (account takeover).
    """
    if not username or username not in users_db:
        raise HTTPException(status_code=404, detail="USER_NOT_FOUND")

    if session:
        require_self_or_admin(username, session)
        return users_db[username]

    if not check_rate_limit("2fa", username):
        retry = get_rate_limit_retry_after("2fa", username)
        raise HTTPException(status_code=429, detail=f"RATE_LIMITED_2FA_{retry}s")

    user = users_db[username]
    if user.get("totp_enabled"):
        # Bootstrap path is reserved for accounts with no active 2FA. Once 2FA is on,
        # only a real authenticated session may touch /api/2fa/* endpoints.
        raise HTTPException(status_code=401, detail="SESSION_TOKEN_REQUIRED")

    if not password or not verify_password(password, user.get("password", "")):
        raise HTTPException(status_code=401, detail="INVALID_CREDENTIALS")

    return user


@app.post("/api/2fa/setup")
async def setup_2fa(request: Request, auth: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme)):
    data = await request.json()
    username = (data.get("username", "") or "").strip()
    password = data.get("password", "")
    session = _resolve_session_from_auth(auth)
    user = _authorize_2fa_bootstrap(username, password, session)
    if not TOTP_AVAILABLE:
        raise HTTPException(status_code=503, detail="2FA not available - install pyotp qrcode pillow")
    secret = generate_totp_secret()
    totp_pending[username] = secret
    qr_b64 = generate_qr_code_base64(secret, username)
    return {"success": True, "secret": secret, "qr_code": qr_b64, "issuer": "SilkGenesis"}


@app.post("/api/2fa/enable")
async def enable_2fa(request: Request, auth: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme)):
    """
    Activate 2FA. The TOTP secret is the one issued by /api/2fa/setup
    and stored server-side in `totp_pending[username]`. Any `secret` field
    sent by the client is ignored (defense against TOTP secret takeover).
    """
    data = await request.json()
    username = (data.get("username", "") or "").strip()
    code = (data.get("code", "") or "").strip()
    password = data.get("password", "")
    session = _resolve_session_from_auth(auth)
    user = _authorize_2fa_bootstrap(username, password, session)
    if not TOTP_AVAILABLE:
        raise HTTPException(status_code=503, detail="2FA not available")

    pending_secret = totp_pending.get(username)
    if not pending_secret:
        raise HTTPException(status_code=400, detail="No pending 2FA setup. Call /api/2fa/setup first.")

    if not verify_totp(pending_secret, code):
        log_security(AuditEvent.FA2_FAIL, username, {"reason": "wrong_code_during_enable"})
        raise HTTPException(status_code=400, detail="Invalid TOTP code")

    backup_codes = generate_backup_codes(8)
    user["totp_secret"] = pending_secret
    user["totp_enabled"] = True
    user["totp_backup_codes"] = backup_codes
    totp_pending.pop(username, None)
    save_users_persist()
    log(AuditEvent.FA2_ENABLED, username)
    return {"success": True, "backup_codes": backup_codes, "message": "2FA enabled successfully"}

@app.post("/api/2fa/verify")
async def verify_2fa_endpoint(request: Request):
    data = await request.json()
    username = (data.get("username") or "").strip()
    code = (data.get("code") or data.get("totp_code") or "").strip()
    use_backup = data.get("use_backup", False)

    def _maybe_admin_panel_unlock_after_totp() -> None:
        """If Bearer session is admin and matches username, mark server-side admin step-up (same as panel-unlock)."""
        auth = request.headers.get("Authorization") or ""
        if not auth.startswith("Bearer "):
            return
        token = auth.split(" ", 1)[1].strip()
        sess = validate_session(token)
        if not sess or sess.get("role") != "admin":
            return
        if sess.get("username") != username:
            return
        set_admin_unlock(token)

    user = users_db.get(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.get("totp_enabled"):
        raise HTTPException(status_code=400, detail="2FA not enabled")
    if use_backup:
        backup_codes = user.get("totp_backup_codes", [])
        if code.upper() in backup_codes:
            backup_codes.remove(code.upper())
            user["totp_backup_codes"] = backup_codes
            save_users_persist()
            _maybe_admin_panel_unlock_after_totp()
            return {"success": True, "message": "Backup code accepted", "backup_codes_remaining": len(backup_codes)}
        raise HTTPException(status_code=400, detail="Invalid backup code")
    secret = user.get("totp_secret", "")
    if not TOTP_AVAILABLE or not verify_totp(secret, code):
        raise HTTPException(status_code=400, detail="Invalid TOTP code")
    _maybe_admin_panel_unlock_after_totp()
    return {"success": True, "message": "2FA verified"}

@app.post("/api/2fa/disable")
async def disable_2fa(request: Request, session: dict = Depends(get_current_session)):
    data = await request.json()
    username = data.get("username", "")
    code = data.get("code", "")
    require_self_or_admin(username, session)
    user = users_db.get(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    secret = user.get("totp_secret", "")
    if TOTP_AVAILABLE and not verify_totp(secret, code):
        raise HTTPException(status_code=400, detail="Invalid TOTP code")
    user["totp_enabled"] = False
    user["totp_secret"] = None
    user["totp_backup_codes"] = []
    save_users_persist()
    return {"success": True, "message": "2FA disabled"}

@app.get("/api/2fa/status/{username}")
async def get_2fa_status(username: str, session: dict = Depends(get_current_session)):
    require_self_or_admin(username, session)
    user = users_db.get(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "enabled": user.get("totp_enabled", False),
        "backup_codes_remaining": len(user.get("totp_backup_codes", [])),
    }

# ============================================================
# DEAD MAN SWITCH ENDPOINTS
# ============================================================

@app.get("/api/admin/dead-man-switch")
async def get_dms_status(_admin: dict = Depends(require_admin)):
    if not DMS_AVAILABLE:
        return {"active": False, "error": "DMS module not available"}
    return dms.get_status()

@app.post("/api/admin/dead-man-switch/heartbeat")
async def dms_heartbeat(request: Request, _admin: dict = Depends(require_admin)):
    data = await request.json()
    username = data.get("username", "")
    user = users_db.get(username)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if DMS_AVAILABLE:
        dms.record_admin_login(username)
    return {"success": True, "message": "Heartbeat recorded - timer reset to 14 days"}

# ============================================================
# VENDOR BOND ENDPOINTS
# ============================================================

@app.get("/api/vendor/bond")
async def get_vendor_bond(username: str):
    bond = vendor_bonds_db.get(username)
    if not bond:
        return {"has_bond": False, "message": "No bond found"}
    refund_info = can_request_refund(bond) if BOND_AVAILABLE else {}
    return {
        **bond,
        "has_bond": True,
        "refund_eligible": refund_info.get("eligible", False),
        "days_remaining": refund_info.get("days_remaining", 0),
        "eligible_date": refund_info.get("eligible_date"),
    }

@app.post("/api/vendor/bond/pay")
async def pay_vendor_bond(request: Request):
    data = await request.json()
    username = data.get("username", "")
    category = data.get("category", "default")
    user = users_db.get(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not BOND_AVAILABLE:
        raise HTTPException(status_code=503, detail="Bond system not available")
    cached_prices = cache_get("prices")
    xmr_price = cached_prices.get("xmr", 370.0) if cached_prices else 370.0
    amount_usd = get_bond_amount(category)
    amount_xmr = amount_usd / xmr_price
    bond = create_bond(username, category, amount_xmr, amount_usd)
    vendor_bonds_db[username] = bond
    save_vendor_bond(username, bond)  # Persist to SQLite
    return {"success": True, "bond": bond, "message": f"Bond of {amount_xmr:.4f} XMR (${amount_usd}) recorded"}

@app.post("/api/vendor/bond/refund")
async def request_bond_refund(request: Request):
    data = await request.json()
    username = data.get("username", "")
    bond = vendor_bonds_db.get(username)
    if not bond:
        raise HTTPException(status_code=404, detail="No bond found")
    if not BOND_AVAILABLE:
        raise HTTPException(status_code=503, detail="Bond system not available")
    refund_info = can_request_refund(bond)
    if not refund_info["eligible"]:
        raise HTTPException(status_code=400, detail=refund_info["reason"])
    from datetime import datetime as dt2
    bond["refund_requested_at"] = dt2.utcnow().isoformat()
    bond["status"] = "refund_pending"
    vendor_bonds_db[username] = bond
    return {"success": True, "message": "Refund requested. Will be processed within 24h.", "amount_xmr": bond["amount_xmr"]}

@app.get("/api/admin/bonds")
async def admin_get_bonds(_admin: dict = Depends(require_admin)):
    return list(vendor_bonds_db.values())

@app.post("/api/admin/bonds/process-refund")
async def admin_process_refund(request: Request, _admin: dict = Depends(require_admin)):
    data = await request.json()
    username = data.get("username", "")
    bond = vendor_bonds_db.get(username)
    if not bond:
        raise HTTPException(status_code=404, detail="Bond not found")
    from datetime import datetime as dt3
    bond["status"] = "refunded"
    bond["refunded_at"] = dt3.utcnow().isoformat()
    vendor_bonds_db[username] = bond
    if username in users_db:
        with funds_rlock:
            u = users_db[username]
            u["balance"] = u.get("balance", 0) + bond["amount_xmr"]
            save_users_persist()
    return {"success": True, "message": f"Bond refunded: {bond['amount_xmr']:.4f} XMR to {username}"}

# ============================================================
# MONERO SUBADDRESS PER ORDER
# ============================================================

@app.post("/api/order/{order_id}/subaddress")
async def get_order_subaddress(order_id: str, session: dict = Depends(get_current_session)):
    """Genere ou retourne la subaddress XMR unique pour une order"""
    order = orders_db.get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    u = session["username"]
    if u not in (order.get("buyer"), order.get("vendor")) and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")

    # Si deja une subaddress, la retourner
    if order.get("xmr_subaddress"):
        return {
            "order_id": order_id,
            "xmr_address": order["xmr_subaddress"],
            "amount_xmr": order.get("amount_xmr", 0),
            "status": order.get("payment_status", "pending")
        }

    generated = get_or_create_order_subaddress(order_id)
    if not generated or not generated.get("address"):
        raise HTTPException(status_code=503, detail="ORDER_SUBADDRESS_UNAVAILABLE")

    subaddress = generated["address"]
    order["xmr_subaddress"] = subaddress
    if generated.get("address_index") is not None:
        order["xmr_subaddress_index"] = generated.get("address_index")
    order["xmr_subaddress_rpc_online"] = bool(generated.get("rpc_online"))
    order["xmr_subaddress_simulated"] = bool(generated.get("simulated"))
    save_order(order_id, order)

    return {
        "order_id": order_id,
        "xmr_address": subaddress,
        "amount_xmr": order.get("amount_xmr", 0),
        "status": order.get("payment_status", "pending"),
        "rpc_online": bool(generated.get("rpc_online")),
        "simulated": bool(generated.get("simulated")),
    }
@app.get("/api/order/{order_id}/payment-status")
async def check_order_payment(order_id: str, session: dict = Depends(get_current_session)):
    """VAcrifie le statut de payment d'une order (polling 30s)"""
    order = orders_db.get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    u = session["username"]
    if u not in (order.get("buyer"), order.get("vendor")) and session.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ACCESS_DENIED")

    return {
        "order_id": order_id,
        "payment_status": order.get("payment_status", "pending"),
        "amount_xmr": order.get("amount_xmr", 0),
        "amount_received": order.get("amount_received", 0),
        "confirmations": order.get("confirmations", 0),
        "xmr_address": order.get("xmr_subaddress", order.get("xmr_address", "")),
        "status": order.get("status", "pending")
    }


# ============================================================
# WITHDRAWAL & LIQUIDITY MANAGEMENT SYSTEM
# ============================================================
try:
    from withdrawal_endpoints import inject_withdrawal_routes
    inject_withdrawal_routes(app, users_db, orders_db, vendor_bonds_db if 'vendor_bonds_db' in dir() else {})
    _dev_print("[MARKET] [OK] Withdrawal & Liquidity routes injected")
except Exception as _wd_err:
    _dev_print(f"[MARKET] [WARN] Could not inject withdrawal routes: {_wd_err}")

# Start background worker
try:
    from withdrawal_worker import start_withdrawal_worker
    start_withdrawal_worker(users_db, orders_db)
    _dev_print("[MARKET] [OK] Withdrawal background worker started")
except Exception as _ww_err:
    _dev_print(f"[MARKET] [WARN] Could not start withdrawal worker: {_ww_err}")

# ============================================================
# LANCEMENT DU SERVEUR
# ============================================================
if __name__ == "__main__":
    import asyncio
    import uvicorn

    # Force SelectorEventLoop on Windows to avoid ProactorEventLoop crashes
    # with certain antivirus / security software (exit code 3221225477)
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    _dev_print("=" * 55)
    _dev_print("  SILKGENESIS MARKET SERVER")
    _dev_print("  http://127.0.0.1:5000")
    _dev_print("  Security mode: admin bootstrap password from environment")
    _dev_print("=" * 55)
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=5000,
        log_level="info",
        loop="asyncio",
    )




