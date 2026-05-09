"""
SILKGENESIS - Withdrawal & Liquidity Management System
=======================================================
Architecture inspiree des grandes plateformes (Binance, Bybit, Kraken).

Modules couverts :
  1. WithdrawalQueue       - File d'pending multi-niveaux avec validation
  2. WithdrawalRuleEngine  - Regles automatiques par tranche de montant
  3. PartialSettlement     - Payments partiels echelonnes
  4. BalanceAdjustment     - Correction manuelle de balance (visible balance)
  5. LiquiditySnapshot     - Instantane de la liquidity disponible vs equity affichee

Toutes les data sont persistees dans SQLite via db_persist.
Chaque action admin est tracee dans audit_log.
"""

import sqlite3
import json
import secrets
import threading
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from enum import Enum

import os
from db_persist import get_db_path
_lock = threading.Lock()


def _db_path() -> str:
    return get_db_path()


# ============================================================
# ENUMERATIONS - Etats et niveaux du system
# ============================================================

class WithdrawalStatus(str, Enum):
    PENDING        = "pending"          # Soumis, en pending de validation
    UNDER_REVIEW   = "under_review"     # Examen manuel en cours
    APPROVED       = "approved"         # Approuve, pret a etre execute
    PROCESSING     = "processing"       # En cours d'envoi on-chain
    COMPLETED      = "completed"        # Confirme on-chain
    REJECTED       = "rejected"         # Refuse par admin ou regle auto
    CANCELLED      = "cancelled"        # Cancelled by user
    PARTIAL        = "partial"          # Partiellement regle (partial settlement)
    EXPIRED        = "expired"          # Expire (delai depasse sans action)


class WithdrawalTier(str, Enum):
    """
    Tranches de montant - determine le niveau de validation requis.
    Les seuils sont configurables par l'admin via WithdrawalRuleEngine.
    """
    SMALL   = "small"    # Validation automatique possible
    MEDIUM  = "medium"   # Validation admin simple
    LARGE   = "large"    # Double validation + possible partial settlement


class AdjustmentType(str, Enum):
    CREDIT   = "credit"    # Ajout de balance (correction positive)
    DEBIT    = "debit"     # Withdrawal de balance (correction negative)
    OVERRIDE = "override"  # Remplacement direct du balance


# ============================================================
# INITIALISATION DES TABLES SQLite
# ============================================================

