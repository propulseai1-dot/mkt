"""
SILKGENESIS - VENDOR BOND SYSTEM (Version Finale)
===================================================
Bond remboursable par categorie, configurable par admin.
Historique complet: paye / confisque / rembourse.
Visible publiquement sur le profil vendeur.
Validation manuelle admin pour remboursement.
"""
import os
import json
import secrets
import threading
from datetime import datetime, timedelta

from silk_paths import persist_base_dir

_bond_base = persist_base_dir()
BOND_STATE_FILE = os.path.join(_bond_base, "bond_config.json")
BOND_HISTORY_FILE = os.path.join(_bond_base, "bond_history.json")

_lock = threading.Lock()

# ============================================================
# CONFIGURATION PAR DEFAUT (en XMR, pas USD)
# Configurable par admin via /api/admin/bonds/config
# ============================================================
DEFAULT_BOND_CONFIG = {
    # DRUGS
    "Cannabis":         {"xmr": 1.5,  "usd_equiv": 150, "risk": "medium", "color": "#22c55e"},
    "Stimulants":       {"xmr": 2.5,  "usd_equiv": 250, "risk": "high",   "color": "#f59e0b"},
    "Psychedelics":     {"xmr": 2.0,  "usd_equiv": 200, "risk": "medium", "color": "#8b5cf6"},
    "Opioids":          {"xmr": 8.0,  "usd_equiv": 800, "risk": "critical","color": "#ef4444"},
    "Benzos":           {"xmr": 2.5,  "usd_equiv": 250, "risk": "high",   "color": "#f59e0b"},
    "Dissociatives":    {"xmr": 2.0,  "usd_equiv": 200, "risk": "medium", "color": "#8b5cf6"},
    "Empathogens":      {"xmr": 1.5,  "usd_equiv": 150, "risk": "medium", "color": "#22c55e"},
    "Steroids":         {"xmr": 1.0,  "usd_equiv": 100, "risk": "low",    "color": "#3b82f6"},
    "Prescription":     {"xmr": 2.5,  "usd_equiv": 250, "risk": "high",   "color": "#f59e0b"},
    # FRAUD
    "Fraud":            {"xmr": 3.0,  "usd_equiv": 300, "risk": "high",   "color": "#ef4444"},
    "Carding":          {"xmr": 3.0,  "usd_equiv": 300, "risk": "high",   "color": "#ef4444"},
    "Bank Accounts":    {"xmr": 3.0,  "usd_equiv": 300, "risk": "high",   "color": "#ef4444"},
    "PayPal / Cashapp": {"xmr": 2.0,  "usd_equiv": 200, "risk": "medium", "color": "#f59e0b"},
    "Identity Docs":    {"xmr": 3.0,  "usd_equiv": 300, "risk": "high",   "color": "#ef4444"},
    "Counterfeit":      {"xmr": 2.5,  "usd_equiv": 250, "risk": "high",   "color": "#f59e0b"},
    # DIGITAL
    "Digital Goods":    {"xmr": 1.5,  "usd_equiv": 150, "risk": "low",    "color": "#3b82f6"},
    "Accounts":         {"xmr": 1.0,  "usd_equiv": 100, "risk": "low",    "color": "#3b82f6"},
    "Malware / RATs":   {"xmr": 2.0,  "usd_equiv": 200, "risk": "medium", "color": "#f59e0b"},
    "Exploits / 0day":  {"xmr": 3.0,  "usd_equiv": 300, "risk": "high",   "color": "#ef4444"},
    "eBooks / Guides":  {"xmr": 0.5,  "usd_equiv": 50,  "risk": "low",    "color": "#22c55e"},
    "Software / Keys":  {"xmr": 1.0,  "usd_equiv": 100, "risk": "low",    "color": "#3b82f6"},
    # SERVICES
    "Services":         {"xmr": 1.5,  "usd_equiv": 150, "risk": "medium", "color": "#8b5cf6"},
    "Hacking":          {"xmr": 2.0,  "usd_equiv": 200, "risk": "medium", "color": "#f59e0b"},
    "DDoS":             {"xmr": 2.0,  "usd_equiv": 200, "risk": "medium", "color": "#f59e0b"},
    "Money Laundering": {"xmr": 3.0,  "usd_equiv": 300, "risk": "high",   "color": "#ef4444"},
    "Crypto Mixing":    {"xmr": 2.0,  "usd_equiv": 200, "risk": "medium", "color": "#f59e0b"},
    "Escrow Service":   {"xmr": 1.5,  "usd_equiv": 150, "risk": "low",    "color": "#3b82f6"},
    # WEAPONS
    "Weapons":          {"xmr": 5.0,  "usd_equiv": 500, "risk": "critical","color": "#ef4444"},
    "Firearms":         {"xmr": 5.0,  "usd_equiv": 500, "risk": "critical","color": "#ef4444"},
    "Ammunition":       {"xmr": 3.0,  "usd_equiv": 300, "risk": "high",   "color": "#ef4444"},
    "Knives / Blades":  {"xmr": 1.5,  "usd_equiv": 150, "risk": "medium", "color": "#f59e0b"},
    # OTHER
    "Other":            {"xmr": 1.0,  "usd_equiv": 100, "risk": "low",    "color": "#6b7280"},
    "Jewelry / Luxury": {"xmr": 1.0,  "usd_equiv": 100, "risk": "low",    "color": "#6b7280"},
    "Electronics":      {"xmr": 1.0,  "usd_equiv": 100, "risk": "low",    "color": "#6b7280"},
    # DEFAULT
    "default":          {"xmr": 2.0,  "usd_equiv": 200, "risk": "medium", "color": "#6b7280"},
}

