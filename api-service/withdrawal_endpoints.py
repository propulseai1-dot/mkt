"""
SILKGENESIS - Withdrawal & Liquidity API Endpoints
====================================================
Endpoints FastAPI a injecter dans market_server.py.

Routes user :
  POST /api/withdrawal/submit
  GET  /api/withdrawal/history
  GET  /api/withdrawal/{wid}
  POST /api/withdrawal/{wid}/cancel

Routes admin :
  GET  /api/admin/withdrawals/queue
  GET  /api/admin/withdrawals/all
  POST /api/admin/withdrawals/{wid}/review
  POST /api/admin/withdrawals/{wid}/partial-settlement
  POST /api/admin/settlements/{sid}/process
  GET  /api/admin/settlements/pending
  POST /api/admin/balance/adjust
  POST /api/admin/balance/reverse/{adj_id}
  GET  /api/admin/balance/adjustments
  GET  /api/admin/balance/adjustments/{username}
  GET  /api/admin/withdrawal-rules
  POST /api/admin/withdrawal-rules/{tier}
  GET  /api/admin/liquidity/snapshot
  GET  /api/admin/liquidity/history
  POST /api/admin/liquidity/refresh
"""

from fastapi import APIRouter, Request, HTTPException
from datetime import datetime
from typing import Optional
import os
from price_oracle_client import get_xmr_usd

from funds_lock import funds_rlock

from withdrawal_queue import (
    WithdrawalQueueManager,
    WithdrawalRuleEngine,
    PartialSettlementManager,
    BalanceAdjustmentManager,
    LiquidityEngine,
    PlatformControlManager,
)

router = APIRouter()


def _allow_clearnet_prices() -> bool:
    return str(os.getenv("SILKGENESIS_ENABLE_CLEARNET_PRICES", "0")).strip().lower() in ("1", "true", "yes", "on")


# ============================================================
# HELPERS - Authentification & Autorisation
# ============================================================

def _require_auth(request: Request, users_db: dict) -> dict:
    """Checks le token de session et retourne l'user."""
    from security import validate_session
    token = request.headers.get("X-Session-Token", "")
    # Support modern bearer auth used by frontend.
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth.split(" ", 1)[1].strip()
    session = validate_session(token)
    if not session:
        raise HTTPException(status_code=401, detail="SESSION_EXPIRED")
    user = users_db.get(session["username"])
    if not user or user.get("status") == "banned":
        raise HTTPException(status_code=403, detail="ACCOUNT_SUSPENDED")
    return user


def _require_admin(request: Request, users_db: dict) -> dict:
    """Checks que l'user est admin."""
    user = _require_auth(request, users_db)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="ADMIN_REQUIRED")
    return user


def _require_admin_totp_for_balance_actions(admin_user: dict, data: dict, users_db: dict) -> None:
    """
    Ajustements / annulations de solde : exige 2FA (TOTP) actif sur le compte admin
    et un code valide (TOTP courant ou code de secours consomme).
    """
    from security import verify_totp
    from db_persist import save_user

    uname = admin_user.get("username")
    u = users_db.get(uname) or admin_user
    if not u.get("totp_enabled") or not u.get("totp_secret"):
        raise HTTPException(
            status_code=403,
            detail="TOTP_REQUIRED_FOR_FUND_ACTIONS: Enable two-factor authentication in Profile (Identity) before using balance tools.",
        )
    code = (data.get("totp_code") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="TOTP_CODE_REQUIRED")

    totp_valid = verify_totp(u.get("totp_secret") or "", code)
    if not totp_valid:
        codes = u.get("totp_backup_codes") or []
        up = code.upper()
        if up in codes:
            u["totp_backup_codes"] = [c for c in codes if c != up]
            totp_valid = True
            save_user(uname, u)
    if not totp_valid:
        raise HTTPException(status_code=400, detail="TOTP_INVALID")


# ============================================================
# INJECTION DANS market_server.py
# Appeler inject_withdrawal_routes(app, users_db, orders_db, vendor_bonds_db)
# depuis market_server.py apres la definition de l'app.
# ============================================================

