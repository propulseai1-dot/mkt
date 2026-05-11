"""
SILKGENESIS - SQLite Persistence Layer (encrypted at rest via SQLCipher)
Sauvegarde les orders, messages et reviews sur disque.
Survit aux redemarrages du serveur.

Toutes les connexions passent par secure_storage.open_secure_connection
qui applique la cle SILKGENESIS_DB_KEY (PRAGMA key) en SQLCipher.
"""
import sqlite3  # garde sqlite3 import pour Row si SQLCipher absent (dev)
import json
import os
import threading
from datetime import datetime

from secure_storage import (
    open_secure_connection,
    LegacyPlaintextDB,
    migrate_db_to_encrypted,
)

_lock = threading.Lock()


def get_db_path() -> str:
    """Chemin SQLite : SILKGENESIS_DB_PATH ou <SILKGENESIS_DATA_DIR>/silkgenesis_data.db ou defaut api-service/."""
    explicit = os.environ.get("SILKGENESIS_DB_PATH", "").strip()
    if explicit:
        p = os.path.abspath(explicit)
        parent = os.path.dirname(p)
        if parent:
            os.makedirs(parent, exist_ok=True)
        return p
    data_dir = os.environ.get("SILKGENESIS_DATA_DIR", "").strip()
    if data_dir:
        dd = os.path.abspath(data_dir)
        os.makedirs(dd, exist_ok=True)
        return os.path.join(dd, "silkgenesis_data.db")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "silkgenesis_data.db")


def get_conn():
    path = get_db_path()
    try:
        return open_secure_connection(path, check_same_thread=False)
    except LegacyPlaintextDB:
        # Migration automatique au premier acces : la base existe encore en clair.
        migrate_db_to_encrypted(path)
        return open_secure_connection(path, check_same_thread=False)

def init_db():
    """Creer les tables si elles n'existent pas"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()

        # ORDERS TABLE
        c.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                buyer TEXT NOT NULL,
                vendor TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                amount_xmr REAL NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT
            )
        """)

        # CHAT MESSAGES TABLE (order-specific)
        c.execute("""
            CREATE TABLE IF NOT EXISTS order_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id TEXT NOT NULL,
                sender TEXT NOT NULL,
                message TEXT NOT NULL,
                encrypted INTEGER DEFAULT 0,
                is_system INTEGER DEFAULT 0,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (order_id) REFERENCES orders(id)
            )
        """)

        # GENERAL CHAT TABLE (buyer-vendor)
        c.execute("""
            CREATE TABLE IF NOT EXISTS general_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_key TEXT NOT NULL,
                buyer TEXT NOT NULL,
                vendor TEXT NOT NULL,
                sender TEXT NOT NULL,
                message TEXT NOT NULL,
                encrypted INTEGER DEFAULT 0,
                timestamp TEXT NOT NULL
            )
        """)

        # REVIEWS TABLE
        c.execute("""
            CREATE TABLE IF NOT EXISTS reviews (
                id TEXT PRIMARY KEY,
                vendor TEXT NOT NULL,
                buyer TEXT NOT NULL,
                order_id TEXT NOT NULL,
                rating INTEGER NOT NULL,
                comment TEXT,
                date TEXT NOT NULL
            )
        """)

        # DISPUTES TABLE
        c.execute("""
            CREATE TABLE IF NOT EXISTS disputes (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                order_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                created_at TEXT NOT NULL
            )
        """)

        # USERS TABLE
        c.execute("""
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'buyer',
                balance REAL NOT NULL DEFAULT 0.0,
                status TEXT NOT NULL DEFAULT 'active',
                updated_at TEXT
            )
        """)

        # LISTINGS TABLE
        c.execute("""
            CREATE TABLE IF NOT EXISTS listings (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                vendor TEXT NOT NULL,
                category TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT,
                updated_at TEXT
            )
        """)

        # CATEGORIES TABLE
        c.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                parent TEXT,
                icon TEXT DEFAULT '📦',
                sort_order INTEGER DEFAULT 0
            )
        """)

        # VENDOR BONDS TABLE
        c.execute("""
            CREATE TABLE IF NOT EXISTS vendor_bonds (
                vendor TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                category TEXT,
                amount_xmr REAL DEFAULT 0,
                amount_usd REAL DEFAULT 0,
                status TEXT DEFAULT 'active',
                paid_at TEXT,
                updated_at TEXT
            )
        """)

        conn.commit()
        conn.close()
        print(f"[DB] SQLite initialized at {get_db_path()}")


# ============================================================
# ORDERS
# ============================================================

def save_order(order_id: str, order: dict):
    """Save ou mettre a jour une order"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        now = datetime.utcnow().isoformat()
        c.execute("""
            INSERT OR REPLACE INTO orders (id, data, buyer, vendor, status, amount_xmr, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            order_id,
            json.dumps(order, default=str),
            order.get('buyer', ''),
            order.get('vendor', ''),
            order.get('status', 'pending'),
            float(order.get('amount_xmr', 0)),
            order.get('created_at', now),
            now
        ))
        conn.commit()
        conn.close()


def load_all_orders() -> dict:
    """Load toutes les orders depuis SQLite"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("SELECT id, data FROM orders")
        rows = c.fetchall()
        conn.close()
    result = {}
    for row in rows:
        try:
            result[row['id']] = json.loads(row['data'])
        except Exception:
            pass
    print(f"[DB] Loaded {len(result)} orders from SQLite")
    return result


def update_order_status(order_id: str, status: str, extra: dict = None):
    """Update le statut d'une order"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("SELECT data FROM orders WHERE id=?", (order_id,))
        row = c.fetchone()
        if row:
            order = json.loads(row['data'])
            order['status'] = status
            if extra:
                order.update(extra)
            c.execute("""
                UPDATE orders SET data=?, status=?, updated_at=? WHERE id=?
            """, (json.dumps(order, default=str), status, datetime.utcnow().isoformat(), order_id))
            conn.commit()
        conn.close()


# ============================================================
# CHAT MESSAGES
# ============================================================

def save_order_message(order_id: str, msg: dict):
    """Save un message de chat d'une order"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("""
            INSERT INTO order_messages (order_id, sender, message, encrypted, is_system, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            order_id,
            msg.get('sender', ''),
            msg.get('message', ''),
            1 if msg.get('encrypted') else 0,
            1 if msg.get('is_system') else 0,
            msg.get('timestamp', datetime.utcnow().isoformat())
        ))
        conn.commit()
        conn.close()


