"""Tests for Epic Mode: middleware, admin toggle, epic_lifo, estimate endpoint,
execute-payoff, and cache invalidation webhook."""
import os
import sys
from datetime import date
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user
from app.sales_engine import build_fifo_lots, compute_grossup_shares


# ── Helpers ──────────────────────────────────────────────────────────────────

ADMIN_EMAIL = "admin@example.com"


def _admin_env():
    return patch.dict(os.environ, {"ADMIN_EMAIL": ADMIN_EMAIL})


def _register_admin(client):
    client.post("/api/auth/test-login", json={"email": ADMIN_EMAIL})


def _set_epic_mode(db_session, active: bool):
    from sqlalchemy import text
    db_session.execute(
        text("UPDATE system_settings SET value = :v WHERE key = 'epic_mode'"),
        {"v": "true" if active else "false"},
    )
    db_session.commit()
    import scaffold.epic_mode as em
    em._cache = None


@pytest.fixture(autouse=True)
def reset_epic_cache():
    import scaffold.epic_mode as em
    em._cache = None
    yield
    em._cache = None


def _make_vesting(vest_date, shares, share_price, grant_type="Bonus"):
    return {
        "date": vest_date,
        "event_type": "Vesting",
        "vested_shares": shares,
        "grant_price": 0.0,
        "share_price": share_price,
        "grant_type": grant_type,
    }


# ============================================================
# epic_lifo lot selection
# ============================================================

def test_epic_lifo_prefers_ltcg_lots():
    """LTCG lots (held ≥ 365d) should be consumed before STCG lots."""
    as_of = date(2024, 7, 1)
    events = [
        _make_vesting(date(2023, 1, 1), 100, 10.0),  # held 547d — LTCG
        _make_vesting(date(2024, 5, 1), 100, 15.0),  # held 61d  — STCG
        _make_vesting(date(2024, 6, 1), 100, 20.0),  # held 30d  — STCG
    ]
    lots = build_fifo_lots(events, as_of, order='epic_lifo')
    # LTCG lot should be first
    assert lots[0][0] == date(2023, 1, 1), "Oldest LTCG lot should be consumed first"
    assert lots[1][0] in (date(2024, 6, 1), date(2024, 5, 1)), "STCG lots follow"


def test_epic_lifo_falls_back_to_stcg():
    """When LTCG lots are exhausted, STCG lots are consumed (LIFO order within STCG)."""
    as_of = date(2024, 7, 1)
    events = [
        _make_vesting(date(2024, 5, 1), 50, 10.0),   # STCG
        _make_vesting(date(2024, 6, 1), 100, 15.0),  # STCG (newest)
    ]
    lots = build_fifo_lots(events, as_of, order='epic_lifo')
    # LIFO within STCG — newest first
    assert lots[0][0] == date(2024, 6, 1)
    assert lots[1][0] == date(2024, 5, 1)


def test_epic_lifo_all_ltcg_lifo_order():
    """When all lots are LTCG, LIFO order is preserved within the LTCG partition."""
    as_of = date(2025, 1, 1)
    events = [
        _make_vesting(date(2021, 1, 1), 100, 5.0),
        _make_vesting(date(2022, 1, 1), 100, 8.0),
        _make_vesting(date(2023, 1, 1), 100, 12.0),
    ]
    lots = build_fifo_lots(events, as_of, order='epic_lifo')
    # All LTCG, LIFO order: newest first
    assert lots[0][0] == date(2023, 1, 1)
    assert lots[1][0] == date(2022, 1, 1)
    assert lots[2][0] == date(2021, 1, 1)


# ============================================================
# Sales estimate endpoint
# ============================================================

def _seed_grant_and_price(client):
    """Add a bonus grant (vested long ago) and a price; return the grant ID."""
    grant_resp = client.post("/api/grants", json={
        "year": 2022, "type": "Bonus",
        "shares": 1000, "price": 10.0,
        "vest_start": "2022-01-01", "periods": 1,
        "exercise_date": "2030-01-01", "dp_shares": 0,
    })
    assert grant_resp.status_code in (200, 201), grant_resp.text
    client.post("/api/prices", json={"effective_date": "2024-01-01", "price": 50.0})
    return grant_resp.json()["id"]


