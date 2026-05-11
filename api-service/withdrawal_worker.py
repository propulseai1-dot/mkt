"""
SILKGENESIS - Withdrawal Background Worker
==========================================
Worker autonome qui tourne in the background pour :

  1. AUTO-EXPIRY      - Expire les withdrawals non traites apres leur delai configure
  2. PRIORITY SCORING - Calculates a priority score for each pending withdrawal
  3. TRANCHE ALERTS   - Detecte les tranches de partial settlement dues et alerte
  4. LIQUIDITY WATCH  - Snapshot automatique toutes les heures + alerte si coverage < seuil
  5. COOLDOWN CHECK   - Checks les cooldowns entre withdrawals du meme user

Usage :
    from withdrawal_worker import start_withdrawal_worker
    start_withdrawal_worker(users_db, orders_db)

Le worker tourne dans un thread daemon - il s'stop automatiquement
quand le processus principal se termine.
"""

import threading
import time
import sqlite3
import secrets
from datetime import datetime, timedelta
from typing import Optional

import os
from db_persist import get_db_path
from funds_lock import funds_rlock
from price_oracle_client import get_xmr_usd
from secure_storage import open_secure_connection

_lock = threading.Lock()


def _db_path() -> str:
    return get_db_path()


def _connect():
    """Always open the withdrawal SQLite via the encrypted-at-rest layer."""
    return open_secure_connection(_db_path(), check_same_thread=False)

# ============================================================
# CONFIGURATION DU WORKER
# ============================================================

WORKER_INTERVAL_SECONDS   = 60      # Cycle principal toutes les 60s
EXPIRY_CHECK_INTERVAL     = 300     # Verification expiry toutes les 5min
LIQUIDITY_SNAPSHOT_INTERVAL = 3600  # Snapshot liquidity toutes les heures
TRANCHE_CHECK_INTERVAL    = 120     # Verification tranches dues toutes les 2min
PRIORITY_RECALC_INTERVAL  = 180     # Recalcul priorites toutes les 3min

# Seuils d'alerte liquidity
LIQUIDITY_ALERT_THRESHOLD = 0.85    # Alerte si coverage < 85%
LIQUIDITY_CRITICAL_THRESHOLD = 0.70 # Critique si coverage < 70%


# ============================================================
# PRIORITY SCORING ENGINE
# ============================================================