def load_order_messages(order_id: str) -> list:
    """Load les messages d'une order"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("SELECT * FROM order_messages WHERE order_id=? ORDER BY id ASC", (order_id,))
        rows = c.fetchall()
        conn.close()
    return [dict(row) for row in rows]


def load_all_order_messages() -> dict:
    """Load tous les messages de toutes les orders"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("SELECT * FROM order_messages ORDER BY order_id, id ASC")
        rows = c.fetchall()
        conn.close()
    result = {}
    for row in rows:
        oid = row['order_id']
        if oid not in result:
            result[oid] = []
        result[oid].append(dict(row))
    print(f"[DB] Loaded messages for {len(result)} orders from SQLite")
    return result


def save_general_message(chat_key: str, buyer: str, vendor: str, msg: dict):
    """Save un message de chat general"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("""
            INSERT INTO general_messages (chat_key, buyer, vendor, sender, message, encrypted, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            chat_key, buyer, vendor,
            msg.get('sender', ''),
            msg.get('message', ''),
            1 if msg.get('encrypted') else 0,
            msg.get('timestamp', datetime.utcnow().isoformat())
        ))
        conn.commit()
        conn.close()


def load_all_general_messages() -> dict:
    """Load tous les messages generaux"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("SELECT * FROM general_messages ORDER BY chat_key, id ASC")
        rows = c.fetchall()
        conn.close()
    result = {}
    for row in rows:
        key = row['chat_key']
        if key not in result:
            result[key] = []
        result[key].append(dict(row))
    print(f"[DB] Loaded {sum(len(v) for v in result.values())} general messages from SQLite")
    return result


# ============================================================
# REVIEWS
# ============================================================

def save_review(vendor: str, review: dict):
    """Save une review"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("""
            INSERT OR REPLACE INTO reviews (id, vendor, buyer, order_id, rating, comment, date)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            review.get('id', ''),
            vendor,
            review.get('buyer', ''),
            review.get('order_id', ''),
            int(review.get('rating', 5)),
            review.get('comment', ''),
            review.get('date', datetime.utcnow().strftime('%Y-%m-%d'))
        ))
        conn.commit()
        conn.close()


