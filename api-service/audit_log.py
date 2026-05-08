"""
SILKGENESIS - Audit Log
Trace toutes les actions sensibles (admin, transactions, security).
Rotating log file, never stored in DB as plaintext.
"""
import os
import json
import time
import threading
from datetime import datetime

def _log_dir() -> str:
    d = os.environ.get("SILKGENESIS_DATA_DIR", "").strip()
    if d:
        p = os.path.join(os.path.abspath(d), "logs")
    else:
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
    os.makedirs(p, exist_ok=True)
    return p


LOG_DIR = _log_dir()
AUDIT_LOG_FILE = os.path.join(LOG_DIR, "audit.log")
MAX_LOG_SIZE = 10 * 1024 * 1024  # 10MB avant rotation
MAX_LOG_FILES = 5

_log_lock = threading.Lock()

# Categories d'evenements
class AuditEvent:
    # Auth
    LOGIN_SUCCESS = "AUTH_LOGIN_SUCCESS"
    LOGIN_FAIL = "AUTH_LOGIN_FAIL"
    LOGIN_BLOCKED = "AUTH_LOGIN_BLOCKED"
    LOGOUT = "AUTH_LOGOUT"
    REGISTER = "AUTH_REGISTER"
    
    # 2FA
    FA2_SETUP = "2FA_SETUP"
    FA2_ENABLED = "2FA_ENABLED"
    FA2_DISABLED = "2FA_DISABLED"
    FA2_FAIL = "2FA_FAIL"
    
    # Admin
    ADMIN_ACCESS = "ADMIN_ACCESS"
    ADMIN_MNEMONIC = "ADMIN_MNEMONIC_VIEW"
    ADMIN_CATEGORY_ADD = "ADMIN_CATEGORY_ADD"
    ADMIN_CATEGORY_DEL = "ADMIN_CATEGORY_DEL"
    ADMIN_DISPUTE_RESOLVE = "ADMIN_DISPUTE_RESOLVE"
    ADMIN_USER_BAN = "ADMIN_USER_BAN"
    ADMIN_VENDOR_APPROVE = "ADMIN_VENDOR_APPROVE"
    
    # Transactions
    ORDER_CREATE = "ORDER_CREATE"
    ORDER_COMPLETE = "ORDER_COMPLETE"
    ORDER_DISPUTE = "ORDER_DISPUTE"
    FUNDS_RELEASED = "FUNDS_RELEASED"
    
    # Wallet
    WITHDRAWAL_REQUEST = "WALLET_WITHDRAWAL_REQUEST"
    WITHDRAWAL_SUCCESS = "WALLET_WITHDRAWAL_SUCCESS"
    WITHDRAWAL_FAIL = "WALLET_WITHDRAWAL_FAIL"
    PIN_FAIL = "WALLET_PIN_FAIL"
    PIN_LOCKED = "WALLET_PIN_LOCKED"
    
    # Security
    RATE_LIMIT = "SECURITY_RATE_LIMIT"
    SUSPICIOUS = "SECURITY_SUSPICIOUS"
    # Admin surface (unauthorized / forbidden / probe storms)
    ADMIN_ACCESS_DENIED = "SECURITY_ADMIN_ACCESS_DENIED"
    ADMIN_ACCESS_RATE_LIMITED = "SECURITY_ADMIN_ACCESS_RATE_LIMITED"

    # Withdrawal Queue (new - Withdrawal & Liquidity Management System)
    WITHDRAWAL_SUBMITTED      = "WITHDRAWAL_SUBMITTED"
    WITHDRAWAL_APPROVED       = "WITHDRAWAL_APPROVED"
    WITHDRAWAL_REJECTED       = "WITHDRAWAL_REJECTED"
    WITHDRAWAL_CANCELLED      = "WITHDRAWAL_CANCELLED"
    WITHDRAWAL_PROCESSING     = "WITHDRAWAL_PROCESSING"
    WITHDRAWAL_COMPLETED      = "WITHDRAWAL_COMPLETED"
    PARTIAL_SETTLEMENT_CREATED = "PARTIAL_SETTLEMENT_CREATED"
    PARTIAL_TRANCHE_PROCESSED  = "PARTIAL_TRANCHE_PROCESSED"

    # Balance Adjustments (new)
    BALANCE_ADJUSTED          = "BALANCE_ADJUSTED"
    BALANCE_ADJUSTMENT_REVERSED = "BALANCE_ADJUSTMENT_REVERSED"

    # Liquidity (new)
    LIQUIDITY_SNAPSHOT        = "LIQUIDITY_SNAPSHOT"
    LIQUIDITY_ALERT           = "LIQUIDITY_ALERT"

    # Platform Control (new - transparent user-facing modes)
    # Severity: CRITICAL - toutes ces actions sont loggees avec le plus haut niveau
    PLATFORM_LPM_ENABLED      = "PLATFORM_LPM_ENABLED"       # Liquidity Protection Mode active
    PLATFORM_LPM_DISABLED     = "PLATFORM_LPM_DISABLED"      # Liquidity Protection Mode desactive
    PLATFORM_FREEZE_ON        = "PLATFORM_FREEZE_ACTIVATED"   # Emergency freeze active
    PLATFORM_FREEZE_OFF       = "PLATFORM_FREEZE_DEACTIVATED" # Emergency freeze leve
    PLATFORM_FREEZE_MSG_UPD   = "PLATFORM_FREEZE_MSG_UPDATED" # Message public mis a jour
    PLATFORM_STRUCTURED_ON    = "PLATFORM_STRUCTURED_ENABLED" # Structured withdrawal policy activee
    PLATFORM_STRUCTURED_OFF   = "PLATFORM_STRUCTURED_DISABLED"# Structured withdrawal policy desactivee

    # Generic admin action (used by withdrawal_endpoints.py)
    ADMIN_ACTION              = "ADMIN_ACTION"


