"""
Tests d'integration: requetes concurentes sur ordres (debit solde) et retraits
queue (soumission). Un TestClient par thread (Starlette n'est pas thread-safe sur
un seul client partage).
"""
from __future__ import annotations

import math
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import pytest
from fastapi.testclient import TestClient

# Adresse XMR 95 chars (base58) — valide pour config.validate_xmr_address
XMR_95 = "4" + "1" * 94


def _find_greenleaf_cheap_listing_id(ms) -> str:
    for lid, l in ms.listings_db.items():
        if l.get("vendor") == "GreenLeaf" and l.get("status") == "active":
            if float(l.get("price_xmr", 99)) < 0.5:
                return lid
    raise RuntimeError("No GreenLeaf listing with price < 0.5 (standard escrow)")


def _seed_integrity_buyer(ms, username: str, balance: float) -> str:
    from security import create_session, hash_password

    ms.users_db[username] = {
        "username": username,
        "password": hash_password("itest_secret_9"),
        "role": "buyer",
        "status": "active",
        "balance": balance,
        "xmr_address": XMR_95,
        "pgp_public_key": "-----BEGIN PGP (test)-----",
        "avatar": None,
        "pos": 0,
    }
    if "GreenLeaf" in ms.users_db:
        ms.users_db["GreenLeaf"]["pgp_public_key"] = "-----BEGIN PGP (vendor test)-----"
    return create_session(username, "buyer")


def _lock_price(ms, listing_id: str, price: float) -> None:
    ms.listings_db[listing_id]["price_xmr"] = float(price)


def _post_order(app, token: str, listing_id: str, buyer: str) -> tuple[int, str]:
    c = TestClient(app)
    r = c.post(
        "/api/orders",
        json={"listing_id": listing_id, "buyer": buyer, "escrow_mode": "standard"},
        headers={"Authorization": f"Bearer {token}"},
    )
    if r.status_code == 200:
        j = r.json()
        return r.status_code, j.get("order_id", "")
    return r.status_code, ""


def _post_withdraw(app, token: str, amount: float) -> int:
    c = TestClient(app)
    r = c.post(
        "/api/withdrawal/submit",
        json={"amount_xmr": amount, "dest_address": XMR_95, "notes": "itest"},
        headers={"Authorization": f"Bearer {token}"},
    )
    return r.status_code


def test_concurrent_orders_deplete_balance_exactly(app_ctx):
    """
    N threads placent le meme achat: seuls floor(balance / price) doivent reussir;
    le solde final = initial - reussites * price (verrou funds_rlock sur /api/orders).
    """
    ms = app_ctx
    from rate_limiter import reset_rate_limit

    user = "itest_orders_conc_1"
    initial = 1.0
    price = 0.1
    # 10 requetes reussies (plafond order/min) ; au-dela: 429 cote rate limit
    n_workers = 10
    expected_ok = int(round(initial / price))

    token = _seed_integrity_buyer(ms, user, initial)
    lid = _find_greenleaf_cheap_listing_id(ms)
    _lock_price(ms, lid, price)

    reset_rate_limit("order", token)
    assert math.isclose(float(ms.users_db[user]["balance"]), initial)

    with ThreadPoolExecutor(max_workers=n_workers) as ex:
        futs = [
            ex.submit(_post_order, ms.app, token, lid, user) for _ in range(n_workers)
        ]
        codes = [f.result()[0] for f in as_completed(futs)]

    n200 = sum(1 for c in codes if c == 200)
    final = float(ms.users_db[user]["balance"])
    assert n200 == expected_ok, f"got {n200} success, expected {expected_ok}, codes={codes}"
    assert math.isclose(final, initial - n200 * price, rel_tol=0, abs_tol=1e-7)
    assert math.isclose(final, 0.0, rel_tol=0, abs_tol=1e-6)


def test_concurrent_withdrawal_submits_not_negative(app_ctx):
    """
    4 retraits paralleles de 0.1 sur 0.3 XMR : exactement 3 reussissent, 1 refuse
    (solde insuffisant), solde final 0 — plus de solde negatif (debit sous funds_rlock
    avant insert file).
    """
    ms = app_ctx
    user = "itest_wd_conc_1"
    initial = 0.3
    each = 0.1
    n_workers = 4
    token = _seed_integrity_buyer(ms, user, initial)

    with ThreadPoolExecutor(max_workers=n_workers) as ex:
        futs = [ex.submit(_post_withdraw, ms.app, token, each) for _ in range(n_workers)]
        codes = [f.result() for f in as_completed(futs)]

    final = float(ms.users_db[user]["balance"])
    n200 = sum(1 for c in codes if c == 200)
    n400 = sum(1 for c in codes if c == 400)
    assert final >= -1e-9, f"negative balance: {final}"
    assert n200 == 3, f"expected 3 OK, 1 HTTP 400, got codes={codes}"
    assert n400 == 1
    assert math.isclose(final, 0.0, rel_tol=0, abs_tol=1e-7)


def test_mixed_concurrent_lock_no_deadlock(app_ctx):
    """
    Fumee: requetes concurentes ordre + retrait: pas de blocage (join borne),
    soldes coherents en memoire.
    """
    ms = app_ctx
    from rate_limiter import reset_rate_limit

    b_user, w_user = "itest_mix_b", "itest_mix_w"
    t_b = _seed_integrity_buyer(ms, b_user, 0.4)
    t_w = _seed_integrity_buyer(ms, w_user, 0.2)
    lid = _find_greenleaf_cheap_listing_id(ms)
    _lock_price(ms, lid, 0.05)
    reset_rate_limit("order", t_b)

    errors: list[BaseException] = []
    lock = threading.Lock()

    def run() -> None:
        try:
            c = TestClient(ms.app)
            c.post(
                "/api/orders",
                json={"listing_id": lid, "buyer": b_user, "escrow_mode": "standard"},
                headers={"Authorization": f"Bearer {t_b}"},
            )
            c.post(
                "/api/withdrawal/submit",
                json={"amount_xmr": 0.01, "dest_address": XMR_95, "notes": "mix"},
                headers={"Authorization": f"Bearer {t_w}"},
            )
        except BaseException as e:
            with lock:
                errors.append(e)

    threads = [threading.Thread(target=run) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=120)
    assert not errors, errors
    assert not any(t.is_alive() for t in threads)
    assert float(ms.users_db[b_user]["balance"]) >= -1e-9
    assert float(ms.users_db[w_user]["balance"]) >= -1e-9