def load_all_reviews() -> dict:
    """Load toutes les reviews"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("SELECT * FROM reviews ORDER BY vendor, date DESC")
        rows = c.fetchall()
        conn.close()
    result = {}
    for row in rows:
        v = row['vendor']
        if v not in result:
            result[v] = []
        result[v].append(dict(row))
    print(f"[DB] Loaded reviews for {len(result)} vendors from SQLite")
    return result


# ============================================================
# DISPUTES
# ============================================================

def save_dispute(dispute_id: str, dispute: dict):
    """Save un dispute"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("""
            INSERT OR REPLACE INTO disputes (id, data, order_id, status, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (
            dispute_id,
            json.dumps(dispute, default=str),
            dispute.get('order_id', ''),
            dispute.get('status', 'open'),
            dispute.get('created_at', datetime.utcnow().isoformat())
        ))
        conn.commit()
        conn.close()


def load_all_disputes() -> dict:
    """Load tous les disputes"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("SELECT id, data FROM disputes")
        rows = c.fetchall()
        conn.close()
    result = {}
    for row in rows:
        try:
            result[row['id']] = json.loads(row['data'])
        except Exception:
            pass
    print(f"[DB] Loaded {len(result)} disputes from SQLite")
    return result


# ============================================================
# USERS
# ============================================================

def save_user(username: str, user: dict):
    """Save ou mettre a jour un user"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        now = datetime.utcnow().isoformat()
        c.execute("""
            INSERT OR REPLACE INTO users (username, data, role, balance, status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            username,
            json.dumps(user, default=str),
            user.get('role', 'buyer'),
            float(user.get('balance', 0.0)),
            user.get('status', 'active'),
            now
        ))
        conn.commit()
        conn.close()


def save_all_users(users_dict: dict):
    """Save tous les users en une seule transaction (bulk)"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        now = datetime.utcnow().isoformat()
        for username, user in users_dict.items():
            c.execute("""
                INSERT OR REPLACE INTO users (username, data, role, balance, status, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                username,
                json.dumps(user, default=str),
                user.get('role', 'buyer'),
                float(user.get('balance', 0.0)),
                user.get('status', 'active'),
                now
            ))
        conn.commit()
        conn.close()


def load_all_users() -> dict:
    """Load tous les users depuis SQLite"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("SELECT username, data FROM users")
        rows = c.fetchall()
        conn.close()
    result = {}
    for row in rows:
        try:
            result[row['username']] = json.loads(row['data'])
        except Exception:
            pass
    print(f"[DB] Loaded {len(result)} users from SQLite")
    return result


# ============================================================
# LISTINGS
# ============================================================

def save_listing(listing_id: str, listing: dict):
    """Save ou mettre a jour un listing"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        now = datetime.utcnow().isoformat()
        c.execute("""
            INSERT OR REPLACE INTO listings (id, data, vendor, category, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            listing_id,
            json.dumps(listing, default=str),
            listing.get('vendor', ''),
            listing.get('category', ''),
            listing.get('status', 'active'),
            listing.get('created_at', now),
            now
        ))
        conn.commit()
        conn.close()


def save_all_listings(listings_dict: dict):
    """Save tous les listings en une seule transaction (bulk)"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        now = datetime.utcnow().isoformat()
        for listing_id, listing in listings_dict.items():
            c.execute("""
                INSERT OR REPLACE INTO listings (id, data, vendor, category, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                listing_id,
                json.dumps(listing, default=str),
                listing.get('vendor', ''),
                listing.get('category', ''),
                listing.get('status', 'active'),
                listing.get('created_at', now),
                now
            ))
        conn.commit()
        conn.close()


def load_all_listings() -> dict:
    """Load tous les listings depuis SQLite"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("SELECT id, data FROM listings WHERE status != 'deleted'")
        rows = c.fetchall()
        conn.close()
    result = {}
    for row in rows:
        try:
            result[row['id']] = json.loads(row['data'])
        except Exception:
            pass
    print(f"[DB] Loaded {len(result)} listings from SQLite")
    return result


def delete_listing_db(listing_id: str):
    """Delete un listing de la DB"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("UPDATE listings SET status='deleted', updated_at=? WHERE id=?",
                  (datetime.utcnow().isoformat(), listing_id))
        conn.commit()
        conn.close()


# ============================================================
# CATEGORIES
# ============================================================

