"""
SILKGENESIS - Security Module v2.0
- Argon2id password hashing (OWASP 2026 recommended)
- PBKDF2 legacy support for migration
- TOTP 2FA (Google Authenticator compatible)
- PIN lockout after failed attempts
- Session token management
- Pepper support for extra security
"""
import hashlib
import hmac
import json
import os
import time
import base64
import struct
import threading
import secrets
from datetime import datetime, timedelta
from typing import Optional

from silk_paths import persist_base_dir

# ============================================================
# PEPPER - Extra secret mixed into all hashes
# Set SILKGENESIS_PEPPER env var. Required in production, and
# also auto-generated per-process in dev (ephemeral) so that a
# fixed default value can never become known to an attacker.
# Note: generating a random pepper invalidates existing hashes
# at restart, which is intentional in dev (use docker volumes
# / persistent .env to keep the same pepper across restarts).
# ============================================================
IS_PRODUCTION = os.environ.get("SILKGENESIS_ENV", "development").lower() == "production"
_env_pepper = os.environ.get("SILKGENESIS_PEPPER", "").strip()
if IS_PRODUCTION:
    if not _env_pepper:
        raise RuntimeError(
            "SILKGENESIS_PEPPER is required in production "
            "(generate a 64-hex random value and set it in the environment)."
        )
    if len(_env_pepper) < 32:
        raise RuntimeError("SILKGENESIS_PEPPER must be at least 32 chars in production.")
    PEPPER = _env_pepper
else:
    if _env_pepper:
        PEPPER = _env_pepper
    else:
        # Pepper ephemere par process: empeche tout attaquant offline d'utiliser
        # une valeur connue, mais invalide les hashes a chaque redemarrage.
        PEPPER = secrets.token_hex(32)
        print("[SECURITY] No SILKGENESIS_PEPPER set; generated ephemeral dev pepper.")

# ============================================================
# ARGON2ID - Primary password hashing (OWASP 2026)
# Falls back to PBKDF2 if argon2-cffi not installed
# ============================================================
try:
    from argon2 import PasswordHasher
    from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
    _ph = PasswordHasher(
        time_cost=3,        # 3 iterations
        memory_cost=65536,  # 64 MB
        parallelism=4,      # 4 threads
        hash_len=32,        # 32 bytes output
        salt_len=16         # 16 bytes salt
    )
    ARGON2_AVAILABLE = True
    print("[SECURITY] Argon2id available - using for new passwords")
except ImportError:
    ARGON2_AVAILABLE = False
    print("[SECURITY] argon2-cffi not installed - using PBKDF2 fallback")

# PBKDF2 fallback settings
HASH_ITERATIONS = 600000  # OWASP 2026 recommended for PBKDF2-SHA256
SALT_LENGTH = 32


def _apply_pepper(password: str) -> str:
    """Mix pepper into password before hashing"""
    return hmac.new(PEPPER.encode(), password.encode(), hashlib.sha256).hexdigest()