def test_sales_estimate_endpoint(client):
    register_user(client, "est@example.com")
    _seed_grant_and_price(client)

    resp = client.get("/api/sales/estimate", params={
        "price_per_share": 50.0,
        "target_net_cash": 10000.0,
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "shares_needed" in data
    assert "gross_proceeds" in data
    assert "estimated_tax" in data
    assert "net_proceeds" in data
    assert data["shares_needed"] > 0
    assert data["net_proceeds"] >= 9999  # close to target


def test_sales_estimate_requires_auth(client):
    resp = client.get("/api/sales/estimate", params={
        "price_per_share": 50.0,
        "target_net_cash": 10000.0,
    })
    assert resp.status_code == 401


def test_sales_estimate_missing_params(client):
    register_user(client)
    resp = client.get("/api/sales/estimate")
    assert resp.status_code == 422  # missing required query params


# ============================================================
# Execute-payoff endpoint
# ============================================================

def _seed_purchase_with_loan(client):
    """Add a purchase grant + loan via /api/flows/new-purchase. Returns loan_id."""
    # 1000*$5 = $5,000 → min DP $500 at 10%, so loan must be ≤ $4,500.
    resp = client.post("/api/flows/new-purchase", json={
        "year": 2021,
        "shares": 1000,
        "price": 5.0,
        "vest_start": "2021-01-01",
        "periods": 1,
        "exercise_date": "2030-01-01",
        "loan_amount": 4500.0,
        "loan_rate": 0.05,
        "loan_due_date": "2030-01-01",
        "generate_payoff_sale": False,
    })
    assert resp.status_code in (200, 201), resp.text
    loan = resp.json().get("loan")
    assert loan, "Expected loan in response"
    client.post("/api/prices", json={"effective_date": "2024-01-01", "price": 50.0})
    return loan["id"]


def test_execute_payoff_creates_sale(client):
    register_user(client, "payoff@example.com")
    loan_id = _seed_purchase_with_loan(client)

    resp = client.post(f"/api/loans/{loan_id}/execute-payoff")
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["loan_id"] == loan_id
    assert data["shares"] > 0


def test_execute_payoff_idempotent(client):
    register_user(client, "payoff2@example.com")
    loan_id = _seed_purchase_with_loan(client)

    r1 = client.post(f"/api/loans/{loan_id}/execute-payoff")
    r2 = client.post(f"/api/loans/{loan_id}/execute-payoff")
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["id"] == r2.json()["id"], "Second call should return same sale"


def test_execute_payoff_not_found(client):
    register_user(client)
    resp = client.post("/api/loans/99999/execute-payoff")
    assert resp.status_code == 404


# ============================================================
# Epic Mode middleware
# ============================================================

def test_epic_mode_off_by_default(client):
    register_user(client)
    # Normal reads should work
    resp = client.get("/api/grants")
    assert resp.status_code == 200


def test_epic_mode_blocks_grant_writes(client, db_session):
    register_user(client, "epicuser@example.com")
    _set_epic_mode(db_session, True)

    resp = client.post("/api/grants", json={
        "year": 2022, "type": "Bonus", "shares": 100, "price": 10.0,
        "vest_start": "2022-01-01", "periods": 4,
        "exercise_date": "2030-01-01", "dp_shares": 0,
    })
    assert resp.status_code == 403, resp.text


def test_epic_mode_blocks_price_writes(client, db_session):
    register_user(client)
    _set_epic_mode(db_session, True)
    resp = client.post("/api/prices", json={"effective_date": "2024-01-01", "price": 50.0})
    assert resp.status_code == 403


def test_epic_mode_blocks_loan_create(client, db_session):
    register_user(client)
    _set_epic_mode(db_session, True)
    resp = client.post("/api/loans", json={
        "grant_year": 2022, "grant_type": "Purchase", "loan_type": "Purchase",
        "loan_year": 2022, "amount": 5000.0, "interest_rate": 0.05,
        "due_date": "2030-01-01",
    })
    assert resp.status_code == 403


def test_epic_mode_allows_sale_writes(client, db_session):
    """POST /api/sales should succeed even in epic_mode (future dates allowed)."""
    register_user(client, "salesok@example.com")
    # Seed data before enabling epic mode
    client.post("/api/grants", json={
        "year": 2021, "type": "Bonus", "shares": 1000, "price": 5.0,
        "vest_start": "2021-01-01", "periods": 1,
        "exercise_date": "2030-01-01", "dp_shares": 0,
    })
    client.post("/api/prices", json={"effective_date": "2024-01-01", "price": 50.0})
    _set_epic_mode(db_session, True)

    from datetime import timedelta
    future_date = (date.today() + timedelta(days=90)).isoformat()
    resp = client.post("/api/sales", json={
        "date": future_date,
        "shares": 10,
        "price_per_share": 50.0,
    })
    assert resp.status_code in (200, 201), f"Sale write blocked in epic_mode: {resp.text}"


def test_epic_mode_allows_execute_payoff(client, db_session):
    """POST /api/loans/{id}/execute-payoff should work in epic_mode (user action)."""
    register_user(client, "payoffepic@example.com")
    loan_id = _seed_purchase_with_loan(client)
    _set_epic_mode(db_session, True)

    resp = client.post(f"/api/loans/{loan_id}/execute-payoff")
    assert resp.status_code == 201, resp.text


def test_epic_mode_allows_reads(client, db_session):
    """GET endpoints are always allowed in epic_mode."""
    register_user(client)
    _set_epic_mode(db_session, True)
    assert client.get("/api/grants").status_code == 200
    assert client.get("/api/prices").status_code == 200
    assert client.get("/api/loans").status_code == 200


# ============================================================
# Epic Mode admin toggle
# ============================================================

def test_epic_mode_admin_toggle(client, db_session):
    with _admin_env():
        _register_admin(client)
        resp = client.get("/api/admin/epic-mode")
    assert resp.status_code == 200
    assert resp.json()["active"] is False

    with _admin_env():
        resp = client.post("/api/admin/epic-mode", json={"active": True})
    assert resp.status_code == 200
    assert resp.json()["active"] is True

    with _admin_env():
        resp = client.get("/api/admin/epic-mode")
    assert resp.json()["active"] is True


def test_epic_mode_admin_toggle_non_admin_forbidden(client):
    register_user(client, "nonadmin@example.com")
    assert client.get("/api/admin/epic-mode").status_code == 403
    assert client.post("/api/admin/epic-mode", json={"active": True}).status_code == 403


# ============================================================
# Cache invalidation webhook
# ============================================================

def test_cache_invalidate_missing_secret_503(client):
    """When CACHE_INVALIDATE_SECRET is not set, endpoint returns 503."""
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("CACHE_INVALIDATE_SECRET", None)
        resp = client.post("/api/internal/cache-invalidate",
                           json={"scope": "all"},
                           headers={"Authorization": "Bearer anything"})
    assert resp.status_code == 503


def test_cache_invalidate_wrong_secret_401(client):
    with patch.dict(os.environ, {"CACHE_INVALIDATE_SECRET": "correct-secret"}):
        resp = client.post("/api/internal/cache-invalidate",
                           json={"scope": "all"},
                           headers={"Authorization": "Bearer wrong-secret"})
    assert resp.status_code == 401


def test_cache_invalidate_triggers_fan_out(client):
    with patch.dict(os.environ, {"CACHE_INVALIDATE_SECRET": "mysecret"}):
        with patch("app.event_cache.schedule_fan_out") as mock_fan_out:
            resp = client.post("/api/internal/cache-invalidate",
                               json={"scope": "all"},
                               headers={"Authorization": "Bearer mysecret"})
    assert resp.status_code == 202
    mock_fan_out.assert_called_once()


def test_cache_invalidate_triggers_recompute_per_user(client):
    with patch.dict(os.environ, {"CACHE_INVALIDATE_SECRET": "mysecret"}):
        with patch("app.event_cache.schedule_recompute") as mock_recompute:
            resp = client.post("/api/internal/cache-invalidate",
                               json={"user_ids": [1, 2, 3]},
                               headers={"Authorization": "Bearer mysecret"})
    assert resp.status_code == 202
    assert mock_recompute.call_count == 3


def test_cache_invalidate_bad_body_400(client):
    with patch.dict(os.environ, {"CACHE_INVALIDATE_SECRET": "mysecret"}):
        resp = client.post("/api/internal/cache-invalidate",
                           json={},
                           headers={"Authorization": "Bearer mysecret"})
    assert resp.status_code == 400