def save_all_categories(categories_list: list):
    """Save toutes les categories"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("DELETE FROM categories")
        for i, cat in enumerate(categories_list):
            c.execute("""
                INSERT OR REPLACE INTO categories (id, name, parent, icon, sort_order)
                VALUES (?, ?, ?, ?, ?)
            """, (
                cat.get('id', cat['name'].lower().replace(' ', '_')),
                cat['name'],
                cat.get('parent'),
                cat.get('icon', '📦'),
                i
            ))
        conn.commit()
        conn.close()


def load_all_categories() -> list:
    """Load toutes les categories depuis SQLite"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("SELECT * FROM categories ORDER BY sort_order ASC")
        rows = c.fetchall()
        conn.close()
    result = []
    for row in rows:
        result.append({
            'id': row['id'],
            'name': row['name'],
            'parent': row['parent'],
            'icon': row['icon']
        })
    print(f"[DB] Loaded {len(result)} categories from SQLite")
    return result


# ============================================================
# VENDOR BONDS
# ============================================================

def save_vendor_bond(vendor: str, bond: dict):
    """Save ou mettre a jour un vendor bond"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        now = datetime.utcnow().isoformat()
        c.execute("""
            INSERT OR REPLACE INTO vendor_bonds (vendor, data, category, amount_xmr, amount_usd, status, paid_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            vendor,
            json.dumps(bond, default=str),
            bond.get('category', ''),
            float(bond.get('amount_xmr', 0)),
            float(bond.get('amount_usd', 0)),
            bond.get('status', 'active'),
            bond.get('paid_at', now),
            now
        ))
        conn.commit()
        conn.close()


def load_all_vendor_bonds() -> dict:
    """Load tous les vendor bonds depuis SQLite"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("SELECT vendor, data FROM vendor_bonds")
        rows = c.fetchall()
        conn.close()
    result = {}
    for row in rows:
        try:
            result[row['vendor']] = json.loads(row['data'])
        except Exception:
            pass
    print(f"[DB] Loaded {len(result)} vendor bonds from SQLite")
    return result


def load_vendor_bond(vendor: str) -> dict:
    """Load le bond d'un vendor specifique"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("SELECT data FROM vendor_bonds WHERE vendor=?", (vendor,))
        row = c.fetchone()
        conn.close()
    if row:
        try:
            return json.loads(row['data'])
        except Exception:
            pass
    return None


# ============================================================
# BACKUP SYSTEM
# ============================================================

import shutil
import threading as _threading

_backup_thread = None

def backup_now() -> str:
    """Creer une sauvegarde immediate de la DB SQLite"""
    dbp = get_db_path()
    backup_dir = os.path.join(os.path.dirname(dbp), 'backups')
    os.makedirs(backup_dir, exist_ok=True)
    ts = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    backup_file = os.path.join(backup_dir, f'silkgenesis_{ts}.db')
    try:
        shutil.copy2(dbp, backup_file)
        print(f"[DB] Backup created: {backup_file}")
        return backup_file
    except Exception as e:
        print(f"[DB] Backup failed: {e}")
        return ""


def list_backups() -> list:
    """Lister les sauvegardes disponibles"""
    backup_dir = os.path.join(os.path.dirname(get_db_path()), 'backups')
    if not os.path.exists(backup_dir):
        return []
    backups = []
    for f in sorted(os.listdir(backup_dir), reverse=True):
        if f.endswith('.db'):
            fp = os.path.join(backup_dir, f)
            stat = os.stat(fp)
            backups.append({
                'filename': f,
                'path': fp,
                'size_bytes': stat.st_size,
                'created_at': datetime.utcfromtimestamp(stat.st_mtime).isoformat()
            })
    return backups


def _auto_backup_loop(interval_seconds: int = 3600):
    """Thread de sauvegarde automatique"""
    while True:
        import time as _time
        _time.sleep(interval_seconds)
        try:
            backup_now()
            # Garder seulement les 24 dernieres sauvegardes
            backups = list_backups()
            if len(backups) > 24:
                for old in backups[24:]:
                    try:
                        os.remove(old['path'])
                    except Exception:
                        pass
        except Exception as e:
            print(f"[DB] Auto-backup error: {e}")


def start_auto_backup(interval_seconds: int = 3600):
    """Demarrer le thread de sauvegarde automatique"""
    global _backup_thread
    if _backup_thread and _backup_thread.is_alive():
        return
    _backup_thread = _threading.Thread(
        target=_auto_backup_loop,
        args=(interval_seconds,),
        daemon=True
    )
    _backup_thread.start()
    print(f"[DB] Auto-backup started (every {interval_seconds}s)")