REFUND_DAYS = 90           # Jours avant remboursement possible
DISPUTE_PENALTY_DAYS = 30  # Jours supplementaires par litige perdu

# ============================================================
# PERSISTANCE CONFIG
# ============================================================
_bond_config = {}   # {category_name: {xmr, usd_equiv, risk, color}}
_bond_history = {}  # {event_id: event_data}

def _load_config():
    global _bond_config
    if os.path.exists(BOND_STATE_FILE):
        try:
            with open(BOND_STATE_FILE, encoding='utf-8') as f:
                _bond_config = json.load(f)
            print(f"[BOND] Config loaded: {len(_bond_config)} categories")
            return
        except Exception as e:
            print(f"[BOND] Config load error: {e}")
    # Premiere fois: utiliser les defaults
    _bond_config = dict(DEFAULT_BOND_CONFIG)
    _save_config()

def _save_config():
    try:
        with open(BOND_STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(_bond_config, f, indent=2)
    except Exception as e:
        print(f"[BOND] Config save error: {e}")

def _load_history():
    global _bond_history
    if os.path.exists(BOND_HISTORY_FILE):
        try:
            with open(BOND_HISTORY_FILE, encoding='utf-8') as f:
                _bond_history = json.load(f)
        except Exception as e:
            print(f"[BOND] History load error: {e}")

def _save_history():
    try:
        with open(BOND_HISTORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(_bond_history, f, indent=2, default=str)
    except Exception as e:
        print(f"[BOND] History save error: {e}")

def _add_history_event(vendor: str, event_type: str, data: dict):
    """Ajouter un evenement a l'historique"""
    event_id = f"EVT_{secrets.token_hex(8)}"
    event = {
        "id": event_id,
        "vendor": vendor,
        "type": event_type,  # paid | refund_requested | refunded | seized | config_changed
        "timestamp": datetime.utcnow().isoformat(),
        **data
    }
    _bond_history[event_id] = event
    _save_history()
    return event

_load_config()
_load_history()

# ============================================================
# CONFIG MANAGEMENT (Admin)
# ============================================================

def get_all_bond_config() -> dict:
    """Retourner toute la configuration des bonds"""
    return dict(_bond_config)

def get_bond_amount_xmr(category_name: str) -> float:
    """Retourner le montant XMR du bond pour une categorie"""
    cfg = _bond_config.get(category_name) or _bond_config.get("default") or DEFAULT_BOND_CONFIG["default"]
    return cfg["xmr"]

def get_bond_config_for_category(category_name: str) -> dict:
    """Retourner la config complete pour une categorie"""
    return _bond_config.get(category_name) or _bond_config.get("default") or DEFAULT_BOND_CONFIG["default"]

def admin_update_bond_config(category_name: str, xmr: float, usd_equiv: float = None,
                              risk: str = None, color: str = None, admin: str = "admin") -> dict:
    """Admin: Modifier le montant du bond pour une categorie"""
    with _lock:
        old_config = _bond_config.get(category_name, {})
        new_config = {
            "xmr": round(xmr, 4),
            "usd_equiv": usd_equiv or round(xmr * 100, 0),
            "risk": risk or old_config.get("risk", "medium"),
            "color": color or old_config.get("color", "#6b7280")
        }
        _bond_config[category_name] = new_config
        _save_config()
        _add_history_event(admin, "config_changed", {
            "category": category_name,
            "old_xmr": old_config.get("xmr"),
            "new_xmr": xmr,
            "admin": admin
        })
        return new_config

def admin_add_category_bond(category_name: str, xmr: float, risk: str = "medium",
                             color: str = "#6b7280", admin: str = "admin") -> dict:
    """Admin: Ajouter une nouvelle categorie de bond"""
    return admin_update_bond_config(category_name, xmr, xmr * 100, risk, color, admin)

# ============================================================
# BOND CREATION & MANAGEMENT
# ============================================================

def create_bond(vendor_username: str, category_name: str, amount_xmr: float, amount_usd: float = 0) -> dict:
    """Creer un enregistrement de bond avec historique"""
    bond = {
        "vendor": vendor_username,
        "category": category_name,
        "amount_xmr": round(amount_xmr, 6),
        "amount_usd": amount_usd or round(amount_xmr * 100, 2),
        "paid_at": datetime.utcnow().isoformat(),
        "status": "active",  # active | refund_pending | refunded | seized
        "disputes_lost": 0,
        "disputes_won": 0,
        "refund_requested_at": None,
        "refund_approved_by": None,
        "refunded_at": None,
        "seized_at": None,
        "seized_reason": None,
        "seized_by": None,
        "history": []
    }
    # Ajouter l'evenement initial
    _add_history_event(vendor_username, "paid", {
        "category": category_name,
        "amount_xmr": amount_xmr,
        "amount_usd": amount_usd
    })
    bond["history"].append({
        "type": "paid",
        "timestamp": bond["paid_at"],
        "amount_xmr": amount_xmr,
        "note": f"Bond paid for category: {category_name}"
    })
    return bond

def can_request_refund(bond_data: dict) -> dict:
    """
    Verifier si le vendeur peut demander le remboursement.
    Retourne {"eligible": bool, "reason": str, "days_remaining": int}
    """
    if not bond_data:
        return {"eligible": False, "reason": "No bond found", "days_remaining": 0}

    status = bond_data.get("status")
    if status == "refunded":
        return {"eligible": False, "reason": "Bond already refunded", "days_remaining": 0}
    if status == "seized":
        return {"eligible": False, "reason": "Bond seized due to violations", "days_remaining": 0}
    if status == "refund_pending":
        return {"eligible": False, "reason": "Refund already requested - awaiting admin approval", "days_remaining": 0}

    paid_at = bond_data.get("paid_at")
    if not paid_at:
        return {"eligible": False, "reason": "Bond not paid", "days_remaining": 0}

    paid_dt = datetime.fromisoformat(paid_at)
    disputes_lost = bond_data.get("disputes_lost", 0)

    # Penalite pour chaque litige perdu
    required_days = REFUND_DAYS + (disputes_lost * DISPUTE_PENALTY_DAYS)
    eligible_date = paid_dt + timedelta(days=required_days)

    now = datetime.utcnow()
    if now >= eligible_date:
        return {
            "eligible": True,
            "reason": "Eligible for refund",
            "days_remaining": 0,
            "eligible_date": eligible_date.isoformat(),
            "required_days": required_days,
            "disputes_lost": disputes_lost
        }
    else:
        days_remaining = (eligible_date - now).days
        return {
            "eligible": False,
            "reason": f"Must wait {days_remaining} more days (disputes lost: {disputes_lost})",
            "days_remaining": days_remaining,
            "eligible_date": eligible_date.isoformat(),
            "required_days": required_days,
            "disputes_lost": disputes_lost
        }

def request_refund(bond_data: dict, vendor: str) -> dict:
    """Vendeur demande le remboursement (validation admin requise)"""
    refund_check = can_request_refund(bond_data)
    if not refund_check["eligible"]:
        return {"success": False, "error": refund_check["reason"]}

    bond_data["status"] = "refund_pending"
    bond_data["refund_requested_at"] = datetime.utcnow().isoformat()
    if "history" not in bond_data:
        bond_data["history"] = []
    bond_data["history"].append({
        "type": "refund_requested",
        "timestamp": datetime.utcnow().isoformat(),
        "note": "Vendor requested refund - awaiting admin approval"
    })
    _add_history_event(vendor, "refund_requested", {
        "amount_xmr": bond_data.get("amount_xmr"),
        "category": bond_data.get("category")
    })
    return {"success": True, "message": "Refund requested. Admin will review within 24h."}

def admin_approve_refund(bond_data: dict, vendor: str, admin: str) -> dict:
    """Admin approuve le remboursement"""
    if bond_data.get("status") != "refund_pending":
        return {"success": False, "error": f"Bond status is '{bond_data.get('status')}', not 'refund_pending'"}

    bond_data["status"] = "refunded"
    bond_data["refunded_at"] = datetime.utcnow().isoformat()
    bond_data["refund_approved_by"] = admin
    if "history" not in bond_data:
        bond_data["history"] = []
    bond_data["history"].append({
        "type": "refunded",
        "timestamp": datetime.utcnow().isoformat(),
        "approved_by": admin,
        "amount_xmr": bond_data.get("amount_xmr"),
        "note": f"Refund approved by admin {admin}"
    })
    _add_history_event(vendor, "refunded", {
        "amount_xmr": bond_data.get("amount_xmr"),
        "category": bond_data.get("category"),
        "approved_by": admin
    })
    return {"success": True, "amount_xmr": bond_data.get("amount_xmr")}

def admin_reject_refund(bond_data: dict, vendor: str, admin: str, reason: str = "") -> dict:
    """Admin rejette la demande de remboursement"""
    bond_data["status"] = "active"
    bond_data["refund_requested_at"] = None
    if "history" not in bond_data:
        bond_data["history"] = []
    bond_data["history"].append({
        "type": "refund_rejected",
        "timestamp": datetime.utcnow().isoformat(),
        "rejected_by": admin,
        "reason": reason,
        "note": f"Refund rejected by admin {admin}: {reason}"
    })
    _add_history_event(vendor, "refund_rejected", {
        "admin": admin,
        "reason": reason
    })
    return {"success": True, "message": "Refund request rejected"}

def admin_seize_bond(bond_data: dict, vendor: str, admin: str, reason: str) -> dict:
    """Admin confisque le bond (violation des regles)"""
    if bond_data.get("status") == "seized":
        return {"success": False, "error": "Bond already seized"}

    seized_amount = bond_data.get("amount_xmr", 0)
    bond_data["status"] = "seized"
    bond_data["seized_at"] = datetime.utcnow().isoformat()
    bond_data["seized_reason"] = reason
    bond_data["seized_by"] = admin
    if "history" not in bond_data:
        bond_data["history"] = []
    bond_data["history"].append({
        "type": "seized",
        "timestamp": datetime.utcnow().isoformat(),
        "seized_by": admin,
        "reason": reason,
        "amount_xmr": seized_amount,
        "note": f"Bond seized by admin {admin}: {reason}"
    })
    _add_history_event(vendor, "seized", {
        "amount_xmr": seized_amount,
        "reason": reason,
        "admin": admin
    })
    return {"success": True, "seized_amount_xmr": seized_amount, "reason": reason}

def record_dispute_result(bond_data: dict, vendor: str, won: bool) -> dict:
    """Enregistrer le resultat d'un litige (impact sur le delai de remboursement)"""
    if won:
        bond_data["disputes_won"] = bond_data.get("disputes_won", 0) + 1
        note = "Dispute won - no penalty"
    else:
        bond_data["disputes_lost"] = bond_data.get("disputes_lost", 0) + 1
        note = f"Dispute lost - +{DISPUTE_PENALTY_DAYS} days penalty on refund"

    if "history" not in bond_data:
        bond_data["history"] = []
    bond_data["history"].append({
        "type": "dispute_result",
        "timestamp": datetime.utcnow().isoformat(),
        "won": won,
        "note": note
    })
    return {"success": True, "disputes_lost": bond_data.get("disputes_lost", 0)}

# ============================================================
# PUBLIC PROFILE DATA
# ============================================================

def get_public_bond_info(bond_data: dict) -> dict:
    """
    Retourner les infos publiques du bond pour le profil vendeur.
    Ne pas exposer les details sensibles.
    """
    if not bond_data:
        return {"has_bond": False}

    status = bond_data.get("status", "unknown")
    status_labels = {
        "active": {"label": "Bond Active", "color": "#22c55e", "icon": "🔒"},
        "refund_pending": {"label": "Refund Pending", "color": "#f59e0b", "icon": "⏳"},
        "refunded": {"label": "Bond Refunded", "color": "#6b7280", "icon": "↩️"},
        "seized": {"label": "Bond Seized", "color": "#ef4444", "icon": "🚫"}
    }
    status_info = status_labels.get(status, {"label": status, "color": "#6b7280", "icon": "❓"})

    paid_at = bond_data.get("paid_at", "")
    paid_date = paid_at[:10] if paid_at else "Unknown"

    return {
        "has_bond": True,
        "category": bond_data.get("category"),
        "amount_xmr": bond_data.get("amount_xmr"),
        "status": status,
        "status_label": status_info["label"],
        "status_color": status_info["color"],
        "status_icon": status_info["icon"],
        "paid_date": paid_date,
        "disputes_lost": bond_data.get("disputes_lost", 0),
        "disputes_won": bond_data.get("disputes_won", 0),
        "verified": status == "active"
    }

# ============================================================
# HISTORY QUERIES
# ============================================================

def get_vendor_history(vendor: str) -> list:
    """Retourner l'historique complet des bonds d'un vendeur"""
    events = [e for e in _bond_history.values() if e.get("vendor") == vendor]
    return sorted(events, key=lambda x: x.get("timestamp", ""), reverse=True)

def get_all_history(limit: int = 200) -> list:
    """Retourner tout l'historique (admin)"""
    events = list(_bond_history.values())
    return sorted(events, key=lambda x: x.get("timestamp", ""), reverse=True)[:limit]

def get_pending_refunds(vendor_bonds_db: dict) -> list:
    """Retourner tous les bonds en attente de remboursement"""
    return [
        {**bond, "vendor": vendor}
        for vendor, bond in vendor_bonds_db.items()
        if bond.get("status") == "refund_pending"
    ]

def get_bond_stats(vendor_bonds_db: dict) -> dict:
    """Stats globales des bonds"""
    bonds = list(vendor_bonds_db.values())
    return {
        "total": len(bonds),
        "active": sum(1 for b in bonds if b.get("status") == "active"),
        "refund_pending": sum(1 for b in bonds if b.get("status") == "refund_pending"),
        "refunded": sum(1 for b in bonds if b.get("status") == "refunded"),
        "seized": sum(1 for b in bonds if b.get("status") == "seized"),
        "total_xmr_locked": round(sum(b.get("amount_xmr", 0) for b in bonds if b.get("status") == "active"), 6),
        "total_xmr_seized": round(sum(b.get("amount_xmr", 0) for b in bonds if b.get("status") == "seized"), 6),
        "total_xmr_refunded": round(sum(b.get("amount_xmr", 0) for b in bonds if b.get("status") == "refunded"), 6),
    }

# Legacy compat
def get_bond_amount(category_id: str) -> float:
    """Legacy: retourne montant USD equiv (pour compatibilite)"""
    cfg = _bond_config.get(category_id) or _bond_config.get("default") or DEFAULT_BOND_CONFIG["default"]
    return cfg.get("usd_equiv", 200.0)
