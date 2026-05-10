"""
SILKGENESIS - At-rest encryption layer
======================================

Goals
-----
- All SQLite databases are opened with SQLCipher (page-level AES-256), so a raw
  read of the .db file (cold backup, stolen disk, hostile root) reveals nothing
  exploitable without the key.
- All sensitive JSON persistence files (users_persist.json, vendor_listings.json,
  audit logs, etc.) are encrypted at rest with Fernet (AES-128-CBC + HMAC-SHA256).

Keys
----
- ``SILKGENESIS_DB_KEY`` (passphrase used as the SQLCipher key) is REQUIRED in
  production. In development we fall back to an ephemeral random key, which
  effectively wipes persistent data between restarts (intentional in dev).
- The same env var is reused (PBKDF2-stretched) to derive a Fernet key for
  encrypted JSON files. Operators only need to manage ONE secret.

Backward compatibility
----------------------
- ``open_secure_connection(path)`` opens an encrypted SQLite. If the underlying
  file already contains a *plaintext* sqlite database (legacy), we transparently
  detect this on first call and raise a clear ``LegacyPlaintextDB`` error so the
  operator can run ``migrate_db_to_encrypted(path)`` before retrying.
- ``encrypted_json_load`` accepts both legacy plaintext JSON and Fernet-wrapped
  payloads, and ``encrypted_json_save`` always writes encrypted form.

Limitations
-----------
- The python ``sqlcipher3-binary`` package ships SQLCipher pre-compiled. If it
  is not available (build env without the wheel), we fall back to plain
  ``sqlite3`` BUT only in development; in production this is a hard error.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import tempfile
from pathlib import Path
from typing import Any, Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

# ---------------------------------------------------------------------------
# Env / mode
# ---------------------------------------------------------------------------
_IS_PRODUCTION = os.environ.get("SILKGENESIS_ENV", "development").lower() == "production"
_DB_KEY_ENV = "SILKGENESIS_DB_KEY"
_KDF_SALT_DEFAULT = b"silkgenesis-at-rest-kdf-v1"


class SecureStorageError(RuntimeError):
    """Raised when the secure storage layer cannot be initialised correctly."""


class LegacyPlaintextDB(SecureStorageError):
    """Raised when an existing database file is detected as plaintext SQLite."""


# ---------------------------------------------------------------------------
# Master key resolution
# ---------------------------------------------------------------------------
def _resolve_master_key() -> str:
    """Return the master key (a passphrase) used for SQLCipher and Fernet derivation."""
    raw = (os.environ.get(_DB_KEY_ENV) or "").strip()
    if _IS_PRODUCTION:
        if not raw or len(raw) < 32:
            raise SecureStorageError(
                f"{_DB_KEY_ENV} must be set in production with at least 32 chars. "
                "Generate one with: openssl rand -hex 32"
            )
        return raw
    if raw:
        return raw
    # Dev: ephemeral key. Persistent data stops being readable across restarts,
    # which is fine for dev and prevents a known dev key from ever leaking.
    ephemeral = secrets.token_hex(32)
    os.environ[_DB_KEY_ENV] = ephemeral
    print(
        "[secure_storage] WARNING: no SILKGENESIS_DB_KEY set; "
        "generated ephemeral dev key (data invalidated at next restart)."
    )
    return ephemeral


_MASTER_KEY: Optional[str] = None


def get_master_key() -> str:
    global _MASTER_KEY
    if _MASTER_KEY is None:
        _MASTER_KEY = _resolve_master_key()
    return _MASTER_KEY


# ---------------------------------------------------------------------------
# SQLCipher
# ---------------------------------------------------------------------------
try:
    import sqlcipher3 as _sqlcipher_module  # provided by sqlcipher3-binary
    _SQLCIPHER_AVAILABLE = True
except Exception:  # pragma: no cover - depends on env
    try:
        from pysqlcipher3 import dbapi2 as _sqlcipher_module  # type: ignore
        _SQLCIPHER_AVAILABLE = True
    except Exception:
        _sqlcipher_module = None
        _SQLCIPHER_AVAILABLE = False

import sqlite3 as _sqlite3

if not _SQLCIPHER_AVAILABLE and _IS_PRODUCTION:
    raise SecureStorageError(
        "SQLCipher python bindings are required in production. "
        "Install 'sqlcipher3-binary' (or 'pysqlcipher3' with a system SQLCipher)."
    )


def _is_plaintext_sqlite(path: str) -> bool:
    """Return True if `path` is an existing SQLite file with the standard plaintext header."""
    try:
        with open(path, "rb") as f:
            head = f.read(16)
        return head.startswith(b"SQLite format 3\x00")
    except FileNotFoundError:
        return False
    except OSError:
        return False


def _apply_cipher_pragma(conn) -> None:
    """Configure key + safe defaults for a SQLCipher connection."""
    key = get_master_key()
    safe = key.replace("'", "''")
    cur = conn.cursor()
    cur.execute(f"PRAGMA key = '{safe}'")
    cur.execute("PRAGMA cipher_compatibility = 4")
    cur.execute("PRAGMA cipher_memory_security = ON")
    cur.execute("PRAGMA kdf_iter = 256000")
    cur.execute("PRAGMA cipher_page_size = 4096")
    cur.execute("PRAGMA cipher_hmac_algorithm = HMAC_SHA512")
    cur.execute("PRAGMA cipher_kdf_algorithm = PBKDF2_HMAC_SHA512")
    cur.fetchall()


def open_secure_connection(path: str, *, check_same_thread: bool = False, timeout: float = 30.0):
    """
    Open an encrypted SQLite connection, transparently bootstrapping an empty
    encrypted DB on first use. Raises LegacyPlaintextDB if `path` exists and
    contains a plaintext database (run migrate_db_to_encrypted first).
    """
    if os.path.exists(path) and _is_plaintext_sqlite(path):
        raise LegacyPlaintextDB(
            f"{path} appears to be a plaintext SQLite file. "
            "Run secure_storage.migrate_db_to_encrypted(path) first."
        )

    if not _SQLCIPHER_AVAILABLE:
        # Dev only (production raises in module import). Plain sqlite3 — explicit warning.
        print(
            "[secure_storage] WARNING: sqlcipher3 not available, opening "
            f"plaintext sqlite3 connection for {path} (DEV ONLY)."
        )
        conn = _sqlite3.connect(path, check_same_thread=check_same_thread, timeout=timeout)
        conn.row_factory = _sqlite3.Row
        return conn

    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = _sqlcipher_module.connect(path, check_same_thread=check_same_thread, timeout=timeout)
    _apply_cipher_pragma(conn)
    # Sanity: try a meta query so a wrong key fails fast.
    try:
        conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
    except Exception as e:
        conn.close()
        raise SecureStorageError(
            f"Cannot open encrypted DB at {path}: wrong key or corrupted file ({type(e).__name__})."
        )
    try:
        conn.row_factory = _sqlite3.Row
    except Exception:
        # sqlcipher3.dbapi2 already provides Row-like access
        pass
    return conn


def migrate_db_to_encrypted(path: str) -> None:
    """One-shot migration: copy a legacy plaintext SQLite into a SQLCipher-encrypted file."""
    if not os.path.exists(path):
        return
    if not _is_plaintext_sqlite(path):
        return
    if not _SQLCIPHER_AVAILABLE:
        raise SecureStorageError(
            "Cannot migrate to encrypted DB: sqlcipher3 not available. "
            "pip install sqlcipher3-binary first."
        )
    key = get_master_key()
    safe = key.replace("'", "''")
    backup_path = f"{path}.plaintext-{secrets.token_hex(4)}.bak"
    os.replace(path, backup_path)
    try:
        plain = _sqlite3.connect(backup_path)
        plain.row_factory = _sqlite3.Row
        encrypted = _sqlcipher_module.connect(path)
        cur = encrypted.cursor()
        cur.execute(f"PRAGMA key = '{safe}'")
        cur.execute("PRAGMA cipher_compatibility = 4")
        cur.execute(f"ATTACH DATABASE '{backup_path}' AS plaintext KEY ''")
        cur.execute("SELECT sqlcipher_export('main', 'plaintext')")
        cur.execute("DETACH DATABASE plaintext")
        encrypted.commit()
        encrypted.close()
        plain.close()
        # Inverse approach: above expects exporting INTO encrypted from plaintext.
    finally:
        # Even on success we keep the backup so the operator can shred it manually
        # after verifying the migration. Print a one-line reminder.
        print(
            f"[secure_storage] migrated {path} to SQLCipher; "
            f"plaintext backup left at {backup_path} (shred manually)."
        )


# ---------------------------------------------------------------------------
# Fernet for JSON files
# ---------------------------------------------------------------------------
_FERNET: Optional[Fernet] = None
_JSON_MAGIC = b"SGENC1\n"  # marker prefix for encrypted JSON files


def _get_fernet() -> Fernet:
    global _FERNET
    if _FERNET is None:
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=_KDF_SALT_DEFAULT,
            iterations=200_000,
        )
        derived = kdf.derive(get_master_key().encode())
        _FERNET = Fernet(base64.urlsafe_b64encode(derived))
    return _FERNET


def encrypted_json_save(path: str, data: Any) -> None:
    """Serialise + encrypt + atomically replace the file at `path`."""
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
    token = _get_fernet().encrypt(raw)
    tmp_fd, tmp_path = tempfile.mkstemp(prefix=".sgenc.", dir=parent or None)
    try:
        with os.fdopen(tmp_fd, "wb") as f:
            f.write(_JSON_MAGIC)
            f.write(token)
            f.flush()
            try:
                os.fsync(f.fileno())
            except OSError:
                pass
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def encrypted_json_load(path: str, default: Any = None) -> Any:
    """Decrypt + parse the JSON file at `path`. Accepts legacy plaintext JSON."""
    if not os.path.exists(path):
        return default
    with open(path, "rb") as f:
        blob = f.read()
    if not blob:
        return default

    if blob.startswith(_JSON_MAGIC):
        token = blob[len(_JSON_MAGIC):]
        try:
            decrypted = _get_fernet().decrypt(token)
        except InvalidToken:
            raise SecureStorageError(
                f"Cannot decrypt {path}: wrong SILKGENESIS_DB_KEY or corrupted file."
            )
        return json.loads(decrypted.decode("utf-8"))

    # Legacy plaintext JSON: load it, but rewrite encrypted on next save.
    try:
        return json.loads(blob.decode("utf-8"))
    except json.JSONDecodeError:
        return default


def shred_path(path: str, passes: int = 3) -> None:
    """Best-effort overwrite + delete a file (use after a confirmed re-encryption)."""
    try:
        if not os.path.exists(path):
            return
        size = os.path.getsize(path)
        with open(path, "r+b") as f:
            for _ in range(passes):
                f.seek(0)
                f.write(secrets.token_bytes(size))
                f.flush()
                try:
                    os.fsync(f.fileno())
                except OSError:
                    pass
        os.unlink(path)
    except OSError:
        pass


__all__ = [
    "SecureStorageError",
    "LegacyPlaintextDB",
    "open_secure_connection",
    "migrate_db_to_encrypted",
    "encrypted_json_save",
    "encrypted_json_load",
    "shred_path",
    "get_master_key",
]