def save_all_disputes(disputes_dict: dict):
    """Save tous les disputes (bulk)"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        try:
            for dispute_id, dispute in disputes_dict.items():
                c.execute("""
                    INSERT OR REPLACE INTO disputes (id, data, order_id, status, created_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (
                    dispute_id,
                    json.dumps(dispute, default=str),
                    dispute.get('order_id', ''),
                    dispute.get('status', 'open'),
                    dispute.get('created_at', datetime.utcnow().isoformat())
                ))
            conn.commit()
        except Exception as e:
            print(f"[DB] save_all_disputes error: {e}")
        finally:
            conn.close()


def save_all_reviews(reviews_dict: dict):
    """Save toutes les reviews (bulk)"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        try:
            for vendor, reviews in reviews_dict.items():
                for review in reviews:
                    c.execute("""
                        INSERT OR REPLACE INTO reviews (id, vendor, buyer, order_id, rating, comment, date)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (
                        review.get('id', ''),
                        vendor,
                        review.get('buyer', ''),
                        review.get('order_id', ''),
                        int(review.get('rating', 5)),
                        review.get('comment', ''),
                        review.get('date', datetime.utcnow().strftime('%Y-%m-%d'))
                    ))
            conn.commit()
        except Exception as e:
            print(f"[DB] save_all_reviews error: {e}")
        finally:
            conn.close()


def save_all_order_messages(chat_db: dict):
    """Save tous les messages de orders (bulk)"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        try:
            for order_id, messages in chat_db.items():
                for msg in messages:
                    c.execute("""
                        INSERT OR IGNORE INTO order_messages
                        (order_id, sender, message, encrypted, is_system, timestamp)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (
                        order_id,
                        msg.get("sender", ""),
                        msg.get("message", ""),
                        1 if msg.get("encrypted") else 0,
                        1 if msg.get("is_system") else 0,
                        msg.get("timestamp", datetime.utcnow().isoformat())
                    ))
            conn.commit()
        except Exception as e:
            print(f"[DB] save_all_order_messages error: {e}")
        finally:
            conn.close()


def save_all_general_messages(general_chat_db: dict):
    """Save tous les messages generaux (bulk)"""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        try:
            for chat_key, messages in general_chat_db.items():
                parts = chat_key.split("_", 1)
                buyer = parts[0] if len(parts) > 0 else ""
                vendor = parts[1] if len(parts) > 1 else ""
                for msg in messages:
                    c.execute("""
                        INSERT OR IGNORE INTO general_messages
                        (chat_key, buyer, vendor, sender, message, encrypted, timestamp)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (
                        chat_key, buyer, vendor,
                        msg.get("sender", ""),
                        msg.get("message", ""),
                        1 if msg.get("encrypted") else 0,
                        msg.get("timestamp", datetime.utcnow().isoformat())
                    ))
            conn.commit()
        except Exception as e:
            print(f"[DB] save_all_general_messages error: {e}")
        finally:
            conn.close()


# Initialiser la DB au demarrage
init_db()


# ============================================================
# REFERRALS
# ============================================================

def _ensure_referrals_table():
    """Creer la table referrals si elle n'existe pas (migration safe)."""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("""
            CREATE TABLE IF NOT EXISTS referrals (
                code        TEXT PRIMARY KEY,
                data        TEXT NOT NULL,
                owner       TEXT NOT NULL,
                uses        INTEGER DEFAULT 0,
                updated_at  TEXT
            )
        """)
        conn.commit()
        conn.close()

_ensure_referrals_table()


def save_referral(code: str, ref_data: dict):
    """Save ou mettre a jour un code de parrainage."""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        now = datetime.utcnow().isoformat()
        c.execute("""
            INSERT OR REPLACE INTO referrals (code, data, owner, uses, updated_at)
            VALUES (?, ?, ?, ?, ?)
        """, (
            code,
            json.dumps(ref_data, default=str),
            ref_data.get("owner", ""),
            int(ref_data.get("uses", 0)),
            now,
        ))
        conn.commit()
        conn.close()


def load_all_referrals() -> dict:
    """Load tous les codes de parrainage depuis SQLite."""
    with _lock:
        conn = get_conn()
        c = conn.cursor()
        c.execute("SELECT code, data FROM referrals")
        rows = c.fetchall()
        conn.close()
    result = {}
    for row in rows:
        try:
            result[row["code"]] = json.loads(row["data"])
        except Exception:
            pass
    if result:
        print(f"[DB] Loaded {len(result)} referral codes from SQLite")
    return result