def hash_password(password: str) -> str:
    """
    Hash a password using Argon2id (preferred) or PBKDF2 fallback.
    Always applies pepper before hashing.
    """
    peppered = _apply_pepper(password)
    
    if ARGON2_AVAILABLE:
        try:
            # argon2-cffi produces: $argon2id$v=19$m=...$salt$hash
            # Store it directly — it already starts with $argon2id$
            hashed = _ph.hash(peppered)
            return hashed
        except Exception as e:
            print(f"[SECURITY] Argon2id hash failed: {e}, falling back to PBKDF2")
    
    # PBKDF2 fallback
    salt = os.urandom(SALT_LENGTH)
    key = hashlib.pbkdf2_hmac('sha256', peppered.encode('utf-8'), salt, HASH_ITERATIONS)
    return f"$pbkdf2${HASH_ITERATIONS}${salt.hex()}${key.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    """
    Verify a password against its stored hash.
    Supports: Argon2id, PBKDF2, and legacy plain text (migration only).
    """
    if not stored_hash:
        return False
    
    # Legacy: plain text password (migration - first boot only)
    if not stored_hash.startswith('$'):
        return password == stored_hash
    
    # Argon2id — hash stored directly as $argon2id$v=19$... (native argon2-cffi format)
    if stored_hash.startswith('$argon2id$') and ARGON2_AVAILABLE:
        try:
            peppered = _apply_pepper(password)
            # Pass the full hash to argon2-cffi (it expects $argon2id$v=19$...)
            _ph.verify(stored_hash, peppered)
            return True
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
        except Exception:
            return False
    
    # PBKDF2
    if stored_hash.startswith('$pbkdf2$'):
        try:
            parts = stored_hash.split('$')
            iterations = int(parts[2])
            salt = bytes.fromhex(parts[3])
            stored_key = bytes.fromhex(parts[4])
            peppered = _apply_pepper(password)
            key = hashlib.pbkdf2_hmac('sha256', peppered.encode('utf-8'), salt, iterations)
            return hmac.compare_digest(key, stored_key)
        except Exception:
            # Try without pepper (legacy)
            try:
                parts = stored_hash.split('$')
                iterations = int(parts[2])
                salt = bytes.fromhex(parts[3])
                stored_key = bytes.fromhex(parts[4])
                key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
                return hmac.compare_digest(key, stored_key)
            except Exception:
                return False
    
    # Legacy PBKDF2 without prefix marker
    try:
        parts = stored_hash.split('$')
        if len(parts) >= 4:
            iterations = int(parts[1]) if parts[1].isdigit() else HASH_ITERATIONS
            salt = bytes.fromhex(parts[2])
            stored_key = bytes.fromhex(parts[3])
            key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
            return hmac.compare_digest(key, stored_key)
    except Exception:
        pass
    
    return False


def needs_rehash(stored_hash: str) -> bool:
    """Check if a password hash needs to be upgraded to Argon2id"""
    if not stored_hash:
        return True
    if stored_hash.startswith('$argon2id$') and ARGON2_AVAILABLE:
        return False  # Already using best algorithm
    return True  # Needs upgrade


def migrate_users_passwords(users_db: dict) -> int:
    """
    Migrate plain text passwords to Argon2id/PBKDF2.
    Returns number of passwords migrated.
    """
    migrated = 0
    for username, user in users_db.items():
        pwd = user.get("password", "")
        if pwd and not pwd.startswith('$'):
            # Plain text - hash it
            user["password"] = hash_password(pwd)
            migrated += 1
    return migrated


# ============================================================
# SESSION TOKEN MANAGEMENT
# ============================================================
_sessions = {}  # {token: {username, created_at, last_active, admin_unlock_until?, ...}}
_sessions_lock = threading.Lock()
SESSION_TTL = 30 * 60  # 30 minutes
# Après 2FA step-up admin (séparer session login et accès panel)
ADMIN_STEP_UP_TTL = 4 * 3600  # 4 heures


def set_admin_unlock(token: str, ttl_seconds: Optional[int] = None) -> bool:
    """Marque la session comme débloquée pour les routes /api/admin/* (step-up 2FA)."""
    ttl = int(ttl_seconds) if ttl_seconds is not None else ADMIN_STEP_UP_TTL
    with _sessions_lock:
        s = _sessions.get(token)
        if not s:
            return False
        s["admin_unlock_until"] = time.time() + ttl
        return True


def create_session(username: str, role: str = "buyer") -> str:
    """Create a new session token"""
    token = secrets.token_urlsafe(48)
    with _sessions_lock:
        _sessions[token] = {
            "username": username,
            "role": role,
            "created_at": time.time(),
            "last_active": time.time()
        }
    return token


def validate_session(token: str) -> Optional[dict]:
    """Validate a session token and update last_active"""
    if not token:
        return None
    with _sessions_lock:
        session = _sessions.get(token)
        if not session:
            return None
        now = time.time()
        if now - session["last_active"] > SESSION_TTL:
            del _sessions[token]
            return None
        session["last_active"] = now
        return dict(session)


def invalidate_session(token: str):
    """Invalidate a specific session"""
    with _sessions_lock:
        _sessions.pop(token, None)


def invalidate_all_sessions(username: str) -> int:
    """Invalidate all sessions for a user (force logout all devices)"""
    count = 0
    with _sessions_lock:
        to_delete = [t for t, s in _sessions.items() if s["username"] == username]
        for t in to_delete:
            del _sessions[t]
            count += 1
    return count


def list_user_sessions(username: str) -> list:
    """List active sessions for a user (without exposing full tokens)."""
    now = time.time()
    sessions = []
    with _sessions_lock:
        for token, s in _sessions.items():
            if s.get("username") != username:
                continue
            age_seconds = max(0, int(now - s.get("created_at", now)))
            idle_seconds = max(0, int(now - s.get("last_active", now)))
            sessions.append({
                "token_preview": token[:10] + "...",
                "created_at": s.get("created_at"),
                "last_active": s.get("last_active"),
                "age_seconds": age_seconds,
                "idle_seconds": idle_seconds,
            })
    sessions.sort(key=lambda x: x.get("last_active", 0), reverse=True)
    return sessions


def invalidate_other_sessions(username: str, current_token: str) -> int:
    """Invalidate all sessions for user except the provided current token."""
    count = 0
    with _sessions_lock:
        to_delete = [
            t for t, s in _sessions.items()
            if s.get("username") == username and t != current_token
        ]
        for t in to_delete:
            del _sessions[t]
            count += 1
    return count


def cleanup_expired_sessions():
    """Remove expired sessions (call periodically)"""
    now = time.time()
    with _sessions_lock:
        expired = [t for t, s in _sessions.items() if now - s["last_active"] > SESSION_TTL]
        for t in expired:
            del _sessions[t]
    return len(expired)


# Start session cleanup thread
def _session_cleanup_thread():
    while True:
        time.sleep(300)  # Every 5 minutes
        cleaned = cleanup_expired_sessions()
        if cleaned > 0:
            print(f"[SESSION] Cleaned {cleaned} expired sessions")

threading.Thread(target=_session_cleanup_thread, daemon=True).start()


# ============================================================
# TOTP 2FA (Google Authenticator compatible)
# ============================================================

def generate_totp_secret() -> str:
    """Generate a new TOTP secret (base32 encoded)"""
    raw = os.urandom(20)
    return base64.b32encode(raw).decode('utf-8')


def _hotp(secret: str, counter: int) -> int:
    """HMAC-based One-Time Password"""
    key = base64.b32decode(secret.upper())
    msg = struct.pack('>Q', counter)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    offset = h[-1] & 0x0f
    code = struct.unpack('>I', h[offset:offset+4])[0] & 0x7fffffff
    return code % 1000000


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    """Verify a TOTP code with time window tolerance"""
    if not secret or not code:
        return False
    try:
        code_int = int(code.strip())
        counter = int(time.time()) // 30
        for delta in range(-window, window + 1):
            if _hotp(secret, counter + delta) == code_int:
                return True
        return False
    except (ValueError, Exception):
        return False


def get_totp_uri(secret: str, username: str, issuer: str = "SilkGenesis") -> str:
    """Generate otpauth:// URI for QR code generation"""
    return f"otpauth://totp/{issuer}:{username}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30"


# ============================================================
# PIN LOCKOUT SYSTEM
# ============================================================
_pin_failures = {}  # {username: {count, locked_until}}
_pin_lock = threading.Lock()

MAX_PIN_ATTEMPTS = 5
PIN_LOCKOUT_SECONDS = 300  # 5 minutes


def check_pin_lockout(username: str) -> dict:
    """Check if user is locked out from PIN attempts"""
    with _pin_lock:
        data = _pin_failures.get(username, {})
        locked_until = data.get("locked_until", 0)
        if locked_until and time.time() < locked_until:
            remaining = int(locked_until - time.time())
            return {"locked": True, "remaining_seconds": remaining}
        return {"locked": False, "remaining_seconds": 0}


def record_pin_failure(username: str) -> dict:
    """Record a PIN failure and potentially lock the account"""
    with _pin_lock:
        data = _pin_failures.get(username, {"count": 0, "locked_until": 0})
        data["count"] = data.get("count", 0) + 1
        attempts_left = MAX_PIN_ATTEMPTS - data["count"]
        
        if data["count"] >= MAX_PIN_ATTEMPTS:
            data["locked_until"] = time.time() + PIN_LOCKOUT_SECONDS
            data["count"] = 0
            _pin_failures[username] = data
            return {
                "locked": True,
                "attempts_left": 0,
                "message": f"Account locked for {PIN_LOCKOUT_SECONDS}s after {MAX_PIN_ATTEMPTS} failed attempts"
            }
        
        _pin_failures[username] = data
        return {
            "locked": False,
            "attempts_left": max(0, attempts_left),
            "message": f"{max(0, attempts_left)} attempts remaining"
        }


def record_pin_success(username: str):
    """Reset PIN failure count on success"""
    with _pin_lock:
        _pin_failures.pop(username, None)


# ============================================================
# SECURE PASSWORD GENERATOR
# ============================================================

def generate_secure_password(length: int = 24) -> str:
    """Generate a cryptographically secure random password"""
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def hash_pin(pin: str) -> str:
    """Hash a 6-digit PIN using the same hardened path as passwords."""
    return hash_password(str(pin))


def verify_pin(pin: str, stored_hash: str) -> bool:
    """Verify PIN hash with backward compatibility for legacy plaintext PINs."""
    if not stored_hash:
        return False
    # Legacy plaintext PIN support (auto-migrated by caller after success).
    if not str(stored_hash).startswith("$"):
        return str(pin) == str(stored_hash)
    return verify_password(str(pin), str(stored_hash))


# ============================================================
# DEAD MAN SWITCH
# ============================================================
_dms_last_checkin = time.time()
_dms_interval_hours = 72  # 72 hours default
_dms_enabled = False
_dms_action = "shutdown"  # "shutdown" | "wipe" | "alert"

DMS_SECURITY_STATE_FILE = os.path.join(persist_base_dir(), "dms_security.json")


def _load_dms_persisted_state() -> None:
    """Restore DMS timer / enabled flag across process restarts."""
    global _dms_last_checkin, _dms_interval_hours, _dms_enabled, _dms_action
    try:
        if os.path.isfile(DMS_SECURITY_STATE_FILE):
            with open(DMS_SECURITY_STATE_FILE, encoding="utf-8") as f:
                data = json.load(f)
            _dms_enabled = bool(data.get("enabled", False))
            _dms_interval_hours = max(1, int(data.get("interval_hours", 72)))
            act = str(data.get("action", "shutdown"))
            if act in ("shutdown", "wipe", "alert"):
                _dms_action = act
            lc = data.get("last_checkin_ts")
            if lc is not None:
                _dms_last_checkin = float(lc)
    except Exception:
        pass


def _save_dms_persisted_state() -> None:
    try:
        with open(DMS_SECURITY_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "enabled": _dms_enabled,
                    "interval_hours": _dms_interval_hours,
                    "action": _dms_action,
                    "last_checkin_ts": _dms_last_checkin,
                },
                f,
                indent=2,
            )
    except Exception:
        pass


_load_dms_persisted_state()


def dms_checkin():
    """Admin checks in to prevent dead man switch trigger"""
    global _dms_last_checkin
    _dms_last_checkin = time.time()
    _save_dms_persisted_state()
    return {"status": "ok", "next_required_in_hours": _dms_interval_hours}


def dms_configure(enabled: bool, interval_hours: int = 72, action: str = "shutdown"):
    """Configure the dead man switch"""
    global _dms_enabled, _dms_interval_hours, _dms_action
    _dms_enabled = enabled
    _dms_interval_hours = max(1, int(interval_hours))
    _dms_action = action if action in ("shutdown", "wipe", "alert") else "shutdown"
    _save_dms_persisted_state()


def dms_status() -> dict:
    """Get dead man switch status"""
    elapsed = time.time() - _dms_last_checkin
    hours_elapsed = elapsed / 3600
    hours_remaining = max(0, _dms_interval_hours - hours_elapsed)
    triggered = _dms_enabled and hours_elapsed >= _dms_interval_hours
    return {
        "enabled": _dms_enabled,
        "interval_hours": _dms_interval_hours,
        "hours_since_checkin": round(hours_elapsed, 2),
        "hours_remaining": round(hours_remaining, 2),
        "triggered": triggered,
        "action": _dms_action,
        "last_checkin": datetime.utcfromtimestamp(_dms_last_checkin).isoformat()
    }


def _dms_monitor():
    """Background thread monitoring dead man switch"""
    while True:
        time.sleep(3600)  # Check every hour
        if not _dms_enabled:
            continue
        elapsed = time.time() - _dms_last_checkin
        if elapsed >= _dms_interval_hours * 3600:
            print(f"[DMS] ⚠️ DEAD MAN SWITCH TRIGGERED! Action: {_dms_action}")
            if _dms_action == "shutdown":
                print("[DMS] Initiating emergency shutdown...")
                os._exit(1)
            elif _dms_action == "wipe":
                print("[DMS] Initiating data wipe...")
                # Best-effort secure delete of all sensitive persistence files.
                # (Production: rely on FDE + key destruction, not file-level shred.)
                try:
                    from secure_storage import shred_path
                except Exception:
                    shred_path = None  # type: ignore
                base = os.path.dirname(__file__)
                data_dir = os.environ.get("SILKGENESIS_DATA_DIR", "").strip() or base
                candidates = [
                    "silkgenesis.db",
                    "silkgenesis_data.db",
                    "silkgenesis_data.db-wal",
                    "silkgenesis_data.db-shm",
                    "multisig.db",
                    "users_persist.json",
                    "vendor_listings.json",
                    "warrant_canary.json",
                ]
                for fn in candidates:
                    for parent in (data_dir, base):
                        path = os.path.join(parent, fn)
                        if os.path.exists(path):
                            if shred_path:
                                shred_path(path, passes=3)
                            else:
                                try:
                                    os.remove(path)
                                except OSError:
                                    pass
                            print(f"[DMS] Wiped: {path}")
                os._exit(1)

threading.Thread(target=_dms_monitor, daemon=True).start()