class PriorityScorer:
    """
    Calculates a priority score (0-100) for each pending withdrawal.

    Facteurs pris en compte :
      - Anciennete de la demande (plus vieux = plus prioritaire)
      - Tier (small > medium > large pour la vitesse de traitement)
      - Proximite de l'expiration
      - Historique de l'user (withdrawals completes precedemment)

    Score 100 = traitement immediat requis
    Score 0   = peut attendre
    """

    @staticmethod
    def compute_score(wd: dict) -> int:
        """
        Calcule le score de priorite d'un withdrawal.
        Retourne un entier entre 0 et 100.
        """
        score = 0
        now = datetime.utcnow()

        # --- 1. Anciennete (max 40 points) ---
        try:
            created = datetime.fromisoformat(wd['created_at'])
            age_hours = (now - created).total_seconds() / 3600
            # +1 point par heure, max 40
            score += min(40, int(age_hours * 2))
        except Exception:
            pass

        # --- 2. Tier (small = plus rapide a traiter) ---
        tier_scores = {'small': 30, 'medium': 15, 'large': 5}
        score += tier_scores.get(wd.get('tier', 'medium'), 10)

        # --- 3. Proximite expiration (max 20 points) ---
        try:
            expires = datetime.fromisoformat(wd['expires_at'])
            hours_left = (expires - now).total_seconds() / 3600
            if hours_left < 2:
                score += 20  # Urgence maximale
            elif hours_left < 6:
                score += 15
            elif hours_left < 12:
                score += 10
            elif hours_left < 24:
                score += 5
        except Exception:
            pass

        # --- 4. Montant (petits montants = plus faciles a traiter) ---
        amount = float(wd.get('amount_xmr', 0))
        if amount < 1.0:
            score += 10
        elif amount < 5.0:
            score += 5
        # Les gros montants ne recoivent pas de bonus

        return min(100, score)

    @staticmethod
    def update_all_priorities():
        """
        Recalcule et met a jour les scores de priorite pour tous les withdrawals
        pending. Stores the score dans la colonne `notes` (JSON).
        """
        with _lock:
            conn = _connect()
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("""
                SELECT * FROM withdrawal_queue
                WHERE status IN ('pending', 'under_review')
            """)
            rows = c.fetchall()

            for row in rows:
                wd = dict(row)
                score = PriorityScorer.compute_score(wd)
                # Stocker le score dans priority_score si la colonne existe
                try:
                    c.execute("""
                        UPDATE withdrawal_queue
                        SET priority_score = ?, updated_at = ?
                        WHERE id = ?
                    """, (score, datetime.utcnow().isoformat(), wd['id']))
                except Exception:
                    # La colonne n'existe peut-etre pas encore - on l'ajoute
                    try:
                        c.execute("ALTER TABLE withdrawal_queue ADD COLUMN priority_score INTEGER DEFAULT 0")
                        c.execute("""
                            UPDATE withdrawal_queue
                            SET priority_score = ?, updated_at = ?
                            WHERE id = ?
                        """, (score, datetime.utcnow().isoformat(), wd['id']))
                    except Exception:
                        pass

            conn.commit()
            conn.close()

        print(f"[WORKER] Priority scores updated for {len(rows)} pending withdrawals")


# ============================================================
# AUTO-EXPIRY ENGINE
# ============================================================

class AutoExpiryEngine:
    """
    Expire automatiquement les withdrawals qui ont depasse leur delai.
    Les fonds sont rembourses au balance de l'user.
    """

    @staticmethod
    def expire_stale_withdrawals(users_db: dict) -> int:
        """
        Expire tous les withdrawals dont expires_at est depasse.
        Retourne le nombre de withdrawals expires.
        """
        now = datetime.utcnow().isoformat()
        expired_count = 0

        with _lock:
            conn = _connect()
            conn.row_factory = sqlite3.Row
            c = conn.cursor()

            # Trouver les withdrawals expires
            c.execute("""
                SELECT * FROM withdrawal_queue
                WHERE status IN ('pending', 'under_review')
                AND expires_at IS NOT NULL
                AND expires_at < ?
            """, (now,))
            expired = c.fetchall()

            for row in expired:
                wd = dict(row)
                # Marquer comme expire
                c.execute("""
                    UPDATE withdrawal_queue
                    SET status = 'expired', updated_at = ?
                    WHERE id = ?
                """, (now, wd['id']))

                # Rembourser le balance en memoire
                username = wd['username']
                if username in users_db:
                    with funds_rlock:
                        users_db[username]['balance'] = round(
                            float(users_db[username].get('balance', 0.0)) + float(wd['amount_xmr']),
                            8
                        )
                    try:
                        from db_persist import save_user
                        save_user(username, users_db[username])
                    except Exception:
                        pass

                expired_count += 1
                print(f"[WORKER] Expired withdrawal {wd['id']} for {username} "
                      f"({wd['amount_xmr']} XMR refunded)")

            conn.commit()
            conn.close()

        if expired_count > 0:
            try:
                from audit_log import log, AuditEvent
                log("WITHDRAWAL_AUTO_EXPIRED", "system", {
                    "count": expired_count,
                    "timestamp": now
                })
            except Exception:
                pass

        return expired_count


# ============================================================
# TRANCHE ALERT ENGINE
# ============================================================