def _ensure_log_dir():
    """Create log directory if it doesn't exist"""
    os.makedirs(LOG_DIR, exist_ok=True)


def _rotate_if_needed():
    """Rotate log file if it exceeds MAX_LOG_SIZE"""
    if not os.path.exists(AUDIT_LOG_FILE):
        return
    
    if os.path.getsize(AUDIT_LOG_FILE) < MAX_LOG_SIZE:
        return
    
    # Rotate: audit.log -> audit.log.1 -> audit.log.2 -> ...
    for i in range(MAX_LOG_FILES - 1, 0, -1):
        old = f"{AUDIT_LOG_FILE}.{i}"
        new = f"{AUDIT_LOG_FILE}.{i+1}"
        if os.path.exists(old):
            os.rename(old, new)
    
    os.rename(AUDIT_LOG_FILE, f"{AUDIT_LOG_FILE}.1")


def log(event: str, username: str = "anonymous", details: dict = None, severity: str = "INFO"):
    """
    Write an audit log entry.
    
    Args:
        event: AuditEvent constant (e.g. AuditEvent.LOGIN_SUCCESS)
        username: The user performing the action
        details: Additional context (dict, will be JSON-serialized)
        severity: INFO | WARN | CRITICAL
    """
    _ensure_log_dir()
    
    entry = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "event": event,
        "user": username,
        "severity": severity,
    }
    if details:
        # Never log passwords or secrets
        safe_details = {
            k: v for k, v in details.items()
            if k.lower() not in ("password", "pin", "secret", "token", "key", "mnemonic")
        }
        entry["details"] = safe_details
    
    line = json.dumps(entry, ensure_ascii=False) + "\n"
    
    with _log_lock:
        try:
            _rotate_if_needed()
            with open(AUDIT_LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(line)
        except Exception as e:
            print(f"[AUDIT ERROR] Failed to write log: {e}")


def log_admin(event: str, admin_username: str, details: dict = None):
    """Shortcut for admin actions (always CRITICAL severity)"""
    log(event, admin_username, details, severity="CRITICAL")


def log_security(event: str, identifier: str, details: dict = None):
    """Shortcut for security events (always WARN severity)"""
    log(event, identifier, details, severity="WARN")


def get_recent_logs(n: int = 100, severity_filter: str = None) -> list:
    """Read the last N log entries (for admin dashboard)"""
    if not os.path.exists(AUDIT_LOG_FILE):
        return []
    
    entries = []
    try:
        with open(AUDIT_LOG_FILE, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if severity_filter and entry.get("severity") != severity_filter:
                    continue
                entries.append(entry)
                if len(entries) >= n:
                    break
            except json.JSONDecodeError:
                continue
    except Exception:
        pass
    
    return entries