def init_withdrawal_tables():
    """
    Creates required tables for the withdrawal and liquidity system.
    Idempotent - peut etre appele plusieurs fois sans risque.
    """
    # Pas de _lock ici - appele au demarrage avant les threads
    conn = sqlite3.connect(_db_path(), check_same_thread=False, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")  # Evite les blocages multi-threads
    conn.execute("PRAGMA busy_timeout=10000")
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # ----------------------------------------------------------
    # TABLE 1 : withdrawal_queue
    # Chaque demande de withdrawal create une entree ici.
    # ----------------------------------------------------------
    c.execute("""
        CREATE TABLE IF NOT EXISTS withdrawal_queue (
            id              TEXT PRIMARY KEY,
            username        TEXT NOT NULL,
            amount_xmr      REAL NOT NULL,
            dest_address    TEXT NOT NULL,
            tier            TEXT NOT NULL DEFAULT 'small',
            status          TEXT NOT NULL DEFAULT 'pending',
            validation_level INTEGER NOT NULL DEFAULT 1,
            auto_approved   INTEGER DEFAULT 0,
            reviewed_by     TEXT,
            reviewed_at     TEXT,
            approved_by     TEXT,
            approved_at     TEXT,
            rejected_by     TEXT,
            rejected_at     TEXT,
            rejection_reason TEXT,
            txid            TEXT,
            network_fee_xmr REAL DEFAULT 0.0001,
            is_partial      INTEGER DEFAULT 0,
            parent_id       TEXT,
            created_at      TEXT NOT NULL,
            updated_at      TEXT,
            expires_at      TEXT,
            ip_hash         TEXT,
            user_agent_hash TEXT,
            notes           TEXT
        )
    """)

    # ----------------------------------------------------------
    # TABLE 2 : withdrawal_rules
    # ----------------------------------------------------------
    c.execute("""
        CREATE TABLE IF NOT EXISTS withdrawal_rules (
            tier                TEXT PRIMARY KEY,
            min_xmr             REAL NOT NULL,
            max_xmr             REAL NOT NULL,
            auto_approve        INTEGER DEFAULT 0,
            require_admin_review INTEGER DEFAULT 1,
            require_dual_approval INTEGER DEFAULT 0,
            max_daily_xmr       REAL DEFAULT 10.0,
            max_weekly_xmr      REAL DEFAULT 50.0,
            cooldown_seconds    INTEGER DEFAULT 300,
            allow_partial       INTEGER DEFAULT 0,
            partial_min_pct     REAL DEFAULT 0.25,
            expiry_hours        INTEGER DEFAULT 48,
            updated_at          TEXT,
            updated_by          TEXT
        )
    """)

    # ----------------------------------------------------------
    # TABLE 3 : partial_settlements
    # ----------------------------------------------------------
    c.execute("""
        CREATE TABLE IF NOT EXISTS partial_settlements (
            id              TEXT PRIMARY KEY,
            withdrawal_id   TEXT NOT NULL,
            username        TEXT NOT NULL,
            tranche_number  INTEGER NOT NULL,
            total_tranches  INTEGER NOT NULL,
            amount_xmr      REAL NOT NULL,
            status          TEXT NOT NULL DEFAULT 'pending',
            scheduled_at    TEXT,
            processed_at    TEXT,
            txid            TEXT,
            created_by      TEXT,
            notes           TEXT,
            FOREIGN KEY (withdrawal_id) REFERENCES withdrawal_queue(id)
        )
    """)

    # ----------------------------------------------------------
    # TABLE 4 : balance_adjustments
    # ----------------------------------------------------------
    c.execute("""
        CREATE TABLE IF NOT EXISTS balance_adjustments (
            id              TEXT PRIMARY KEY,
            username        TEXT NOT NULL,
            adjustment_type TEXT NOT NULL,
            amount_xmr      REAL NOT NULL,
            balance_before  REAL NOT NULL,
            balance_after   REAL NOT NULL,
            reason          TEXT NOT NULL,
            category        TEXT DEFAULT 'manual',
            performed_by    TEXT NOT NULL,
            performed_at    TEXT NOT NULL,
            approved_by     TEXT,
            approved_at     TEXT,
            is_reversible   INTEGER DEFAULT 1,
            reversed_by     TEXT,
            reversed_at     TEXT,
            reversal_id     TEXT,
            audit_ref       TEXT
        )
    """)

    # ----------------------------------------------------------
    # TABLE 5 : liquidity_snapshots
    # ----------------------------------------------------------
    c.execute("""
        CREATE TABLE IF NOT EXISTS liquidity_snapshots (
            id                      TEXT PRIMARY KEY,
            snapshot_at             TEXT NOT NULL,
            total_user_equity_xmr   REAL NOT NULL,
            total_user_equity_usd   REAL,
            actual_liquidity_xmr    REAL NOT NULL,
            actual_liquidity_usd    REAL,
            escrow_locked_xmr       REAL DEFAULT 0.0,
            bonds_locked_xmr        REAL DEFAULT 0.0,
            pending_withdrawals_xmr REAL DEFAULT 0.0,
            partial_settlements_xmr REAL DEFAULT 0.0,
            coverage_ratio          REAL,
            liquidity_gap_xmr       REAL,
            xmr_usd_rate            REAL DEFAULT 0.0,
            triggered_by            TEXT DEFAULT 'auto',
            notes                   TEXT
        )
    """)

    # ----------------------------------------------------------
    # TABLE 6 : withdrawal_daily_limits
    # ----------------------------------------------------------
    c.execute("""
        CREATE TABLE IF NOT EXISTS withdrawal_daily_limits (
            username        TEXT NOT NULL,
            date_key        TEXT NOT NULL,
            total_xmr       REAL DEFAULT 0.0,
            count           INTEGER DEFAULT 0,
            updated_at      TEXT,
            PRIMARY KEY (username, date_key)
        )
    """)

    conn.commit()
    conn.close()

    # Inserer les regles par defaut si la table est vide
    _seed_default_rules()
    print("[WITHDRAWAL] Tables initialized successfully")


def _seed_default_rules():
    """Insere les regles par defaut si elles n'existent pas encore."""
    with _lock:
        conn = sqlite3.connect(_db_path(), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("SELECT COUNT(*) as cnt FROM withdrawal_rules")
        row = c.fetchone()
        if row and row['cnt'] == 0:
            now = datetime.utcnow().isoformat()
            defaults = [
                # tier, min, max, auto, review, dual, daily, weekly, cooldown, partial, partial_min, expiry
                ("small",  0.001,  1.0,   1, 0, 0,  5.0,  20.0,  300, 0, 0.25, 24),
                ("medium", 1.001,  10.0,  0, 1, 0, 20.0,  80.0,  600, 1, 0.25, 48),
                ("large",  10.001, 9999.0,0, 1, 1, 50.0, 200.0, 1800, 1, 0.10, 72),
            ]
            for d in defaults:
                c.execute("""
                    INSERT OR IGNORE INTO withdrawal_rules
                    (tier, min_xmr, max_xmr, auto_approve, require_admin_review,
                     require_dual_approval, max_daily_xmr, max_weekly_xmr,
                     cooldown_seconds, allow_partial, partial_min_pct, expiry_hours,
                     updated_at, updated_by)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (*d, now, "system"))
            conn.commit()
        conn.close()


# ============================================================
# WITHDRAWAL RULE ENGINE
# ============================================================

class WithdrawalRuleEngine:
    """
    Moteur de regles pour la validation automatique des withdrawals.
    Determine le tier, checks les limites, et decide si une
    approbation manuelle est necessaire.
    """

    @staticmethod
    def get_rules() -> Dict[str, dict]:
        """Charge toutes les regles depuis SQLite."""
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("SELECT * FROM withdrawal_rules ORDER BY min_xmr ASC")
            rows = c.fetchall()
            conn.close()
        return {row['tier']: dict(row) for row in rows}

    @staticmethod
    def get_rule(tier: str) -> Optional[dict]:
        """Charge la regle d'un tier specifique."""
        rules = WithdrawalRuleEngine.get_rules()
        return rules.get(tier)

    @staticmethod
    def classify_amount(amount_xmr: float) -> str:
        """
        Determine le tier d'un montant de withdrawal.
        Returns 'small', 'medium', ou 'large'.
        """
        rules = WithdrawalRuleEngine.get_rules()
        for tier in ['small', 'medium', 'large']:
            rule = rules.get(tier)
            if rule and rule['min_xmr'] <= amount_xmr <= rule['max_xmr']:
                return tier
        # Si hors plage, forcer 'large' pour security maximale
        return 'large'

    @staticmethod
    def update_rule(tier: str, updates: dict, admin: str) -> dict:
        """
        Update les regles d'un tier (admin uniquement).
        Returns la regle update.
        """
        allowed_fields = {
            'min_xmr', 'max_xmr', 'auto_approve', 'require_admin_review',
            'require_dual_approval', 'max_daily_xmr', 'max_weekly_xmr',
            'cooldown_seconds', 'allow_partial', 'partial_min_pct', 'expiry_hours'
        }
        safe_updates = {k: v for k, v in updates.items() if k in allowed_fields}
        if not safe_updates:
            return {"error": "No valid fields to update"}

        set_clause = ", ".join(f"{k}=?" for k in safe_updates)
        values = list(safe_updates.values()) + [datetime.utcnow().isoformat(), admin, tier]

        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            c = conn.cursor()
            c.execute(
                f"UPDATE withdrawal_rules SET {set_clause}, updated_at=?, updated_by=? WHERE tier=?",
                values
            )
            conn.commit()
            conn.close()

        return WithdrawalRuleEngine.get_rule(tier) or {}

    @staticmethod
    def check_daily_limit(username: str, amount_xmr: float, tier: str) -> dict:
        """
        Checks si l'user depasse sa limite journaliere.
        Returns {"allowed": bool, "used_xmr": float, "limit_xmr": float}
        """
        rule = WithdrawalRuleEngine.get_rule(tier)
        if not rule:
            return {"allowed": False, "reason": "Unknown tier"}

        today = datetime.utcnow().strftime('%Y-%m-%d')
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute(
                "SELECT total_xmr, count FROM withdrawal_daily_limits WHERE username=? AND date_key=?",
                (username, today)
            )
            row = c.fetchone()
            conn.close()

        used = float(row['total_xmr']) if row else 0.0
        limit = float(rule['max_daily_xmr'])

        if used + amount_xmr > limit:
            return {
                "allowed": False,
                "reason": f"Daily limit exceeded: {used:.4f} + {amount_xmr:.4f} > {limit:.4f} XMR",
                "used_xmr": used,
                "limit_xmr": limit,
                "remaining_xmr": max(0.0, limit - used)
            }
        return {
            "allowed": True,
            "used_xmr": used,
            "limit_xmr": limit,
            "remaining_xmr": limit - used
        }

    @staticmethod
    def record_daily_usage(username: str, amount_xmr: float):
        """Enregistre l'utilisation journaliere apres approbation."""
        today = datetime.utcnow().strftime('%Y-%m-%d')
        now = datetime.utcnow().isoformat()
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            c = conn.cursor()
            c.execute("""
                INSERT INTO withdrawal_daily_limits (username, date_key, total_xmr, count, updated_at)
                VALUES (?, ?, ?, 1, ?)
                ON CONFLICT(username, date_key) DO UPDATE SET
                    total_xmr = total_xmr + excluded.total_xmr,
                    count = count + 1,
                    updated_at = excluded.updated_at
            """, (username, today, amount_xmr, now))
            conn.commit()
            conn.close()


# ============================================================
# WITHDRAWAL QUEUE MANAGER
# ============================================================

class WithdrawalQueueManager:
    """
    Gestionnaire principal de la file d'pending des withdrawals.
    Gere le cycle de vie complet : creation -> validation -> execution.
    """

    @staticmethod
    def submit(username: str, amount_xmr: float, dest_address: str,
               user_balance: float, notes: str = "") -> dict:
        """
        Soumet une nouvelle demande de withdrawal.
        Effectue les verifications preliminaires et determine le tier.

        Returns:
            {"success": bool, "withdrawal_id": str, "tier": str,
             "status": str, "message": str}
        """
        # --- Validation de base ---
        if user_balance <= 0:
            return {"success": False, "error": "Insufficient balance"}
        if amount_xmr <= 0:
            return {"success": False, "error": "Amount must be positive"}
        if amount_xmr > user_balance:
            return {"success": False, "error": "Insufficient balance"}
        if not dest_address or len(dest_address) < 90:
            return {"success": False, "error": "Invalid destination address"}

        # --- Classification du tier ---
        tier = WithdrawalRuleEngine.classify_amount(amount_xmr)
        rule = WithdrawalRuleEngine.get_rule(tier)
        if not rule:
            return {"success": False, "error": "Rule configuration error"}

        # --- Validation limite journaliere ---
        limit_check = WithdrawalRuleEngine.check_daily_limit(username, amount_xmr, tier)
        if not limit_check["allowed"]:
            return {"success": False, "error": limit_check["reason"]}

        # --- Creation de l'entree ---
        wid = f"WD_{secrets.token_hex(12).upper()}"
        now = datetime.utcnow().isoformat()
        expiry = (datetime.utcnow() + timedelta(hours=int(rule['expiry_hours']))).isoformat()

        # Determiner le statut initial
        auto_approve = bool(rule['auto_approve'])
        initial_status = WithdrawalStatus.APPROVED if auto_approve else WithdrawalStatus.PENDING
        validation_level = 1 if not rule['require_dual_approval'] else 2

        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            c = conn.cursor()
            c.execute("""
                INSERT INTO withdrawal_queue
                (id, username, amount_xmr, dest_address, tier, status,
                 validation_level, auto_approved, network_fee_xmr,
                 created_at, updated_at, expires_at, notes)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                wid, username, amount_xmr, dest_address, tier,
                initial_status.value, validation_level,
                1 if auto_approve else 0,
                float(rule.get('network_fee_xmr', 0.0001) if 'network_fee_xmr' in rule else 0.0001),
                now, now, expiry, notes
            ))
            conn.commit()
            conn.close()

        return {
            "success": True,
            "withdrawal_id": wid,
            "tier": tier,
            "status": initial_status.value,
            "auto_approved": auto_approve,
            "requires_review": bool(rule['require_admin_review']),
            "requires_dual_approval": bool(rule['require_dual_approval']),
            "expires_at": expiry,
            "message": (
                "Withdrawal auto-approved and queued for processing."
                if auto_approve
                else f"Withdrawal submitted. Tier: {tier.upper()} - awaiting admin review."
            )
        }

    @staticmethod
    def get_withdrawal(wid: str) -> Optional[dict]:
        """Recupere une demande de withdrawal par son ID."""
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("SELECT * FROM withdrawal_queue WHERE id=?", (wid,))
            row = c.fetchone()
            conn.close()
        return dict(row) if row else None

    @staticmethod
    def get_user_withdrawals(username: str, limit: int = 50) -> List[dict]:
        """Recupere l'historique des withdrawals d'un user."""
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("""
                SELECT * FROM withdrawal_queue
                WHERE username=?
                ORDER BY created_at DESC
                LIMIT ?
            """, (username, limit))
            rows = c.fetchall()
            conn.close()
        return [dict(r) for r in rows]

    @staticmethod
    def get_pending_queue(tier: str = None) -> List[dict]:
        """
        Recupere la file d'pending des withdrawals en pending (vue admin).
        Peut etre filtre par tier.
        """
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            if tier:
                c.execute("""
                    SELECT * FROM withdrawal_queue
                    WHERE status IN ('pending','under_review') AND tier=?
                    ORDER BY created_at ASC
                """, (tier,))
            else:
                c.execute("""
                    SELECT * FROM withdrawal_queue
                    WHERE status IN ('pending','under_review')
                    ORDER BY tier DESC, created_at ASC
                """)
            rows = c.fetchall()
            conn.close()
        return [dict(r) for r in rows]

    @staticmethod
    def get_all_withdrawals(status: str = None, limit: int = 200) -> List[dict]:
        """Recupere tous les withdrawals (vue admin complete)."""
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            if status:
                c.execute("""
                    SELECT * FROM withdrawal_queue WHERE status=?
                    ORDER BY created_at DESC LIMIT ?
                """, (status, limit))
            else:
                c.execute("""
                    SELECT * FROM withdrawal_queue
                    ORDER BY created_at DESC LIMIT ?
                """, (limit,))
            rows = c.fetchall()
            conn.close()
        return [dict(r) for r in rows]

    @staticmethod
    def admin_review(wid: str, admin: str, action: str,
                     reason: str = "", notes: str = "") -> dict:
        """
        Action admin sur une demande de withdrawal.
        action: 'approve' | 'reject' | 'cancel' | 'flag_review'
        """
        wd = WithdrawalQueueManager.get_withdrawal(wid)
        if not wd:
            return {"success": False, "error": "Withdrawal not found"}

        now = datetime.utcnow().isoformat()

        if action == "approve":
            rule = WithdrawalRuleEngine.get_rule(wd['tier'])
            # Checksr si double approbation requise
            if rule and rule['require_dual_approval'] and wd.get('reviewed_by') != admin:
                # Premier approbateur
                if not wd.get('reviewed_by'):
                    new_status = WithdrawalStatus.UNDER_REVIEW.value
                    update = {
                        "status": new_status,
                        "reviewed_by": admin,
                        "reviewed_at": now,
                        "notes": notes
                    }
                else:
                    # Deuxieme approbateur (different du premier)
                    new_status = WithdrawalStatus.APPROVED.value
                    update = {
                        "status": new_status,
                        "approved_by": admin,
                        "approved_at": now,
                        "notes": notes
                    }
            else:
                new_status = WithdrawalStatus.APPROVED.value
                update = {
                    "status": new_status,
                    "approved_by": admin,
                    "approved_at": now,
                    "reviewed_by": admin,
                    "reviewed_at": now,
                    "notes": notes
                }

        elif action == "reject":
            new_status = WithdrawalStatus.REJECTED.value
            update = {
                "status": new_status,
                "rejected_by": admin,
                "rejected_at": now,
                "rejection_reason": reason,
                "notes": notes
            }

        elif action == "cancel":
            new_status = WithdrawalStatus.CANCELLED.value
            update = {
                "status": new_status,
                "rejected_by": admin,
                "rejected_at": now,
                "rejection_reason": reason or "Cancelled by admin",
                "notes": notes
            }

        elif action == "flag_review":
            new_status = WithdrawalStatus.UNDER_REVIEW.value
            update = {
                "status": new_status,
                "reviewed_by": admin,
                "reviewed_at": now,
                "notes": notes
            }
        else:
            return {"success": False, "error": f"Unknown action: {action}"}

        # Build UPDATE query dynamically
        set_parts = [f"{k}=?" for k in update.keys()] + ["updated_at=?"]
        values = list(update.values()) + [now, wid]

        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            c = conn.cursor()
            c.execute(
                f"UPDATE withdrawal_queue SET {', '.join(set_parts)} WHERE id=?",
                values
            )
            conn.commit()
            conn.close()

        # Enregistrer l'utilisation journaliere si approuve
        if new_status == WithdrawalStatus.APPROVED.value:
            WithdrawalRuleEngine.record_daily_usage(wd['username'], wd['amount_xmr'])

        return {
            "success": True,
            "withdrawal_id": wid,
            "new_status": new_status,
            "action": action,
            "admin": admin
        }

    @staticmethod
    def mark_processing(wid: str, txid: str = None) -> dict:
        """Marque un withdrawal comme en cours de traitement on-chain."""
        now = datetime.utcnow().isoformat()
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            c = conn.cursor()
            c.execute("""
                UPDATE withdrawal_queue
                SET status=?, txid=?, updated_at=?
                WHERE id=? AND status='approved'
            """, (WithdrawalStatus.PROCESSING.value, txid, now, wid))
            affected = c.rowcount
            conn.commit()
            conn.close()
        return {"success": affected > 0, "withdrawal_id": wid, "txid": txid}

    @staticmethod
    def mark_completed(wid: str, txid: str) -> dict:
        """Marque un withdrawal comme complete (confirmed on-chain)."""
        now = datetime.utcnow().isoformat()
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            c = conn.cursor()
            c.execute("""
                UPDATE withdrawal_queue
                SET status=?, txid=?, updated_at=?
                WHERE id=? AND status IN ('processing','approved')
            """, (WithdrawalStatus.COMPLETED.value, txid, now, wid))
            affected = c.rowcount
            conn.commit()
            conn.close()
        return {"success": affected > 0, "withdrawal_id": wid, "txid": txid}

    @staticmethod
    def cancel_by_user(wid: str, username: str) -> dict:
        """Permet a l'user d'annuler un withdrawal encore en pending."""
        now = datetime.utcnow().isoformat()
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            c = conn.cursor()
            c.execute("""
                UPDATE withdrawal_queue
                SET status=?, updated_at=?
                WHERE id=? AND username=? AND status='pending'
            """, (WithdrawalStatus.CANCELLED.value, now, wid, username))
            affected = c.rowcount
            conn.commit()
            conn.close()
        if affected == 0:
            return {"success": False, "error": "Cannot cancel: withdrawal not found or not in pending state"}
        return {"success": True, "withdrawal_id": wid, "status": "cancelled"}

    @staticmethod
    def get_queue_stats() -> dict:
        """Statistiques globales de la file d'pending (vue admin)."""
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("""
                SELECT
                    status,
                    tier,
                    COUNT(*) as count,
                    SUM(amount_xmr) as total_xmr
                FROM withdrawal_queue
                GROUP BY status, tier
            """)
            rows = c.fetchall()
            conn.close()

        stats = {
            "by_status": {},
            "by_tier": {},
            "pending_total_xmr": 0.0,
            "approved_total_xmr": 0.0,
            "processing_total_xmr": 0.0
        }
        for row in rows:
            s = row['status']
            t = row['tier']
            if s not in stats["by_status"]:
                stats["by_status"][s] = {"count": 0, "total_xmr": 0.0}
            stats["by_status"][s]["count"] += row['count']
            stats["by_status"][s]["total_xmr"] += float(row['total_xmr'] or 0)

            if t not in stats["by_tier"]:
                stats["by_tier"][t] = {"count": 0, "total_xmr": 0.0}
            stats["by_tier"][t]["count"] += row['count']
            stats["by_tier"][t]["total_xmr"] += float(row['total_xmr'] or 0)

            if s == 'pending':
                stats["pending_total_xmr"] += float(row['total_xmr'] or 0)
            elif s == 'approved':
                stats["approved_total_xmr"] += float(row['total_xmr'] or 0)
            elif s == 'processing':
                stats["processing_total_xmr"] += float(row['total_xmr'] or 0)

        return stats


# ============================================================
# PARTIAL SETTLEMENT MANAGER
# ============================================================

class PartialSettlementManager:
    """
    Gere les payments partiels echelonnes pour les withdrawals importants.
    Permet de fractionner un withdrawal en N tranches planifiees,
    reduisant l'impact sur la liquidity disponible.

    Exemple : withdrawal de 50 XMR -> 3 tranches de ~16.67 XMR
    sur 3 jours consecutifs.
    """

    @staticmethod
    def create_settlement_plan(wid: str, username: str, total_xmr: float,
                                num_tranches: int, interval_hours: int,
                                admin: str, notes: str = "") -> dict:
        """
        Creates a partial settlement plan for an approved withdrawal.

        Args:
            wid:            ID du withdrawal parent
            username:       Proprietaire du withdrawal
            total_xmr:      Montant total a regler
            num_tranches:   Nombre de tranches (2-10)
            interval_hours: Intervalle entre chaque tranche (en heures)
            admin:          Admin qui create le plan
            notes:          Notes optionnelles

        Returns:
            {"success": bool, "plan": list, "settlement_ids": list}
        """
        if num_tranches < 2 or num_tranches > 10:
            return {"success": False, "error": "Number of tranches must be between 2 and 10"}
        if total_xmr <= 0:
            return {"success": False, "error": "Total amount must be positive"}
        if interval_hours < 1:
            return {"success": False, "error": "Interval must be at least 1 hour"}

        # Checksr que le withdrawal existe et est approuve
        wd = WithdrawalQueueManager.get_withdrawal(wid)
        if not wd:
            return {"success": False, "error": "Withdrawal not found"}
        if wd['status'] not in ('approved', 'partial'):
            return {"success": False, "error": f"Withdrawal must be approved (current: {wd['status']})"}

        # Calculer les montants par tranche
        base_amount = round(total_xmr / num_tranches, 8)
        remainder = round(total_xmr - (base_amount * (num_tranches - 1)), 8)

        now = datetime.utcnow()
        plan = []
        settlement_ids = []

        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            c = conn.cursor()

            for i in range(num_tranches):
                sid = f"PS_{secrets.token_hex(10).upper()}"
                tranche_amount = remainder if i == num_tranches - 1 else base_amount
                scheduled = (now + timedelta(hours=interval_hours * i)).isoformat()

                c.execute("""
                    INSERT INTO partial_settlements
                    (id, withdrawal_id, username, tranche_number, total_tranches,
                     amount_xmr, status, scheduled_at, created_by, notes)
                    VALUES (?,?,?,?,?,?,?,?,?,?)
                """, (
                    sid, wid, username, i + 1, num_tranches,
                    tranche_amount, 'pending', scheduled, admin, notes
                ))

                plan.append({
                    "settlement_id": sid,
                    "tranche": i + 1,
                    "amount_xmr": tranche_amount,
                    "scheduled_at": scheduled,
                    "status": "pending"
                })
                settlement_ids.append(sid)

            # Marquer le withdrawal parent comme partial
            c.execute("""
                UPDATE withdrawal_queue
                SET status=?, is_partial=1, updated_at=?
                WHERE id=?
            """, (WithdrawalStatus.PARTIAL.value, now.isoformat(), wid))

            conn.commit()
            conn.close()

        return {
            "success": True,
            "withdrawal_id": wid,
            "total_xmr": total_xmr,
            "num_tranches": num_tranches,
            "interval_hours": interval_hours,
            "plan": plan,
            "settlement_ids": settlement_ids,
            "created_by": admin
        }

    @staticmethod
    def get_settlements_for_withdrawal(wid: str) -> List[dict]:
        """Recupere toutes les tranches d'un withdrawal partiel."""
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("""
                SELECT * FROM partial_settlements
                WHERE withdrawal_id=?
                ORDER BY tranche_number ASC
            """, (wid,))
            rows = c.fetchall()
            conn.close()
        return [dict(r) for r in rows]

    @staticmethod
    def process_tranche(sid: str, admin: str, txid: str = None) -> dict:
        """Marque une tranche comme traitee (payment effectue)."""
        now = datetime.utcnow().isoformat()
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("SELECT * FROM partial_settlements WHERE id=?", (sid,))
            row = c.fetchone()
            if not row:
                conn.close()
                return {"success": False, "error": "Settlement tranche not found"}

            c.execute("""
                UPDATE partial_settlements
                SET status='completed', processed_at=?, txid=?
                WHERE id=?
            """, (now, txid, sid))
            conn.commit()
            conn.close()

        return {
            "success": True,
            "settlement_id": sid,
            "tranche": row['tranche_number'],
            "amount_xmr": row['amount_xmr'],
            "txid": txid,
            "processed_at": now
        }

    @staticmethod
    def get_pending_tranches() -> List[dict]:
        """Recupere toutes les tranches en pending (vue admin)."""
        now = datetime.utcnow().isoformat()
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("""
                SELECT ps.*, wq.dest_address, wq.username as wd_username
                FROM partial_settlements ps
                JOIN withdrawal_queue wq ON ps.withdrawal_id = wq.id
                WHERE ps.status='pending' AND ps.scheduled_at <= ?
                ORDER BY ps.scheduled_at ASC
            """, (now,))
            rows = c.fetchall()
            conn.close()
        return [dict(r) for r in rows]

    @staticmethod
    def get_settlement_summary() -> dict:
        """Resume global des reglements partiels."""
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("""
                SELECT status, COUNT(*) as count, SUM(amount_xmr) as total_xmr
                FROM partial_settlements
                GROUP BY status
            """)
            rows = c.fetchall()
            conn.close()
        return {
            row['status']: {
                "count": row['count'],
                "total_xmr": round(float(row['total_xmr'] or 0), 8)
            }
            for row in rows
        }


# ============================================================
# BALANCE ADJUSTMENT MANAGER
# ============================================================

class BalanceAdjustmentManager:
    """
    Gere les ajustements manuels de balance visible.

    IMPORTANT : Ces ajustements modifient uniquement le champ `balance`
    de l'user dans users_db. Ils ne creatent PAS de transaction
    on-chain et ne modifient PAS l'historique des orders.

    Cas d'usage legitimes :
      - Correction for yield/staking calculation error
      - Compensation suite a un bug de credit
      - Ajustement suite a un litige resolu manuellement
      - Correction d'un double-credit ou double-debit
    """

    @staticmethod
    def apply_adjustment(username: str, adjustment_type: str,
                          amount_xmr: float, current_balance: float,
                          reason: str, performed_by: str,
                          category: str = "manual",
                          audit_ref: str = "") -> dict:
        """
        Applique un ajustement de balance et retourne le nouveau balance.

        Args:
            username:        User cible
            adjustment_type: 'credit' | 'debit' | 'override'
            amount_xmr:      Montant de l'ajustement (ou nouveau balance si override)
            current_balance: Balance actuel (pour calcul et audit)
            reason:          Justification obligatoire
            performed_by:    Admin qui effectue l'ajustement
            category:        Categorie (yield_correction, staking, bug_fix, etc.)
            audit_ref:       Reference externe (ticket, ordre, etc.)

        Returns:
            {"success": bool, "adjustment_id": str,
             "balance_before": float, "balance_after": float}
        """
        if not reason or len(reason.strip()) < 10:
            return {"success": False, "error": "Reason must be at least 10 characters"}
        if amount_xmr < 0:
            return {"success": False, "error": "Amount must be non-negative"}

        balance_before = round(current_balance, 8)

        if adjustment_type == AdjustmentType.CREDIT:
            balance_after = round(balance_before + amount_xmr, 8)
        elif adjustment_type == AdjustmentType.DEBIT:
            if amount_xmr > balance_before:
                return {"success": False, "error": "Debit amount exceeds current balance"}
            balance_after = round(balance_before - amount_xmr, 8)
        elif adjustment_type == AdjustmentType.OVERRIDE:
            balance_after = round(amount_xmr, 8)
        else:
            return {"success": False, "error": f"Unknown adjustment type: {adjustment_type}"}

        adj_id = f"ADJ_{secrets.token_hex(10).upper()}"
        now = datetime.utcnow().isoformat()

        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            c = conn.cursor()
            c.execute("""
                INSERT INTO balance_adjustments
                (id, username, adjustment_type, amount_xmr, balance_before,
                 balance_after, reason, category, performed_by, performed_at,
                 is_reversible, audit_ref)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                adj_id, username, adjustment_type, amount_xmr,
                balance_before, balance_after, reason.strip(), category,
                performed_by, now, 1, audit_ref
            ))
            conn.commit()
            conn.close()

        return {
            "success": True,
            "adjustment_id": adj_id,
            "username": username,
            "adjustment_type": adjustment_type,
            "amount_xmr": amount_xmr,
            "balance_before": balance_before,
            "balance_after": balance_after,
            "performed_by": performed_by,
            "performed_at": now
        }

    @staticmethod
    def reverse_adjustment(adj_id: str, reversed_by: str, reason: str) -> dict:
        """
        Cancels a previous adjustment (if reversible).
        Creates a reverse adjustment to preserve traceability.
        """
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("SELECT * FROM balance_adjustments WHERE id=?", (adj_id,))
            row = c.fetchone()
            conn.close()

        if not row:
            return {"success": False, "error": "Adjustment not found"}
        if not row['is_reversible']:
            return {"success": False, "error": "This adjustment is not reversible"}
        if row['reversed_by']:
            return {"success": False, "error": "Adjustment already reversed"}

        # Creer l'ajustement inverse
        reverse_type = (
            AdjustmentType.DEBIT if row['adjustment_type'] == 'credit'
            else AdjustmentType.CREDIT if row['adjustment_type'] == 'debit'
            else AdjustmentType.OVERRIDE
        )

        now = datetime.utcnow().isoformat()
        rev_id = f"ADJ_REV_{secrets.token_hex(8).upper()}"

        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            c = conn.cursor()
            # Marquer l'original comme cancelled
            c.execute("""
                UPDATE balance_adjustments
                SET reversed_by=?, reversed_at=?, reversal_id=?
                WHERE id=?
            """, (reversed_by, now, rev_id, adj_id))
            # Creer l'entree de reversal
            c.execute("""
                INSERT INTO balance_adjustments
                (id, username, adjustment_type, amount_xmr, balance_before,
                 balance_after, reason, category, performed_by, performed_at,
                 is_reversible, audit_ref)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                rev_id, row['username'], reverse_type.value,
                row['amount_xmr'], row['balance_after'], row['balance_before'],
                f"REVERSAL of {adj_id}: {reason}", "reversal",
                reversed_by, now, 0, adj_id
            ))
            conn.commit()
            conn.close()

        return {
            "success": True,
            "reversal_id": rev_id,
            "original_id": adj_id,
            "username": row['username'],
            "balance_restored_to": row['balance_before'],
            "reversed_by": reversed_by
        }

    @staticmethod
    def get_user_adjustments(username: str, limit: int = 50) -> List[dict]:
        """Recupere l'historique des ajustements d'un user."""
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("""
                SELECT * FROM balance_adjustments
                WHERE username=?
                ORDER BY performed_at DESC
                LIMIT ?
            """, (username, limit))
            rows = c.fetchall()
            conn.close()
        return [dict(r) for r in rows]

    @staticmethod
    def get_all_adjustments(limit: int = 200) -> List[dict]:
        """Recupere tous les ajustements (vue admin)."""
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("""
                SELECT * FROM balance_adjustments
                ORDER BY performed_at DESC
                LIMIT ?
            """, (limit,))
            rows = c.fetchall()
            conn.close()
        return [dict(r) for r in rows]

    @staticmethod
    def get_adjustment_stats() -> dict:
        """Statistiques globales des ajustements."""
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("""
                SELECT
                    adjustment_type,
                    COUNT(*) as count,
                    SUM(amount_xmr) as total_xmr
                FROM balance_adjustments
                WHERE reversed_by IS NULL
                GROUP BY adjustment_type
            """)
            rows = c.fetchall()
            conn.close()
        return {
            row['adjustment_type']: {
                "count": row['count'],
                "total_xmr": round(float(row['total_xmr'] or 0), 8)
            }
            for row in rows
        }


# ============================================================
# LIQUIDITY SNAPSHOT ENGINE
# ============================================================

class LiquidityEngine:
    """
    Moteur de calcul et de suivi de la liquidity.

    Calcule en temps reel la difference entre :
      - Total User Equity : somme de tous les balances affiches aux users
      - Actual Available Liquidity : fonds reellement disponibles pour les withdrawals

    Cette difference (le "liquidity gap") est critique pour :
      - La gestion du risque operationnel
      - La preparation aux audits
      - La detection precoce de problemes de solvabilite
    """

    @staticmethod
    def compute_snapshot(users_db: dict, orders_db: dict,
                          vendor_bonds_db: dict, xmr_usd_rate: float = 0.0,
                          triggered_by: str = "auto",
                          actual_wallet_balance: float = None) -> dict:
        """
        Calcule un instantane complet de la liquidity.

        Args:
            users_db:              Dict des users (en memoire)
            orders_db:             Dict des orders (en memoire)
            vendor_bonds_db:       Dict des bonds vendors
            xmr_usd_rate:          Taux XMR/USD actuel
            triggered_by:          Qui a declenche le snapshot
            actual_wallet_balance: Balance reel du wallet Monero (si disponible)

        Returns:
            Snapshot complet avec tous les metriques
        """
        # --- 1. Total User Equity (somme des balances affiches) ---
        # Exclure les admins du calcul d'equity:
        # L'equity = ce que les users/vendors ont a retirer (pas les fonds plateforme)
        # La balance admin = commissions accumulees = fonds propres de la plateforme
        total_user_equity = sum(
            float(u.get('balance', 0.0))
            for u in users_db.values()
            if u.get('role', 'buyer') not in ('admin',)
        )
        # Separe: fonds propres de la plateforme (commissions admin)
        platform_equity = sum(
            float(u.get('balance', 0.0))
            for u in users_db.values()
            if u.get('role', 'buyer') == 'admin'
        )
        # Pour le calcul de coverage, on utilise uniquement l'equity users/vendors
        _total_user_equity_for_coverage = sum(
            float(u.get('balance', 0.0))
            for u in users_db.values()
            if u.get('status') != 'banned'
        )

        # --- 2. Fonds bloques en escrow (orders en cours) ---
        escrow_locked = sum(
            float(o.get('amount_xmr', 0.0))
            for o in orders_db.values()
            if o.get('status') in ('pending', 'paid', 'shipped', 'disputed')
        )

        # --- 3. Bonds vendors actifs ---
        bonds_locked = sum(
            float(b.get('amount_xmr', 0.0))
            for b in vendor_bonds_db.values()
            if b.get('status') == 'active'
        )

        # --- 4. Withdrawals en pending/approuves ---
        wd_stats = WithdrawalQueueManager.get_queue_stats()
        pending_withdrawals = (
            wd_stats.get("pending_total_xmr", 0.0) +
            wd_stats.get("approved_total_xmr", 0.0) +
            wd_stats.get("processing_total_xmr", 0.0)
        )

        # --- 5. Tranches de reglement partiel en pending ---
        ps_summary = PartialSettlementManager.get_settlement_summary()
        partial_pending = float(ps_summary.get('pending', {}).get('total_xmr', 0.0))

        # --- 6. Liquidity reelle disponible ---
        # Si on a le balance reel du wallet, on l'utilise
        # Sinon, on estime : equity - escrow - bonds - pending_wd
        if actual_wallet_balance is not None:
            actual_liquidity = float(actual_wallet_balance)
        else:
            # Estimation conservative
            actual_liquidity = max(0.0, total_user_equity - escrow_locked - bonds_locked)

        # --- 7. Metriques derivees ---
        coverage_ratio = (
            round(actual_liquidity / total_user_equity, 4)
            if total_user_equity > 0 else 1.0
        )
        liquidity_gap = round(actual_liquidity - total_user_equity, 8)

        # --- 8. Conversion USD ---
        rate = float(xmr_usd_rate) if xmr_usd_rate else 0.0
        total_equity_usd = round(total_user_equity * rate, 2) if rate else None
        actual_liquidity_usd = round(actual_liquidity * rate, 2) if rate else None

        snapshot = {
            "snapshot_at": datetime.utcnow().isoformat(),
            "total_user_equity_xmr": round(total_user_equity, 8),
            "total_user_equity_usd": total_equity_usd,
            "actual_liquidity_xmr": round(actual_liquidity, 8),
            "actual_liquidity_usd": actual_liquidity_usd,
            "escrow_locked_xmr": round(escrow_locked, 8),
            "bonds_locked_xmr": round(bonds_locked, 8),
            "pending_withdrawals_xmr": round(pending_withdrawals, 8),
            "partial_settlements_xmr": round(partial_pending, 8),
            "coverage_ratio": coverage_ratio,
            "liquidity_gap_xmr": liquidity_gap,
            "xmr_usd_rate": rate,
            "triggered_by": triggered_by,
            # Indicateurs de risque
            "risk_level": LiquidityEngine._assess_risk(coverage_ratio, liquidity_gap),
            "is_solvent": coverage_ratio >= 1.0,
            "breakdown": {
                "user_equity": round(total_user_equity, 8),
                "escrow": round(escrow_locked, 8),
                "bonds": round(bonds_locked, 8),
                "pending_withdrawals": round(pending_withdrawals, 8),
                "partial_settlements": round(partial_pending, 8),
                "available": round(actual_liquidity, 8)
            }
        }

        # Persister le snapshot
        LiquidityEngine._save_snapshot(snapshot)
        return snapshot

    @staticmethod
    def _assess_risk(coverage_ratio: float, liquidity_gap: float) -> str:
        """
        Evalue le niveau de risque de liquidity.
        Returns: 'healthy' | 'warning' | 'critical' | 'insolvent'
        """
        if coverage_ratio >= 1.5:
            return "healthy"
        elif coverage_ratio >= 1.0:
            return "adequate"
        elif coverage_ratio >= 0.8:
            return "warning"
        elif coverage_ratio >= 0.5:
            return "critical"
        else:
            return "insolvent"

    @staticmethod
    def _save_snapshot(snapshot: dict):
        """Persiste un snapshot dans SQLite."""
        sid = f"SNAP_{secrets.token_hex(8).upper()}"
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            c = conn.cursor()
            c.execute("""
                INSERT INTO liquidity_snapshots
                (id, snapshot_at, total_user_equity_xmr, total_user_equity_usd,
                 actual_liquidity_xmr, actual_liquidity_usd,
                 escrow_locked_xmr, bonds_locked_xmr,
                 pending_withdrawals_xmr, partial_settlements_xmr,
                 coverage_ratio, liquidity_gap_xmr,
                 xmr_usd_rate, triggered_by, notes)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                sid,
                snapshot['snapshot_at'],
                snapshot['total_user_equity_xmr'],
                snapshot.get('total_user_equity_usd'),
                snapshot['actual_liquidity_xmr'],
                snapshot.get('actual_liquidity_usd'),
                snapshot['escrow_locked_xmr'],
                snapshot['bonds_locked_xmr'],
                snapshot['pending_withdrawals_xmr'],
                snapshot['partial_settlements_xmr'],
                snapshot['coverage_ratio'],
                snapshot['liquidity_gap_xmr'],
                snapshot['xmr_usd_rate'],
                snapshot['triggered_by'],
                json.dumps(snapshot.get('breakdown', {}))
            ))
            conn.commit()
            conn.close()

    @staticmethod
    def get_snapshots(limit: int = 48) -> List[dict]:
        """Recupere les derniers snapshots (pour graphiques)."""
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("""
                SELECT * FROM liquidity_snapshots
                ORDER BY snapshot_at DESC
                LIMIT ?
            """, (limit,))
            rows = c.fetchall()
            conn.close()
        return [dict(r) for r in reversed(rows)]  # Ordre chronologique

    @staticmethod
    def get_latest_snapshot() -> Optional[dict]:
        """Recupere le snapshot le plus recent."""
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("""
                SELECT * FROM liquidity_snapshots
                ORDER BY snapshot_at DESC
                LIMIT 1
            """)
            row = c.fetchone()
            conn.close()
        return dict(row) if row else None


# ============================================================
# PLATFORM CONTROL MANAGER
# ============================================================

class PlatformControlManager:
    """
    Gere les modes de controle de la plateforme :

      1. Liquidity Protection Mode - Informe les users que les withdrawals
         peuvent etre traites en plusieurs versements. Totalement transparent.

      2. Emergency Freeze - Suspend temporairement tous les withdrawals avec un
         message public visible par tous les users.

      3. Structured Withdrawal Policy - Convertit automatiquement les gros
         withdrawals en partial settlements quand le coverage ratio est bas.

    Toutes les actions sont loggees dans audit_log avec severity CRITICAL.
    Les users voient toujours un message clair expliquant la situation.
    """

    # Cles de configuration dans la table platform_config
    KEY_LIQUIDITY_PROTECTION  = "liquidity_protection_mode"
    KEY_EMERGENCY_FREEZE      = "emergency_freeze"
    KEY_FREEZE_MESSAGE        = "emergency_freeze_message"
    KEY_STRUCTURED_POLICY     = "structured_withdrawal_policy"
    KEY_STRUCTURED_THRESHOLD  = "structured_threshold_xmr"
    KEY_STRUCTURED_COVERAGE   = "structured_coverage_trigger"
    KEY_MANUAL_CRYPTO_ENABLED = "manual_crypto_prices_enabled"
    KEY_MANUAL_XMR_USD        = "manual_xmr_usd"
    KEY_MANUAL_BTC_USD        = "manual_btc_usd"

    @staticmethod
    def _init_config_table():
        """Creates the platform_config table if missing."""
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            c = conn.cursor()
            c.execute("""
                CREATE TABLE IF NOT EXISTS platform_config (
                    key         TEXT PRIMARY KEY,
                    value       TEXT NOT NULL,
                    updated_at  TEXT,
                    updated_by  TEXT,
                    description TEXT
                )
            """)
            # Valeurs par defaut
            defaults = [
                (PlatformControlManager.KEY_LIQUIDITY_PROTECTION, "0",
                 "Liquidity Protection Mode active (0=off, 1=on)"),
                (PlatformControlManager.KEY_EMERGENCY_FREEZE, "0",
                 "Emergency freeze active (0=off, 1=on)"),
                (PlatformControlManager.KEY_FREEZE_MESSAGE,
                 "Emergency Maintenance - Withdrawals temporarily paused for system upgrade. We apologize for the inconvenience.",
                 "Message displayed to users during emergency freeze"),
                (PlatformControlManager.KEY_STRUCTURED_POLICY, "0",
                 "Auto structured withdrawal policy active (0=off, 1=on)"),
                (PlatformControlManager.KEY_STRUCTURED_THRESHOLD, "60.0",
                 "XMR threshold above which structured withdrawal applies"),
                (PlatformControlManager.KEY_STRUCTURED_COVERAGE, "0.80",
                 "Coverage ratio below which structured policy auto-activates"),
                (PlatformControlManager.KEY_MANUAL_CRYPTO_ENABLED, "0",
                 "Use admin-set USD spot prices for XMR/BTC instead of oracle (0=off, 1=on)"),
                (PlatformControlManager.KEY_MANUAL_XMR_USD, "165.0",
                 "Manual XMR/USD spot price when manual_crypto_prices_enabled=1"),
                (PlatformControlManager.KEY_MANUAL_BTC_USD, "74000.0",
                 "Manual BTC/USD spot price when manual_crypto_prices_enabled=1"),
            ]
            for key, value, desc in defaults:
                c.execute("""
                    INSERT OR IGNORE INTO platform_config (key, value, updated_at, updated_by, description)
                    VALUES (?, ?, ?, ?, ?)
                """, (key, value, datetime.utcnow().isoformat(), "system", desc))
            conn.commit()
            conn.close()

    @staticmethod
    def _get(key: str) -> str:
        """Lit une valeur de configuration."""
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("SELECT value FROM platform_config WHERE key=?", (key,))
            row = c.fetchone()
            conn.close()
        return row['value'] if row else ""

    @staticmethod
    def _set(key: str, value: str, admin: str):
        """Ecrit une valeur de configuration."""
        now = datetime.utcnow().isoformat()
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            c = conn.cursor()
            c.execute("""
                UPDATE platform_config SET value=?, updated_at=?, updated_by=?
                WHERE key=?
            """, (value, now, admin, key))
            conn.commit()
            conn.close()

    # ----------------------------------------------------------
    # LECTURE DE L'ETAT GLOBAL (utilise par les endpoints)
    # ----------------------------------------------------------

    @staticmethod
    def get_platform_status() -> dict:
        """
        Returns l'etat complet des modes de controle.
        Appele par l'endpoint public /api/platform/status
        pour que le frontend affiche les banners appropriees.
        """
        lpm_active = PlatformControlManager._get(
            PlatformControlManager.KEY_LIQUIDITY_PROTECTION) == "1"
        freeze_active = PlatformControlManager._get(
            PlatformControlManager.KEY_EMERGENCY_FREEZE) == "1"
        freeze_msg = PlatformControlManager._get(
            PlatformControlManager.KEY_FREEZE_MESSAGE)
        structured_active = PlatformControlManager._get(
            PlatformControlManager.KEY_STRUCTURED_POLICY) == "1"
        structured_threshold = float(
            PlatformControlManager._get(PlatformControlManager.KEY_STRUCTURED_THRESHOLD) or "60.0")
        structured_coverage = float(
            PlatformControlManager._get(PlatformControlManager.KEY_STRUCTURED_COVERAGE) or "0.80")

        return {
            "liquidity_protection_mode": {
                "active": lpm_active,
                "user_message": (
                    "⚠️ Liquidity Protection Mode is active - withdrawals may be processed "
                    "in multiple installments over time. Your funds are safe and fully accounted for."
                ) if lpm_active else None,
            },
            "emergency_freeze": {
                "active": freeze_active,
                "user_message": freeze_msg if freeze_active else None,
            },
            "structured_withdrawal_policy": {
                "active": structured_active,
                "threshold_xmr": structured_threshold,
                "coverage_trigger": structured_coverage,
                "user_message": (
                    f"ℹ️ Withdrawals above {structured_threshold:.2f} XMR are currently processed "
                    f"as structured payments in multiple installments. "
                    f"You will receive a detailed schedule upon approval."
                ) if structured_active else None,
            },
            "withdrawals_blocked": freeze_active,
        }

    # ----------------------------------------------------------
    # 1. LIQUIDITY PROTECTION MODE
    # ----------------------------------------------------------

    @staticmethod
    def set_liquidity_protection_mode(enabled: bool, admin: str) -> dict:
        """
        Enables or disables le Liquidity Protection Mode.

        Quand actif :
          - Les users voient une banner d'information claire.
          - Les withdrawals continuent d'etre traites normalement.
          - Les gros withdrawals peuvent etre convertis en structured withdrawals.
          - Aucune action cachee - transparence totale.
        """
        PlatformControlManager._set(
            PlatformControlManager.KEY_LIQUIDITY_PROTECTION,
            "1" if enabled else "0",
            admin
        )
        action = "ENABLED" if enabled else "DISABLED"
        print(f"[PLATFORM] Liquidity Protection Mode {action} by {admin}")
        return {
            "success": True,
            "liquidity_protection_mode": enabled,
            "action": action,
            "admin": admin,
            "timestamp": datetime.utcnow().isoformat(),
            "note": (
                "Users will see a transparent notification about installment processing."
                if enabled else "Liquidity Protection Mode deactivated."
            )
        }

    # ----------------------------------------------------------
    # 2. EMERGENCY FREEZE (Kill Switch transparent)
    # ----------------------------------------------------------

    @staticmethod
    def set_emergency_freeze(enabled: bool, admin: str,
                              message: str = None) -> dict:
        """
        Enables or disables le freeze d'urgence des withdrawals.

        Quand actif :
          - Tous les nouveaux withdrawals sont bloques avec un message public.
          - Les withdrawals deja en cours (processing) ne sont PAS cancelleds.
          - Le message est visible par TOUS les users sur leur dashboard.
          - L'admin peut personnaliser le message affiche.

        Args:
            enabled: True pour activer, False pour desactiver
            admin:   Admin qui effectue l'action
            message: Message public personnalise (optionnel)
        """
        PlatformControlManager._set(
            PlatformControlManager.KEY_EMERGENCY_FREEZE,
            "1" if enabled else "0",
            admin
        )
        if message and enabled:
            PlatformControlManager._set(
                PlatformControlManager.KEY_FREEZE_MESSAGE,
                message.strip(),
                admin
            )

        current_msg = PlatformControlManager._get(
            PlatformControlManager.KEY_FREEZE_MESSAGE)
        action = "ACTIVATED" if enabled else "DEACTIVATED"
        print(f"[PLATFORM] Emergency Freeze {action} by {admin}")

        return {
            "success": True,
            "emergency_freeze": enabled,
            "action": action,
            "admin": admin,
            "public_message": current_msg if enabled else None,
            "timestamp": datetime.utcnow().isoformat(),
            "note": (
                f"All new withdrawals are now blocked. Users see: '{current_msg}'"
                if enabled else "Emergency freeze lifted. Withdrawals resumed."
            )
        }

    @staticmethod
    def update_freeze_message(message: str, admin: str) -> dict:
        """Update le message public du freeze sans changer son etat."""
        if not message or len(message.strip()) < 10:
            return {"success": False, "error": "Message must be at least 10 characters"}
        PlatformControlManager._set(
            PlatformControlManager.KEY_FREEZE_MESSAGE,
            message.strip(),
            admin
        )
        return {
            "success": True,
            "message": message.strip(),
            "updated_by": admin
        }

    @staticmethod
    def check_withdrawal_allowed() -> dict:
        """
        Checks si les withdrawals sont autorises.
        Appele avant chaque soumission de withdrawal.
        Returns {"allowed": bool, "reason": str, "user_message": str}
        """
        freeze_active = PlatformControlManager._get(
            PlatformControlManager.KEY_EMERGENCY_FREEZE) == "1"
        if freeze_active:
            msg = PlatformControlManager._get(
                PlatformControlManager.KEY_FREEZE_MESSAGE)
            return {
                "allowed": False,
                "reason": "EMERGENCY_FREEZE_ACTIVE",
                "user_message": msg
            }
        return {"allowed": True}

    # ----------------------------------------------------------
    # 3. STRUCTURED WITHDRAWAL POLICY (Auto Partial Mode transparent)
    # ----------------------------------------------------------

    @staticmethod
    def set_structured_withdrawal_policy(enabled: bool, admin: str,
                                          threshold_xmr: float = None,
                                          coverage_trigger: float = None) -> dict:
        """
        Active la politique de structured withdrawals.

        Quand actif :
          - Les withdrawals au-dessus du seuil sont automatiquement convertis
            en partial settlements avec un calendrier communique a l'user.
          - L'user voit clairement : "Votre withdrawal de X XMR sera traite
            en N versements de Y XMR sur Z jours."
          - Peut etre declenche manuellement ou automatiquement si le
            coverage ratio drops below configured threshold.

        Args:
            enabled:          True pour activer
            admin:            Admin qui effectue l'action
            threshold_xmr:    Seuil XMR au-dessus duquel la politique s'applique
            coverage_trigger: Coverage ratio declencheur (ex: 0.80 = 80%)
        """
        PlatformControlManager._set(
            PlatformControlManager.KEY_STRUCTURED_POLICY,
            "1" if enabled else "0",
            admin
        )
        if threshold_xmr is not None:
            PlatformControlManager._set(
                PlatformControlManager.KEY_STRUCTURED_THRESHOLD,
                str(float(threshold_xmr)),
                admin
            )
        if coverage_trigger is not None:
            PlatformControlManager._set(
                PlatformControlManager.KEY_STRUCTURED_COVERAGE,
                str(float(coverage_trigger)),
                admin
            )

        threshold = float(PlatformControlManager._get(
            PlatformControlManager.KEY_STRUCTURED_THRESHOLD) or "60.0")
        coverage = float(PlatformControlManager._get(
            PlatformControlManager.KEY_STRUCTURED_COVERAGE) or "0.80")

        action = "ENABLED" if enabled else "DISABLED"
        print(f"[PLATFORM] Structured Withdrawal Policy {action} by {admin} "
              f"(threshold={threshold} XMR, coverage_trigger={coverage*100:.0f}%)")

        return {
            "success": True,
            "structured_withdrawal_policy": enabled,
            "threshold_xmr": threshold,
            "coverage_trigger": coverage,
            "action": action,
            "admin": admin,
            "timestamp": datetime.utcnow().isoformat(),
            "note": (
                f"Withdrawals above {threshold:.2f} XMR will be automatically "
                f"structured into installments. Users are notified transparently."
                if enabled else "Structured withdrawal policy deactivated."
            )
        }

    @staticmethod
    def check_structured_policy(amount_xmr: float,
                                  coverage_ratio: float = None) -> dict:
        """
        Checks si un withdrawal doit etre converti en structured withdrawal.

        Returns:
            {
              "apply_structured": bool,
              "reason": str,
              "suggested_tranches": int,
              "suggested_interval_days": int,
              "user_message": str
            }
        """
        policy_active = PlatformControlManager._get(
            PlatformControlManager.KEY_STRUCTURED_POLICY) == "1"
        threshold = float(PlatformControlManager._get(
            PlatformControlManager.KEY_STRUCTURED_THRESHOLD) or "60.0")
        coverage_trigger = float(PlatformControlManager._get(
            PlatformControlManager.KEY_STRUCTURED_COVERAGE) or "0.80")

        # Checksr si la politique s'applique
        apply = False
        reason = ""

        if policy_active and amount_xmr >= threshold:
            apply = True
            reason = f"Structured withdrawal policy active (amount {amount_xmr:.4f} XMR ≥ threshold {threshold:.2f} XMR)"

        if coverage_ratio is not None and coverage_ratio < coverage_trigger:
            apply = True
            reason = (reason + " | " if reason else "") + \
                     f"Coverage ratio {coverage_ratio*100:.1f}% below trigger {coverage_trigger*100:.0f}%"

        if not apply:
            return {"apply_structured": False}

        # Calculer le nombre de tranches suggere
        # Regle : ~10-15% par tranche, minimum 3 tranches
        if amount_xmr < 100:
            num_tranches = 3
            interval_days = 7
        elif amount_xmr < 500:
            num_tranches = 5
            interval_days = 10
        else:
            num_tranches = 8
            interval_days = 14

        per_tranche = round(amount_xmr / num_tranches, 6)
        total_days = interval_days * (num_tranches - 1)

        return {
            "apply_structured": True,
            "reason": reason,
            "suggested_tranches": num_tranches,
            "suggested_interval_days": interval_days,
            "per_tranche_xmr": per_tranche,
            "total_days": total_days,
            "user_message": (
                f"Your withdrawal of {amount_xmr:.6f} XMR will be processed as a structured payment: "
                f"{num_tranches} installments of {per_tranche:.6f} XMR each, "
                f"paid every {interval_days} days over {total_days} days. "
                f"Your funds are fully reserved and will be released on schedule."
            )
        }

    # ----------------------------------------------------------
    # ADMIN - Vue complete de la configuration
    # ----------------------------------------------------------

    @staticmethod
    def get_manual_crypto_settings() -> dict:
        """Lecture des prix manuels (admin)."""
        return {
            "enabled": PlatformControlManager._get(PlatformControlManager.KEY_MANUAL_CRYPTO_ENABLED) == "1",
            "xmr_usd": float(PlatformControlManager._get(PlatformControlManager.KEY_MANUAL_XMR_USD) or "0") or 165.0,
            "btc_usd": float(PlatformControlManager._get(PlatformControlManager.KEY_MANUAL_BTC_USD) or "0") or 74000.0,
        }

    @staticmethod
    def set_manual_crypto_prices(
        enabled: bool, xmr_usd: float, btc_usd: float, admin: str
    ) -> dict:
        """Definit les prix spot USD affichages / calculs (remplace l'oracle si active)."""
        if xmr_usd <= 0 or btc_usd <= 0:
            return {"success": False, "error": "INVALID_PRICES"}
        PlatformControlManager._set(
            PlatformControlManager.KEY_MANUAL_CRYPTO_ENABLED,
            "1" if enabled else "0",
            admin,
        )
        PlatformControlManager._set(
            PlatformControlManager.KEY_MANUAL_XMR_USD,
            f"{round(float(xmr_usd), 2):.2f}",
            admin,
        )
        PlatformControlManager._set(
            PlatformControlManager.KEY_MANUAL_BTC_USD,
            f"{round(float(btc_usd), 2):.2f}",
            admin,
        )
        return {
            "success": True,
            "enabled": enabled,
            "xmr_usd": round(float(xmr_usd), 2),
            "btc_usd": round(float(btc_usd), 2),
            "updated_by": admin,
            "timestamp": datetime.utcnow().isoformat(),
        }

    @staticmethod
    def get_admin_config() -> dict:
        """Returns la configuration complete pour le dashboard admin."""
        with _lock:
            conn = sqlite3.connect(_db_path(), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("SELECT * FROM platform_config ORDER BY key ASC")
            rows = c.fetchall()
            conn.close()
        return {row['key']: dict(row) for row in rows}

    @staticmethod
    def get_freeze_history(limit: int = 50) -> list:
        """
        Returns l'historique des activations/desactivations du freeze
        depuis les logs d'audit.
        """
        try:
            from audit_log import get_recent_logs
            logs = get_recent_logs(n=500)
            return [
                e for e in logs
                if e.get('event') in (
                    'PLATFORM_FREEZE_ACTIVATED',
                    'PLATFORM_FREEZE_DEACTIVATED',
                    'PLATFORM_LPM_ENABLED',
                    'PLATFORM_LPM_DISABLED',
                    'PLATFORM_STRUCTURED_ENABLED',
                    'PLATFORM_STRUCTURED_DISABLED',
                )
            ][:limit]
        except Exception:
            return []


# ============================================================
# INITIALISATION AU DEMARRAGE
# ============================================================


def __getattr__(name: str):
    # Compat: import withdrawal_queue.DB_PATH (ancien chemin fige)
    if name == "DB_PATH":
        return _db_path()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


init_withdrawal_tables()
PlatformControlManager._init_config_table()
print("[WITHDRAWAL] Withdrawal & Liquidity Management System loaded")
print("[PLATFORM]  Platform Control Manager initialized")