class TrancheAlertEngine:
    """
    Detecte les tranches de partial settlement dues et non traitees.
    Genere des alertes dans les logs pour que l'admin agisse.
    """

    @staticmethod
    def check_overdue_tranches() -> list:
        """
        Retourne la liste des tranches dues et non traitees.
        """
        now = datetime.utcnow().isoformat()
        with _lock:
            conn = _connect()
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("""
                SELECT ps.*, wq.dest_address, wq.username as wd_username
                FROM partial_settlements ps
                JOIN withdrawal_queue wq ON ps.withdrawal_id = wq.id
                WHERE ps.status = 'pending'
                AND ps.scheduled_at <= ?
                ORDER BY ps.scheduled_at ASC
            """, (now,))
            rows = c.fetchall()
            conn.close()

        overdue = [dict(r) for r in rows]

        if overdue:
            print(f"[WORKER] [WARN] {len(overdue)} overdue settlement tranche(s) require admin action!")
            for t in overdue[:5]:  # Log les 5 premieres
                print(f"[WORKER]   -> {t['id']} | {t['username']} | "
                      f"{t['amount_xmr']} XMR | due: {t['scheduled_at']}")

        return overdue


# ============================================================
# LIQUIDITY WATCH ENGINE
# ============================================================

class LiquidityWatchEngine:
    """
    Prend des snapshots periodiques de la liquidity et genere des alertes
    if coverage ratio drops below configured thresholds.
    """

    @staticmethod
    def take_snapshot(users_db: dict, orders_db: dict):
        """
        Prend un snapshot de liquidity et checks les seuils d'alerte.
        """
        try:
            from withdrawal_queue import LiquidityEngine, PlatformControlManager

            # Load les bonds vendors
            vendor_bonds_db = {}
            try:
                from db_persist import load_all_vendor_bonds
                vendor_bonds_db = load_all_vendor_bonds()
            except Exception:
                pass

            # Taux XMR/USD (fallback si API indisponible)
            xmr_rate, _rate_source = get_xmr_usd(default=165.0, max_age_sec=120)
            allow_clearnet_prices = str(os.getenv("SILKGENESIS_ENABLE_CLEARNET_PRICES", "0")).strip().lower() in ("1", "true", "yes", "on")
            if allow_clearnet_prices:
                try:
                    import requests
                    resp = requests.get(
                        "https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=usd",
                        timeout=5
                    )
                    xmr_rate = float(resp.json()["monero"]["usd"])
                except Exception:
                    pass

            snapshot = LiquidityEngine.compute_snapshot(
                users_db=users_db,
                orders_db=orders_db,
                vendor_bonds_db=vendor_bonds_db,
                xmr_usd_rate=xmr_rate,
                triggered_by="auto_worker"
            )

            coverage = snapshot.get('coverage_ratio', 1.0)
            risk = snapshot.get('risk_level', 'adequate')

            print(f"[WORKER] Liquidity snapshot: coverage={coverage*100:.1f}% "
                  f"risk={risk} equity={snapshot.get('total_user_equity_xmr', 0):.4f} XMR")

            # Alertes
            if coverage < LIQUIDITY_CRITICAL_THRESHOLD:
                print(f"[WORKER] [CRITICAL] Coverage ratio {coverage*100:.1f}% "
                      f"below critical threshold {LIQUIDITY_CRITICAL_THRESHOLD*100:.0f}%!")
                try:
                    from audit_log import log_admin, AuditEvent
                    log_admin(AuditEvent.LIQUIDITY_ALERT, "system", {
                        "severity": "CRITICAL",
                        "coverage_ratio": coverage,
                        "threshold": LIQUIDITY_CRITICAL_THRESHOLD,
                        "equity_xmr": snapshot.get('total_user_equity_xmr'),
                        "liquidity_xmr": snapshot.get('actual_liquidity_xmr')
                    })
                except Exception:
                    pass

                # Auto-activer le Liquidity Protection Mode si coverage critique
                try:
                    lpm_status = PlatformControlManager._get(
                        PlatformControlManager.KEY_LIQUIDITY_PROTECTION)
                    if lpm_status != "1":
                        PlatformControlManager.set_liquidity_protection_mode(
                            enabled=True, admin="auto_worker"
                        )
                        print("[WORKER] [SHIELD] Auto-activated Liquidity Protection Mode")
                except Exception:
                    pass

            elif coverage < LIQUIDITY_ALERT_THRESHOLD:
                print(f"[WORKER] [WARNING] Coverage ratio {coverage*100:.1f}% "
                      f"below warning threshold {LIQUIDITY_ALERT_THRESHOLD*100:.0f}%")
                try:
                    from audit_log import log, AuditEvent
                    log(AuditEvent.LIQUIDITY_ALERT, "system", {
                        "severity": "WARNING",
                        "coverage_ratio": coverage,
                        "threshold": LIQUIDITY_ALERT_THRESHOLD
                    })
                except Exception:
                    pass

            return snapshot

        except Exception as e:
            print(f"[WORKER] Error taking liquidity snapshot: {e}")
            return None


