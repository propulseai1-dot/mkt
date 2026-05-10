"""
SILKGENESIS — Affiliate commission engine (XMR, internal balance).

Splits marketplace commission (vendor tier fee on escrow release):
  • Buyer referral L1: 40% of marketplace commission
  • Buyer referral L2: 10%
  • Buyer referral L3: 4%
  • Vendor referrer L1: 1% of marketplace commission
Total affiliate share = 55% of commission; platform keeps 45%.

Persisted ledger: affiliate_ledger.json under persist_base_dir().
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from silk_paths import persist_base_dir

AFFILIATE_LEDGER_FILE = os.path.join(persist_base_dir(), "affiliate_ledger.json")

# Fractions of *marketplace commission* (not sale amount)
BUYER_L1_FRAC = 0.40
BUYER_L2_FRAC = 0.10
BUYER_L3_FRAC = 0.04
VENDOR_REF_FRAC = 0.01

_lock = threading.Lock()
_state: Dict[str, Any] = {"payments": []}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_ledger() -> None:
    global _state
    try:
        if os.path.isfile(AFFILIATE_LEDGER_FILE):
            with open(AFFILIATE_LEDGER_FILE, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data.get("payments"), list):
                _state["payments"] = data["payments"]
    except Exception:
        pass


def _save_ledger() -> None:
    try:
        with open(AFFILIATE_LEDGER_FILE, "w", encoding="utf-8") as f:
            json.dump(_state, f, indent=2)
    except Exception:
        pass


_load_ledger()


def buyer_referral_chain(users_db: dict, buyer: Optional[str], max_depth: int = 3) -> List[str]:
    """Returns [L1, L2, L3] referrer usernames walking referred_by from buyer upward."""
    if not buyer or buyer not in users_db:
        return []
    chain: List[str] = []
    u = buyer
    for _ in range(max_depth):
        ref = (users_db.get(u) or {}).get("referred_by")
        if not ref or ref not in users_db:
            break
        if ref in chain:
            break
        chain.append(ref)
        u = ref
    return chain[:max_depth]


def apply_affiliate_payouts(
    users_db: dict,
    buyer: Optional[str],
    vendor: str,
    commission_xmr: float,
    order_volume_xmr: float,
    order_id: str,
) -> Dict[str, Any]:
    """
    Credits affiliate balances from marketplace commission. Caller must hold funds_rlock.
    Returns affiliate_total_xmr and payout detail for settlement JSON.
    """
    commission_xmr = float(commission_xmr)
    if commission_xmr <= 0:
        return {"total_affiliate_xmr": 0.0, "payouts": [], "platform_net_commission_xmr": 0.0}

    payouts: List[Dict[str, Any]] = []
    chain = buyer_referral_chain(users_db, buyer, 3)
    rates = [
        (BUYER_L1_FRAC, "buyer_l1", 0),
        (BUYER_L2_FRAC, "buyer_l2", 1),
        (BUYER_L3_FRAC, "buyer_l3", 2),
    ]
    for frac, role, idx in rates:
        if idx >= len(chain):
            continue
        user = chain[idx]
        if user == vendor:
            continue
        amt = round(commission_xmr * frac, 8)
        if amt <= 0:
            continue
        if user in users_db:
            users_db[user]["balance"] = round(float(users_db[user].get("balance", 0)) + amt, 8)
        payouts.append({"username": user, "role": role, "amount_xmr": amt})

    vref = (users_db.get(vendor) or {}).get("referred_by")
    if vref and vref in users_db and vref != buyer:
        amt = round(commission_xmr * VENDOR_REF_FRAC, 8)
        if amt > 0:
            users_db[vref]["balance"] = round(float(users_db[vref].get("balance", 0)) + amt, 8)
            payouts.append({"username": vref, "role": "vendor_l1", "amount_xmr": amt})

    total_aff = round(sum(p["amount_xmr"] for p in payouts), 8)
    platform_net = round(max(0.0, commission_xmr - total_aff), 8)

    entry = {
        "ts": _utc_now_iso(),
        "order_id": order_id,
        "buyer": buyer,
        "vendor": vendor,
        "commission_xmr": round(commission_xmr, 8),
        "order_volume_xmr": round(float(order_volume_xmr), 8),
        "affiliate_total_xmr": total_aff,
        "platform_net_commission_xmr": platform_net,
        "payouts": list(payouts),
    }
    with _lock:
        _state.setdefault("payments", []).append(entry)
        if len(_state["payments"]) > 5000:
            _state["payments"] = _state["payments"][-4000:]
        _save_ledger()

    return {
        "total_affiliate_xmr": total_aff,
        "payouts": payouts,
        "platform_net_commission_xmr": platform_net,
    }


def payments_for_user(username: str) -> List[Dict[str, Any]]:
    """User-facing history: rows where user received a payout."""
    out: List[Dict[str, Any]] = []
    for row in _state.get("payments", []):
        for p in row.get("payouts") or []:
            if p.get("username") == username:
                out.append(
                    {
                        "ts": row.get("ts"),
                        "order_id": row.get("order_id"),
                        "role": p.get("role"),
                        "amount_xmr": p.get("amount_xmr"),
                        "order_volume_xmr": row.get("order_volume_xmr"),
                        "commission_xmr": row.get("commission_xmr"),
                    }
                )
    out.sort(key=lambda x: x.get("ts") or "", reverse=True)
    return out[:100]


def stats_for_user(username: str) -> Dict[str, Any]:
    earned = 0.0
    orders_seen: set = set()
    volume_attr = 0.0
    for row in _state.get("payments", []):
        oid = row.get("order_id")
        vol = float(row.get("order_volume_xmr") or 0)
        user_hit = False
        for p in row.get("payouts") or []:
            if p.get("username") == username:
                earned += float(p.get("amount_xmr") or 0)
                user_hit = True
        if user_hit and oid and oid not in orders_seen:
            volume_attr += vol
            orders_seen.add(oid)
    return {
        "total_earned_xmr": round(earned, 8),
        "attributed_volume_xmr": round(volume_attr, 8),
    }


def leaderboard_current_month(top_n: int = 10) -> List[Dict[str, Any]]:
    """Aggregate affiliate XMR this calendar month (UTC); anonymized labels."""
    now = datetime.now(timezone.utc)
    prefix = f"{now.year:04d}-{now.month:02d}"
    totals: Dict[str, float] = {}
    for row in _state.get("payments", []):
        ts = row.get("ts") or ""
        if not ts.startswith(prefix):
            continue
        for p in row.get("payouts") or []:
            u = p.get("username")
            if not u:
                continue
            totals[u] = totals.get(u, 0.0) + float(p.get("amount_xmr") or 0)

    ranked = sorted(totals.items(), key=lambda x: x[1], reverse=True)[:top_n]
    out: List[Dict[str, Any]] = []
    for i, (uname, xmr) in enumerate(ranked, start=1):
        h = hashlib.sha256(f"silk-aff-{uname}-{prefix}".encode()).hexdigest()[:6].upper()
        out.append(
            {
                "rank": i,
                "label": f"Affiliate #{i} ({h})",
                "earnings_xmr": round(xmr, 8),
            }
        )
    return out


def program_static_payload(vendor_levels_for_examples: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Rules + example $1000 sale USD split per tier (marketing math)."""
    nominal_usd = 1000.0
    tiers_out = []
    for lvl in vendor_levels_for_examples:
        rate = float(lvl.get("commission", lvl.get("commission_rate", 0.08)))
        fee_usd = nominal_usd * rate
        affiliates_usd = fee_usd * 0.55
        market_usd = fee_usd * 0.45
        tiers_out.append(
            {
                "name": lvl.get("name", ""),
                "min_sales": int(lvl.get("min_sales", 0)),
                "commission_pct": round(rate * 100, 2),
                "fee_on_1000_usd": round(fee_usd, 2),
                "affiliates_on_1000_usd": round(affiliates_usd, 2),
                "market_on_1000_usd": round(market_usd, 2),
            }
        )
    return {
        "affiliate_share_of_commission": 0.55,
        "market_share_of_commission": 0.45,
        "buyer_chain": {"l1_pct_of_commission": 40, "l2_pct_of_commission": 10, "l3_pct_of_commission": 4},
        "vendor_referrer_pct_of_commission": 1,
        "max_buyer_depth": 3,
        "example_nominal_sale_usd": nominal_usd,
        "tiers": tiers_out,
        "tree": [
            {"id": "b1", "label": "Buyer referral level 1", "pct_of_market_commission": 40},
            {"id": "b2", "label": "Buyer referral level 2", "pct_of_market_commission": 10},
            {"id": "b3", "label": "Buyer referral level 3", "pct_of_market_commission": 4},
            {"id": "v1", "label": "Vendor referrer (direct)", "pct_of_market_commission": 1},
        ],
    }