def inject_withdrawal_routes(app, users_db: dict, orders_db: dict, vendor_bonds_db: dict):
    """
    Injecte toutes les routes de withdrawal & liquidity dans l'app FastAPI.
    Doit etre appele apres l'initialisation de l'app et des data.
    """

    def _attempt_hot_wallet_payout(wid: str) -> dict:
        """Try immediate Monero payout and mark withdrawal as processing."""
        wd_now = WithdrawalQueueManager.get_withdrawal(wid)
        if not wd_now:
            return {"success": False, "error": "WITHDRAWAL_NOT_FOUND"}
        try:
            from monero_rpc import get_rpc, ATOMIC_UNIT
            rpc = get_rpc()
            amount_atomic = int(float(wd_now["amount_xmr"]) * ATOMIC_UNIT)
            transfer = rpc.transfer(
                destinations=[{"address": wd_now["dest_address"], "amount": amount_atomic}],
                account_index=0,
                priority=2
            )
            if not transfer or not transfer.get("tx_hash"):
                return {"success": False, "error": "WITHDRAWAL_RPC_TRANSFER_FAILED"}
            txid = transfer.get("tx_hash")
            mp = WithdrawalQueueManager.mark_processing(wid, txid=txid)
            if not mp.get("success"):
                return {"success": False, "error": "WITHDRAWAL_MARK_PROCESSING_FAILED"}
            return {
                "success": True,
                "txid": txid,
                "amount_xmr": float(wd_now["amount_xmr"]),
                "fee_xmr": float(transfer.get("fee_xmr") or 0.0),
                "status": "processing"
            }
        except Exception as e:
            return {"success": False, "error": f"WITHDRAWAL_RPC_ERROR: {e}"}

    # ----------------------------------------------------------
    # USER ROUTES
    # ----------------------------------------------------------

    @app.post("/api/withdrawal/submit")
    async def submit_withdrawal(request: Request):
        """
        Soumet une demande de withdrawal.
        Le tier est determine automatiquement selon le montant.
        """
        user = _require_auth(request, users_db)
        data = await request.json()

        amount_xmr = float(data.get("amount_xmr", 0))
        dest_address = str(data.get("dest_address", "")).strip()
        notes = str(data.get("notes", ""))

        from db_persist import save_user
        from config import validate_xmr_address
        if not validate_xmr_address(dest_address):
            raise HTTPException(status_code=400, detail="INVALID_XMR_ADDRESS")

        username = user["username"]
        if amount_xmr <= 0:
            raise HTTPException(status_code=400, detail="INVALID_AMOUNT")

        # Check + debit solde SOUS le verrou AVANT l'insert file (evite TOCTOU / solde negatif en concurrence).
        with funds_rlock:
            bal = float(users_db[username].get("balance", 0.0))
            if bal <= 0:
                raise HTTPException(status_code=400, detail="INSUFFICIENT_BALANCE_FOR_WITHDRAWAL_REQUEST")
            if amount_xmr > bal:
                raise HTTPException(status_code=400, detail="INSUFFICIENT_BALANCE")
            pre = bal
            users_db[username]["balance"] = round(bal - amount_xmr, 8)
            save_user(username, users_db[username])

        try:
            result = WithdrawalQueueManager.submit(
                username=username,
                amount_xmr=amount_xmr,
                dest_address=dest_address,
                user_balance=pre,
                notes=notes,
            )
        except Exception:
            with funds_rlock:
                users_db[username]["balance"] = pre
                save_user(username, users_db[username])
            raise

        if not result.get("success"):
            with funds_rlock:
                users_db[username]["balance"] = pre
                save_user(username, users_db[username])
            raise HTTPException(status_code=400, detail=result.get("error", "WITHDRAWAL_FAILED"))

        from audit_log import log, AuditEvent
        log(AuditEvent.WITHDRAWAL_SUBMITTED, username, {
            "withdrawal_id": result["withdrawal_id"],
            "amount_xmr": amount_xmr,
            "tier": result["tier"],
            "status": result["status"]
        })

        # Auto-payout for small withdrawals (< 1 XMR) that are auto-approved.
        if result.get("auto_approved") and result.get("tier") == "small" and result.get("status") == "approved":
            payout = _attempt_hot_wallet_payout(result["withdrawal_id"])
            if payout.get("success"):
                result["auto_payout"] = payout
            else:
                # Keep withdrawal approved for manual admin payout path.
                result["auto_payout_error"] = payout.get("error", "AUTO_PAYOUT_FAILED")

        return result

    @app.get("/api/withdrawal/history")
    async def get_withdrawal_history(request: Request):
        """Returns l'historique des withdrawals de l'user connecte."""
        user = _require_auth(request, users_db)
        withdrawals = WithdrawalQueueManager.get_user_withdrawals(user["username"])
        return {"withdrawals": withdrawals, "count": len(withdrawals)}

    @app.get("/api/withdrawal/{wid}")
    async def get_withdrawal_detail(wid: str, request: Request):
        """Returns le detail d'un withdrawal (proprietaire ou admin)."""
        user = _require_auth(request, users_db)
        wd = WithdrawalQueueManager.get_withdrawal(wid)
        if not wd:
            raise HTTPException(status_code=404, detail="WITHDRAWAL_NOT_FOUND")
        # Checksr que l'user est proprietaire ou admin
        if wd["username"] != user["username"] and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="ACCESS_DENIED")

        # Ajouter les tranches si partial settlement
        settlements = []
        if wd.get("is_partial"):
            settlements = PartialSettlementManager.get_settlements_for_withdrawal(wid)

        return {"withdrawal": wd, "settlements": settlements}

    @app.post("/api/withdrawal/{wid}/cancel")
    async def cancel_withdrawal(wid: str, request: Request):
        """Cancels a pending withdrawal (user only, status 'pending')."""
        user = _require_auth(request, users_db)
        username = user["username"]

        result = WithdrawalQueueManager.cancel_by_user(wid, username)
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "CANCEL_FAILED"))

        wd = WithdrawalQueueManager.get_withdrawal(wid)
        if wd:
            with funds_rlock:
                users_db[username]["balance"] = round(
                    float(users_db[username].get("balance", 0.0)) + float(wd["amount_xmr"]), 8
                )
                from db_persist import save_user
                save_user(username, users_db[username])

        return result

    # ----------------------------------------------------------
    # ROUTES ADMIN - WITHDRAWAL QUEUE
    # ----------------------------------------------------------

    @app.get("/api/admin/withdrawals/queue")
    async def admin_get_queue(request: Request, tier: Optional[str] = None):
        """
        Returns la file d'pending des withdrawals en pending de validation.
        Peut etre filtre par tier: small | medium | large
        """
        _require_admin(request, users_db)
        queue = WithdrawalQueueManager.get_pending_queue(tier=tier)
        stats = WithdrawalQueueManager.get_queue_stats()
        rules = WithdrawalRuleEngine.get_rules()
        return {
            "queue": queue,
            "count": len(queue),
            "stats": stats,
            "rules": rules
        }

    @app.get("/api/admin/withdrawals/all")
    async def admin_get_all_withdrawals(
        request: Request,
        status: Optional[str] = None,
        limit: int = 200
    ):
        """Returns tous les withdrawals avec filtres optionnels."""
        _require_admin(request, users_db)
        withdrawals = WithdrawalQueueManager.get_all_withdrawals(status=status, limit=limit)
        stats = WithdrawalQueueManager.get_queue_stats()
        return {
            "withdrawals": withdrawals,
            "count": len(withdrawals),
            "stats": stats
        }

    @app.post("/api/admin/withdrawals/{wid}/review")
    async def admin_review_withdrawal(wid: str, request: Request):
        """
        Action admin sur un withdrawal.
        Body: {"action": "approve"|"reject"|"cancel"|"flag_review", "reason": str, "notes": str}
        """
        admin_user = _require_admin(request, users_db)
        data = await request.json()

        action = data.get("action", "")
        reason = data.get("reason", "")
        notes = data.get("notes", "")

        if action not in ("approve", "reject", "cancel", "flag_review"):
            raise HTTPException(status_code=400, detail="INVALID_ACTION")

        result = WithdrawalQueueManager.admin_review(
            wid=wid,
            admin=admin_user["username"],
            action=action,
            reason=reason,
            notes=notes
        )

        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "REVIEW_FAILED"))

        if action in ("reject", "cancel"):
            wd = WithdrawalQueueManager.get_withdrawal(wid)
            if wd and wd["username"] in users_db:
                with funds_rlock:
                    uu = wd["username"]
                    users_db[uu]["balance"] = round(
                        float(users_db[uu].get("balance", 0.0)) + float(wd["amount_xmr"]), 8
                    )
                    from db_persist import save_user
                    save_user(uu, users_db[uu])

        # Validate = approve + immediate payout attempt from hot wallet.
        # Only execute payout when the review result effectively reached APPROVED
        # (e.g. large withdrawals with dual approval may stay UNDER_REVIEW first).
        if action == "approve" and result.get("new_status") == "approved":
            payout = _attempt_hot_wallet_payout(wid)
            if not payout.get("success"):
                raise HTTPException(status_code=503, detail=payout.get("error", "WITHDRAWAL_AUTO_PAYOUT_FAILED"))
            result["auto_payout"] = payout

        from audit_log import log_admin, AuditEvent
        log_admin(AuditEvent.ADMIN_ACTION, admin_user["username"], {
            "action": f"withdrawal_{action}",
            "withdrawal_id": wid,
            "reason": reason
        })

        return result

    @app.post("/api/admin/withdrawals/{wid}/mark-processing")
    async def admin_mark_processing(wid: str, request: Request):
        """Marque un withdrawal comme en cours de traitement on-chain."""
        admin_user = _require_admin(request, users_db)
        data = await request.json()
        txid = data.get("txid")
        result = WithdrawalQueueManager.mark_processing(wid, txid=txid)
        if not result.get("success"):
            raise HTTPException(status_code=400, detail="MARK_PROCESSING_FAILED")
        return result

    @app.post("/api/admin/withdrawals/{wid}/mark-completed")
    async def admin_mark_completed(wid: str, request: Request):
        """Marque un withdrawal comme complete (confirmed on-chain)."""
        admin_user = _require_admin(request, users_db)
        data = await request.json()
        txid = data.get("txid", "")
        if not txid:
            raise HTTPException(status_code=400, detail="TXID_REQUIRED")
        result = WithdrawalQueueManager.mark_completed(wid, txid=txid)
        if not result.get("success"):
            raise HTTPException(status_code=400, detail="MARK_COMPLETED_FAILED")
        return result

    @app.post("/api/admin/withdrawals/{wid}/force-cancel")
    async def admin_force_cancel_withdrawal(wid: str, request: Request):
        """
        Force-cancel a withdrawal even if status is approved/processing.
        Use only when payout did not actually leave the hot wallet.
        Body: {"reason": str, "notes": str}
        """
        admin_user = _require_admin(request, users_db)
        data = await request.json()
        reason = str(data.get("reason", "")).strip() or "Cancelled by admin"
        notes = str(data.get("notes", "")).strip()

        wd = WithdrawalQueueManager.get_withdrawal(wid)
        if not wd:
            raise HTTPException(status_code=404, detail="WITHDRAWAL_NOT_FOUND")

        status = str(wd.get("status") or "")
        if status in ("completed", "rejected", "cancelled", "expired"):
            raise HTTPException(status_code=400, detail=f"CANNOT_FORCE_CANCEL_FROM_STATUS:{status}")

        result = WithdrawalQueueManager.admin_review(
            wid=wid,
            admin=admin_user["username"],
            action="cancel",
            reason=reason,
            notes=notes
        )
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "FORCE_CANCEL_FAILED"))

        # Refund if the account still exists. If deleted, keep an explicit flag for audit.
        refunded = False
        username = wd.get("username")
        if username in users_db:
            with funds_rlock:
                users_db[username]["balance"] = round(
                    float(users_db[username].get("balance", 0.0)) + float(wd["amount_xmr"]),
                    8
                )
                from db_persist import save_user
                save_user(username, users_db[username])
            refunded = True

        from audit_log import log_admin, AuditEvent
        log_admin(AuditEvent.ADMIN_ACTION, admin_user["username"], {
            "action": "withdrawal_force_cancel",
            "withdrawal_id": wid,
            "prior_status": status,
            "reason": reason,
            "refunded": refunded,
            "user_exists": username in users_db
        })

        return {
            "success": True,
            "withdrawal_id": wid,
            "new_status": "cancelled",
            "refunded": refunded,
            "user_exists": username in users_db
        }

    # ----------------------------------------------------------
    # ROUTES ADMIN - PARTIAL SETTLEMENTS
    # ----------------------------------------------------------

    @app.post("/api/admin/withdrawals/{wid}/partial-settlement")
    async def admin_create_partial_settlement(wid: str, request: Request):
        """
        Creates a partial settlement plan for an approved withdrawal.
        Body: {
            "num_tranches": int (2-10),
            "interval_hours": int,
            "notes": str
        }
        """
        admin_user = _require_admin(request, users_db)
        data = await request.json()

        wd = WithdrawalQueueManager.get_withdrawal(wid)
        if not wd:
            raise HTTPException(status_code=404, detail="WITHDRAWAL_NOT_FOUND")

        num_tranches = int(data.get("num_tranches", 3))
        interval_hours = int(data.get("interval_hours", 24))
        notes = data.get("notes", "")

        result = PartialSettlementManager.create_settlement_plan(
            wid=wid,
            username=wd["username"],
            total_xmr=float(wd["amount_xmr"]),
            num_tranches=num_tranches,
            interval_hours=interval_hours,
            admin=admin_user["username"],
            notes=notes
        )

        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "SETTLEMENT_FAILED"))

        from audit_log import log_admin, AuditEvent
        log_admin(AuditEvent.ADMIN_ACTION, admin_user["username"], {
            "action": "partial_settlement_created",
            "withdrawal_id": wid,
            "num_tranches": num_tranches,
            "total_xmr": wd["amount_xmr"]
        })

        return result

    @app.post("/api/admin/settlements/{sid}/process")
    async def admin_process_tranche(sid: str, request: Request):
        """Marque une tranche de reglement partiel comme traitee."""
        admin_user = _require_admin(request, users_db)
        data = await request.json()
        txid = data.get("txid")

        result = PartialSettlementManager.process_tranche(
            sid=sid,
            admin=admin_user["username"],
            txid=txid
        )

        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "PROCESS_FAILED"))

        return result

    @app.get("/api/admin/settlements/pending")
    async def admin_get_pending_settlements(request: Request):
        """Returns toutes les tranches de reglement dues maintenant."""
        _require_admin(request, users_db)
        tranches = PartialSettlementManager.get_pending_tranches()
        summary = PartialSettlementManager.get_settlement_summary()
        return {
            "due_tranches": tranches,
            "count": len(tranches),
            "summary": summary
        }

    @app.get("/api/admin/settlements/withdrawal/{wid}")
    async def admin_get_settlement_plan(wid: str, request: Request):
        """Returns le plan de reglement partiel d'un withdrawal."""
        _require_admin(request, users_db)
        settlements = PartialSettlementManager.get_settlements_for_withdrawal(wid)
        wd = WithdrawalQueueManager.get_withdrawal(wid)
        return {
            "withdrawal": wd,
            "settlements": settlements,
            "count": len(settlements)
        }

    # ----------------------------------------------------------
    # ROUTES ADMIN - BALANCE ADJUSTMENTS
    # ----------------------------------------------------------

    @app.post("/api/admin/balance/adjust")
    async def admin_adjust_balance(request: Request):
        """
        Ajuste manuellement le balance visible d'un user.
        Body: {
            "username": str,
            "adjustment_type": "credit"|"debit"|"override",
            "amount_xmr": float,
            "reason": str (min 10 chars),
            "category": str (optional),
            "audit_ref": str (optional),
            "totp_code": str (requis — 2FA admin)
        }
        """
        admin_user = _require_admin(request, users_db)
        data = await request.json()
        _require_admin_totp_for_balance_actions(admin_user, data, users_db)

        target_username = data.get("username", "").strip()
        adjustment_type = data.get("adjustment_type", "")
        amount_xmr = float(data.get("amount_xmr", 0))
        reason = data.get("reason", "")
        category = data.get("category", "manual")
        audit_ref = data.get("audit_ref", "")

        if target_username not in users_db:
            raise HTTPException(status_code=404, detail="USER_NOT_FOUND")

        current_balance = float(users_db[target_username].get("balance", 0.0))

        result = BalanceAdjustmentManager.apply_adjustment(
            username=target_username,
            adjustment_type=adjustment_type,
            amount_xmr=amount_xmr,
            current_balance=current_balance,
            reason=reason,
            performed_by=admin_user["username"],
            category=category,
            audit_ref=audit_ref
        )

        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "ADJUSTMENT_FAILED"))

        with funds_rlock:
            users_db[target_username]["balance"] = result["balance_after"]
            from db_persist import save_user
            save_user(target_username, users_db[target_username])

        from audit_log import log_admin, AuditEvent
        log_admin(AuditEvent.ADMIN_ACTION, admin_user["username"], {
            "action": "balance_adjustment",
            "target_user": target_username,
            "adjustment_type": adjustment_type,
            "amount_xmr": amount_xmr,
            "balance_before": result["balance_before"],
            "balance_after": result["balance_after"],
            "reason": reason,
            "adjustment_id": result["adjustment_id"]
        })

        return result

    @app.post("/api/admin/balance/reverse/{adj_id}")
    async def admin_reverse_adjustment(adj_id: str, request: Request):
        """
        Cancels a previous balance adjustment.
        Body: {"reason": str, "totp_code": str (requis — 2FA admin)}
        """
        admin_user = _require_admin(request, users_db)
        data = await request.json()
        _require_admin_totp_for_balance_actions(admin_user, data, users_db)
        reason = data.get("reason", "")

        if not reason:
            raise HTTPException(status_code=400, detail="REASON_REQUIRED")

        result = BalanceAdjustmentManager.reverse_adjustment(
            adj_id=adj_id,
            reversed_by=admin_user["username"],
            reason=reason
        )

        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "REVERSAL_FAILED"))

        target_username = result["username"]
        if target_username in users_db:
            with funds_rlock:
                users_db[target_username]["balance"] = result["balance_restored_to"]
                from db_persist import save_user
                save_user(target_username, users_db[target_username])

        return result

    @app.get("/api/admin/balance/adjustments")
    async def admin_get_all_adjustments(request: Request, limit: int = 200):
        """Returns tous les ajustements de balance (vue admin complete)."""
        _require_admin(request, users_db)
        adjustments = BalanceAdjustmentManager.get_all_adjustments(limit=limit)
        stats = BalanceAdjustmentManager.get_adjustment_stats()
        return {
            "adjustments": adjustments,
            "count": len(adjustments),
            "stats": stats
        }

    @app.get("/api/admin/balance/adjustments/{username}")
    async def admin_get_user_adjustments(username: str, request: Request):
        """Returns l'historique des ajustements d'un user specifique."""
        _require_admin(request, users_db)
        if username not in users_db:
            raise HTTPException(status_code=404, detail="USER_NOT_FOUND")
        adjustments = BalanceAdjustmentManager.get_user_adjustments(username)
        user = users_db[username]
        return {
            "username": username,
            "current_balance": user.get("balance", 0.0),
            "adjustments": adjustments,
            "count": len(adjustments)
        }

    # ----------------------------------------------------------
    # ROUTES ADMIN - WITHDRAWAL RULES
    # ----------------------------------------------------------

    @app.get("/api/admin/withdrawal-rules")
    async def admin_get_rules(request: Request):
        """Returns la configuration des regles de withdrawal par tier."""
        _require_admin(request, users_db)
        rules = WithdrawalRuleEngine.get_rules()
        return {"rules": rules}

    @app.post("/api/admin/withdrawal-rules/{tier}")
    async def admin_update_rule(tier: str, request: Request):
        """
        Update les regles d'un tier de withdrawal.
        tier: small | medium | large
        Body: {champs a modifier}
        """
        admin_user = _require_admin(request, users_db)
        if tier not in ("small", "medium", "large"):
            raise HTTPException(status_code=400, detail="INVALID_TIER")

        data = await request.json()
        result = WithdrawalRuleEngine.update_rule(
            tier=tier,
            updates=data,
            admin=admin_user["username"]
        )

        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])

        from audit_log import log_admin, AuditEvent
        log_admin(AuditEvent.ADMIN_ACTION, admin_user["username"], {
            "action": "withdrawal_rule_updated",
            "tier": tier,
            "updates": data
        })

        return {"success": True, "tier": tier, "rule": result}

    # ----------------------------------------------------------
    # ROUTES ADMIN - LIQUIDITY DASHBOARD
    # ----------------------------------------------------------

    @app.get("/api/admin/liquidity/snapshot")
    async def admin_get_liquidity_snapshot(request: Request):
        """
        Returns le snapshot de liquidity le plus recent.
        Calcule un nouveau snapshot en temps reel.
        """
        _require_admin(request, users_db)

        # Fetch le taux XMR/USD
        xmr_rate, _rate_source = get_xmr_usd(default=165.0, max_age_sec=120)
        if _allow_clearnet_prices():
            try:
                import requests as _req
                resp = _req.get(
                    "https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=usd",
                    timeout=3
                )
                xmr_rate = float(resp.json()["monero"]["usd"])
            except Exception:
                xmr_rate = 165.0  # Fallback

        # Fetch le balance reel du wallet via client RPC (auth runtime)
        actual_wallet_balance = None
        try:
            from monero_rpc import get_rpc
            rpc = get_rpc()
            balance = rpc.get_balance(account_index=0)
            if balance:
                actual_wallet_balance = float(balance.get("unlocked_xmr", 0.0))
        except Exception:
            pass

        # Load les bonds vendors
        from db_persist import load_all_vendor_bonds
        vendor_bonds_db = load_all_vendor_bonds()

        snapshot = LiquidityEngine.compute_snapshot(
            users_db=users_db,
            orders_db=orders_db,
            vendor_bonds_db=vendor_bonds_db,
            xmr_usd_rate=xmr_rate,
            triggered_by="admin_request",
            actual_wallet_balance=actual_wallet_balance
        )

        # Ajouter les stats de la queue
        queue_stats = WithdrawalQueueManager.get_queue_stats()
        settlement_summary = PartialSettlementManager.get_settlement_summary()
        adjustment_stats = BalanceAdjustmentManager.get_adjustment_stats()

        return {
            "snapshot": snapshot,
            "queue_stats": queue_stats,
            "settlement_summary": settlement_summary,
            "adjustment_stats": adjustment_stats,
            "wallet_connected": actual_wallet_balance is not None,
            "xmr_usd_rate": xmr_rate
        }

    @app.get("/api/admin/liquidity/history")
    async def admin_get_liquidity_history(request: Request, limit: int = 48):
        """Returns l'historique des snapshots de liquidity (pour graphiques)."""
        _require_admin(request, users_db)
        snapshots = LiquidityEngine.get_snapshots(limit=limit)
        return {
            "snapshots": snapshots,
            "count": len(snapshots)
        }

    @app.post("/api/admin/liquidity/refresh")
    async def admin_refresh_liquidity(request: Request):
        """Force le recalcul immediat d'un snapshot de liquidity."""
        admin_user = _require_admin(request, users_db)

        xmr_rate, _rate_source = get_xmr_usd(default=165.0, max_age_sec=120)
        if _allow_clearnet_prices():
            try:
                import requests as _req
                resp = _req.get(
                    "https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=usd",
                    timeout=3
                )
                xmr_rate = float(resp.json()["monero"]["usd"])
            except Exception:
                xmr_rate = 165.0

        from db_persist import load_all_vendor_bonds
        vendor_bonds_db = load_all_vendor_bonds()

        snapshot = LiquidityEngine.compute_snapshot(
            users_db=users_db,
            orders_db=orders_db,
            vendor_bonds_db=vendor_bonds_db,
            xmr_usd_rate=xmr_rate,
            triggered_by=f"manual:{admin_user['username']}"
        )

        return {"success": True, "snapshot": snapshot}

    # ----------------------------------------------------------
    # ROUTE PUBLIQUE - Platform Status (sans auth, pour banners)
    # ----------------------------------------------------------

    @app.get("/api/platform/status")
    async def get_platform_status():
        """
        Endpoint PUBLIC - retourne l'etat des modes de controle.
        Called by frontend on load to show banners.
        Aucune donnee sensible n'est exposee.
        """
        return PlatformControlManager.get_platform_status()

    # ----------------------------------------------------------
    # ROUTES ADMIN - PLATFORM CONTROL
    # ----------------------------------------------------------

    @app.get("/api/admin/platform/config")
    async def admin_get_platform_config(request: Request):
        """Returns la configuration complete des modes de controle."""
        _require_admin(request, users_db)
        config = PlatformControlManager.get_admin_config()
        status = PlatformControlManager.get_platform_status()
        history = PlatformControlManager.get_freeze_history(limit=20)
        return {
            "config": config,
            "status": status,
            "recent_history": history
        }

    @app.post("/api/admin/platform/liquidity-protection")
    async def admin_set_liquidity_protection(request: Request):
        """
        Enables or disables le Liquidity Protection Mode.
        Body: {"enabled": bool}

        Quand actif, les users voient une banner transparente :
        "Withdrawals may be processed in multiple installments over time."
        """
        admin_user = _require_admin(request, users_db)
        data = await request.json()
        enabled = bool(data.get("enabled", False))

        result = PlatformControlManager.set_liquidity_protection_mode(
            enabled=enabled,
            admin=admin_user["username"]
        )

        from audit_log import log_admin, AuditEvent
        log_admin(AuditEvent.ADMIN_ACTION, admin_user["username"], {
            "action": "PLATFORM_LPM_ENABLED" if enabled else "PLATFORM_LPM_DISABLED",
            "liquidity_protection_mode": enabled
        })

        return result

    @app.post("/api/admin/platform/emergency-freeze")
    async def admin_set_emergency_freeze(request: Request):
        """
        Enables or disables le freeze d'urgence des withdrawals.
        Body: {
            "enabled": bool,
            "message": str (optionnel - message public affiche aux users)
        }

        Quand actif :
          - Tous les nouveaux withdrawals sont bloques.
          - Le message est visible publiquement par tous les users.
          - Les withdrawals deja en cours (processing) ne sont PAS cancelleds.
        """
        admin_user = _require_admin(request, users_db)
        data = await request.json()
        enabled = bool(data.get("enabled", False))
        message = data.get("message", "").strip() or None

        result = PlatformControlManager.set_emergency_freeze(
            enabled=enabled,
            admin=admin_user["username"],
            message=message
        )

        from audit_log import log_admin, AuditEvent
        log_admin(AuditEvent.ADMIN_ACTION, admin_user["username"], {
            "action": "PLATFORM_FREEZE_ACTIVATED" if enabled else "PLATFORM_FREEZE_DEACTIVATED",
            "emergency_freeze": enabled,
            "public_message": result.get("public_message")
        })

        return result

    @app.post("/api/admin/platform/freeze-message")
    async def admin_update_freeze_message(request: Request):
        """
        Update le message public du freeze sans changer son etat.
        Body: {"message": str}
        """
        admin_user = _require_admin(request, users_db)
        data = await request.json()
        message = data.get("message", "").strip()

        result = PlatformControlManager.update_freeze_message(
            message=message,
            admin=admin_user["username"]
        )
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "UPDATE_FAILED"))

        return result

    @app.post("/api/admin/platform/structured-policy")
    async def admin_set_structured_policy(request: Request):
        """
        Enables or disables la politique de structured withdrawals.
        Body: {
            "enabled": bool,
            "threshold_xmr": float (optionnel),
            "coverage_trigger": float (optionnel, ex: 0.80 pour 80%)
        }

        Quand actif, les withdrawals au-dessus du seuil sont automatiquement
        convertis en partial settlements. L'user recoit un calendrier
        detaille et transparent.
        """
        admin_user = _require_admin(request, users_db)
        data = await request.json()
        enabled = bool(data.get("enabled", False))
        threshold_xmr = data.get("threshold_xmr")
        coverage_trigger = data.get("coverage_trigger")

        result = PlatformControlManager.set_structured_withdrawal_policy(
            enabled=enabled,
            admin=admin_user["username"],
            threshold_xmr=float(threshold_xmr) if threshold_xmr is not None else None,
            coverage_trigger=float(coverage_trigger) if coverage_trigger is not None else None
        )

        from audit_log import log_admin, AuditEvent
        log_admin(AuditEvent.ADMIN_ACTION, admin_user["username"], {
            "action": "PLATFORM_STRUCTURED_ENABLED" if enabled else "PLATFORM_STRUCTURED_DISABLED",
            "structured_policy": enabled,
            "threshold_xmr": result.get("threshold_xmr"),
            "coverage_trigger": result.get("coverage_trigger")
        })

        return result

    @app.get("/api/admin/platform/check-withdrawal/{amount_xmr}")
    async def admin_check_withdrawal_policy(amount_xmr: float, request: Request):
        """
        Simule la verification d'un withdrawal selon les politiques actives.
        Useful for testing configuration before enabling it.
        """
        _require_admin(request, users_db)

        freeze_check = PlatformControlManager.check_withdrawal_allowed()
        structured_check = PlatformControlManager.check_structured_policy(amount_xmr)

        # Fetch le dernier coverage ratio
        latest = LiquidityEngine.get_latest_snapshot()
        coverage = float(latest.get("coverage_ratio", 1.0)) if latest else 1.0

        structured_with_coverage = PlatformControlManager.check_structured_policy(
            amount_xmr, coverage_ratio=coverage
        )

        return {
            "amount_xmr": amount_xmr,
            "freeze_check": freeze_check,
            "structured_check_policy_only": structured_check,
            "structured_check_with_coverage": structured_with_coverage,
            "current_coverage_ratio": coverage,
            "platform_status": PlatformControlManager.get_platform_status()
        }

    print("[WITHDRAWAL] All API routes injected successfully")
    print("[WITHDRAWAL] User routes: /api/withdrawal/*")
    print("[WITHDRAWAL] Admin routes: /api/admin/withdrawals/*, /api/admin/balance/*, /api/admin/liquidity/*")
    print("[PLATFORM]  Platform Control routes: /api/platform/status, /api/admin/platform/*")