# ============================================================
# COOLDOWN CHECKER
# ============================================================

class CooldownChecker:
    """
    Checks que les users respectent les cooldowns entre withdrawals.
    Nettoie aussi les entrees de limites journalieres obsoletes.
    """

    @staticmethod
    def cleanup_old_daily_limits():
        """
        Removes daily-limit entries older than 7 days.
        """
        cutoff = (datetime.utcnow() - timedelta(days=7)).strftime('%Y-%m-%d')
        with _lock:
            conn = _connect()
            c = conn.cursor()
            c.execute("""
                DELETE FROM withdrawal_daily_limits
                WHERE date_key < ?
            """, (cutoff,))
            deleted = c.rowcount
            conn.commit()
            conn.close()

        if deleted > 0:
            print(f"[WORKER] Cleaned up {deleted} old daily limit entries")

    @staticmethod
    def get_user_cooldown_status(username: str, tier: str) -> dict:
        """
        Checks si un user est en cooldown pour un tier donne.
        Retourne {"in_cooldown": bool, "remaining_seconds": int}
        """
        try:
            from withdrawal_queue import WithdrawalRuleEngine
            rule = WithdrawalRuleEngine.get_rule(tier)
            if not rule:
                return {"in_cooldown": False}

            cooldown_seconds = int(rule.get('cooldown_seconds', 300))

            with _lock:
                conn = _connect()
                conn.row_factory = sqlite3.Row
                c = conn.cursor()
                c.execute("""
                    SELECT MAX(created_at) as last_wd
                    FROM withdrawal_queue
                    WHERE username = ? AND tier = ?
                    AND status NOT IN ('rejected', 'cancelled', 'expired')
                """, (username, tier))
                row = c.fetchone()
                conn.close()

            if not row or not row['last_wd']:
                return {"in_cooldown": False}

            last_wd = datetime.fromisoformat(row['last_wd'])
            elapsed = (datetime.utcnow() - last_wd).total_seconds()
            remaining = cooldown_seconds - elapsed

            if remaining > 0:
                return {
                    "in_cooldown": True,
                    "remaining_seconds": int(remaining),
                    "cooldown_seconds": cooldown_seconds
                }
            return {"in_cooldown": False}

        except Exception:
            return {"in_cooldown": False}


# ============================================================
# WORKER PRINCIPAL
# ============================================================

class WithdrawalWorker:
    """
    Worker principal qui orchestre tous les sous-systemes.
    Tourne dans un thread daemon.
    """

    def __init__(self, users_db: dict, orders_db: dict):
        self.users_db = users_db
        self.orders_db = orders_db
        self._running = False
        self._thread = None

        # Compteurs de cycles
        self._cycle = 0
        self._last_expiry_check = 0
        self._last_liquidity_snapshot = 0
        self._last_tranche_check = 0
        self._last_priority_recalc = 0
        self._last_cleanup = 0

    def start(self):
        """Demarre le worker dans un thread daemon."""
        if self._running:
            print("[WORKER] Already running")
            return

        self._running = True
        self._thread = threading.Thread(
            target=self._run_loop,
            name="WithdrawalWorker",
            daemon=True
        )
        self._thread.start()
        print("[WORKER] [OK] Withdrawal Worker started (daemon thread)")

    def stop(self):
        """Stop le worker proprement."""
        self._running = False
        print("[WORKER] Stopping...")

    def _run_loop(self):
        """Boucle principale du worker."""
        print("[WORKER] Worker loop started")

        while self._running:
            try:
                now_ts = time.time()
                self._cycle += 1

                # --- Auto-expiry (toutes les 5min) ---
                if now_ts - self._last_expiry_check >= EXPIRY_CHECK_INTERVAL:
                    expired = AutoExpiryEngine.expire_stale_withdrawals(self.users_db)
                    if expired > 0:
                        print(f"[WORKER] Auto-expired {expired} withdrawal(s)")
                    self._last_expiry_check = now_ts

                # --- Priority scoring (toutes les 3min) ---
                if now_ts - self._last_priority_recalc >= PRIORITY_RECALC_INTERVAL:
                    PriorityScorer.update_all_priorities()
                    self._last_priority_recalc = now_ts

                # --- Tranche alerts (toutes les 2min) ---
                if now_ts - self._last_tranche_check >= TRANCHE_CHECK_INTERVAL:
                    TrancheAlertEngine.check_overdue_tranches()
                    self._last_tranche_check = now_ts

                # --- Liquidity snapshot (toutes les heures) ---
                if now_ts - self._last_liquidity_snapshot >= LIQUIDITY_SNAPSHOT_INTERVAL:
                    LiquidityWatchEngine.take_snapshot(self.users_db, self.orders_db)
                    self._last_liquidity_snapshot = now_ts

                # --- Cleanup (toutes les 24h) ---
                if now_ts - self._last_cleanup >= 86400:
                    CooldownChecker.cleanup_old_daily_limits()
                    self._last_cleanup = now_ts

            except Exception as e:
                print(f"[WORKER] Error in cycle {self._cycle}: {e}")

            # Attendre avant le prochain cycle
            time.sleep(WORKER_INTERVAL_SECONDS)

        print("[WORKER] Worker loop stopped")


# ============================================================
# FONCTION D'INITIALISATION (appelee depuis market_server.py)
# ============================================================

_worker_instance: Optional[WithdrawalWorker] = None


def start_withdrawal_worker(users_db: dict, orders_db: dict) -> WithdrawalWorker:
    """
    Demarre le worker de gestion des withdrawals.
    Idempotent - ne demarre qu'une seule instance.

    Args:
        users_db:  Dictionnaire des users (reference partagee)
        orders_db: Dictionnaire des orders (reference partagee)

    Returns:
        L'instance du worker
    """
    global _worker_instance

    if _worker_instance and _worker_instance._running:
        print("[WORKER] Worker already running - skipping")
        return _worker_instance

    # Ajouter la colonne priority_score si elle n'existe pas
    try:
        with _lock:
            conn = _connect()
            c = conn.cursor()
            c.execute("ALTER TABLE withdrawal_queue ADD COLUMN priority_score INTEGER DEFAULT 0")
            conn.commit()
            conn.close()
    except Exception:
        pass  # Colonne deja existante

    _worker_instance = WithdrawalWorker(users_db, orders_db)
    _worker_instance.start()

    # Premier snapshot immediat au demarrage
    threading.Thread(
        target=lambda: LiquidityWatchEngine.take_snapshot(users_db, orders_db),
        daemon=True,
        name="InitialLiquiditySnapshot"
    ).start()

    return _worker_instance


def get_worker() -> Optional[WithdrawalWorker]:
    """Retourne l'instance du worker en cours."""
    return _worker_instance




